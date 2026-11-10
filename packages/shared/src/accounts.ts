import { z } from 'zod';
import { PAYMENT_METHODS } from './enums';
import { dateKeySchema } from './schemas';

/** Rupees in forms → integer paise on the server (CLAUDE.md §6.4). */
const rupees = z.coerce.number({ invalid_type_error: 'Enter an amount' }).min(0, 'Amount cannot be negative').max(10_000_000, 'That is too large');

export const feePlanSchema = z.object({
  enrolmentId: z.string().min(1),
  totalFee: rupees,
  discountType: z.enum(['AMOUNT', 'PERCENT']).default('AMOUNT'),
  discountValue: z.coerce.number().min(0).default(0),
  discountReason: z.string().trim().max(300).optional(),
  instalments: z.array(z.object({ dueDate: dateKeySchema, amount: rupees.refine((v) => v > 0, 'Amount must be more than 0') })).min(1, 'Add at least one instalment').max(24),
}).refine((v) => v.discountValue === 0 || (v.discountReason && v.discountReason.length >= 3), { message: 'Give a reason for the discount', path: ['discountReason'] })
  .refine((v) => v.discountType !== 'PERCENT' || v.discountValue <= 100, { message: 'At most 100%', path: ['discountValue'] });
export type FeePlanInput = z.infer<typeof feePlanSchema>;

export const PAYMENT_METHOD_KEYS = Object.keys(PAYMENT_METHODS) as (keyof typeof PAYMENT_METHODS)[];
export const paymentSchema = z.object({
  enrolmentId: z.string().min(1),
  amount: rupees.refine((v) => v > 0, 'Amount must be more than 0'),
  paidOn: dateKeySchema,
  method: z.enum(PAYMENT_METHOD_KEYS as [string, ...string[]]),
  reference: z.string().trim().max(100).optional(),
  receivedById: z.string().optional(),
  note: z.string().trim().max(300).optional(),
}).refine((v) => v.method === 'CASH' || (v.reference && v.reference.length >= 2), { message: 'Enter the reference number (UPI / bank / cheque / card slip)', path: ['reference'] });
export type PaymentInput = z.infer<typeof paymentSchema>;

export const refundSchema = z.object({
  enrolmentId: z.string().min(1),
  kind: z.enum(['REFUND', 'ADJUSTMENT']),
  amount: rupees.refine((v) => v > 0, 'Amount must be more than 0'),
  paidOn: dateKeySchema,
  method: z.enum(PAYMENT_METHOD_KEYS as [string, ...string[]]).default('CASH'),
  reference: z.string().trim().max(100).optional(),
  note: z.string().trim().min(3, 'Explain why').max(300),
});
export const voidRequestSchema = z.object({ reason: z.string().trim().min(3, 'Give a reason').max(300) });
export const decisionSchema = z.object({ approve: z.boolean(), note: z.string().trim().max(300).optional() })
  .refine((v) => v.approve || (v.note && v.note.length >= 3), { message: 'Give a reason', path: ['note'] });
export const remindSchema = z.object({ instalmentIds: z.array(z.string()).min(1, 'Choose at least one').max(500) });
export const batchFeeSchema = z.object({ fee: rupees.nullable() });
export const courseFeeSchema = z.object({ defaultFee: rupees.optional(), feeLocked: z.boolean().optional() });

/** Discount in paise for a total. */
export function discountPaise(totalPaise: number, type: 'AMOUNT' | 'PERCENT', value: number) {
  const d = type === 'PERCENT' ? Math.round((totalPaise * value) / 100) : Math.round(value * 100);
  return Math.min(totalPaise, Math.max(0, d));
}

/** True when a discount is above the approval limit (PRD §11.1, default 10%). */
export function discountNeedsApproval(totalPaise: number, discount: number, limitPercent: number) {
  return totalPaise > 0 && discount > Math.round((totalPaise * limitPercent) / 100);
}

/** Splits an amount into equal monthly instalments (last one takes the rounding). */
export function splitInstalments(netPaise: number, count: number, firstDue: string): { dueDate: string; amountPaise: number }[] {
  const n = Math.max(1, Math.min(24, count));
  const base = Math.floor(netPaise / n / 100) * 100; // whole rupees
  const out = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(`${firstDue}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + i);
    out.push({ dueDate: d.toISOString().slice(0, 10), amountPaise: i === n - 1 ? netPaise - base * (n - 1) : base });
  }
  return out;
}

/** PRD §11.2: a payment goes to the oldest unpaid instalment first. Returns how much each instalment gets. */
export function allocate(instalments: { id: string; seq: number; amountPaise: number; paidPaise: number }[], amountPaise: number) {
  let left = amountPaise;
  const out: { instalmentId: string; amountPaise: number }[] = [];
  for (const i of [...instalments].sort((a, b) => a.seq - b.seq)) {
    if (left <= 0) break;
    const open = i.amountPaise - i.paidPaise;
    if (open <= 0) continue;
    const take = Math.min(open, left);
    out.push({ instalmentId: i.id, amountPaise: take });
    left -= take;
  }
  return { allocations: out, unallocated: left };
}

export type InstalmentState = 'PAID' | 'OVERDUE' | 'DUE_TODAY' | 'DUE_SOON' | 'UPCOMING';
export const INSTALMENT_STATE: Record<InstalmentState, string> = { PAID: 'Paid', OVERDUE: 'Overdue', DUE_TODAY: 'Due today', DUE_SOON: 'Due soon', UPCOMING: 'Upcoming' };

/** Where an instalment stands on a given IST day ("due soon" = within `soonDays`). */
export function instalmentState(i: { dueDate: string; amountPaise: number; paidPaise: number }, todayKey: string, soonDays = 3): InstalmentState {
  if (i.paidPaise >= i.amountPaise) return 'PAID';
  if (i.dueDate < todayKey) return 'OVERDUE';
  if (i.dueDate === todayKey) return 'DUE_TODAY';
  const days = (new Date(`${i.dueDate}T00:00:00Z`).getTime() - new Date(`${todayKey}T00:00:00Z`).getTime()) / 86400000;
  return days <= soonDays ? 'DUE_SOON' : 'UPCOMING';
}

/** Indian-style amount in words for receipts, e.g. 12500 → "Twelve thousand five hundred rupees only". */
export function rupeesInWords(paise: number): string {
  const ones = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  const two = (n: number) => (n < 20 ? ones[n] : `${tens[Math.floor(n / 10)]}${n % 10 ? `-${ones[n % 10]}` : ''}`);
  const three = (n: number) => `${n >= 100 ? `${ones[Math.floor(n / 100)]} hundred${n % 100 ? ' ' : ''}` : ''}${n % 100 ? two(n % 100) : ''}`;
  let r = Math.floor(paise / 100);
  const p = paise % 100;
  if (r === 0 && p === 0) return 'Zero rupees only';
  const parts: string[] = [];
  const crore = Math.floor(r / 10_000_000); r %= 10_000_000;
  const lakh = Math.floor(r / 100_000); r %= 100_000;
  const thousand = Math.floor(r / 1000); r %= 1000;
  if (crore) parts.push(`${three(crore)} crore`);
  if (lakh) parts.push(`${two(lakh)} lakh`);
  if (thousand) parts.push(`${two(thousand)} thousand`);
  if (r) parts.push(three(r));
  let s = parts.length ? `${parts.join(' ')} rupees` : '';
  if (p) s += `${s ? ' and ' : ''}${two(p)} paise`;
  s = `${s} only`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
