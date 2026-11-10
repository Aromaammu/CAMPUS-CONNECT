import { describe, expect, it } from 'vitest';
import { attendancePercent, attendanceDecisionSchema, decideOnline } from './attendance';

const t = (m: number) => new Date(Date.UTC(2026, 10, 10, 3, 30 + m)); // 9:00 IST + m minutes
const rules = { presentPercent: 75, lateMinutes: 10, checkinRequired: false };
const run = (intervals: [number, number | null][], extra: Partial<Parameters<typeof decideOnline>[0]> = {}) =>
  decideOnline({ intervals: intervals.map(([a, b]) => ({ joinedAt: t(a), leftAt: b === null ? null : t(b) })), from: t(0), to: t(120), checkins: { opened: 0, answered: 0 }, rules, ...extra });

describe('automatic attendance (PRD §8.1)', () => {
  it('present when in class for at least 75%', () => {
    expect(run([[0, 90]]).status).toBe('PRESENT');
    expect(run([[0, 89]]).status).toBe('ABSENT');
  });
  it('a dropped connection is added up, overlaps not counted twice', () => {
    const d = run([[0, 50], [45, 70], [75, 120]]);
    expect(d.seconds).toBe(115 * 60);
    expect(d.status).toBe('PRESENT');
  });
  it('late when the first join is more than 10 minutes after the start', () => {
    expect(run([[10, 120]]).status).toBe('PRESENT');
    const late = run([[11, 120]]);
    expect(late.status).toBe('LATE');
    expect(late.reason).toMatch(/11 minutes late/);
  });
  it('not joining at all is absent', () => {
    expect(run([]).reason).toBe('Did not join');
  });
  it('when check-ins are required, missing one makes the student absent', () => {
    const r = { ...rules, checkinRequired: true };
    expect(run([[0, 120]], { rules: r, checkins: { opened: 2, answered: 1 } }).status).toBe('ABSENT');
    expect(run([[0, 120]], { rules: r, checkins: { opened: 2, answered: 2 } }).status).toBe('PRESENT');
    // check-ins as "extra": informational only
    expect(run([[0, 120]], { checkins: { opened: 2, answered: 0 } }).status).toBe('PRESENT');
  });
  it('a student still in class counts up to now', () => {
    expect(run([[0, null]], { now: t(60) }).seconds).toBe(3600);
  });
});

describe('attendance percentage', () => {
  it('counts Present and Late, leaves Excused out', () => {
    expect(attendancePercent([{ status: 'PRESENT' }, { status: 'LATE' }, { status: 'ABSENT' }, { status: 'EXCUSED' }])).toBe(67);
    expect(attendancePercent([])).toBeNull();
  });
  it('rejecting a request needs a reason', () => {
    expect(attendanceDecisionSchema.safeParse({ approve: false }).success).toBe(false);
    expect(attendanceDecisionSchema.safeParse({ approve: true, status: 'PRESENT' }).success).toBe(true);
  });
});
