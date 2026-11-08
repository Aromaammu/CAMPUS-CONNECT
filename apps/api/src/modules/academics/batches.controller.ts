import { BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, Post, Put, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  SessionUser, batchSchema, batchUpdateSchema, can, cancelSessionSchema, enrolSchema, enrolmentActionSchema, formatDateTime, formatWeekdayDate, istToUtc,
  rescheduleSchema, rupeesToPaise, substituteSchema,
} from '@cc/shared';
import { z } from 'zod';
import { CurrentUser, RequirePerm, assertCan, branchesFor } from '../../common/org-access';
import { Zod } from '../../common/http';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { NotifyService } from '../notifications/notify.service';
import { AcademicsService } from './academics.service';
import { BatchHooks } from './batch-hooks';

const listQuery = z.object({
  branchId: z.string().optional(),
  courseId: z.string().optional(),
  status: z.enum(['UPCOMING', 'RUNNING', 'COMPLETED', 'CANCELLED']).optional(),
  mode: z.enum(['ONLINE', 'OFFLINE', 'HYBRID']).optional(),
  mine: z.string().optional(),
  q: z.string().trim().optional(),
});

const batchInclude = {
  branch: { select: { id: true, code: true, name: true } },
  course: { select: { id: true, code: true, name: true, totalMinutes: true, defaultFeePaise: true, feeLocked: true } },
  room: { select: { id: true, name: true, capacity: true } },
  teachers: { include: { employee: { select: { id: true, code: true, user: { select: { id: true, name: true } } } } } },
  _count: { select: { enrolments: { where: { status: { in: ['ACTIVE', 'ON_HOLD'] } } }, sessions: { where: { status: { not: 'CANCELLED' } } } } },
} satisfies Prisma.BatchInclude;

@Controller('batches')
export class BatchesController {
  constructor(private prisma: PrismaService, private audit: AuditService, private acad: AcademicsService, private notify: NotifyService, private hooks: BatchHooks) {}

  @Get()
  async list(@CurrentUser() user: SessionUser, @Query() query: Record<string, string>) {
    const q = listQuery.parse(query);
    if (user.kind === 'STUDENT') throw new ForbiddenException();
    const viewIds = branchesFor(user, 'batches.view');
    const scope: Prisma.BatchWhereInput[] = [];
    if (q.mine === '1' || (viewIds && viewIds.length === 0)) {
      scope.push({ OR: [{ teachers: { some: { employeeId: user.employeeId ?? '__none__' } } }, { sessions: { some: { teacherId: user.employeeId ?? '__none__' } } }] });
    } else if (viewIds) {
      scope.push({ OR: [{ branchId: { in: viewIds } }, { teachers: { some: { employeeId: user.employeeId ?? '__none__' } } }] });
    }
    if (q.branchId) scope.push({ branchId: q.branchId });
    const rows = await this.prisma.batch.findMany({
      where: {
        AND: [
          ...scope,
          q.courseId ? { courseId: q.courseId } : {},
          q.status ? { status: q.status } : {},
          q.mode ? { mode: q.mode } : {},
          q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { course: { name: { contains: q.q, mode: 'insensitive' } } }] } : {},
        ],
      },
      include: batchInclude,
      orderBy: [{ status: 'asc' }, { startDate: 'desc' }],
      take: 500,
    });
    const next = await this.prisma.session.findMany({
      where: { batchId: { in: rows.map((r) => r.id) }, status: { in: ['SCHEDULED', 'LIVE'] }, endsAt: { gt: new Date() } },
      orderBy: { startsAt: 'asc' },
      distinct: ['batchId'],
      select: { batchId: true, startsAt: true, status: true },
    });
    return rows.map((r) => ({ ...r, nextSession: next.find((n) => n.batchId === r.id) ?? null }));
  }

  /** Session plan + clashes before saving (PRD §6.2). */
  @RequirePerm('batches.manage')
  @Post('preview')
  async preview(@CurrentUser() user: SessionUser, @Body(new Zod(batchSchema)) body: z.infer<typeof batchSchema>) {
    assertCan(user, 'batches.manage', body.branchId);
    const course = await this.prisma.course.findUnique({ where: { id: body.courseId } });
    if (!course) throw new BadRequestException('Choose a course');
    const plan = await this.acad.plan(body.branchId, course.totalMinutes, body);
    const teacherIds = [body.teacherId];
    const clashes = await this.acad.clashes(plan, teacherIds, body.mode === 'ONLINE' ? null : body.roomId);
    return { sessions: plan.length, first: plan[0]?.startsAt ?? null, last: plan[plan.length - 1]?.endsAt ?? null, clashes: clashes.slice(0, 20), clashCount: clashes.length };
  }

  @RequirePerm('batches.manage')
  @Post()
  async create(@CurrentUser() user: SessionUser, @Body(new Zod(batchSchema)) body: z.infer<typeof batchSchema>) {
    assertCan(user, 'batches.manage', body.branchId);
    const course = await this.prisma.course.findUnique({ where: { id: body.courseId }, include: { branchAccess: true } });
    if (!course || course.status !== 'PUBLISHED' || !(course.allBranches || course.branchAccess.some((b) => b.branchId === body.branchId))) {
      throw new BadRequestException({ message: 'This course is not open to this branch', fieldErrors: { courseId: 'This course is not open to this branch' } });
    }
    await this.assertTeachers(body.branchId, [body.teacherId, body.backupTeacherId].filter(Boolean) as string[]);
    if (body.roomId) await this.assertRoom(body.branchId, body.roomId);
    if (await this.prisma.batch.findUnique({ where: { branchId_name: { branchId: body.branchId, name: body.name } } })) {
      throw new BadRequestException({ message: 'This branch already has a batch with that name', fieldErrors: { name: 'This branch already has a batch with that name' } });
    }
    const feePaise = this.feeFor(user, body.branchId, course, body.fee);
    const plan = await this.acad.plan(body.branchId, course.totalMinutes, body);
    if (!plan.length) throw new BadRequestException('No class days could be scheduled. Check the days and times.');
    const roomId = body.mode === 'ONLINE' ? null : body.roomId ?? null;
    const batch = await this.prisma.$transaction(async (tx) => {
      const b = await tx.batch.create({
        data: {
          branchId: body.branchId, courseId: body.courseId, name: body.name, mode: body.mode, startDate: new Date(body.startDate), days: [...body.days].sort(),
          startTime: body.startTime, endTime: body.endTime, roomId, capacity: body.capacity, autoRecord: body.mode !== 'OFFLINE' && body.autoRecord,
          checkinRequired: body.checkinRequired, feePaise,
          teachers: { create: [{ employeeId: body.teacherId, role: 'MAIN' }, ...(body.backupTeacherId && body.backupTeacherId !== body.teacherId ? [{ employeeId: body.backupTeacherId, role: 'BACKUP' }] : [])] },
          sessions: { create: plan.map((p) => ({ position: p.position, startsAt: p.startsAt, endsAt: p.endsAt, roomId })) },
        },
      });
      await this.audit.record({ actorId: user.id, action: 'batch.create', entity: 'Batch', entityId: b.id, branchId: body.branchId, summary: `Created batch ${body.name} (${course.name}) with ${plan.length} sessions`, after: body }, tx);
      await this.acad.refreshBatchStatus(b.id, tx);
      return b;
    });
    await this.hooks.batchCreated(batch.id);
    return batch;
  }

  private feeFor(user: SessionUser, branchId: string, course: { defaultFeePaise: number; feeLocked: boolean }, fee?: number) {
    if (fee === undefined || course.feeLocked) return null;
    const paise = rupeesToPaise(fee);
    if (paise === course.defaultFeePaise) return null;
    if (!can(user, 'fees.manage', branchId)) throw new ForbiddenException('You cannot set a branch price for this batch');
    return paise;
  }

  private async assertTeachers(branchId: string, employeeIds: string[]) {
    for (const id of employeeIds) {
      const e = await this.prisma.employee.findFirst({ where: { id, OR: [{ branchId }, { extraBranches: { some: { branchId } } }], user: { status: 'ACTIVE' } } });
      if (!e) throw new BadRequestException({ message: 'Choose a teacher who works in this branch', fieldErrors: { teacherId: 'Choose a teacher who works in this branch' } });
    }
  }

  private async assertRoom(branchId: string, roomId: string) {
    const r = await this.prisma.room.findFirst({ where: { id: roomId, branchId, active: true } });
    if (!r) throw new BadRequestException({ message: 'Choose a room in this branch', fieldErrors: { roomId: 'Choose a room in this branch' } });
  }

  @Get(':id')
  async get(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    const batch = await this.acad.batchOr404(id);
    const role = await this.acad.assertViewBatch(user, batch);
    await this.acad.refreshBatchStatus(id);
    const b = await this.prisma.batch.findUniqueOrThrow({ where: { id }, include: batchInclude });
    const hours = await this.acad.hours(id);
    return {
      ...b, hours, viewerRole: role,
      canManage: can(user, 'batches.manage', b.branchId),
      canEnrol: can(user, 'enrolments.manage', b.branchId),
      canTeach: role === 'teacher' || can(user, 'attendance.oversee', b.branchId),
    };
  }

  @Get(':id/sessions')
  async sessions(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    const batch = await this.acad.batchOr404(id);
    await this.acad.assertViewBatch(user, batch);
    return this.prisma.session.findMany({
      where: { batchId: id },
      orderBy: { startsAt: 'asc' },
      include: { teacher: { select: { id: true, user: { select: { name: true } } } }, room: { select: { name: true } } },
    });
  }

  @RequirePerm('batches.manage')
  @Put(':id')
  async update(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body(new Zod(batchUpdateSchema)) body: z.infer<typeof batchUpdateSchema>) {
    const before = await this.prisma.batch.findUnique({ where: { id }, include: { teachers: true, course: true } });
    if (!before) throw new NotFoundException('Batch not found');
    assertCan(user, 'batches.manage', before.branchId);
    await this.assertTeachers(before.branchId, [body.teacherId, body.backupTeacherId].filter(Boolean) as string[]);
    const roomId = before.mode === 'ONLINE' ? null : body.roomId ?? null;
    if (before.mode !== 'ONLINE' && !roomId) throw new BadRequestException({ message: 'Offline and hybrid batches need a room', fieldErrors: { roomId: 'Choose a room' } });
    if (roomId) await this.assertRoom(before.branchId, roomId);
    if (body.name !== before.name && (await this.prisma.batch.findUnique({ where: { branchId_name: { branchId: before.branchId, name: body.name } } }))) {
      throw new BadRequestException({ message: 'This branch already has a batch with that name', fieldErrors: { name: 'This branch already has a batch with that name' } });
    }
    const active = await this.prisma.enrolment.count({ where: { batchId: id, status: { in: ['ACTIVE', 'ON_HOLD'] } } });
    if (body.capacity < active) throw new BadRequestException({ message: `${active} students are already enrolled`, fieldErrors: { capacity: `At least ${active}` } });
    const feePaise = body.fee === undefined ? before.feePaise : this.feeFor(user, before.branchId, before.course, body.fee);
    const after = await this.prisma.$transaction(async (tx) => {
      await tx.batchTeacher.deleteMany({ where: { batchId: id } });
      await tx.batchTeacher.createMany({ data: [{ batchId: id, employeeId: body.teacherId, role: 'MAIN' }, ...(body.backupTeacherId && body.backupTeacherId !== body.teacherId ? [{ batchId: id, employeeId: body.backupTeacherId, role: 'BACKUP' }] : [])] });
      if (roomId !== before.roomId) await tx.session.updateMany({ where: { batchId: id, status: 'SCHEDULED', startsAt: { gt: new Date() }, roomId: before.roomId }, data: { roomId } });
      const a = await tx.batch.update({ where: { id }, data: { name: body.name, capacity: body.capacity, roomId, autoRecord: before.mode !== 'OFFLINE' && body.autoRecord, checkinRequired: body.checkinRequired, feePaise } });
      await this.audit.record({ actorId: user.id, action: 'batch.update', entity: 'Batch', entityId: id, branchId: before.branchId, summary: `Updated batch ${body.name}`, before, after: body }, tx);
      return a;
    });
    await this.hooks.membersChanged(id);
    return after;
  }

  @RequirePerm('batches.manage')
  @Post(':id/cancel')
  async cancelBatch(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body(new Zod(z.object({ reason: z.string().trim().min(3, 'Please give a reason') }))) body: { reason: string }) {
    const b = await this.acad.batchOr404(id);
    assertCan(user, 'batches.manage', b.branchId);
    await this.prisma.$transaction(async (tx) => {
      await tx.batch.update({ where: { id }, data: { status: 'CANCELLED' } });
      await tx.session.updateMany({ where: { batchId: id, status: 'SCHEDULED', startsAt: { gt: new Date() } }, data: { status: 'CANCELLED', cancelReason: body.reason } });
      await this.audit.record({ actorId: user.id, action: 'batch.cancel', entity: 'Batch', entityId: id, branchId: b.branchId, summary: `Cancelled batch ${b.name}: ${body.reason}` }, tx);
    });
    return { ok: true };
  }

  /** Add more sessions at the end (e.g. after cancellations) following the batch's pattern. */
  @RequirePerm('batches.manage')
  @Post(':id/extend')
  async extend(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body(new Zod(z.object({ count: z.coerce.number().int().min(1).max(50) }))) body: { count: number }) {
    const b = await this.acad.batchOr404(id);
    assertCan(user, 'batches.manage', b.branchId);
    const added = await this.appendSessions(b, body.count);
    await this.audit.record({ actorId: user.id, action: 'batch.extend', entity: 'Batch', entityId: id, branchId: b.branchId, summary: `Added ${added} session(s) to ${b.name}` });
    return { added };
  }

  private async appendSessions(b: { id: string; branchId: string; days: number[]; startTime: string; endTime: string; roomId: string | null }, count: number) {
    const last = await this.prisma.session.findFirst({ where: { batchId: b.id }, orderBy: { position: 'desc' } });
    const lastStart = await this.prisma.session.findFirst({ where: { batchId: b.id }, orderBy: { startsAt: 'desc' } });
    const from = lastStart ? new Date(lastStart.startsAt.getTime() + 86400000) : new Date();
    const startKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(from);
    const [sh, sm] = b.startTime.split(':').map(Number);
    const [eh, em] = b.endTime.split(':').map(Number);
    const per = eh * 60 + em - (sh * 60 + sm);
    const plan = await this.acad.plan(b.branchId, per * count, { startDate: startKey, days: b.days, startTime: b.startTime, endTime: b.endTime }, (last?.position ?? 0) + 1);
    await this.prisma.session.createMany({ data: plan.map((p) => ({ batchId: b.id, position: p.position, startsAt: p.startsAt, endsAt: p.endsAt, roomId: b.roomId })) });
    await this.acad.refreshBatchStatus(b.id);
    return plan.length;
  }

  // ── Sessions ──
  private async sessionFor(user: SessionUser, sessionId: string) {
    const s = await this.prisma.session.findUnique({ where: { id: sessionId }, include: { batch: { include: { teachers: true } } } });
    if (!s) throw new NotFoundException('Class not found');
    assertCan(user, 'batches.manage', s.batch.branchId);
    return s;
  }

  private async studentUserIds(batchId: string) {
    const rows = await this.prisma.enrolment.findMany({ where: { batchId, status: 'ACTIVE' }, select: { student: { select: { userId: true } } } });
    return rows.map((r) => r.student.userId);
  }

  private async teacherUserIds(batchId: string, extraEmployeeIds: (string | null | undefined)[] = []) {
    const t = await this.prisma.batchTeacher.findMany({ where: { batchId }, select: { employee: { select: { userId: true } } } });
    const extra = await this.prisma.employee.findMany({ where: { id: { in: extraEmployeeIds.filter(Boolean) as string[] } }, select: { userId: true } });
    return [...t.map((x) => x.employee.userId), ...extra.map((x) => x.userId)];
  }

  @RequirePerm('batches.manage')
  @Post('sessions/:sessionId/reschedule')
  async reschedule(@CurrentUser() user: SessionUser, @Param('sessionId') sessionId: string, @Body(new Zod(rescheduleSchema)) body: z.infer<typeof rescheduleSchema>) {
    const s = await this.sessionFor(user, sessionId);
    if (s.status !== 'SCHEDULED') throw new BadRequestException('Only scheduled classes can be moved');
    const startsAt = istToUtc(body.date, body.startTime);
    const endsAt = istToUtc(body.date, body.endTime);
    if (startsAt < new Date()) throw new BadRequestException({ message: 'Choose a time in the future', fieldErrors: { date: 'Choose a time in the future' } });
    const roomId = s.batch.mode === 'ONLINE' ? null : body.roomId ?? s.roomId;
    const teacherIds = s.teacherId ? [s.teacherId] : s.batch.teachers.filter((t) => t.role === 'MAIN').map((t) => t.employeeId);
    const clashes = (await this.acad.clashes([{ startsAt, endsAt }], teacherIds, roomId)).filter((c) => c.with !== `${s.batch.name}`);
    await this.prisma.$transaction(async (tx) => {
      await tx.session.update({ where: { id: sessionId }, data: { startsAt, endsAt, roomId, note: body.note ?? s.note } });
      await this.audit.record({ actorId: user.id, action: 'session.reschedule', entity: 'Session', entityId: sessionId, branchId: s.batch.branchId, summary: `Moved ${s.batch.name} class ${s.position} from ${formatDateTime(s.startsAt)} to ${formatDateTime(startsAt)}`, before: { startsAt: s.startsAt, endsAt: s.endsAt }, after: { startsAt, endsAt } }, tx);
    });
    await this.notify.sendMany([...(await this.studentUserIds(s.batchId)), ...(await this.teacherUserIds(s.batchId, [s.teacherId]))], {
      type: 'N5', title: `${s.batch.name}: class moved`, body: `Class ${s.position} is now on ${formatWeekdayDate(startsAt)} at ${formatDateTime(startsAt).split(', ')[1]}.`, link: '/timetable', email: true, sms: true, essential: true,
    });
    return { ok: true, clashes };
  }

  @RequirePerm('batches.manage')
  @Post('sessions/:sessionId/cancel')
  async cancelSession(@CurrentUser() user: SessionUser, @Param('sessionId') sessionId: string, @Body(new Zod(cancelSessionSchema)) body: z.infer<typeof cancelSessionSchema>) {
    const s = await this.sessionFor(user, sessionId);
    if (s.status !== 'SCHEDULED') throw new BadRequestException('Only scheduled classes can be cancelled');
    await this.prisma.$transaction(async (tx) => {
      await tx.session.update({ where: { id: sessionId }, data: { status: 'CANCELLED', cancelReason: body.reason } });
      await this.audit.record({ actorId: user.id, action: 'session.cancel', entity: 'Session', entityId: sessionId, branchId: s.batch.branchId, summary: `Cancelled ${s.batch.name} class on ${formatDateTime(s.startsAt)}: ${body.reason}` }, tx);
    });
    let makeUp = 0;
    if (body.addMakeUp) makeUp = await this.appendSessions(s.batch, 1);
    await this.notify.sendMany([...(await this.studentUserIds(s.batchId)), ...(await this.teacherUserIds(s.batchId, [s.teacherId]))], {
      type: 'N5', title: `${s.batch.name}: class cancelled`, body: `${formatWeekdayDate(s.startsAt)}: ${body.reason}${makeUp ? '. A make-up class has been added at the end.' : ''}`, link: '/timetable', email: true, sms: true, essential: true,
    });
    return { ok: true, makeUp };
  }

  @RequirePerm('batches.manage')
  @Post('sessions/:sessionId/substitute')
  async substitute(@CurrentUser() user: SessionUser, @Param('sessionId') sessionId: string, @Body(new Zod(substituteSchema)) body: z.infer<typeof substituteSchema>) {
    const s = await this.sessionFor(user, sessionId);
    if (s.status === 'COMPLETED' || s.status === 'CANCELLED') throw new BadRequestException('This class has already finished');
    if (body.teacherId) await this.assertTeachers(s.batch.branchId, [body.teacherId]);
    const sub = body.teacherId ? await this.prisma.employee.findUnique({ where: { id: body.teacherId }, include: { user: true } }) : null;
    const clashes = sub ? await this.acad.clashes([s], [sub.id], null, s.batchId) : [];
    await this.prisma.$transaction(async (tx) => {
      await tx.session.update({ where: { id: sessionId }, data: { teacherId: body.teacherId ?? null } });
      await this.audit.record({ actorId: user.id, action: 'session.substitute', entity: 'Session', entityId: sessionId, branchId: s.batch.branchId, summary: sub ? `${sub.user.name} will take ${s.batch.name} on ${formatDateTime(s.startsAt)}` : `Removed the substitute for ${s.batch.name} on ${formatDateTime(s.startsAt)}` }, tx);
    });
    await this.notify.sendMany([...(await this.studentUserIds(s.batchId)), ...(await this.teacherUserIds(s.batchId, [body.teacherId, s.teacherId]))], {
      type: 'N5', title: `${s.batch.name}: ${sub ? 'substitute teacher' : 'teacher back'}`, body: `${formatWeekdayDate(s.startsAt)}: ${sub ? `${sub.user.name} will take this class.` : 'The regular teacher will take this class.'}`, link: '/timetable', email: true, essential: true,
    });
    return { ok: true, clashes };
  }

  // ── Enrolments ──
  @Get(':id/enrolments')
  async enrolments(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    const b = await this.acad.batchOr404(id);
    const role = await this.acad.assertViewBatch(user, b);
    if (role === 'student') throw new ForbiddenException();
    return this.prisma.enrolment.findMany({
      where: { batchId: id },
      include: { student: { select: { id: true, code: true, branchId: true, user: { select: { id: true, name: true, email: true, mobile: true } }, branch: { select: { code: true } } } } },
      orderBy: [{ status: 'asc' }, { student: { user: { name: 'asc' } } }],
    });
  }

  @RequirePerm('enrolments.manage')
  @Post(':id/enrolments')
  async enrol(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body(new Zod(enrolSchema)) body: z.infer<typeof enrolSchema>) {
    const b = await this.prisma.batch.findUnique({ where: { id }, include: { course: true } });
    if (!b) throw new NotFoundException('Batch not found');
    assertCan(user, 'enrolments.manage', b.branchId);
    if (b.status === 'CANCELLED' || b.status === 'COMPLETED') throw new BadRequestException('This batch is closed for enrolment');
    const created = await this.prisma.$transaction(async (tx) => {
      // Lock the batch row so two people can't overfill it at the same time.
      await tx.$queryRaw`SELECT id FROM "Batch" WHERE id = ${id} FOR UPDATE`;
      const active = await tx.enrolment.count({ where: { batchId: id, status: { in: ['ACTIVE', 'ON_HOLD'] } } });
      const fresh = [];
      for (const sid of body.studentIds) {
        const ex = await tx.enrolment.findUnique({ where: { studentId_batchId: { studentId: sid, batchId: id } } });
        if (ex && ex.status !== 'MOVED' && ex.status !== 'DROPPED') continue;
        fresh.push(sid);
      }
      if (active + fresh.length > b.capacity) throw new BadRequestException(`Only ${Math.max(0, b.capacity - active)} seat(s) left in this batch`);
      const students = await tx.student.findMany({ where: { id: { in: fresh } }, include: { user: { select: { name: true, status: true } } } });
      if (students.length !== fresh.length) throw new BadRequestException('Some students were not found');
      const rows = [];
      for (const s of students) {
        const e = await tx.enrolment.upsert({
          where: { studentId_batchId: { studentId: s.id, batchId: id } },
          create: { studentId: s.id, batchId: id },
          update: { status: 'ACTIVE', statusNote: null, enrolledOn: new Date() },
        });
        rows.push(e);
      }
      await this.audit.record({ actorId: user.id, action: 'enrolment.create', entity: 'Batch', entityId: id, branchId: b.branchId, summary: `Enrolled ${students.length} student(s) in ${b.name}: ${students.map((s) => s.user.name).join(', ')}` }, tx);
      return rows;
    });
    for (const e of created) await this.hooks.enrolled(e.id);
    await this.hooks.membersChanged(id);
    return { enrolled: created.length };
  }

  @RequirePerm('enrolments.manage')
  @Post('enrolments/:enrolmentId/action')
  async enrolmentAction(@CurrentUser() user: SessionUser, @Param('enrolmentId') enrolmentId: string, @Body(new Zod(enrolmentActionSchema)) body: z.infer<typeof enrolmentActionSchema>) {
    const e = await this.prisma.enrolment.findUnique({ where: { id: enrolmentId }, include: { batch: true, student: { include: { user: true } } } });
    if (!e) throw new NotFoundException('Enrolment not found');
    assertCan(user, 'enrolments.manage', e.batch.branchId);
    const name = e.student.user.name;
    if (body.action === 'MOVE') {
      const to = await this.prisma.batch.findUnique({ where: { id: body.toBatchId! } });
      if (!to) throw new BadRequestException('Choose the new batch');
      assertCan(user, 'enrolments.manage', to.branchId);
      if (to.courseId !== e.batch.courseId) throw new BadRequestException('Students can only move to a batch of the same course');
      if (to.id === e.batchId) throw new BadRequestException('Choose a different batch');
      const moved = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Batch" WHERE id = ${to.id} FOR UPDATE`;
        const active = await tx.enrolment.count({ where: { batchId: to.id, status: { in: ['ACTIVE', 'ON_HOLD'] } } });
        if (active >= to.capacity) throw new BadRequestException('The new batch is full');
        await tx.enrolment.update({ where: { id: enrolmentId }, data: { status: 'MOVED', statusNote: `Moved to ${to.name}${body.note ? `: ${body.note}` : ''}` } });
        const n = await tx.enrolment.upsert({
          where: { studentId_batchId: { studentId: e.studentId, batchId: to.id } },
          create: { studentId: e.studentId, batchId: to.id, movedFromId: enrolmentId },
          update: { status: 'ACTIVE', movedFromId: enrolmentId, statusNote: null },
        });
        await this.audit.record({ actorId: user.id, action: 'enrolment.move', entity: 'Enrolment', entityId: n.id, branchId: e.batch.branchId, summary: `Moved ${name} from ${e.batch.name} to ${to.name}` }, tx);
        return n;
      });
      await this.hooks.enrolmentMoved(enrolmentId, moved.id);
      await this.hooks.membersChanged(e.batchId);
      await this.hooks.membersChanged(to.id);
      return { ok: true };
    }
    const next = { HOLD: 'ON_HOLD', RESUME: 'ACTIVE', DROP: 'DROPPED' }[body.action] as 'ON_HOLD' | 'ACTIVE' | 'DROPPED';
    const allowed: Record<string, string[]> = { HOLD: ['ACTIVE'], RESUME: ['ON_HOLD'], DROP: ['ACTIVE', 'ON_HOLD'] };
    if (!allowed[body.action].includes(e.status)) throw new BadRequestException('That change is not possible for this enrolment');
    await this.prisma.$transaction(async (tx) => {
      await tx.enrolment.update({ where: { id: enrolmentId }, data: { status: next, statusNote: body.note ?? null } });
      await this.audit.record({ actorId: user.id, action: `enrolment.${body.action.toLowerCase()}`, entity: 'Enrolment', entityId: enrolmentId, branchId: e.batch.branchId, summary: `${body.action === 'HOLD' ? 'Put on hold' : body.action === 'RESUME' ? 'Resumed' : 'Dropped'} ${name} in ${e.batch.name}${body.note ? `: ${body.note}` : ''}` }, tx);
    });
    await this.hooks.membersChanged(e.batchId);
    return { ok: true };
  }
}
