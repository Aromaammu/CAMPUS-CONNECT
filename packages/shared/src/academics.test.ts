import { describe, expect, it } from 'vitest';
import { batchSchema, planSessions } from './academics';

describe('planSessions', () => {
  it('builds Python Full Stack (40 h) Mon–Fri 9–11 am: 20 sessions', () => {
    const s = planSessions({ startDate: '2026-11-02', days: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '11:00', totalMinutes: 40 * 60, holidays: [] });
    expect(s).toHaveLength(20);
    expect(s[0].date).toBe('2026-11-02');
    expect(s[0].startsAt.toISOString()).toBe('2026-11-02T03:30:00.000Z');
    expect(s[19].date).toBe('2026-11-27');
    expect(s.every((x) => ![0, 6].includes(new Date(`${x.date}T00:00:00Z`).getUTCDay()))).toBe(true);
  });

  it('skips holidays and adds a day at the end instead', () => {
    const s = planSessions({ startDate: '2026-11-02', days: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '11:00', totalMinutes: 40 * 60, holidays: ['2026-11-04'] });
    expect(s).toHaveLength(20);
    expect(s.map((x) => x.date)).not.toContain('2026-11-04');
    expect(s[19].date).toBe('2026-11-30');
  });

  it('starts from the first matching weekday', () => {
    const s = planSessions({ startDate: '2026-11-08', days: [1, 3, 5], startTime: '18:00', endTime: '20:00', totalMinutes: 6 * 60, holidays: [] });
    expect(s.map((x) => x.date)).toEqual(['2026-11-09', '2026-11-11', '2026-11-13']);
  });

  it('rounds up when hours do not divide evenly', () => {
    const s = planSessions({ startDate: '2026-11-02', days: [1], startTime: '10:00', endTime: '11:30', totalMinutes: 4 * 60, holidays: [] });
    expect(s).toHaveLength(3);
  });

  it('returns nothing for impossible inputs', () => {
    expect(planSessions({ startDate: '2026-11-02', days: [], startTime: '10:00', endTime: '11:00', totalMinutes: 60, holidays: [] })).toEqual([]);
    expect(planSessions({ startDate: '2026-11-02', days: [1], startTime: '11:00', endTime: '10:00', totalMinutes: 60, holidays: [] })).toEqual([]);
  });
});

describe('batchSchema', () => {
  const base = { branchId: 'b', courseId: 'c', name: 'Morning Batch A', mode: 'ONLINE', startDate: '2026-11-02', days: [1], startTime: '09:00', endTime: '11:00', capacity: 30, teacherId: 't' };
  it('needs a room for offline and hybrid', () => {
    expect(batchSchema.safeParse({ ...base, mode: 'HYBRID' }).success).toBe(false);
    expect(batchSchema.safeParse({ ...base, mode: 'HYBRID', roomId: 'r' }).success).toBe(true);
  });
  it('needs the end after the start', () => {
    expect(batchSchema.safeParse({ ...base, endTime: '08:00' }).success).toBe(false);
  });
});
