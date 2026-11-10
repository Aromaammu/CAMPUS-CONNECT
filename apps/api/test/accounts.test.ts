import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AccountsModule } from '../src/modules/accounts/accounts.module';
import { DEMO, as, closeApp, getApp, prisma } from './helpers';

beforeAll(async () => { await getApp(); });
afterAll(async () => { await closeApp(); });
const KACC = DEMO.kochiAccounts;
const HOA = DEMO.accounts; // Head of Accounts
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const addDays = (n: number) => new Date(new Date(`${today()}T00:00:00Z`).getTime() + n * 86400_000).toISOString().slice(0, 10);

/** A Kochi enrolment whose plan has no payments yet (overdue students in the demo data). */
async function unpaidKochiEnrolment() {
  const plans = await prisma().feePlan.findMany({ where: { enrolment: { status: 'ACTIVE', batch: { branch: { code: 'KOC01' }, name: { not: 'Live Demo Class' } } }, discountStatus: 'NONE' }, include: { instalments: true, enrolment: { include: { student: true } } } });
  const p = plans.find((x) => x.instalments.every((i) => i.paidPaise === 0) && !x.enrolment.student.userId.startsWith('x'));
  if (!p) throw new Error('no unpaid plan in demo data');
  return p;
}

describe('fee plans and discounts', () => {
  it('instalments must add up; a 15% discount waits for the Head of Accounts, who approves it', async () => {
    const p = await unpaidKochiEnrolment();
    const acc = await as(KACC);
    const total = p.totalPaise / 100;
    const bad = await acc.post('/api/accounts/fee-plans', { enrolmentId: p.enrolmentId, totalFee: total, instalments: [{ dueDate: addDays(10), amount: total - 1 }] });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toMatch(/add up/);
    const net = total * 0.85;
    const r = await acc.post('/api/accounts/fee-plans', { enrolmentId: p.enrolmentId, totalFee: total, discountType: 'PERCENT', discountValue: 15, discountReason: 'Merit scholarship', instalments: [{ dueDate: addDays(5), amount: net / 2 }, { dueDate: addDays(35), amount: net / 2 }] });
    expect(r.status).toBe(201);
    expect(r.body.discountStatus).toBe('PENDING');
    const hoa = await prisma().user.findUniqueOrThrow({ where: { email: HOA } });
    expect(await prisma().notification.count({ where: { userId: hoa.id, type: 'N14' } })).toBeGreaterThan(0);
    expect((await acc.post(`/api/accounts/fee-plans/${r.body.id}/discount-decision`, { approve: true })).status).toBe(403);
    const list = await (await as(HOA)).get('/api/accounts/approvals');
    expect(list.body.discounts.map((d: { id: string }) => d.id)).toContain(r.body.id);
    expect((await (await as(HOA)).post(`/api/accounts/fee-plans/${r.body.id}/discount-decision`, { approve: true })).status).toBe(200);
    expect((await prisma().feePlan.findUniqueOrThrow({ where: { id: r.body.id } })).discountStatus).toBe('APPROVED');
    expect((await (await as(DEMO.tvmAccounts)).post('/api/accounts/fee-plans', { enrolmentId: p.enrolmentId, totalFee: total, instalments: [{ dueDate: addDays(5), amount: total }] })).status).toBe(403);
  });

  it('rejecting a discount puts the amount back on the last instalment', async () => {
    const p = await unpaidKochiEnrolment();
    const total = p.totalPaise / 100;
    const net = total - 6000;
    const r = await (await as(KACC)).post('/api/accounts/fee-plans', { enrolmentId: p.enrolmentId, totalFee: total, discountValue: 6000, discountReason: 'Asked for a big discount', instalments: [{ dueDate: addDays(3), amount: net }] });
    if (r.body.discountStatus !== 'PENDING') return; // 6,000 may be under 10% for expensive courses
    expect((await (await as(HOA)).post(`/api/accounts/fee-plans/${r.body.id}/discount-decision`, { approve: false })).status).toBe(400); // needs a reason
    await (await as(HOA)).post(`/api/accounts/fee-plans/${r.body.id}/discount-decision`, { approve: false, note: 'Not eligible' });
    const plan = await prisma().feePlan.findUniqueOrThrow({ where: { id: r.body.id }, include: { instalments: true } });
    expect(plan.netPaise).toBe(plan.totalPaise);
    expect(plan.instalments.reduce((a, i) => a + i.amountPaise, 0)).toBe(plan.totalPaise);
  });
});

describe('payments and receipts', () => {
  it('records a payment against the oldest instalment, with the next receipt number, and tells the student', async () => {
    const p = await unpaidKochiEnrolment();
    const acc = await as(KACC);
    const inst = [...p.instalments].sort((a, b) => a.seq - b.seq);
    const amount = (inst[0].amountPaise + 50000) / 100; // first instalment + ₹500 of the next
    expect((await acc.post('/api/accounts/payments', { enrolmentId: p.enrolmentId, amount, paidOn: today(), method: 'UPI' })).status).toBe(400); // reference needed
    expect((await acc.post('/api/accounts/payments', { enrolmentId: p.enrolmentId, amount, paidOn: addDays(2), method: 'CASH' })).status).toBe(400); // future
    const before = await prisma().payment.findFirst({ where: { branch: { code: 'KOC01' } }, orderBy: { receiptNo: 'desc' } });
    const r = await acc.post('/api/accounts/payments', { enrolmentId: p.enrolmentId, amount, paidOn: today(), method: 'UPI', reference: 'UPI98765' });
    expect(r.status).toBe(201);
    const n = (s: string) => Number(s.split('/').pop());
    expect(n(r.body.receiptNo)).toBe(n(before!.receiptNo) + 1);
    expect(r.body.receiptNo).toMatch(/^RCPT\/KOC01\/\d{4}\/\d{5}$/);
    const after = await prisma().instalment.findMany({ where: { feePlanId: p.id }, orderBy: { seq: 'asc' } });
    expect(after[0].paidPaise).toBe(after[0].amountPaise);
    expect(after[1].paidPaise).toBe(50000);
    expect(await prisma().notification.count({ where: { userId: p.enrolment.student.userId, type: 'N13' } })).toBeGreaterThan(0);
    // Receipt PDF: the student and the branch can download it; another branch cannot.
    const pdf = await (await as(KACC)).get(`/api/accounts/payments/${r.body.id}/receipt.pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.body.subarray(0, 4).toString()).toBe('%PDF');
    expect((await (await as(DEMO.tvmAccounts)).get(`/api/accounts/payments/${r.body.id}/receipt.pdf`)).status).toBe(403);
    expect((await (await as(DEMO.arjun)).get(`/api/accounts/payments/${r.body.id}/receipt.pdf`)).status).toBe(403);
    expect(await prisma().auditLog.count({ where: { action: 'payment.record', entityId: r.body.id } })).toBe(1);
  });

  it('two people paying the last balance at the same time: only one succeeds, and no receipt number is skipped', async () => {
    const p = await unpaidKochiEnrolment();
    const balance = p.instalments.reduce((a, i) => a + i.amountPaise - i.paidPaise, 0) / 100;
    const [a, b] = await Promise.all([as(KACC), as(DEMO.kochiAdmin)]);
    const before = await prisma().payment.findFirst({ where: { branch: { code: 'KOC01' } }, orderBy: { receiptNo: 'desc' } });
    const res = await Promise.all([
      a.post('/api/accounts/payments', { enrolmentId: p.enrolmentId, amount: balance, paidOn: today(), method: 'CASH' }),
      b.post('/api/accounts/payments', { enrolmentId: p.enrolmentId, amount: balance, paidOn: today(), method: 'CASH' }),
    ]);
    expect(res.map((r) => r.status).sort()).toEqual([201, 400]);
    const ok = res.find((r) => r.status === 201)!;
    expect(Number(ok.body.receiptNo.split('/').pop())).toBe(Number(before!.receiptNo.split('/').pop()) + 1);
    expect((await a.post('/api/accounts/payments', { enrolmentId: p.enrolmentId, amount: 1, paidOn: today(), method: 'CASH' })).body.message).toMatch(/more than the balance/);
  });

  it('a void needs the Head of Accounts; approving it puts the dues back', async () => {
    const pay = await prisma().payment.findFirstOrThrow({ where: { status: 'VALID', kind: 'PAYMENT', branch: { code: 'KOC01' } }, include: { allocations: true } });
    const acc = await as(KACC);
    expect((await acc.post(`/api/accounts/payments/${pay.id}/void`, { reason: 'x' })).status).toBe(400);
    expect((await acc.post(`/api/accounts/payments/${pay.id}/void`, { reason: 'Cheque bounced' })).status).toBe(200);
    expect((await acc.post(`/api/accounts/payments/${pay.id}/void-decision`, { approve: true })).status).toBe(403);
    const before = await prisma().instalment.findUniqueOrThrow({ where: { id: pay.allocations[0].instalmentId } });
    expect((await (await as(HOA)).post(`/api/accounts/payments/${pay.id}/void-decision`, { approve: true })).status).toBe(200);
    const after = await prisma().instalment.findUniqueOrThrow({ where: { id: pay.allocations[0].instalmentId } });
    expect(after.paidPaise).toBe(before.paidPaise - pay.allocations[0].amountPaise);
    expect((await prisma().payment.findUniqueOrThrow({ where: { id: pay.id } })).status).toBe('VOIDED');
    expect(await prisma().auditLog.count({ where: { entityId: pay.id, action: { in: ['payment.void.request', 'payment.void.approve'] } } })).toBe(2);
  });

  it('refunds cannot exceed what was paid; adjustments reduce the balance', async () => {
    const e = await prisma().enrolment.findFirstOrThrow({ where: { student: { user: { email: DEMO.diya } }, batch: { name: 'Morning Batch A' } }, include: { feePlan: true } });
    const acc = await as(KACC);
    const over = await acc.post('/api/accounts/adjustments', { enrolmentId: e.id, kind: 'REFUND', amount: e.feePlan!.netPaise / 100 + 1, paidOn: today(), note: 'Overpaid' });
    expect(over.status).toBe(400);
    const ok = await acc.post('/api/accounts/adjustments', { enrolmentId: e.id, kind: 'REFUND', amount: 500, paidOn: today(), method: 'CASH', note: 'Paid twice for books' });
    expect(ok.status).toBe(201);
    expect(ok.body.kind).toBe('REFUND');
  });
});

describe('dues, reminders and reports', () => {
  it('lists overdue fees and sends reminders by email and SMS; automatic reminders go once a day', async () => {
    const d = await (await as(KACC)).get('/api/accounts/dues?status=overdue');
    expect(d.status).toBe(200);
    expect(d.body.rows.length).toBeGreaterThan(0);
    expect(d.body.rows.every((r: { state: string }) => r.state === 'OVERDUE')).toBe(true);
    const r = await (await as(KACC)).post('/api/accounts/dues/remind', { instalmentIds: [d.body.rows[0].id] });
    expect(r.body.sent).toBe(1);
    expect(await prisma().outboundMessage.count({ where: { template: 'N12', channel: 'SMS' } })).toBeGreaterThan(0);
    // An instalment due today gets the automatic "due today" reminder exactly once.
    const i = await prisma().instalment.findFirstOrThrow({ where: { paidPaise: 0, feePlan: { enrolment: { status: 'ACTIVE' } } } });
    await prisma().instalment.update({ where: { id: i.id }, data: { dueDate: new Date(today()) } });
    const mod = (await getApp()).get(AccountsModule);
    const count = () => prisma().notification.count({ where: { type: 'N12', title: { startsWith: 'Fee due today' } } });
    const before = await count();
    await mod.reminders(new Date(), true);
    const after = await count();
    expect(after).toBeGreaterThan(before);
    await mod.reminders(new Date(), true);
    expect(await count()).toBe(after);
  });

  it('sales and collections summary, day-close by accountant and Excel export; branches see only their own', async () => {
    const koc = await prisma().branch.findUniqueOrThrow({ where: { code: 'KOC01' } });
    const s = await (await as(HOA)).get('/api/accounts/summary');
    expect(s.status).toBe(200);
    expect(s.body.collectionsPaise).toBeGreaterThan(0);
    expect(s.body.byMethod.length).toBeGreaterThan(0);
    expect(s.body.byBranch.length).toBeGreaterThan(1);
    const own = await (await as(KACC)).get('/api/accounts/summary');
    expect(own.body.byBranch.map((b: { label: string }) => b.label)).toEqual(['KOC01']);
    expect((await (await as(DEMO.tvmAccounts)).get(`/api/accounts/summary?branchId=${koc.id}`)).status).toBe(403);
    expect((await (await as(DEMO.anita)).get('/api/accounts/summary')).status).toBe(403);
    const dc = await (await as(KACC)).get(`/api/accounts/day-close?date=${today()}`);
    expect(dc.status).toBe(200);
    expect(dc.body.date).toBe(today());
    const x = await (await as(KACC)).get('/api/accounts/export.xlsx?type=dues').buffer(true).parse((res, cb) => { const chunks: Buffer[] = []; res.on('data', (c: Buffer) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks))); });
    expect(x.status).toBe(200);
    expect((x.body as Buffer).subarray(0, 2).toString()).toBe('PK');
  });

  it('the student sees their fees and downloads payment and dues statements', async () => {
    const me = await (await as(DEMO.arjun)).get('/api/me/fees');
    expect(me.status).toBe(200);
    expect(me.body[0].plan).toBeTruthy();
    expect(me.body[0].payments.length).toBeGreaterThan(0);
    for (const kind of ['payments', 'dues']) {
      const r = await (await as(DEMO.arjun)).get(`/api/reports/students/me/${kind}.pdf`);
      expect(r.status, kind).toBe(200);
    }
    const diya = await prisma().student.findFirstOrThrow({ where: { user: { email: DEMO.diya } } });
    expect((await (await as(DEMO.arjun)).get(`/api/reports/students/${diya.id}/payments.pdf`)).status).toBe(403);
  });
});

describe('prices', () => {
  it('the Branch Admin sets a batch price unless head office locked the course; only the Head of Accounts locks', async () => {
    const b = await prisma().batch.findFirstOrThrow({ where: { name: 'Evening Batch – Hybrid' }, include: { course: true } });
    expect((await (await as(DEMO.kochiAdmin)).put(`/api/accounts/fees/batches/${b.id}`, { fee: 62000 })).status).toBe(200);
    expect((await (await as(DEMO.tvmAdmin)).put(`/api/accounts/fees/batches/${b.id}`, { fee: 1 })).status).toBe(403);
    expect((await (await as(DEMO.kochiAdmin)).put(`/api/accounts/fees/courses/${b.courseId}`, { feeLocked: true })).status).toBe(403);
    expect((await (await as(HOA)).put(`/api/accounts/fees/courses/${b.courseId}`, { feeLocked: true })).status).toBe(200);
    const locked = await (await as(DEMO.kochiAdmin)).put(`/api/accounts/fees/batches/${b.id}`, { fee: 60000 });
    expect(locked.status).toBe(400);
    await (await as(HOA)).put(`/api/accounts/fees/courses/${b.courseId}`, { feeLocked: false });
  });
});
