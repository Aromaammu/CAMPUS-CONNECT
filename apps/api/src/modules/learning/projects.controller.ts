import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, NotFoundException, Param, Post, Query, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Prisma } from '@prisma/client';
import { SessionUser, can, projectReviewSchema, projectSubmitSchema } from '@cc/shared';
import type { Request } from 'express';
import { z } from 'zod';
import { AuditService } from '../../common/audit.service';
import { CurrentUser, branchesFor } from '../../common/auth';
import { FilesService } from '../../common/files.service';
import { Zod, clientIp } from '../../common/http';
import { PrismaService } from '../../common/prisma.service';
import { AcademicsService } from '../academics/academics.service';
import { AttendanceService } from '../attendance/attendance.service';
import { NotifyService } from '../notifications/notify.service';

const projectInclude = {
  enrolment: { select: { id: true, status: true, studentId: true, batchId: true, student: { select: { id: true, code: true, userId: true, user: { select: { name: true } } } }, batch: { select: { id: true, name: true, branchId: true, projectsOpen: true, course: { select: { name: true, totalMinutes: true } }, branch: { select: { code: true } }, teachers: { select: { employeeId: true, employee: { select: { userId: true } } } } } } } },
  submissions: { orderBy: { version: 'desc' } },
  reviews: { orderBy: { createdAt: 'desc' }, include: { reviewer: { select: { name: true } } } },
} satisfies Prisma.ProjectInclude;
type ProjectFull = Prisma.ProjectGetPayload<{ include: typeof projectInclude }>;

/** PRD §9.4: student submits → teacher reviews → Branch Admin gives final approval (course Completed). */
@Controller()
export class ProjectsController {
  constructor(
    private prisma: PrismaService, private acad: AcademicsService, private files: FilesService, private notify: NotifyService,
    private audit: AuditService, private att: AttendanceService,
  ) {}

  /** Open when the batch has delivered all its hours, or the Branch Admin opened submissions. */
  async submissionsOpen(batch: { id: string; projectsOpen: boolean; course: { totalMinutes: number } }) {
    if (batch.projectsOpen) return true;
    const h = await this.acad.hours(batch.id);
    return h.deliveredMinutes >= batch.course.totalMinutes;
  }

  private async view(p: ProjectFull, user: SessionUser) {
    const fileIds = [...new Set(p.submissions.flatMap((s) => s.fileIds))];
    const files = await this.prisma.fileObject.findMany({ where: { id: { in: fileIds } }, select: { id: true, name: true, sizeBytes: true } });
    const b = p.enrolment.batch;
    const teacher = !!user.employeeId && b.teachers.some((t) => t.employeeId === user.employeeId) && can(user, 'projects.review', b.branchId);
    const approver = can(user, 'projects.approve', b.branchId);
    return {
      id: p.id, status: p.status, updatedAt: p.updatedAt,
      student: { id: p.enrolment.student.id, code: p.enrolment.student.code, name: p.enrolment.student.user.name },
      batch: { id: b.id, name: b.name, course: b.course.name, branch: b.branch.code },
      submissions: p.submissions.map((s) => ({ ...s, files: s.fileIds.map((id) => files.find((f) => f.id === id)).filter(Boolean).map((f) => ({ ...f!, url: this.files.signedUrl(f!.id, user.id, { download: true }) })) })),
      reviews: p.reviews.map((r) => ({ id: r.id, stage: r.stage, decision: r.decision, comment: r.comment, createdAt: r.createdAt, reviewer: r.reviewer.name })),
      canReview: teacher && p.status === 'SUBMITTED',
      canApprove: approver && p.status === 'TEACHER_APPROVED',
    };
  }

  private async load(id: string) {
    const p = await this.prisma.project.findUnique({ where: { id }, include: projectInclude });
    if (!p) throw new NotFoundException('Project not found');
    return p;
  }

  private assertSee(user: SessionUser, p: ProjectFull) {
    const b = p.enrolment.batch;
    if (p.enrolment.student.userId === user.id) return;
    if (user.employeeId && b.teachers.some((t) => t.employeeId === user.employeeId)) return;
    if (can(user, 'projects.approve', b.branchId) || can(user, 'batches.manage', b.branchId)) return;
    throw new ForbiddenException('You do not have access to this project');
  }

  /** S8: my project for each batch. */
  @Get('me/projects')
  async mine(@CurrentUser() user: SessionUser) {
    if (!user.studentId) throw new ForbiddenException('Only students submit projects');
    const enrolments = await this.prisma.enrolment.findMany({
      where: { studentId: user.studentId, status: { in: ['ACTIVE', 'COMPLETED', 'ON_HOLD'] } },
      include: { batch: { select: { id: true, name: true, projectsOpen: true, course: { select: { name: true, totalMinutes: true } }, branch: { select: { code: true } } } } },
    });
    const out = [];
    for (const e of enrolments) {
      const p = await this.prisma.project.findUnique({ where: { enrolmentId: e.id }, include: projectInclude });
      const open = await this.submissionsOpen(e.batch);
      out.push({
        enrolmentId: e.id, batch: { id: e.batch.id, name: e.batch.name, course: e.batch.course.name, branch: e.batch.branch.code },
        open, project: p ? await this.view(p, user) : null,
        canSubmit: open && e.status === 'ACTIVE' && (!p || ['NOT_SUBMITTED', 'CHANGES_REQUESTED'].includes(p.status)),
      });
    }
    return out;
  }

  @Post('projects/upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 1024 * 1024 * 1024 } }))
  async upload(@CurrentUser() user: SessionUser, @UploadedFile() file?: Express.Multer.File) {
    if (!user.studentId) throw new ForbiddenException('Only students submit projects');
    const f = await this.files.save(file, { purpose: 'project', userId: user.id, kinds: ['pdf', 'office', 'image', 'text', 'video'] });
    return { id: f.id, name: f.name, sizeBytes: f.sizeBytes };
  }

  @Post('me/projects/:enrolmentId/submit')
  async submit(@CurrentUser() user: SessionUser, @Param('enrolmentId') enrolmentId: string, @Body(new Zod(projectSubmitSchema)) body: z.infer<typeof projectSubmitSchema>) {
    const e = await this.prisma.enrolment.findUnique({ where: { id: enrolmentId }, include: { batch: { select: { id: true, name: true, projectsOpen: true, branchId: true, course: { select: { totalMinutes: true } }, teachers: { select: { employee: { select: { userId: true } } } } } } } });
    if (!e || e.studentId !== user.studentId) throw new NotFoundException('Enrolment not found');
    if (e.status !== 'ACTIVE') throw new BadRequestException('Your place in this batch is not active');
    if (!(await this.submissionsOpen(e.batch))) throw new BadRequestException('Project submissions open when the course hours are complete, or when your branch opens them');
    if (body.fileIds.length) {
      const files = await this.prisma.fileObject.findMany({ where: { id: { in: body.fileIds }, uploadedById: user.id, purpose: 'project' } });
      if (files.length !== new Set(body.fileIds).size) throw new BadRequestException('Upload your files again');
    }
    const p = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`project:${enrolmentId}`}))`;
      const proj = await tx.project.upsert({ where: { enrolmentId }, create: { enrolmentId }, update: {} });
      if (!['NOT_SUBMITTED', 'CHANGES_REQUESTED'].includes(proj.status)) throw new BadRequestException('Your project is already with your teacher');
      const last = await tx.projectSubmission.findFirst({ where: { projectId: proj.id }, orderBy: { version: 'desc' } });
      await tx.projectSubmission.create({ data: { projectId: proj.id, version: (last?.version ?? 0) + 1, title: body.title, description: body.description ?? null, link: body.link ?? null, fileIds: body.fileIds } });
      return tx.project.update({ where: { id: proj.id }, data: { status: 'SUBMITTED' } });
    });
    await this.notify.sendMany(e.batch.teachers.map((t) => t.employee.userId), { type: 'N11', title: `Project submitted by ${user.name}`, body: `${e.batch.name}: ${body.title}`, link: `/projects/${p.id}`, email: true });
    return p;
  }

  /** T8 (teacher: waiting for review) and BA10 (Branch Admin: waiting for final approval). */
  @Get('projects')
  async list(@CurrentUser() user: SessionUser, @Query('stage') stage: 'review' | 'approve' | 'all' = 'review') {
    let where: Prisma.ProjectWhereInput;
    if (stage === 'review') {
      if (!user.employeeId) throw new ForbiddenException('Only teachers review projects');
      where = { status: 'SUBMITTED', enrolment: { batch: { teachers: { some: { employeeId: user.employeeId } } } } };
    } else {
      const scope = branchesFor(user, 'projects.approve');
      const teach = user.employeeId ? [{ enrolment: { batch: { teachers: { some: { employeeId: user.employeeId } } } } }] : [];
      const branch = scope === null ? [{}] : scope.length ? [{ enrolment: { batch: { branchId: { in: scope } } } }] : [];
      if (!branch.length && !teach.length) throw new ForbiddenException('You do not have access to this');
      where = { OR: stage === 'approve' ? branch : [...branch, ...teach], ...(stage === 'approve' ? { status: 'TEACHER_APPROVED' as const } : {}) };
      if (stage === 'approve' && !branch.length) throw new ForbiddenException('Only the Branch Admin gives final approval');
    }
    const rows = await this.prisma.project.findMany({ where, include: projectInclude, orderBy: { updatedAt: 'asc' }, take: 200 });
    return Promise.all(rows.map((p) => this.view(p, user)));
  }

  @Get('projects/:id')
  async get(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    const p = await this.load(id);
    this.assertSee(user, p);
    return this.view(p, user);
  }

  @Post('projects/:id/review')
  @HttpCode(200)
  async review(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body(new Zod(projectReviewSchema)) body: z.infer<typeof projectReviewSchema>, @Req() req: Request) {
    const p = await this.load(id);
    const b = p.enrolment.batch;
    const v = await this.view(p, user);
    let stage: 'TEACHER' | 'BRANCH';
    let next: 'TEACHER_APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED' | 'COMPLETED' | 'SUBMITTED';
    if (v.canReview) {
      stage = 'TEACHER';
      if (body.decision === 'SEND_BACK') throw new BadRequestException('Choose approve, request changes or reject');
      next = body.decision === 'APPROVE' ? 'TEACHER_APPROVED' : body.decision === 'CHANGES' ? 'CHANGES_REQUESTED' : 'REJECTED';
    } else if (v.canApprove) {
      stage = 'BRANCH';
      if (body.decision === 'CHANGES') throw new BadRequestException('Send it back to the teacher instead');
      next = body.decision === 'APPROVE' ? 'COMPLETED' : body.decision === 'SEND_BACK' ? 'SUBMITTED' : 'REJECTED';
    } else {
      throw new ForbiddenException(['SUBMITTED', 'TEACHER_APPROVED'].includes(p.status) ? 'You cannot review this project' : 'This project is not waiting for a review');
    }
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.project.updateMany({ where: { id, status: p.status }, data: { status: next } });
      if (!count) throw new BadRequestException('Someone else just reviewed this project');
      await tx.projectReview.create({ data: { projectId: id, reviewerId: user.id, stage, decision: body.decision, comment: body.comment ?? null } });
      if (next === 'COMPLETED') {
        await tx.enrolment.update({ where: { id: p.enrolment.id }, data: { status: 'COMPLETED', statusNote: 'Final project approved' } });
      }
      if (stage === 'BRANCH') {
        await this.audit.record({
          actorId: user.id, action: `project.${body.decision.toLowerCase()}`, entity: 'Project', entityId: id, branchId: b.branchId,
          summary: `${body.decision === 'APPROVE' ? 'Final approval' : body.decision === 'SEND_BACK' ? 'Sent back to the teacher' : 'Rejected'}: ${p.enrolment.student.user.name}'s project in ${b.name}`, ip: clientIp(req) ?? undefined,
        }, tx);
      }
    });
    const student = p.enrolment.student;
    const msg: Record<string, string> = {
      TEACHER_APPROVED: 'Your teacher approved your project. It now goes to your branch for final approval.',
      CHANGES_REQUESTED: 'Your teacher asked for changes to your project',
      REJECTED: 'Your project was not accepted',
      COMPLETED: 'Congratulations! Your project is approved and your course is complete',
    };
    if (msg[next]) await this.notify.send(student.userId, { type: 'N11', title: msg[next], body: body.comment ?? b.name, link: '/learn/projects', email: true });
    if (next === 'TEACHER_APPROVED') {
      const admins = await this.att.branchStaffWith('projects.approve', b.branchId);
      await this.notify.sendMany(admins, { type: 'N11', title: `Project ready for final approval: ${student.user.name}`, body: b.name, link: `/projects/${id}`, email: true });
    }
    if (next === 'SUBMITTED') {
      await this.notify.sendMany(b.teachers.map((t) => t.employee.userId), { type: 'N11', title: `Project sent back by the branch: ${student.user.name}`, body: body.comment ?? '', link: `/projects/${id}` });
    }
    return { status: next };
  }

  /** Branch Admin opens project submissions before all hours are delivered. */
  @Post('batches/:id/projects-open')
  @HttpCode(200)
  async open(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body(new Zod(z.object({ open: z.boolean() }))) body: { open: boolean }) {
    const b = await this.acad.batchOr404(id);
    if (!can(user, 'batches.manage', b.branchId) && !can(user, 'projects.approve', b.branchId)) throw new ForbiddenException('Only the Branch Admin can open project submissions');
    await this.prisma.batch.update({ where: { id }, data: { projectsOpen: body.open } });
    return { projectsOpen: body.open };
  }
}
