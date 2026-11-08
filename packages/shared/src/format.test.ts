import { describe, expect, it } from 'vitest';
import { formatDate, formatDays, formatHHMM, formatINR, formatTime, istDateKey, istToUtc, rupeesToPaise } from './format';

describe('Indian formatting', () => {
  it('formats rupees with Indian grouping', () => {
    expect(formatINR(12345600)).toBe('₹1,23,456');
    expect(formatINR(12345650)).toBe('₹1,23,456.50');
    expect(formatINR(0)).toBe('₹0');
  });
  it('converts rupees to paise without float errors', () => {
    expect(rupeesToPaise('1,23,456.50')).toBe(12345650);
    expect(rupeesToPaise(0.1 + 0.2)).toBe(30);
  });
  it('shows dates and times in IST', () => {
    const d = new Date('2026-11-08T03:30:00Z'); // 9:00 am IST
    expect(formatDate(d)).toBe('08-11-2026');
    expect(formatTime(d)).toBe('9:00 am');
    expect(istDateKey(new Date('2026-11-08T20:00:00Z'))).toBe('2026-11-09');
    expect(istToUtc('2026-11-08', '09:00').toISOString()).toBe('2026-11-08T03:30:00.000Z');
  });
  it('describes weekly days', () => {
    expect(formatDays([1, 2, 3, 4, 5])).toBe('Mon–Fri');
    expect(formatDays([1, 3, 5])).toBe('Mon, Wed, Fri');
    expect(formatHHMM('14:05')).toBe('2:05 pm');
  });
});

import { parseDdMmYyyy } from './org-schemas';
import { dateKeySchema } from './schemas';
describe('dates from forms and Excel', () => {
  it('accepts real dates and refuses impossible ones', () => {
    expect(parseDdMmYyyy('15-08-2004')).toBe('2004-08-15');
    expect(parseDdMmYyyy('5/3/2004')).toBe('2004-03-05');
    expect(parseDdMmYyyy('31/31/2004')).toBe('invalid');
    expect(parseDdMmYyyy('29-02-2023')).toBe('invalid');
    expect(parseDdMmYyyy('29-02-2024')).toBe('2024-02-29');
    expect(dateKeySchema.safeParse('2026-02-30').success).toBe(false);
    expect(dateKeySchema.safeParse('2026-11-08').success).toBe(true);
  });
});
