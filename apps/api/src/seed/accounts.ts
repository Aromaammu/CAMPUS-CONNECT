import { PrismaClient } from '@prisma/client';
import { allocate, splitInstalments } from '@cc/shared';

const istKey = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
const addDays = (k: string, n: number) => new Date(new Date(`${k}T00:00:00Z`).getTime() + n * 86400_000).toISOString().slice(0, 10);

/**
 * Accounts demo data (Phase 7): a fee plan for every enrolment, payments with real receipt numbers,
 * some overdue dues, one discount and one void waiting for the Head of Accounts.
 */
export async function seedAccounts(prisma: PrismaClient, now = new Date()) {
  const today = istKey(now);
  const year = Number(today.slice(0, 4));
  const accountant = async (branchId: string) => (await prisma.employee.findFirst({ where: { branchId, designation: { name: 'Accountant' } }, include: { user: true } }));
  const director = await prisma.user.findUniqueOrThrow({ where: { email: 'director@demo.cc' } });
  const enrolments = await prisma.enrolment.findMany({
    where: { status: { in: ['ACTIVE', 'COMPLETED'] }, batch: { status: { not: 'CANCELLED' } } },
    include: { student: { include: { user: true } }, batch: { include: { branch: true, course: true } } },
    orderBy: [{ batchId: 'asc' }, { studentId: 'asc' }],
  });
  const next = async (branchId: string, code: string) => {
    const rows = await prisma.$queryRaw<{ last: number }[]>`
      INSERT INTO "IdCounter" ("branchId", "kind", "year", "last") VALUES (${branchId}, 'RCPT', ${year}, 1)
      ON CONFLICT ("branchId", "kind", "year") DO UPDATE SET "last" = "IdCounter"."last" + 1 RETURNING "last"`;
    return `RCPT/${code}/${year}/${String(Number(rows[0].last)).padStart(5, '0')}`;
  };
  let n = 0;
  let pendingDiscountDone = false;
  let voidDone = false;
  for (const e of enrolments) {
    n++;
    const total = e.batch.feePaise ?? e.batch.course.defaultFeePaise;
    const email = e.student.user.email;
    const start = istKey(e.enrolledOn);
    // Pattern: Diya pays in one go; most pay in 3 monthly instalments; every 5th gets 5% off; one 15% discount waits for approval.
    const pending = !pendingDiscountDone && e.batch.name === 'Morning Batch A' && email !== 'arjun.student@demo.cc' && email !== 'diya.student@demo.cc' && n % 4 === 0;
    const discount = pending ? Math.round(total * 0.15) : n % 5 === 0 ? Math.round(total * 0.05) : 0;
    const net = total - discount;
    const oneTime = email === 'diya.student@demo.cc';
    const parts = oneTime ? [{ dueDate: start, amountPaise: net }] : splitInstalments(net, 3, start);
    const plan = await prisma.feePlan.create({
      data: {
        enrolmentId: e.id, totalPaise: total, discountPaise: discount, discountReason: discount ? (pending ? 'Sibling already studying with us' : 'Early-bird offer') : null,
        discountStatus: discount ? (pending ? 'PENDING' : 'APPROVED') : 'NONE', netPaise: net, createdById: director.id,
        instalments: { create: parts.map((p, i) => ({ seq: i + 1, dueDate: new Date(p.dueDate), amountPaise: p.amountPaise })) },
      },
      include: { instalments: { orderBy: { seq: 'asc' } } },
    });
    if (pending) pendingDiscountDone = true;
    // Payments: past-due instalments are paid, except every 6th student who is overdue (dues demo).
    const overdue = n % 6 === 0 && email !== 'arjun.student@demo.cc' && email !== 'diya.student@demo.cc';
    const acct = await accountant(e.batch.branchId);
    for (const inst of plan.instalments) {
      const due = inst.dueDate.toISOString().slice(0, 10);
      if (due > today || overdue) continue;
      const paidOn = due < addDays(today, -1) ? due : addDays(today, -1);
      const method = n % 3 === 0 ? 'UPI' : n % 3 === 1 ? 'CASH' : 'BANK';
      const receiptNo = await next(e.batch.branchId, e.batch.branch.code);
      const { allocations } = allocate(plan.instalments.map((x) => ({ ...x, paidPaise: x.id === inst.id ? 0 : x.paidPaise })).filter((x) => x.id === inst.id), inst.amountPaise);
      const p = await prisma.payment.create({
        data: {
          branchId: e.batch.branchId, studentId: e.studentId, enrolmentId: e.id, amountPaise: inst.amountPaise, paidOn: new Date(paidOn), method,
          reference: method === 'CASH' ? null : `${method}${100000 + n * 7}`, receiptNo, receivedById: acct?.id ?? null, recordedByUserId: acct?.userId ?? director.id,
          allocations: { create: allocations },
        },
      });
      await prisma.instalment.update({ where: { id: inst.id }, data: { paidPaise: inst.amountPaise } });
      // One payment entered twice by mistake: a void waits for approval.
      if (!voidDone && e.batch.branch.code === 'KOC01' && n % 7 === 0) {
        await prisma.payment.update({ where: { id: p.id }, data: { status: 'VOID_PENDING', voidReason: 'Entered twice by mistake', voidRequestedBy: acct?.userId ?? director.id } });
        voidDone = true;
      }
    }
  }
}
