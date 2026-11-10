import { Global, Logger, Module, OnModuleInit } from '@nestjs/common';
import { AttStatus, attendancePercent, formatWeekdayDate } from '@cc/shared';
import { JobsService } from '../../common/jobs.service';
import { PrismaService } from '../../common/prisma.service';
import { SettingsService } from '../../common/settings.service';
import { NotifyService } from '../notifications/notify.service';
import { RecordingsService } from '../recordings/recordings.service';
import { AttendanceController, AttendanceOverviewController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { AttendanceRequestsController } from './requests.controller';

/** ISO week label, e.g. 2026-W46 (used so low-attendance alerts go once a week). */
export function isoWeek(d: Date) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear();
  const w = Math.ceil(((t.getTime() - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
  return `${y}-W${String(w).padStart(2, '0')}`;
}

@Global()
@Module({ controllers: [AttendanceController, AttendanceOverviewController, AttendanceRequestsController], providers: [AttendanceService], exports: [AttendanceService] })
export class AttendanceModule implements OnModuleInit {
  private log = new Logger('Attendance');
  constructor(private jobs: JobsService, private prisma: PrismaService, private att: AttendanceService, private settings: SettingsService, private notify: NotifyService, private rec: RecordingsService) {}

  onModuleInit() {
    this.jobs.register('attendance.finalize', 60_000, () => this.finalizeEnded());
    this.jobs.register('attendance.escalate', 10 * 60_000, () => this.escalate());
    this.jobs.register('attendance.lowAlerts', 60 * 60_000, () => this.lowAttendanceAlerts());
  }

  /** Saves attendance for classes that are over (and closes classes a teacher forgot to end). */
  async finalizeEnded(now = new Date()) {
    const since = new Date(now.getTime() - 3 * 86400_000);
    const due = await this.prisma.session.findMany({
      where: { attendanceFinalizedAt: null, status: { not: 'CANCELLED' }, endsAt: { gte: since, lt: new Date(now.getTime() - 10 * 60_000) } },
      take: 50, orderBy: { endsAt: 'asc' },
    });
    for (const s of due) {
      if (s.status === 'LIVE') {
        if (s.endsAt.getTime() > now.getTime() - 60 * 60_000) continue; // still running over time: wait up to an hour
        await this.prisma.presenceInterval.updateMany({ where: { sessionId: s.id, leftAt: null }, data: { leftAt: now } });
        await this.rec.stop(s.id).catch(() => undefined);
      }
      if (s.status !== 'COMPLETED') await this.prisma.session.update({ where: { id: s.id }, data: { status: 'COMPLETED', ...(s.status === 'LIVE' ? { liveEndedAt: now } : {}) } });
      await this.att.finalize(s.id);
      this.log.log(`attendance saved for class ${s.id}`);
    }
  }

  /** PRD §8.2.3: undecided after N days → the Branch Admin decides. */
  async escalate(now = new Date()) {
    const days = await this.settings.get('attendance.escalateDays');
    const due = await this.prisma.attendanceRequest.findMany({
      where: { status: 'PENDING', createdAt: { lt: new Date(now.getTime() - days * 86400_000) } },
      include: { student: { select: { user: { select: { name: true } } } }, session: { select: { position: true, startsAt: true, batch: { select: { name: true, branchId: true } } } } },
      take: 200,
    });
    for (const r of due) {
      const { count } = await this.prisma.attendanceRequest.updateMany({ where: { id: r.id, status: 'PENDING' }, data: { status: 'ESCALATED', escalatedAt: now } });
      if (!count) continue;
      const admins = await this.att.branchStaffWith('attendance.oversee', r.session.batch.branchId);
      await this.notify.sendMany(admins, {
        type: 'N6', title: `Attendance request needs you: ${r.student.user.name}`,
        body: `The teacher did not decide within ${days} days. ${r.session.batch.name}, class ${r.session.position} (${formatWeekdayDate(r.session.startsAt)}).`,
        link: '/attendance', email: true,
      });
    }
  }

  /** PRD §8.3: below the threshold → student and Branch Admin alerted, once a week while it stays low. */
  async lowAttendanceAlerts(now = new Date()) {
    const threshold = await this.settings.get('attendance.lowAlertPercent');
    const week = isoWeek(now);
    const enrolments = await this.prisma.enrolment.findMany({
      where: { status: 'ACTIVE', batch: { status: 'RUNNING' } },
      include: { student: { select: { id: true, user: { select: { id: true, name: true } } } }, batch: { select: { id: true, name: true, branchId: true } } },
    });
    for (const e of enrolments) {
      const rows = await this.prisma.attendance.findMany({ where: { studentId: e.studentId, session: { batchId: e.batchId } }, select: { status: true } });
      if (rows.length < 3) continue;
      const pct = attendancePercent(rows.map((r) => ({ status: r.status as AttStatus })));
      if (pct === null || pct >= threshold) continue;
      await this.jobs.once(`lowatt:${e.id}:${week}`, async () => {
        await this.notify.send(e.student.user.id, {
          type: 'N7', title: `Your attendance in ${e.batch.name} is ${pct}%`, body: `Please attend regularly. The minimum is ${threshold}%.`, link: '/learn/attendance', email: true,
        });
        const admins = await this.att.branchStaffWith('attendance.oversee', e.batch.branchId);
        await this.notify.sendMany(admins, {
          type: 'N7', title: `Low attendance: ${e.student.user.name} (${pct}%)`, body: `${e.batch.name}. Minimum is ${threshold}%.`, link: `/students/${e.student.id}`, email: true,
        });
      });
    }
  }
}
