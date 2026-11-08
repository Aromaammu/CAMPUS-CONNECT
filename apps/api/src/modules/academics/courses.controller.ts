import { BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SessionUser, can, courseDecisionSchema, courseRequestSchema, courseSchema, rupeesToPaise } from '@cc/shared';
import { z } from 'zod';
import { CurrentUser, RequirePerm, assertCan, branchesFor } from '../../common/org-access';
import { Zod } from '../../common/http';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { NotifyService } from '../notifications/notify.service';

@Controller('courses')
export class CoursesController {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  /** Admins see the whole catalogue; branches see published courses open to them. */
  private visibleWhere(user: SessionUser, branchId?: string): Prisma.CourseWhereInput {
    if (can(user, 'courses.manage') && !branchId) return {};
    const ids = branchId ? [branchId] : branchesFor(user, 'courses.view') ?? null;
    return {
      status: 'PUBLISHED',
      ...(ids ? { OR: [{ allBranches: true }, { branchAccess: { some: { branchId: { in: ids } } } }] } : {}),
    };
  }

  @Get()
  async list(@CurrentUser() user: SessionUser, @Query('q') q?: string, @Query('status') status?: string, @Query('branchId') branchId?: string) {
    if (user.kind === 'STUDENT') throw new ForbiddenException();
    if (branchId && !can(user, 'courses.view', branchId) && !can(user, 'batches.manage', branchId)) throw new ForbiddenException('You do not have access to this branch');
    return this.prisma.course.findMany({
      where: {
        AND: [
          this.visibleWhere(user, branchId),
          status ? { status: status as 'DRAFT' | 'PUBLISHED' | 'RETIRED' } : {},
          q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { code: { contains: q, mode: 'insensitive' } }, { category: { contains: q, mode: 'insensitive' } }] } : {},
        ],
      },
      include: { _count: { select: { modules: true, batches: true } }, branchAccess: { select: { branch: { select: { code: true } } } } },
      orderBy: { name: 'asc' },
    });
  }

  @Get(':id')
  async get(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    const c = await this.prisma.course.findUnique({ where: { id }, include: { modules: { orderBy: { position: 'asc' } }, branchAccess: { select: { branchId: true, branch: { select: { code: true, name: true } } } } } });
    if (!c) throw new NotFoundException('Course not found');
    if (user.kind === 'STUDENT') {
      const enrolled = await this.prisma.enrolment.count({ where: { studentId: user.studentId ?? '', batch: { courseId: id } } });
      if (!enrolled) throw new ForbiddenException('You do not have access to this course');
    } else if (!can(user, 'courses.manage')) {
      const ids = branchesFor(user, 'courses.view') ?? [];
      const open = c.status === 'PUBLISHED' && (c.allBranches || c.branchAccess.some((b) => ids.includes(b.branchId)));
      const teaches = user.employeeId ? await this.prisma.batch.count({ where: { courseId: id, teachers: { some: { employeeId: user.employeeId } } } }) : 0;
      if (!open && !teaches) throw new ForbiddenException('You do not have access to this course');
    }
    return c;
  }

  private data(body: z.infer<typeof courseSchema>) {
    return {
      code: body.code, name: body.name, category: body.category ?? null, totalMinutes: Math.round(body.hours * 60), description: body.description ?? null,
      defaultFeePaise: rupeesToPaise(body.defaultFee), feeLocked: body.feeLocked, allBranches: body.allBranches,
    };
  }

  @RequirePerm('courses.manage')
  @Post()
  async create(@CurrentUser() user: SessionUser, @Body(new Zod(courseSchema)) body: z.infer<typeof courseSchema>) {
    if (await this.prisma.course.findUnique({ where: { code: body.code } })) throw new BadRequestException({ message: 'That course code is already used', fieldErrors: { code: 'That course code is already used' } });
    return this.prisma.$transaction(async (tx) => {
      const c = await tx.course.create({
        data: {
          ...this.data(body), status: 'DRAFT',
          modules: { create: body.modules.map((m, i) => ({ position: i + 1, title: m.title, topics: m.topics ?? null })) },
          branchAccess: body.allBranches ? undefined : { create: body.branchIds.map((branchId) => ({ branchId })) },
        },
      });
      await this.audit.record({ actorId: user.id, action: 'course.create', entity: 'Course', entityId: c.id, summary: `Created course ${c.code} – ${c.name}`, after: body }, tx);
      return c;
    });
  }

  @RequirePerm('courses.manage')
  @Put(':id')
  async update(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body(new Zod(courseSchema)) body: z.infer<typeof courseSchema>) {
    const before = await this.prisma.course.findUnique({ where: { id }, include: { modules: true } });
    if (!before) throw new NotFoundException('Course not found');
    const clash = await this.prisma.course.findUnique({ where: { code: body.code } });
    if (clash && clash.id !== id) throw new BadRequestException({ message: 'That course code is already used', fieldErrors: { code: 'That course code is already used' } });
    return this.prisma.$transaction(async (tx) => {
      // Modules referenced by materials are kept (renamed/reordered) rather than deleted.
      const used = new Set((await tx.material.findMany({ where: { moduleId: { in: before.modules.map((m) => m.id) } }, select: { moduleId: true } })).map((m) => m.moduleId));
      await tx.courseModule.deleteMany({ where: { courseId: id, id: { notIn: [...used].filter(Boolean) as string[] } } });
      const kept = before.modules.filter((m) => used.has(m.id)).sort((a, b) => a.position - b.position);
      for (let i = 0; i < body.modules.length; i++) {
        const m = body.modules[i];
        const reuse = kept.shift();
        if (reuse) await tx.courseModule.update({ where: { id: reuse.id }, data: { position: i + 1, title: m.title, topics: m.topics ?? null } });
        else await tx.courseModule.create({ data: { courseId: id, position: i + 1, title: m.title, topics: m.topics ?? null } });
      }
      for (const extra of kept) await tx.courseModule.update({ where: { id: extra.id }, data: { position: body.modules.length + 1 + extra.position } });
      await tx.courseBranch.deleteMany({ where: { courseId: id } });
      if (!body.allBranches) await tx.courseBranch.createMany({ data: body.branchIds.map((branchId) => ({ courseId: id, branchId })) });
      const after = await tx.course.update({ where: { id }, data: this.data(body) });
      await this.audit.record({ actorId: user.id, action: 'course.update', entity: 'Course', entityId: id, summary: `Updated course ${after.code}`, before, after: body }, tx);
      return after;
    });
  }

  @RequirePerm('courses.manage')
  @Patch(':id/status')
  async setStatus(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body(new Zod(z.object({ status: z.enum(['DRAFT', 'PUBLISHED', 'RETIRED']) }))) body: { status: 'DRAFT' | 'PUBLISHED' | 'RETIRED' }) {
    const c = await this.prisma.course.update({ where: { id }, data: { status: body.status } });
    await this.audit.record({ actorId: user.id, action: `course.${body.status.toLowerCase()}`, entity: 'Course', entityId: id, summary: `${body.status === 'PUBLISHED' ? 'Published' : body.status === 'RETIRED' ? 'Retired' : 'Moved to draft'} course ${c.code}` });
    return c;
  }
}

@Controller('course-requests')
export class CourseRequestsController {
  constructor(private prisma: PrismaService, private audit: AuditService, private notify: NotifyService) {}

  @RequirePerm('courses.request', 'courses.decide')
  @Get()
  async list(@CurrentUser() user: SessionUser, @Query('status') status?: string) {
    const deciding = can(user, 'courses.decide');
    const ids = deciding ? null : branchesFor(user, 'courses.request');
    return this.prisma.courseRequest.findMany({
      where: { ...(ids ? { branchId: { in: ids } } : {}), ...(status ? { status: status as 'PENDING' } : {}) },
      include: { branch: { select: { code: true, name: true } }, course: { select: { id: true, code: true } } },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });
  }

  @RequirePerm('courses.request')
  @Post()
  async create(@CurrentUser() user: SessionUser, @Body(new Zod(courseRequestSchema)) body: z.infer<typeof courseRequestSchema>) {
    assertCan(user, 'courses.request', body.branchId);
    const r = await this.prisma.courseRequest.create({
      data: { branchId: body.branchId, requestedById: user.id, name: body.name, category: body.category, totalMinutes: Math.round(body.hours * 60), description: body.description, syllabus: body.syllabus, feePaise: rupeesToPaise(body.fee) },
      include: { branch: true },
    });
    await this.audit.record({ actorId: user.id, action: 'course_request.create', entity: 'CourseRequest', entityId: r.id, branchId: body.branchId, summary: `${r.branch.code} requested a new course: ${body.name}` });
    const deciders = await this.prisma.user.findMany({ where: { status: 'ACTIVE', OR: [{ kind: 'SUPER_ADMIN' }, { kind: 'ADMIN', adminModules: { some: { module: 'academics' } } }] } });
    for (const d of deciders) {
      await this.notify.send(d.id, { type: 'N15', title: `New course request from ${r.branch.code}`, body: body.name, link: '/course-requests', email: true });
    }
    return r;
  }

  /** Resubmit after "Send back". */
  @RequirePerm('courses.request')
  @Put(':id')
  async resubmit(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body(new Zod(courseRequestSchema)) body: z.infer<typeof courseRequestSchema>) {
    const r = await this.prisma.courseRequest.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Request not found');
    assertCan(user, 'courses.request', r.branchId);
    if (r.status !== 'SENT_BACK') throw new BadRequestException('Only requests sent back for changes can be edited');
    const after = await this.prisma.courseRequest.update({
      where: { id },
      data: { name: body.name, category: body.category, totalMinutes: Math.round(body.hours * 60), description: body.description, syllabus: body.syllabus, feePaise: rupeesToPaise(body.fee), status: 'PENDING', decisionNote: null },
    });
    await this.audit.record({ actorId: user.id, action: 'course_request.resubmit', entity: 'CourseRequest', entityId: id, branchId: r.branchId, summary: `Resubmitted course request ${body.name}` });
    return after;
  }

  @RequirePerm('courses.decide')
  @Post(':id/decision')
  async decide(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body(new Zod(courseDecisionSchema)) body: z.infer<typeof courseDecisionSchema>) {
    const r = await this.prisma.courseRequest.findUnique({ where: { id }, include: { branch: true } });
    if (!r) throw new NotFoundException('Request not found');
    if (r.status !== 'PENDING') throw new BadRequestException('This request has already been decided');
    if (body.decision === 'APPROVE' && (await this.prisma.course.findUnique({ where: { code: body.code! } }))) {
      throw new BadRequestException({ message: 'That course code is already used', fieldErrors: { code: 'That course code is already used' } });
    }
    const result = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.courseRequest.updateMany({ where: { id, status: 'PENDING' }, data: { status: body.decision === 'APPROVE' ? 'APPROVED' : body.decision === 'REJECT' ? 'REJECTED' : 'SENT_BACK', decisionNote: body.note ?? null, decidedById: user.id, decidedAt: new Date(), shareAll: body.shareAll } });
      if (!claimed.count) throw new BadRequestException('This request has already been decided');
      let courseId: string | null = null;
      if (body.decision === 'APPROVE') {
        const syllabus = (r.syllabus as { title: string; topics?: string }[]) ?? [];
        const c = await tx.course.create({
          data: {
            code: body.code!, name: r.name, category: r.category, totalMinutes: r.totalMinutes, description: r.description, defaultFeePaise: r.feePaise,
            status: 'PUBLISHED', allBranches: body.shareAll,
            modules: { create: syllabus.map((m, i) => ({ position: i + 1, title: m.title, topics: m.topics ?? null })) },
            branchAccess: body.shareAll ? undefined : { create: [{ branchId: r.branchId }] },
          },
        });
        courseId = c.id;
        await tx.courseRequest.update({ where: { id }, data: { courseId } });
      }
      await this.audit.record({ actorId: user.id, action: `course_request.${body.decision.toLowerCase()}`, entity: 'CourseRequest', entityId: id, branchId: r.branchId, summary: `${body.decision === 'APPROVE' ? 'Approved' : body.decision === 'REJECT' ? 'Rejected' : 'Sent back'} ${r.branch.code}'s request "${r.name}"${body.note ? `: ${body.note}` : ''}` }, tx);
      return { courseId };
    });
    const label = body.decision === 'APPROVE' ? 'approved' : body.decision === 'REJECT' ? 'rejected' : 'sent back for changes';
    await this.notify.send(r.requestedById, { type: 'N15', title: `Course request ${label}`, body: `${r.name}${body.note ? ` · ${body.note}` : ''}`, link: '/course-requests', email: true });
    return result;
  }
}
