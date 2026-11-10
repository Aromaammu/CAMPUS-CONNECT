import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AttStatus, AttendanceMarkInput, OnlineDecision, Permission, SessionUser, can, decideOnline } from '@cc/shared';
import { AuditService } from '../../common/audit.service';
import { PrismaService, Tx } from '../../common/prisma.service';
import { SettingsService } from '../../common/settings.service';

/** Sources a teacher or Branch Admin set by hand; automatic recalculation never overwrites them. */
const HAND_SOURCES = ['MANUAL', 'ROSTER', 'REQUEST'] as const;

export interface RosterRow {
  studentId: string; userId: string; name: string; code: string;
  status: AttStatus | null; source: string | null; saved: boolean;
  seconds: number; percent: number; firstJoinAt: Date | null; inRoomNow: boolean; inRoom: boolean;
  checkins: { opened: number; answered: number }; reason: string | null;
}

@Injectable()
export class AttendanceService {
  constructor(private prisma: PrismaService, private settings: SettingsService, private audit: AuditService) {}

  async sessionOr404(id: string) {
    const s = await this.prisma.session.findUnique({
      where: { id },
      include: { batch: { include: { teachers: true, course: { select: { name: true } }, branch: { select: { id: true, code: true, name: true } } } } },
    });
    if (!s) throw new NotFoundException('Class not found');
    return s;
  }

  isTeacherOf(user: SessionUser, s: { teacherId: string | null; batch: { teachers: { employeeId: string }[] } }) {
    return !!user.employeeId && (s.teacherId === user.employeeId || s.batch.teachers.some((t) => t.employeeId === user.employeeId));
  }

  /** Teacher of the class, or someone who oversees the branch's attendance. */
  async access(user: SessionUser, sessionId: string) {
    const s = await this.sessionOr404(sessionId);
    const teacher = this.isTeacherOf(user, s);
    const oversee = can(user, 'attendance.oversee', s.batch.branchId);
    if (!teacher && !oversee) throw new ForbiddenException('Only the teacher or Branch Admin can see this');
    const lockHours = await this.settings.get('attendance.lockHours');
    const locked = Date.now() > s.endsAt.getTime() + lockHours * 3600_000;
    return { s, teacher, oversee, locked, canEdit: oversee || (teacher && !locked), lockHours };
  }

  /** When the class actually ran: from the later of the start time and the teacher opening it, to the earlier of end and the teacher ending it. */
  classWindow(s: { startsAt: Date; endsAt: Date; liveStartedAt: Date | null; liveEndedAt: Date | null }) {
    const from = new Date(Math.max(s.startsAt.getTime(), s.liveStartedAt?.getTime() ?? s.startsAt.getTime()));
    const to = new Date(Math.min(s.endsAt.getTime(), s.liveEndedAt?.getTime() ?? s.endsAt.getTime()));
    return { from, to: to > from ? to : new Date(from.getTime() + 60_000) };
  }

  /** Every active student's attendance: saved marks, or what the automatic rules say so far. */
  async roster(sessionId: string, now = new Date()): Promise<RosterRow[]> {
    const s = await this.sessionOr404(sessionId);
    const set = await this.settings.all();
    const rules = { presentPercent: set['attendance.presentPercent'], lateMinutes: set['attendance.lateMinutes'], checkinRequired: s.batch.checkinRequired };
    const [enrolments, saved, intervals, windows] = await Promise.all([
      this.prisma.enrolment.findMany({
        where: { batchId: s.batchId, OR: [{ status: 'ACTIVE' }, { student: { attendance: { some: { sessionId } } } }] },
        include: { student: { select: { id: true, code: true, user: { select: { id: true, name: true } } } } },
        orderBy: { student: { user: { name: 'asc' } } },
      }),
      this.prisma.attendance.findMany({ where: { sessionId } }),
      this.prisma.presenceInterval.findMany({ where: { sessionId, role: 'student' } }),
      this.prisma.checkinWindow.findMany({ where: { sessionId }, include: { responses: true } }),
    ]);
    const { from, to } = this.classWindow(s);
    const online = s.batch.mode !== 'OFFLINE' && !!s.liveStartedAt;
    return enrolments.map((e) => {
      const st = e.student;
      const mine = intervals.filter((i) => i.userId === st.user.id);
      const checkins = { opened: windows.length, answered: windows.filter((w) => w.responses.some((r) => r.studentId === st.id)).length };
      const row = saved.find((a) => a.studentId === st.id);
      const auto: OnlineDecision | null = online ? decideOnline({ intervals: mine, from, to, now, checkins, rules }) : null;
      const status = (row?.status as AttStatus | undefined) ?? auto?.status ?? null;
      return {
        studentId: st.id, userId: st.user.id, name: st.user.name, code: st.code,
        status, source: row?.source ?? (auto ? 'AUTO' : null), saved: !!row,
        seconds: auto?.seconds ?? row?.attendedSeconds ?? 0, percent: auto?.percent ?? 0,
        firstJoinAt: auto?.firstJoinAt ?? row?.firstJoinAt ?? null,
        inRoomNow: mine.some((i) => !i.leftAt), inRoom: row?.inRoom ?? false,
        checkins, reason: row?.reason ?? auto?.reason ?? null,
      };
    });
  }

  /**
   * Saves automatic attendance when a class is over. Marks set by hand are kept.
   * Classroom-only classes: students nobody marked are saved as Absent.
   */
  async finalize(sessionId: string, tx?: Tx) {
    const s = await this.sessionOr404(sessionId);
    const rows = await this.roster(sessionId);
    const run = async (db: Tx) => {
      const existing = await db.attendance.findMany({ where: { sessionId } });
      for (const r of rows) {
        const prev = existing.find((a) => a.studentId === r.studentId);
        if (prev && (HAND_SOURCES as readonly string[]).includes(prev.source)) continue;
        if (r.inRoom) continue;
        const online = s.batch.mode !== 'OFFLINE' && !!s.liveStartedAt;
        const data = online
          ? { status: r.status ?? 'ABSENT', source: 'AUTO' as const, attendedSeconds: r.seconds, firstJoinAt: r.firstJoinAt, checkedIn: r.checkins.opened > 0 && r.checkins.answered >= r.checkins.opened, reason: r.reason }
          : { status: 'ABSENT' as const, source: 'NONE' as const, attendedSeconds: 0, firstJoinAt: null, checkedIn: false, reason: s.batch.mode === 'OFFLINE' ? 'Not marked on the roster' : 'The class did not run online' };
        await db.attendance.upsert({ where: { sessionId_studentId: { sessionId, studentId: r.studentId } }, create: { sessionId, studentId: r.studentId, ...data }, update: data });
      }
      await db.session.update({ where: { id: sessionId }, data: { attendanceFinalizedAt: new Date() } });
    };
    if (tx) await run(tx); else await this.prisma.$transaction(run);
  }

  /** Teacher roster / manual override (PRD §8.1 c), audited. */
  async mark(user: SessionUser, sessionId: string, marks: AttendanceMarkInput[], ip?: string) {
    const a = await this.access(user, sessionId);
    if (!a.canEdit) throw new ForbiddenException(`Attendance locked ${a.lockHours} hours after the class. Ask the student to send an attendance request, or ask your Branch Admin.`);
    if (a.s.status === 'CANCELLED') throw new BadRequestException('This class was cancelled');
    if (Date.now() < a.s.startsAt.getTime() - 15 * 60_000) throw new BadRequestException('You can mark attendance once the class has started');
    const enrolled = await this.prisma.enrolment.findMany({ where: { batchId: a.s.batchId, studentId: { in: marks.map((m) => m.studentId) } }, select: { studentId: true } });
    const ok = new Set(enrolled.map((e) => e.studentId));
    const bad = marks.find((m) => !ok.has(m.studentId));
    if (bad) throw new BadRequestException('One of these students is not in this batch');
    const mode = a.s.batch.mode;
    const changes: string[] = [];
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.attendance.findMany({ where: { sessionId, studentId: { in: marks.map((m) => m.studentId) } }, include: { student: { select: { user: { select: { name: true } } } } } });
      for (const m of marks) {
        const prev = existing.find((e) => e.studentId === m.studentId);
        const roster = mode === 'OFFLINE' || (mode === 'HYBRID' && !!m.inRoom);
        // Changing an automatic online result needs a reason (PRD §8.1 c).
        if (!roster && (!m.reason || m.reason.length < 3)) throw new BadRequestException({ message: 'Give a reason when you change online attendance', fieldErrors: { [`reason.${m.studentId}`]: 'Give a reason' } });
        if (prev && prev.status === m.status && prev.inRoom === !!m.inRoom && (HAND_SOURCES as readonly string[]).includes(prev.source)) continue;
        const data = { status: m.status, source: roster ? ('ROSTER' as const) : ('MANUAL' as const), markedById: user.id, reason: m.reason ?? null, inRoom: mode === 'OFFLINE' ? true : !!m.inRoom };
        await tx.attendance.upsert({ where: { sessionId_studentId: { sessionId, studentId: m.studentId } }, create: { sessionId, studentId: m.studentId, ...data }, update: data });
        const who = prev?.student.user.name ?? (await tx.student.findUnique({ where: { id: m.studentId }, select: { user: { select: { name: true } } } }))?.user.name;
        changes.push(`${who}: ${prev ? `${prev.status} → ` : ''}${m.status}${m.reason ? ` (${m.reason})` : ''}`);
      }
      if (changes.length) {
        await this.audit.record({
          actorId: user.id, action: 'attendance.mark', entity: 'Session', entityId: sessionId, branchId: a.s.batch.branchId,
          summary: `Attendance for ${a.s.batch.name} class ${a.s.position}: ${changes.slice(0, 5).join('; ')}${changes.length > 5 ? ` and ${changes.length - 5} more` : ''}`, ip,
        }, tx);
      }
    });
    return { changed: changes.length };
  }

  /** Staff of a branch who hold a permission (e.g. Branch Admins for escalations). */
  async branchStaffWith(perm: Permission, branchId: string) {
    const emps = await this.prisma.employee.findMany({
      where: { OR: [{ branchId }, { extraBranches: { some: { branchId } } }], user: { status: 'ACTIVE' } },
      include: { designation: true, user: { select: { id: true } } },
    });
    return emps
      .filter((e) => (e.designation.permissions.includes(perm) || e.extraPermissions.includes(perm)) && !e.removedPermissions.includes(perm))
      .map((e) => e.user.id);
  }
}
