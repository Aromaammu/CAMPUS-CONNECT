import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { SessionUser, can, istDateKey, overlaps, planSessions } from '@cc/shared';
import { PrismaService, Tx } from '../../common/prisma.service';

export interface Clash { kind: 'teacher' | 'room'; date: string; startsAt: Date; endsAt: Date; with: string }

@Injectable()
export class AcademicsService {
  constructor(private prisma: PrismaService) {}

  async holidayKeys(branchId: string, from?: Date) {
    const rows = await this.prisma.holiday.findMany({ where: { OR: [{ branchId: null }, { branchId }], ...(from ? { date: { gte: new Date(istDateKey(from)) } } : {}) } });
    return rows.map((h) => h.date.toISOString().slice(0, 10));
  }

  async plan(branchId: string, totalMinutes: number, input: { startDate: string; days: number[]; startTime: string; endTime: string }, startPosition = 1) {
    return planSessions({ ...input, totalMinutes, holidays: await this.holidayKeys(branchId), startPosition });
  }

  /** Teacher or room booked twice at the same time (PRD §6.2 clash check). */
  async clashes(sessions: { startsAt: Date; endsAt: Date }[], teacherIds: string[], roomId: string | null | undefined, excludeBatchId?: string): Promise<Clash[]> {
    if (!sessions.length) return [];
    const from = sessions[0].startsAt;
    const to = sessions[sessions.length - 1].endsAt;
    const others = await this.prisma.session.findMany({
      where: {
        status: { not: 'CANCELLED' },
        startsAt: { lt: to },
        endsAt: { gt: from },
        ...(excludeBatchId ? { batchId: { not: excludeBatchId } } : {}),
        OR: [
          ...(teacherIds.length ? [{ teacherId: { in: teacherIds } }, { teacherId: null, batch: { teachers: { some: { employeeId: { in: teacherIds }, role: 'MAIN' } } } }] : []),
          ...(roomId ? [{ roomId }] : []),
        ],
      },
      include: { batch: { select: { name: true, branch: { select: { code: true } }, teachers: true } }, room: { select: { name: true } } },
    });
    const out: Clash[] = [];
    for (const s of sessions) {
      for (const o of others) {
        if (!overlaps(s.startsAt, s.endsAt, o.startsAt, o.endsAt)) continue;
        const oTeachers = o.teacherId ? [o.teacherId] : o.batch.teachers.filter((t) => t.role === 'MAIN').map((t) => t.employeeId);
        if (teacherIds.some((t) => oTeachers.includes(t))) out.push({ kind: 'teacher', date: istDateKey(s.startsAt), startsAt: s.startsAt, endsAt: s.endsAt, with: `${o.batch.branch.code} · ${o.batch.name}` });
        if (roomId && o.roomId === roomId) out.push({ kind: 'room', date: istDateKey(s.startsAt), startsAt: s.startsAt, endsAt: s.endsAt, with: `${o.room?.name ?? 'Room'} · ${o.batch.name}` });
      }
    }
    return out;
  }

  async batchOr404(id: string) {
    const b = await this.prisma.batch.findUnique({ where: { id }, include: { teachers: true } });
    if (!b) throw new NotFoundException('Batch not found');
    return b;
  }

  /** Teacher of the batch (main/backup) or substitute for one of its sessions. */
  async isTeacher(user: SessionUser, batchId: string) {
    if (!user.employeeId) return false;
    const t = await this.prisma.batchTeacher.findUnique({ where: { batchId_employeeId: { batchId, employeeId: user.employeeId } } });
    if (t) return true;
    return (await this.prisma.session.count({ where: { batchId, teacherId: user.employeeId } })) > 0;
  }

  async isEnrolled(user: SessionUser, batchId: string, activeOnly = false) {
    if (!user.studentId) return false;
    const e = await this.prisma.enrolment.findUnique({ where: { studentId_batchId: { studentId: user.studentId, batchId } } });
    return !!e && (!activeOnly || e.status === 'ACTIVE') && e.status !== 'MOVED';
  }

  async assertViewBatch(user: SessionUser, batch: { id: string; branchId: string }) {
    if (user.kind === 'STUDENT') {
      if (await this.isEnrolled(user, batch.id)) return 'student' as const;
      throw new ForbiddenException('You do not have access to this batch');
    }
    if (can(user, 'batches.view', batch.branchId) || can(user, 'batches.manage', batch.branchId)) return 'staff' as const;
    if (await this.isTeacher(user, batch.id)) return 'teacher' as const;
    throw new ForbiddenException('You do not have access to this batch');
  }

  /** Teacher of this batch, or someone who oversees the branch's classes. */
  async assertTeachOrOversee(user: SessionUser, batch: { id: string; branchId: string }) {
    if (user.kind === 'STUDENT') throw new ForbiddenException('You do not have access to this');
    if (can(user, 'attendance.oversee', batch.branchId) || can(user, 'batches.manage', batch.branchId)) return;
    if (await this.isTeacher(user, batch.id)) return;
    throw new ForbiddenException('Only the batch teacher can do this');
  }

  /** Recompute a batch status from its sessions. */
  async refreshBatchStatus(batchId: string, tx: Tx = this.prisma) {
    const b = await tx.batch.findUnique({ where: { id: batchId }, select: { status: true } });
    if (!b || b.status === 'CANCELLED') return;
    const now = new Date();
    const [first, remaining] = await Promise.all([
      tx.session.findFirst({ where: { batchId, status: { not: 'CANCELLED' } }, orderBy: { startsAt: 'asc' } }),
      tx.session.count({ where: { batchId, status: { in: ['SCHEDULED', 'LIVE'] }, endsAt: { gt: now } } }),
    ]);
    const status = !first || first.startsAt > now ? 'UPCOMING' : remaining > 0 ? 'RUNNING' : 'COMPLETED';
    if (status !== b.status) await tx.batch.update({ where: { id: batchId }, data: { status } });
  }

  /** Minutes delivered (sessions that have ended, not cancelled) and scheduled. */
  async hours(batchId: string) {
    const sessions = await this.prisma.session.findMany({ where: { batchId, status: { not: 'CANCELLED' } }, select: { startsAt: true, endsAt: true } });
    const now = Date.now();
    let delivered = 0;
    let scheduled = 0;
    for (const s of sessions) {
      const m = (s.endsAt.getTime() - s.startsAt.getTime()) / 60000;
      scheduled += m;
      if (s.endsAt.getTime() <= now) delivered += m;
    }
    return { deliveredMinutes: Math.round(delivered), scheduledMinutes: Math.round(scheduled) };
  }
}
