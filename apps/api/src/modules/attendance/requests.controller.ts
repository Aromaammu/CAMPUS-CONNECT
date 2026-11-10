import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, NotFoundException, Param, Post, Query, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Prisma } from '@prisma/client';
import { SessionUser, attendanceDecisionSchema, attendanceRequestSchema, can, formatWeekdayDate } from '@cc/shared';
import type { Request } from 'express';
import { z } from 'zod';
import { AuditService } from '../../common/audit.service';
import { CurrentUser, branchesFor } from '../../common/auth';
import { FilesService } from '../../common/files.service';
import { Zod, clientIp, paging } from '../../common/http';
import { PrismaService } from '../../common/prisma.service';
import { SettingsService } from '../../common/settings.service';
import { NotifyService } from '../notifications/notify.service';
import { AttendanceService } from './attendance.service';

const include = {
  student: { select: { id: true, code: true, user: { select: { id: true, name: true } } } },
  session: { select: { id: true, position: true, startsAt: true, endsAt: true, teacherId: true, batch: { select: { id: true, name: true, branchId: true, branch: { select: { code: true } }, course: { select: { name: true } }, teachers: { select: { employeeId: true } } } } } },
} satisfies Prisma.AttendanceRequestInclude;

/** PRD §8.2: student asks → teacher decides → escalates to the Branch Admin after 2 days. */
@Controller('attendance/requests')
export class AttendanceRequestsController {
  constructor(
    private prisma: PrismaService, private att: AttendanceService, private files: FilesService, private settings: SettingsService,
    private notify: NotifyService, private audit: AuditService,
  ) {}

  /** Screenshot to back up a request (images or PDF, up to 5 MB). */
  @Post('attachment')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async attach(@CurrentUser() user: SessionUser, @UploadedFile() file?: Express.Multer.File) {
    if (!user.studentId) throw new ForbiddenException('Only students send attendance requests');
    const f = await this.files.save(file, { purpose: 'attendance', userId: user.id, kinds: ['image', 'pdf'], maxMb: 5 });
    return { id: f.id, name: f.name };
  }

  @Post()
  async create(@CurrentUser() user: SessionUser, @Body(new Zod(attendanceRequestSchema)) body: z.infer<typeof attendanceRequestSchema>) {
    if (!user.studentId) throw new ForbiddenException('Only students send attendance requests');
    const studentId = user.studentId;
    const s = await this.att.sessionOr404(body.sessionId);
    const e = await this.prisma.enrolment.findUnique({ where: { studentId_batchId: { studentId, batchId: s.batchId } } });
    if (!e || e.status !== 'ACTIVE') throw new ForbiddenException('You are not in this batch');
    if (s.status === 'CANCELLED') throw new BadRequestException('This class was cancelled');
    const days = await this.settings.get('attendance.requestDays');
    if (Date.now() < s.endsAt.getTime() && s.status !== 'COMPLETED') throw new BadRequestException('You can ask once the class is over');
    if (Date.now() > s.endsAt.getTime() + days * 86400_000) throw new BadRequestException(`Requests are allowed within ${days} days of the class`);
    if (body.attachmentId) {
      const f = await this.prisma.fileObject.findUnique({ where: { id: body.attachmentId } });
      if (!f || f.uploadedById !== user.id || f.purpose !== 'attendance') throw new BadRequestException('Attach the screenshot again');
    }
    const created = await this.prisma.$transaction(async (tx) => {
      // One open request per class: serialise two clicks from the same student.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`attreq:${s.id}:${studentId}`}))`;
      const att = await tx.attendance.findUnique({ where: { sessionId_studentId: { sessionId: s.id, studentId } } });
      if (att?.status === 'PRESENT' || att?.status === 'EXCUSED') throw new BadRequestException('You are already marked for this class');
      const open = await tx.attendanceRequest.findFirst({ where: { sessionId: s.id, studentId, status: { in: ['PENDING', 'ESCALATED', 'APPROVED'] } } });
      if (open) throw new BadRequestException(open.status === 'APPROVED' ? 'This request was already approved' : 'You already sent a request for this class');
      return tx.attendanceRequest.create({ data: { sessionId: s.id, studentId, reason: body.reason, note: body.note ?? null, attachmentId: body.attachmentId ?? null } });
    });
    const teacherEmpIds = [...s.batch.teachers.map((t) => t.employeeId), ...(s.teacherId ? [s.teacherId] : [])];
    const teachers = await this.prisma.employee.findMany({ where: { id: { in: teacherEmpIds } }, select: { userId: true } });
    await this.notify.sendMany(teachers.map((t) => t.userId), {
      type: 'N6', title: `Attendance request from ${user.name}`, body: `${s.batch.name}, class ${s.position} (${formatWeekdayDate(s.startsAt)}): ${body.reason}`,
      link: '/teach/attendance-requests', email: true,
    });
    return created;
  }

  /** Teacher: requests for their classes. Branch Admin: every request in their branches (escalated first). */
  @Get()
  async list(@CurrentUser() user: SessionUser, @Query('status') status = 'open', @Query('page') page = '1') {
    if (user.kind === 'STUDENT') throw new ForbiddenException('You do not have access to this');
    const branches = branchesFor(user, 'attendance.oversee');
    const or: Prisma.AttendanceRequestWhereInput[] = [];
    if (user.employeeId) or.push({ session: { OR: [{ teacherId: user.employeeId }, { batch: { teachers: { some: { employeeId: user.employeeId } } } }] } });
    if (branches === null) or.push({});
    else if (branches.length) or.push({ session: { batch: { branchId: { in: branches } } } });
    if (!or.length) return { total: 0, page: 1, pageSize: 20, rows: [] };
    const statuses = status === 'open' ? ['PENDING', 'ESCALATED'] : status === 'closed' ? ['APPROVED', 'REJECTED'] : ['PENDING', 'ESCALATED', 'APPROVED', 'REJECTED'];
    const where: Prisma.AttendanceRequestWhereInput = { OR: or, status: { in: statuses as never } };
    const p = paging(Number(page) || 1, 20);
    const [total, rows] = await Promise.all([
      this.prisma.attendanceRequest.count({ where }),
      this.prisma.attendanceRequest.findMany({ where, include, orderBy: [{ status: 'asc' }, { createdAt: 'asc' }], ...p }),
    ]);
    return {
      total, page: Number(page) || 1, pageSize: 20,
      rows: rows.map((r) => ({ ...r, canDecide: this.canDecide(user, r) })),
    };
  }

  private canDecide(user: SessionUser, r: { status: string; session: { teacherId: string | null; batch: { branchId: string; teachers: { employeeId: string }[] } } }) {
    if (!['PENDING', 'ESCALATED'].includes(r.status)) return false;
    if (can(user, 'attendance.oversee', r.session.batch.branchId)) return true;
    return r.status === 'PENDING' && this.att.isTeacherOf(user, r.session);
  }

  @Get(':id/attachment')
  async attachment(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    const r = await this.prisma.attendanceRequest.findUnique({ where: { id }, include });
    if (!r || !r.attachmentId) throw new NotFoundException('No attachment');
    const mine = r.student.user.id === user.id;
    if (!mine && !this.att.isTeacherOf(user, r.session) && !can(user, 'attendance.oversee', r.session.batch.branchId)) throw new ForbiddenException('You do not have access to this');
    return { url: this.files.signedUrl(r.attachmentId, user.id) };
  }

  @Post(':id/decision')
  @HttpCode(200)
  async decide(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body(new Zod(attendanceDecisionSchema)) body: z.infer<typeof attendanceDecisionSchema>, @Req() req: Request) {
    const r = await this.prisma.attendanceRequest.findUnique({ where: { id }, include });
    if (!r) throw new NotFoundException('Request not found');
    if (!this.canDecide(user, r)) {
      if (!['PENDING', 'ESCALATED'].includes(r.status)) throw new BadRequestException('This request was already decided');
      throw new ForbiddenException(r.status === 'ESCALATED' ? 'This request has gone to the Branch Admin' : 'Only the teacher or Branch Admin can decide');
    }
    const granted = body.approve ? (body.status ?? 'PRESENT') : null;
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.attendanceRequest.updateMany({
        where: { id, status: { in: ['PENDING', 'ESCALATED'] } },
        data: { status: body.approve ? 'APPROVED' : 'REJECTED', grantedStatus: granted, decidedById: user.id, decisionNote: body.note ?? null, decidedAt: new Date() },
      });
      if (!count) throw new BadRequestException('This request was already decided');
      if (granted) {
        const data = { status: granted, source: 'REQUEST' as const, markedById: user.id, reason: `Request approved: ${r.reason}` };
        await tx.attendance.upsert({ where: { sessionId_studentId: { sessionId: r.sessionId, studentId: r.studentId } }, create: { sessionId: r.sessionId, studentId: r.studentId, ...data }, update: data });
      }
      await this.audit.record({
        actorId: user.id, action: body.approve ? 'attendance.request.approve' : 'attendance.request.reject', entity: 'AttendanceRequest', entityId: id, branchId: r.session.batch.branchId,
        summary: `${body.approve ? `Approved (${granted})` : 'Rejected'} attendance request from ${r.student.user.name} for ${r.session.batch.name} class ${r.session.position}${body.note ? `: ${body.note}` : ''}`,
        ip: clientIp(req) ?? undefined,
      }, tx);
    });
    await this.notify.send(r.student.user.id, {
      type: 'N6',
      title: body.approve ? `Attendance approved: you are marked ${granted === 'LATE' ? 'Late' : 'Present'}` : 'Your attendance request was not approved',
      body: `${r.session.batch.name}, class ${r.session.position}${body.note ? `. ${body.note}` : ''}`,
      link: '/learn/attendance', email: true,
    });
    return { ok: true };
  }
}
