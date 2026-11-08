import { BadRequestException, Controller, ForbiddenException, Get, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SessionUser, can } from '@cc/shared';
import { CurrentUser, Kinds, branchesFor } from '../../common/org-access';
import { PrismaService } from '../../common/prisma.service';
import { AcademicsService } from './academics.service';

const sessionInclude = {
  batch: {
    select: {
      id: true, name: true, mode: true, branchId: true, branch: { select: { code: true } }, course: { select: { name: true, code: true } },
      teachers: { where: { role: 'MAIN' }, select: { employee: { select: { id: true, user: { select: { name: true } } } } } },
    },
  },
  teacher: { select: { id: true, user: { select: { name: true } } } },
  room: { select: { name: true } },
} satisfies Prisma.SessionInclude;

@Controller()
export class TimetableController {
  constructor(private prisma: PrismaService, private acad: AcademicsService) {}

  /**
   * scope=me: my classes (student: enrolled batches; teacher: batches I teach or substitute).
   * scope=branch: a branch's timetable, optionally by teacher, room or batch (PRD §6.4).
   */
  @Get('timetable')
  async timetable(@CurrentUser() user: SessionUser, @Query() q: Record<string, string>) {
    const from = q.from ? new Date(q.from) : new Date(Date.now() - 7 * 86400000);
    const to = q.to ? new Date(q.to) : new Date(Date.now() + 35 * 86400000);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) throw new BadRequestException('Choose a valid date range');
    if (to.getTime() - from.getTime() > 100 * 86400000) throw new BadRequestException('Choose at most 100 days');
    const when: Prisma.SessionWhereInput = { startsAt: { lt: to }, endsAt: { gt: from } };
    let where: Prisma.SessionWhereInput;
    if ((q.scope ?? 'me') === 'me') {
      if (user.kind === 'STUDENT') {
        where = { ...when, batch: { enrolments: { some: { studentId: user.studentId ?? '', status: { in: ['ACTIVE', 'ON_HOLD', 'COMPLETED'] } } } } };
      } else {
        const me = user.employeeId ?? '__none__';
        where = { ...when, OR: [{ teacherId: me }, { teacherId: null, batch: { teachers: { some: { employeeId: me } } } }] };
      }
    } else {
      if (user.kind === 'STUDENT') throw new ForbiddenException();
      const ids = branchesFor(user, 'batches.view');
      if (q.branchId && !can(user, 'batches.view', q.branchId)) throw new ForbiddenException('You do not have access to this branch');
      where = {
        ...when,
        batch: { ...(q.branchId ? { branchId: q.branchId } : ids ? { branchId: { in: ids } } : {}), ...(q.batchId ? { id: q.batchId } : {}) },
        ...(q.roomId ? { roomId: q.roomId } : {}),
        ...(q.teacherId ? { OR: [{ teacherId: q.teacherId }, { teacherId: null, batch: { teachers: { some: { employeeId: q.teacherId, role: 'MAIN' } } } }] } : {}),
      };
    }
    const rows = await this.prisma.session.findMany({ where, include: sessionInclude, orderBy: { startsAt: 'asc' }, take: 2000 });
    return rows.map((s) => ({
      id: s.id, batchId: s.batchId, position: s.position, startsAt: s.startsAt, endsAt: s.endsAt, status: s.status, cancelReason: s.cancelReason, topic: s.topic,
      batchName: s.batch.name, mode: s.batch.mode, branchCode: s.batch.branch.code, courseName: s.batch.course.name,
      teacherName: s.teacher?.user.name ?? s.batch.teachers[0]?.employee.user.name ?? null, substitute: !!s.teacherId, room: s.room?.name ?? null,
    }));
  }

  /** Student: my courses with batch, timing, teacher and hours progress (PRD §10 "My courses"). */
  @Kinds('STUDENT')
  @Get('me/enrolments')
  async myEnrolments(@CurrentUser() user: SessionUser) {
    const rows = await this.prisma.enrolment.findMany({
      where: { studentId: user.studentId ?? '', status: { not: 'MOVED' } },
      include: {
        batch: {
          include: {
            course: { select: { id: true, name: true, code: true, totalMinutes: true } }, branch: { select: { code: true, name: true } }, room: { select: { name: true } },
            teachers: { include: { employee: { select: { user: { select: { id: true, name: true } } } } } },
          },
        },
      },
      orderBy: { enrolledOn: 'desc' },
    });
    const out = [];
    for (const e of rows) {
      const next = await this.prisma.session.findFirst({ where: { batchId: e.batchId, status: { in: ['SCHEDULED', 'LIVE'] }, endsAt: { gt: new Date() } }, orderBy: { startsAt: 'asc' } });
      out.push({ ...e, hours: await this.acad.hours(e.batchId), nextSession: next });
    }
    return out;
  }
}
