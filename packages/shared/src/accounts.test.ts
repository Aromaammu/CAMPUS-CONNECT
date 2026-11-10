import { describe, expect, it } from 'vitest';
import { allocate, discountNeedsApproval, discountPaise, feePlanSchema, instalmentState, paymentSchema, rupeesInWords, splitInstalments } from './accounts';

describe('fee plans', () => {
  it('discounts by amount or percent; above 10% needs approval', () => {
    expect(discountPaise(3_500_000, 'PERCENT', 10)).toBe(350_000);
    expect(discountPaise(3_500_000, 'AMOUNT', 2000)).toBe(200_000);
    expect(discountPaise(100_00, 'AMOUNT', 500)).toBe(100_00); // never more than the fee
    expect(discountNeedsApproval(3_500_000, 350_000, 10)).toBe(false);
    expect(discountNeedsApproval(3_500_000, 350_100, 10)).toBe(true);
  });
  it('splits into monthly instalments that add up exactly', () => {
    const parts = splitInstalments(3_150_000, 3, '2026-11-15');
    expect(parts.map((p) => p.dueDate)).toEqual(['2026-11-15', '2026-12-15', '2027-01-15']);
    expect(parts.reduce((a, p) => a + p.amountPaise, 0)).toBe(3_150_000);
    expect(parts[0].amountPaise % 100).toBe(0);
  });
  it('a discount needs a reason', () => {
    expect(feePlanSchema.safeParse({ enrolmentId: 'e', totalFee: 35000, discountValue: 5, discountType: 'PERCENT', instalments: [{ dueDate: '2026-12-01', amount: 33250 }] }).success).toBe(false);
  });
});

describe('payments', () => {
  const plan = [
    { id: 'a', seq: 1, amountPaise: 1_000_000, paidPaise: 1_000_000 },
    { id: 'b', seq: 2, amountPaise: 1_000_000, paidPaise: 400_000 },
    { id: 'c', seq: 3, amountPaise: 1_000_000, paidPaise: 0 },
  ];
  it('pays the oldest unpaid instalment first, then the next', () => {
    expect(allocate(plan, 800_000)).toEqual({ allocations: [{ instalmentId: 'b', amountPaise: 600_000 }, { instalmentId: 'c', amountPaise: 200_000 }], unallocated: 0 });
    expect(allocate(plan, 2_000_000).unallocated).toBe(400_000);
  });
  it('non-cash payments need a reference', () => {
    expect(paymentSchema.safeParse({ enrolmentId: 'e', amount: 1000, paidOn: '2026-11-10', method: 'UPI' }).success).toBe(false);
    expect(paymentSchema.safeParse({ enrolmentId: 'e', amount: 1000, paidOn: '2026-11-10', method: 'CASH' }).success).toBe(true);
  });
  it('instalment states by date', () => {
    const i = { amountPaise: 100, paidPaise: 0 };
    expect(instalmentState({ ...i, dueDate: '2026-11-09' }, '2026-11-10')).toBe('OVERDUE');
    expect(instalmentState({ ...i, dueDate: '2026-11-10' }, '2026-11-10')).toBe('DUE_TODAY');
    expect(instalmentState({ ...i, dueDate: '2026-11-13' }, '2026-11-10')).toBe('DUE_SOON');
    expect(instalmentState({ ...i, dueDate: '2026-11-20' }, '2026-11-10')).toBe('UPCOMING');
    expect(instalmentState({ amountPaise: 100, paidPaise: 100, dueDate: '2026-11-01' }, '2026-11-10')).toBe('PAID');
  });
  it('amount in words, Indian style', () => {
    expect(rupeesInWords(1_250_000)).toBe('Twelve thousand five hundred rupees only');
    expect(rupeesInWords(12_345_675)).toBe('One lakh twenty-three thousand four hundred fifty-six rupees and seventy-five paise only');
  });
});
