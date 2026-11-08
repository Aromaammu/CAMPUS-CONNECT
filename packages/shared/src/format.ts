/** Indian formatting helpers (CLAUDE.md §6.5). All times stored UTC, shown IST. */
export const IST = 'Asia/Kolkata';

/** ₹1,23,456 or ₹1,23,456.50 from paise. */
export function formatINR(paise: number, opts: { decimals?: boolean } = {}): string {
  const rupees = paise / 100;
  const showDecimals = opts.decimals ?? paise % 100 !== 0;
  const s = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: showDecimals ? 2 : 0,
    maximumFractionDigits: showDecimals ? 2 : 0,
  }).format(rupees);
  return s.replace(/\s/g, '');
}

export function rupeesToPaise(rupees: number | string): number {
  const n = typeof rupees === 'string' ? Number(rupees.replace(/[,₹\s]/g, '')) : rupees;
  return Math.round(n * 100);
}

function parts(d: Date | string) {
  const date = typeof d === 'string' ? new Date(d) : d;
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: IST, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short',
  }).formatToParts(date);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour') === '24' ? '00' : get('hour'), min: get('minute'), wd: get('weekday') };
}

/** DD-MM-YYYY in IST */
export function formatDate(d: Date | string): string { const x = parts(d); return `${x.d}-${x.m}-${x.y}`; }
/** 9:05 am in IST */
export function formatTime(d: Date | string): string {
  const x = parts(d); const h = Number(x.h);
  return `${h % 12 === 0 ? 12 : h % 12}:${x.min} ${h < 12 ? 'am' : 'pm'}`;
}
export function formatDateTime(d: Date | string): string { return `${formatDate(d)}, ${formatTime(d)}`; }
export function formatWeekdayDate(d: Date | string): string { const x = parts(d); return `${x.wd} ${x.d}-${x.m}-${x.y}`; }

/** YYYY-MM-DD of a moment in IST */
export function istDateKey(d: Date | string): string { const x = parts(d); return `${x.y}-${x.m}-${x.d}`; }

/** Build a UTC Date from an IST calendar date (YYYY-MM-DD) and time (HH:mm). */
export function istToUtc(dateKey: string, hhmm: string): Date {
  return new Date(`${dateKey}T${hhmm}:00+05:30`);
}

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** "Mon–Fri" or "Mon, Wed, Fri" */
export function formatDays(days: number[]): string {
  const s = [...days].sort((a, b) => a - b);
  if (s.length > 2 && s.every((v, i) => i === 0 || v === s[i - 1] + 1)) return `${WEEKDAYS[s[0]]}–${WEEKDAYS[s[s.length - 1]]}`;
  return s.map((d) => WEEKDAYS[d]).join(', ');
}

/** "9:00 am" from "09:00" */
export function formatHHMM(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

export function minutesToHours(min: number): string {
  const h = Math.floor(min / 60); const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
