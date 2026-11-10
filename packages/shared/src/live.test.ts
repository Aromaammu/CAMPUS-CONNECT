import { describe, expect, it } from 'vitest';
import { liveControlSchema, parseLiveRoomName, parseRoomState, presenceSeconds } from './live';

const t = (m: number) => new Date(Date.UTC(2026, 10, 10, 4, m));

describe('presenceSeconds', () => {
  it('merges overlapping reconnects instead of counting twice', () => {
    expect(presenceSeconds([{ joinedAt: t(0), leftAt: t(30) }, { joinedAt: t(20), leftAt: t(50) }], t(0), t(120))).toBe(50 * 60);
  });
  it('adds separate stays and clips to the class time', () => {
    expect(presenceSeconds([{ joinedAt: t(-10), leftAt: t(10) }, { joinedAt: t(30), leftAt: t(40) }, { joinedAt: t(110), leftAt: t(130) }], t(0), t(120))).toBe(30 * 60);
  });
  it('counts a still-open stay up to now', () => {
    expect(presenceSeconds([{ joinedAt: t(0), leftAt: null }], t(0), t(120), t(15))).toBe(15 * 60);
  });
});

describe('room helpers', () => {
  it('round-trips room names and tolerates bad metadata', () => {
    expect(parseLiveRoomName('s_abc')).toEqual({ kind: 'session', id: 'abc' });
    expect(parseLiveRoomName('other')).toBeNull();
    expect(parseRoomState('not json').micAllowed).toBe(true);
    expect(parseRoomState('{"chatDisabled":true}').chatDisabled).toBe(true);
  });
  it('person actions need a person', () => {
    expect(liveControlSchema.safeParse({ action: 'remove' }).success).toBe(false);
    expect(liveControlSchema.safeParse({ action: 'mute-all' }).success).toBe(true);
  });
});
