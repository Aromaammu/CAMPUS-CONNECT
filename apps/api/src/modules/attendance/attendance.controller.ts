import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, NotFoundException, Param, Post, Put, Query, Req } from '@nestjs/common';
import { AttStatus, AttendanceMarkInput, SessionUser, attendanceMarksSchema, attendancePercent } from '@cc/shared';
import type { Request } from 'express';
import { CurrentUser, branchesFor } from '../../common/auth';
import { Zod, clientIp } from '../../common/http';
import { PrismaService } from '../../common/prisma.service';
import { SettingsService } from '../../common/settings.service';
import { LiveGateway } from '../live/live.gateway';
import { LiveService } from '../live/live.service';
import { AttendanceService } from './attendance.service';

@Controller()
export class AttendanceController {
  constructor(
    private att: AttendanceService, private prisma: PrismaService, private settings: SettingsService,
    private live: LiveService, private gw: LiveGateway,
  ) {}

  /** T4 / live attendance panel: the class roster with automatic and hand-set marks. */
  @Get('attendance/sessions/:id')
  async roster(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    const a = await this.att.access(user, id);
    const s = a.s;
    const [rows, windows] = await Promise.all([
      this.att.roster(id),
      this.prisma.checkinWindow.findMany({ where: { sessionId: id }, orderBy: { openedAt: 'asc' }, include: { _count: { select: { responses: true } } } }),
    ]);
    const now = new Date();
    return {
      session: { id: s.id, position: s.position, startsAt: s.startsAt, endsAt: s.endsAt, status: s.status, liveStartedAt: s.liveStartedAt, liveEndedAt: s.liveEndedAt, topic: s.topic, finalized: !!s.attendanceFinalizedAt },
      batch: { id: s.batchId, name: s.batch.name, mode: s.batch.mode, course: s.batch.course.name, branch: s.batch.branch, checkinRequired: s.batch.checkinRequired },
      locked: a.locked, canEdit: a.canEdit, isTeacher: a.teacher, lockHours: a.lockHours,
      rows,
      checkins: windows.map((w) => ({ id: w.id, openedAt: w.openedAt, closesAt: w.closesAt, answered: w._count.responses, open: w.closesAt > now })),
    };
  }

  @Put('attendance/sessions/:id')
  mark(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body(new Zod(attendanceMarksSchema)) body: { marks: AttendanceMarkInput[] }, @Req() req: Request) {
    return this.att.mark(user, id, body.marks, clientIp(req) ?? undefined);
  }

  /** "Mark your attendance": the teacher opens a short check-in window during the live class. */
  @Post('attendance/sessions/:id/checkins')
  async openCheckin(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    const a = await this.live.access(user, id);
    if (!a.isHost) throw new ForbiddenException('Only the teacher can ask for check-ins');
    if (a.session.status !== 'LIVE') throw new BadRequestException('Start the class first');
    const now = new Date();
    const open = await this.prisma.checkinWindow.findFirst({ where: { sessionId: id, closesAt: { gt: now } } });
    if (open) throw new BadRequestException('A check-in is already open');
    const secs = await this.settings.get('attendance.checkinSeconds');
    const w = await this.prisma.checkinWindow.create({ data: { sessionId: id, openedBy: user.id, closesAt: new Date(now.getTime() + secs * 1000) } });
    await this.gw.send(this.live.roomOf(id), 'notice', { type: 'checkin', windowId: w.id, closesAt: w.closesAt.toISOString() });
    return w;
  }

  /** For a student who joins or refreshes during a check-in. */
  @Get('attendance/sessions/:id/checkin')
  async currentCheckin(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    const w = await this.prisma.checkinWindow.findFirst({ where: { sessionId: id, closesAt: { gt: new Date() } }, orderBy: { openedAt: 'desc' } });
    if (!w || !user.studentId) return { open: null };
    const answered = !!(await this.prisma.checkinResponse.findUnique({ where: { windowId_studentId: { windowId: w.id, studentId: user.studentId } } }));
    return { open: { windowId: w.id, closesAt: w.closesAt, answered } };
  }

  @Post('attendance/checkins/:windowId')
  @HttpCode(200)
  async respond(@CurrentUser() user: SessionUser, @Param('windowId') windowId: string) {
    if (!user.studentId) throw new ForbiddenException('Only students check in');
    const w = await this.prisma.checkinWindow.findUnique({ where: { id: windowId }, include: { session: { select: { batchId: true } } } });
    if (!w) throw new NotFoundException('Check-in not found');
    const e = await this.prisma.enrolment.findUnique({ where: { studentId_batchId: { studentId: user.studentId, batchId: w.session.batchId } } });
    if (!e || e.status !== 'ACTIVE') throw new ForbiddenException('You are not in this batch');
    if (Date.now() > w.closesAt.getTime() + 5000) throw new BadRequestException('The check-in has closed. You can send an attendance request after the class.');
    await this.prisma.checkinResponse.upsert({ where: { windowId_studentId: { windowId, studentId: user.studentId } }, create: { windowId, studentId: user.studentId }, update: {} });
    return { ok: true };
  }

  /** S5: a student's attendance in every batch, with which classes they can still request. */
  @Get('me/attendance')
  async mine(@CurrentUser() user: SessionUser, @Query('batchId') batchId?: string) {
    if (!user.studentId) throw new ForbiddenException('Only students have attendance');
    const requestDays = await this.settings.get('attendance.requestDays');
    const enrolments = await this.prisma.enrolment.findMany({
      where: { studentId: user.studentId, status: { not: 'MOVED' }, ...(batchId ? { batchId } : {}) },
      include: { batch: { include: { course: { select: { name: true } }, branch: { select: { code: true, name: true } } } } },
      orderBy: { enrolledOn: 'desc' },
    });
    const now = Date.now();
    const out = [];
    for (const e of enrolments) {
      const sessions = await this.prisma.session.findMany({
        where: { batchId: e.batchId, status: { not: 'CANCELLED' }, startsAt: { lte: new Date() } },
        orderBy: { startsAt: 'desc' },
        include: { attendance: { where: { studentId: user.studentId } }, attRequests: { where: { studentId: user.studentId }, orderBy: { createdAt: 'desc' }, take: 1 } },
      });
      const rows = sessions.map((s) => {
        const att = s.attendance[0];
        const req = s.attRequests[0];
        const ended = s.endsAt.getTime() <= now || s.status === 'COMPLETED';
        const withinWindow = now <= s.endsAt.getTime() + requestDays * 86400_000;
        const canRequest = ended && withinWindow && e.status === 'ACTIVE' && att?.status !== 'PRESENT' && att?.status !== 'EXCUSED' && (!req || req.status === 'REJECTED');
        return {
          sessionId: s.id, position: s.position, startsAt: s.startsAt, endsAt: s.endsAt, status: s.status,
          attendance: att ? { status: att.status, source: att.source, reason: att.reason, attendedSeconds: att.attendedSeconds } : null,
          request: req ? { id: req.id, status: req.status, decisionNote: req.decisionNote, createdAt: req.createdAt } : null,
          canRequest,
        };
      });
      const marked = rows.filter((r) => r.attendance).map((r) => ({ status: r.attendance!.status as AttStatus }));
      out.push({
        enrolmentId: e.id, enrolmentStatus: e.status,
        batch: { id: e.batchId, name: e.batch.name, course: e.batch.course.name, branch: e.batch.branch },
        percent: attendancePercent(marked),
        counts: { present: marked.filter((m) => m.status === 'PRESENT').length, late: marked.filter((m) => m.status === 'LATE').length, absent: marked.filter((m) => m.status === 'ABSENT').length, excused: marked.filter((m) => m.status === 'EXCUSED').length },
        sessions: rows,
      });
    }
    return { requestDays, batches: out };
  }
}

/** BA11: attendance across a branch's batches, low-attendance students and requests waiting for the Branch Admin. */
@Controller('attendance')
export class AttendanceOverviewController {
  constructor(private prisma: PrismaService, private settings: SettingsService) {}

  @Get('overview')
  async overview(@CurrentUser() user: SessionUser, @Query('branchId') branchId?: string) {
    const scope = branchesFor(user, 'attendance.oversee');
    if (scope !== null && !scope.length) throw new ForbiddenException('You do not have access to this');
    if (branchId && scope !== null && !scope.includes(branchId)) throw new ForbiddenException('You do not have access to this branch');
    const branchFilter = branchId ? { branchId } : scope === null ? {} : { branchId: { in: scope } };
    const threshold = await this.settings.get('attendance.lowAlertPercent');
    const batches = await this.prisma.batch.findMany({
      where: { ...branchFilter, status: { in: ['RUNNING', 'COMPLETED'] } },
      include: { course: { select: { name: true } }, branch: { select: { code: true } } },
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
    });
    const out = [];
    const low: { studentId: string; name: string; code: string; batch: string; batchId: string; percent: number }[] = [];
    for (const b of batches) {
      const rows = await this.prisma.attendance.findMany({
        where: { session: { batchId: b.id } },
        select: { status: true, studentId: true, student: { select: { code: true, user: { select: { name: true } } } } },
      });
      const byStudent = new Map<string, typeof rows>();
      rows.forEach((r) => byStudent.set(r.studentId, [...(byStudent.get(r.studentId) ?? []), r]));
      for (const [sid, list] of byStudent) {
        const pct = attendancePercent(list.map((x) => ({ status: x.status as AttStatus })));
        if (list.length >= 3 && pct !== null && pct < threshold) low.push({ studentId: sid, name: list[0].student.user.name, code: list[0].student.code, batch: b.name, batchId: b.id, percent: pct });
      }
      out.push({ id: b.id, name: b.name, course: b.course.name, branch: b.branch.code, status: b.status, percent: attendancePercent(rows.map((r) => ({ status: r.status as AttStatus }))), marked: rows.length });
    }
    const [escalated, pending] = await Promise.all([
      this.prisma.attendanceRequest.count({ where: { status: 'ESCALATED', session: { batch: branchFilter } } }),
      this.prisma.attendanceRequest.count({ where: { status: 'PENDING', session: { batch: branchFilter } } }),
    ]);
    return { threshold, batches: out, low: low.sort((a, b) => a.percent - b.percent), requests: { escalated, pending } };
  }
}
