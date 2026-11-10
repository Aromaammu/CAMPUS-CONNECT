import { z } from 'zod';
import { presenceSeconds } from './live';

export type AttStatus = 'PRESENT' | 'LATE' | 'ABSENT' | 'EXCUSED';
export const ATT_STATUSES: AttStatus[] = ['PRESENT', 'LATE', 'ABSENT', 'EXCUSED'];
export const ATT_SOURCE_LABELS: Record<string, string> = {
  AUTO: 'Automatic', CHECKIN: 'Check-in', MANUAL: 'Teacher', REQUEST: 'Request approved', ROSTER: 'Roster', NONE: 'Not marked',
};

export interface AttendanceRules { presentPercent: number; lateMinutes: number; checkinRequired: boolean }

export interface OnlineDecision { status: 'PRESENT' | 'LATE' | 'ABSENT'; seconds: number; percent: number; firstJoinAt: Date | null; checkedIn: boolean; reason: string | null }

/**
 * PRD §8.1 (online): Present if in class for at least `presentPercent` of the class, Late if the first
 * join was more than `lateMinutes` after the start. When check-ins are required, every check-in must be answered too.
 * `from`/`to` is the time the class actually ran; reconnects are merged so time is never counted twice.
 */
export function decideOnline(o: {
  intervals: { joinedAt: Date; leftAt: Date | null }[];
  from: Date; to: Date; now?: Date;
  checkins: { opened: number; answered: number };
  rules: AttendanceRules;
}): OnlineDecision {
  const duration = Math.max(1, (o.to.getTime() - o.from.getTime()) / 1000);
  const seconds = presenceSeconds(o.intervals, o.from, o.to, o.now);
  const percent = Math.min(100, Math.round((seconds / duration) * 100));
  const firstJoinAt = o.intervals.length ? new Date(Math.min(...o.intervals.map((i) => i.joinedAt.getTime()))) : null;
  const checkedIn = o.checkins.opened === 0 || o.checkins.answered >= o.checkins.opened;
  if (!firstJoinAt || percent < o.rules.presentPercent) {
    return { status: 'ABSENT', seconds, percent, firstJoinAt, checkedIn, reason: firstJoinAt ? `In class for ${percent}% of the time` : 'Did not join' };
  }
  if (o.rules.checkinRequired && !checkedIn) return { status: 'ABSENT', seconds, percent, firstJoinAt, checkedIn, reason: 'Missed a check-in' };
  const lateBy = (firstJoinAt.getTime() - o.from.getTime()) / 60000;
  if (lateBy > o.rules.lateMinutes) return { status: 'LATE', seconds, percent, firstJoinAt, checkedIn, reason: `Joined ${Math.round(lateBy)} minutes late` };
  return { status: 'PRESENT', seconds, percent, firstJoinAt, checkedIn, reason: null };
}

/** Attendance % for a student in a batch: (Present + Late) ÷ classes held, Excused classes left out. */
export function attendancePercent(rows: { status: AttStatus }[]): number | null {
  const counted = rows.filter((r) => r.status !== 'EXCUSED');
  if (!counted.length) return null;
  return Math.round((counted.filter((r) => r.status === 'PRESENT' || r.status === 'LATE').length / counted.length) * 100);
}

export const attendanceMarkSchema = z.object({
  studentId: z.string().min(1),
  status: z.enum(['PRESENT', 'LATE', 'ABSENT', 'EXCUSED']),
  reason: z.string().trim().max(300).optional(),
  inRoom: z.boolean().optional(),
});
export const attendanceMarksSchema = z.object({ marks: z.array(attendanceMarkSchema).min(1).max(300) });
export type AttendanceMarkInput = z.infer<typeof attendanceMarkSchema>;

export const ATT_REQUEST_REASONS = [
  'My internet dropped',
  'I missed the check-in',
  'I was in the classroom but not marked',
  'Technical problem with the app',
  'Other',
] as const;
export const attendanceRequestSchema = z.object({
  sessionId: z.string().min(1),
  reason: z.enum(ATT_REQUEST_REASONS, { errorMap: () => ({ message: 'Choose a reason' }) }),
  note: z.string().trim().max(1000).optional(),
  attachmentId: z.string().optional(),
});
export const attendanceDecisionSchema = z
  .object({ approve: z.boolean(), status: z.enum(['PRESENT', 'LATE']).optional(), note: z.string().trim().max(500).optional() })
  .refine((v) => v.approve || (v.note && v.note.length >= 3), { message: 'Tell the student why', path: ['note'] });
export const ATT_REQUEST_STATUS = { PENDING: 'Waiting for teacher', ESCALATED: 'With Branch Admin', APPROVED: 'Approved', REJECTED: 'Rejected' } as const;
