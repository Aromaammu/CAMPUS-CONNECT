import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  FeePlanInput, PAYMENT_METHODS, PaymentInput, SessionUser, allocate, can, discountNeedsApproval, discountPaise, formatDate, formatINR,
  instalmentState, istDateKey, rupeesInWords, rupeesToPaise,
} from '@cc/shared';
import type { Content } from 'pdfmake/interfaces';
import { AuditService } from '../../common/audit.service';
import { IdService } from '../../common/ids.service';
import { PdfService } from '../../common/pdf.service';
import { PrismaService, Tx } from '../../common/prisma.service';
import { SettingsService } from '../../common/settings.service';
import { NotifyService } from '../notifications/notify.service';

export const enrolmentInclude = {
  student: { select: { id: true, code: true, userId: true, user: { select: { name: true, email: true, mobile: true } } } },
  batch: { select: { id: true, name: true, branchId: true, feePaise: true, branch: { select: { code: true, name: true } }, course: { select: { id: true, name: true, defaultFeePaise: true } } } },
} satisfies Prisma.EnrolmentInclude;

/** PRD §11: fee plans, manual payments with gap-free receipts, voids, refunds, dues. Money is integer paise. */
@Injectable()
export class AccountsService {
  constructor(
    private prisma: PrismaService, private ids: IdService, private settings: SettingsService, private audit: AuditService,
    private notify: NotifyService, private pdf: PdfService,
  ) {}

  async enrolment(id: string) {
    const e = await this.prisma.enrolment.findUnique({ where: { id }, include: enrolmentInclude });
    if (!e) throw new NotFoundException('Enrolment not found');
    return e;
  }

  assert(user: SessionUser, perm: 'accounts.view' | 'accounts.record' | 'accounts.approve' | 'fees.manage', branchId: string) {
    if (!can(user, perm, branchId)) throw new ForbiddenException('You do not have access to this');
  }

  /** People who approve voids and big discounts (Head of Accounts). */
  async approvers() {
    const admins = await this.prisma.user.findMany({ where: { status: 'ACTIVE', OR: [{ kind: 'SUPER_ADMIN' }, { kind: 'ADMIN', adminModules: { some: { module: 'accounts' } } }] }, select: { id: true } });
    return admins.map((a) => a.id);
  }

  /** The student's fee position for one enrolment: plan, instalments with state, payments. */
  async ledger(enrolmentId: string) {
    const e = await this.enrolment(enrolmentId);
    const plan = await this.prisma.feePlan.findUnique({ where: { enrolmentId }, include: { instalments: { orderBy: { seq: 'asc' } } } });
    const payments = await this.prisma.payment.findMany({ where: { enrolmentId }, orderBy: [{ paidOn: 'desc' }, { createdAt: 'desc' }], include: { receivedBy: { select: { user: { select: { name: true } } } } } });
    const today = istDateKey(new Date());
    const soon = await this.settings.get('accounts.reminderDaysBefore');
    const instalments = (plan?.instalments ?? []).map((i) => ({ ...i, dueDate: i.dueDate.toISOString().slice(0, 10), state: instalmentState({ dueDate: i.dueDate.toISOString().slice(0, 10), amountPaise: i.amountPaise, paidPaise: i.paidPaise }, today, soon) }));
    const paid = instalments.reduce((a, i) => a + i.paidPaise, 0);
    const net = plan?.netPaise ?? 0;
    const overdue = instalments.filter((i) => i.state === 'OVERDUE').reduce((a, i) => a + (i.amountPaise - i.paidPaise), 0);
    return {
      enrolment: { id: e.id, status: e.status, enrolledOn: e.enrolledOn, student: e.student, batch: e.batch },
      listPricePaise: e.batch.feePaise ?? e.batch.course.defaultFeePaise,
      plan: plan ? { id: plan.id, totalPaise: plan.totalPaise, discountPaise: plan.discountPaise, discountReason: plan.discountReason, discountStatus: plan.discountStatus, netPaise: plan.netPaise, createdAt: plan.createdAt } : null,
      instalments, payments: payments.map((p) => ({ ...p, paidOn: p.paidOn.toISOString().slice(0, 10), receivedByName: p.receivedBy?.user.name ?? null })),
      totals: { netPaise: net, paidPaise: paid, balancePaise: Math.max(0, net - paid), overduePaise: overdue },
    };
  }

  /** Create or replace a fee plan (only while nothing has been paid against it). */
  async savePlan(user: SessionUser, body: FeePlanInput, ip?: string) {
    const e = await this.enrolment(body.enrolmentId);
    this.assert(user, 'accounts.record', e.batch.branchId);
    const total = rupeesToPaise(body.totalFee);
    const listPrice = e.batch.feePaise ?? e.batch.course.defaultFeePaise;
    if (total !== listPrice && !can(user, 'fees.manage', e.batch.branchId)) throw new ForbiddenException('Use the batch price, or ask someone who can change fees');
    const discount = discountPaise(total, body.discountType, body.discountValue);
    const net = total - discount;
    const sum = body.instalments.reduce((a, i) => a + rupeesToPaise(i.amount), 0);
    if (sum !== net) throw new BadRequestException({ message: `The instalments add up to ${formatINR(sum)} but the fee after discount is ${formatINR(net)}`, fieldErrors: { instalments: 'Instalments must add up to the fee after discount' } });
    const dates = body.instalments.map((i) => i.dueDate);
    if ([...dates].sort().join() !== dates.join()) throw new BadRequestException('Put the instalments in date order');
    const limit = await this.settings.get('accounts.discountApprovalPercent');
    const needsApproval = discountNeedsApproval(total, discount, limit) && !can(user, 'accounts.approve', e.batch.branchId);
    const plan = await this.prisma.$transaction(async (tx) => {
      const prev = await tx.feePlan.findUnique({ where: { enrolmentId: e.id }, include: { instalments: true } });
      if (prev && prev.instalments.some((i) => i.paidPaise > 0)) throw new BadRequestException('Payments are already recorded on this plan. Record an adjustment instead of changing it.');
      if (prev) await tx.feePlan.delete({ where: { id: prev.id } });
      const p = await tx.feePlan.create({
        data: {
          enrolmentId: e.id, totalPaise: total, discountPaise: discount, discountReason: body.discountReason ?? null, netPaise: net, createdById: user.id,
          discountStatus: discount === 0 ? 'NONE' : needsApproval ? 'PENDING' : 'APPROVED',
          instalments: { create: body.instalments.map((i, n) => ({ seq: n + 1, dueDate: new Date(i.dueDate), amountPaise: rupeesToPaise(i.amount) })) },
        },
      });
      await this.audit.record({
        actorId: user.id, action: prev ? 'fees.plan.replace' : 'fees.plan.create', entity: 'FeePlan', entityId: p.id, branchId: e.batch.branchId,
        summary: `Fee plan for ${e.student.user.name} (${e.batch.name}): ${formatINR(total)}${discount ? `, discount ${formatINR(discount)} (${body.discountReason})` : ''}, ${body.instalments.length} instalment(s)`, ip,
      }, tx);
      return p;
    });
    if (plan.discountStatus === 'PENDING') {
      await this.notify.sendMany(await this.approvers(), { type: 'N14', title: `Discount needs approval: ${e.student.user.name}`, body: `${formatINR(discount)} off ${formatINR(total)} (${body.discountReason}) in ${e.batch.name}`, link: '/accounts/approvals', email: true });
    }
    return plan;
  }

  /** Discount above the limit: approve, or reject (the discount is removed and added back to the last instalment). */
  async decideDiscount(user: SessionUser, planId: string, approve: boolean, note: string | undefined, ip?: string) {
    const plan = await this.prisma.feePlan.findUnique({ where: { id: planId }, include: { instalments: { orderBy: { seq: 'asc' } }, enrolment: { include: enrolmentInclude } } });
    if (!plan) throw new NotFoundException('Fee plan not found');
    this.assert(user, 'accounts.approve', plan.enrolment.batch.branchId);
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.feePlan.updateMany({ where: { id: planId, discountStatus: 'PENDING' }, data: approve ? { discountStatus: 'APPROVED' } : { discountStatus: 'REJECTED', netPaise: plan.totalPaise, discountPaise: 0 } });
      if (!count) throw new BadRequestException('This discount was already decided');
      if (!approve) {
        const last = plan.instalments[plan.instalments.length - 1];
        await tx.instalment.update({ where: { id: last.id }, data: { amountPaise: last.amountPaise + plan.discountPaise } });
      }
      await this.audit.record({
        actorId: user.id, action: approve ? 'fees.discount.approve' : 'fees.discount.reject', entity: 'FeePlan', entityId: planId, branchId: plan.enrolment.batch.branchId,
        summary: `${approve ? 'Approved' : 'Rejected'} a ${formatINR(plan.discountPaise)} discount for ${plan.enrolment.student.user.name}${note ? `: ${note}` : ''}`, ip,
      }, tx);
    });
    await this.notify.send(plan.createdById, { type: 'N14', title: `Discount ${approve ? 'approved' : 'rejected'}: ${plan.enrolment.student.user.name}`, body: note ?? '', link: `/students/${plan.enrolment.student.id}` });
  }

  /** PRD §11.2: record a payment; it fills the oldest unpaid instalments; the receipt number comes from the same transaction. */
  async recordPayment(user: SessionUser, body: PaymentInput, ip?: string) {
    const e = await this.enrolment(body.enrolmentId);
    this.assert(user, 'accounts.record', e.batch.branchId);
    if (body.paidOn > istDateKey(new Date())) throw new BadRequestException({ message: 'The payment date cannot be in the future', fieldErrors: { paidOn: 'Not in the future' } });
    const amount = rupeesToPaise(body.amount);
    if (body.receivedById) {
      const emp = await this.prisma.employee.findUnique({ where: { id: body.receivedById }, include: { extraBranches: true } });
      if (!emp || (emp.branchId !== e.batch.branchId && !emp.extraBranches.some((b) => b.branchId === e.batch.branchId))) throw new BadRequestException('The person who received it must work at this branch');
    }
    const payment = await this.prisma.$transaction(async (tx) => {
      const plan = await tx.feePlan.findUnique({ where: { enrolmentId: e.id } });
      if (!plan) throw new BadRequestException('Set up a fee plan first');
      // Lock the instalments so two people recording at once cannot both fill the same one.
      const rows = await tx.$queryRaw<{ id: string; seq: number; amountPaise: number; paidPaise: number }[]>`
        SELECT id, seq, "amountPaise", "paidPaise" FROM "Instalment" WHERE "feePlanId" = ${plan.id} ORDER BY seq FOR UPDATE`;
      const { allocations, unallocated } = allocate(rows, amount);
      if (unallocated > 0) throw new BadRequestException({ message: `That is ${formatINR(unallocated)} more than the balance due`, fieldErrors: { amount: 'More than the balance due' } });
      const receiptNo = await this.ids.receiptNo(tx, e.batch.branchId, e.batch.branch.code);
      const p = await tx.payment.create({
        data: {
          branchId: e.batch.branchId, studentId: e.studentId, enrolmentId: e.id, kind: 'PAYMENT', amountPaise: amount, paidOn: new Date(body.paidOn),
          method: body.method, reference: body.reference ?? null, note: body.note ?? null, receiptNo, receivedById: body.receivedById ?? user.employeeId ?? null, recordedByUserId: user.id,
          allocations: { create: allocations },
        },
      });
      for (const a of allocations) await tx.instalment.update({ where: { id: a.instalmentId }, data: { paidPaise: { increment: a.amountPaise } } });
      await this.audit.record({
        actorId: user.id, action: 'payment.record', entity: 'Payment', entityId: p.id, branchId: e.batch.branchId,
        summary: `${receiptNo}: ${formatINR(amount)} by ${PAYMENT_METHODS[body.method as keyof typeof PAYMENT_METHODS]} from ${e.student.user.name} (${e.batch.name})`, ip,
      }, tx);
      return p;
    });
    await this.notify.send(e.student.userId, {
      type: 'N13', title: `Payment received: ${formatINR(amount)}`, body: `Receipt ${payment.receiptNo}. Thank you! Download it from Payments & dues.`, link: '/learn/payments', email: true, sms: true, essential: true,
    });
    return payment;
  }

  /** Refund (money back) or adjustment (written off from the dues). Never touches existing payments. */
  async recordOther(user: SessionUser, body: { enrolmentId: string; kind: 'REFUND' | 'ADJUSTMENT'; amount: number; paidOn: string; method: string; reference?: string; note: string }, ip?: string) {
    const e = await this.enrolment(body.enrolmentId);
    this.assert(user, 'accounts.record', e.batch.branchId);
    const amount = rupeesToPaise(body.amount);
    return this.prisma.$transaction(async (tx) => {
      const plan = await tx.feePlan.findUnique({ where: { enrolmentId: e.id } });
      if (!plan) throw new BadRequestException('Set up a fee plan first');
      let allocations: { instalmentId: string; amountPaise: number }[] = [];
      if (body.kind === 'ADJUSTMENT') {
        const rows = await tx.$queryRaw<{ id: string; seq: number; amountPaise: number; paidPaise: number }[]>`SELECT id, seq, "amountPaise", "paidPaise" FROM "Instalment" WHERE "feePlanId" = ${plan.id} ORDER BY seq FOR UPDATE`;
        const r = allocate(rows, amount);
        if (r.unallocated > 0) throw new BadRequestException('An adjustment cannot be more than the balance due');
        allocations = r.allocations;
      } else {
        const paid = await tx.payment.aggregate({ where: { enrolmentId: e.id, kind: 'PAYMENT', status: { not: 'VOIDED' } }, _sum: { amountPaise: true } });
        const refunded = await tx.payment.aggregate({ where: { enrolmentId: e.id, kind: 'REFUND', status: { not: 'VOIDED' } }, _sum: { amountPaise: true } });
        if (amount > (paid._sum.amountPaise ?? 0) - (refunded._sum.amountPaise ?? 0)) throw new BadRequestException('A refund cannot be more than the student has paid');
      }
      const receiptNo = await this.ids.receiptNo(tx, e.batch.branchId, e.batch.branch.code);
      const p = await tx.payment.create({
        data: {
          branchId: e.batch.branchId, studentId: e.studentId, enrolmentId: e.id, kind: body.kind, amountPaise: amount, paidOn: new Date(body.paidOn),
          method: body.method, reference: body.reference ?? null, note: body.note, receiptNo, receivedById: user.employeeId ?? null, recordedByUserId: user.id,
          allocations: { create: allocations },
        },
      });
      for (const a of allocations) await tx.instalment.update({ where: { id: a.instalmentId }, data: { paidPaise: { increment: a.amountPaise } } });
      await this.audit.record({ actorId: user.id, action: `payment.${body.kind.toLowerCase()}`, entity: 'Payment', entityId: p.id, branchId: e.batch.branchId, summary: `${receiptNo}: ${body.kind === 'REFUND' ? 'Refund' : 'Adjustment'} of ${formatINR(amount)} for ${e.student.user.name}: ${body.note}`, ip }, tx);
      return p;
    });
  }

  async requestVoid(user: SessionUser, paymentId: string, reason: string, ip?: string) {
    const p = await this.prisma.payment.findUnique({ where: { id: paymentId }, include: { student: { select: { user: { select: { name: true } } } } } });
    if (!p) throw new NotFoundException('Payment not found');
    this.assert(user, 'accounts.record', p.branchId);
    const { count } = await this.prisma.payment.updateMany({ where: { id: paymentId, status: 'VALID' }, data: { status: 'VOID_PENDING', voidReason: reason, voidRequestedBy: user.id } });
    if (!count) throw new BadRequestException('This payment is not valid any more');
    await this.audit.record({ actorId: user.id, action: 'payment.void.request', entity: 'Payment', entityId: paymentId, branchId: p.branchId, summary: `Asked to void ${p.receiptNo} (${formatINR(p.amountPaise)}): ${reason}`, ip });
    await this.notify.sendMany(await this.approvers(), { type: 'N14', title: `Void requested: ${p.receiptNo}`, body: `${formatINR(p.amountPaise)} from ${p.student.user.name}. ${reason}`, link: '/accounts/approvals', email: true });
  }

  /** Head of Accounts decides a void. Approving reverses what the payment had paid off. */
  async decideVoid(user: SessionUser, paymentId: string, approve: boolean, note: string | undefined, ip?: string) {
    const p = await this.prisma.payment.findUnique({ where: { id: paymentId }, include: { allocations: true } });
    if (!p) throw new NotFoundException('Payment not found');
    this.assert(user, 'accounts.approve', p.branchId);
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.payment.updateMany({
        where: { id: paymentId, status: 'VOID_PENDING' },
        data: approve ? { status: 'VOIDED', voidDecidedBy: user.id, voidDecidedAt: new Date() } : { status: 'VALID', voidDecidedBy: user.id, voidDecidedAt: new Date() },
      });
      if (!count) throw new BadRequestException('This void was already decided');
      if (approve) for (const a of p.allocations) await tx.instalment.update({ where: { id: a.instalmentId }, data: { paidPaise: { decrement: a.amountPaise } } });
      await this.audit.record({ actorId: user.id, action: approve ? 'payment.void.approve' : 'payment.void.reject', entity: 'Payment', entityId: paymentId, branchId: p.branchId, summary: `${approve ? 'Voided' : 'Kept'} ${p.receiptNo} (${formatINR(p.amountPaise)})${note ? `: ${note}` : ''}`, ip }, tx);
    });
    if (p.voidRequestedBy) await this.notify.send(p.voidRequestedBy, { type: 'N14', title: `Void ${approve ? 'approved' : 'rejected'}: ${p.receiptNo}`, body: note ?? '', link: '/accounts/receipts' });
  }

  /** Fee reminder by in-app, email and SMS (PRD §11.3, N12). */
  async sendReminder(i: { id: string; dueDate: Date; amountPaise: number; paidPaise: number; feePlan: { enrolment: { student: { userId: string }; batch: { name: string } } } }, kind: 'manual' | 'soon' | 'today' | 'overdue') {
    const due = formatINR(i.amountPaise - i.paidPaise);
    const when = formatDate(i.dueDate);
    const title = kind === 'overdue' || (kind === 'manual' && i.dueDate < new Date(istDateKey(new Date()))) ? `Fee overdue: ${due} was due on ${when}` : kind === 'today' ? `Fee due today: ${due}` : `Fee due on ${when}: ${due}`;
    await this.notify.send(i.feePlan.enrolment.student.userId, { type: 'N12', title, body: `${i.feePlan.enrolment.batch.name}. Please pay at your branch.`, link: '/learn/payments', email: true, sms: true, essential: true });
    await this.prisma.instalment.update({ where: { id: i.id }, data: { lastReminderAt: new Date() } });
  }

  /** Receipt PDF (PRD §11.2). */
  async receiptPdf(paymentId: string) {
    const p = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { branch: true, student: { include: { user: true } }, enrolment: { include: { batch: { include: { course: true } } } }, receivedBy: { include: { user: true } }, allocations: { include: { instalment: true } } },
    });
    if (!p) throw new NotFoundException('Receipt not found');
    const title = p.kind === 'REFUND' ? 'Refund voucher' : p.kind === 'ADJUSTMENT' ? 'Adjustment note' : 'Payment receipt';
    const body: Content[] = [];
    if (p.status !== 'VALID') body.push({ text: p.status === 'VOIDED' ? 'VOID: this receipt was cancelled' : 'Void requested: awaiting approval', color: '#b42318', bold: true, fontSize: 13, margin: [0, 0, 0, 8] });
    body.push({ columns: [{ text: 'Amount', style: 'muted' }, { text: formatINR(p.amountPaise, { decimals: true }), fontSize: 20, bold: true, alignment: 'right', color: '#0E3B47' }] });
    body.push({ text: rupeesInWords(p.amountPaise), italics: true, margin: [0, 2, 0, 12], alignment: 'right' });
    if (p.allocations.length) body.push(this.pdf.table(['Instalment', 'Due date', 'Paid now'], p.allocations.sort((a, b) => a.instalment.seq - b.instalment.seq).map((a) => [`#${a.instalment.seq}`, formatDate(a.instalment.dueDate), formatINR(a.amountPaise, { decimals: true })])));
    body.push({ text: 'This is a computer-generated receipt and needs no signature.', style: 'muted', margin: [0, 18, 0, 0], fontSize: 8.5 });
    return {
      name: `${p.receiptNo.replace(/\//g, '-')}.pdf`,
      buffer: await this.pdf.render({
        title, subtitle: p.receiptNo,
        meta: [
          ['Date', formatDate(p.paidOn)], ['Student', `${p.student.user.name} (${p.student.code})`], ['Course', `${p.enrolment.batch.course.name} · ${p.enrolment.batch.name}`],
          ['Branch', p.branch.name], ['Paid by', `${PAYMENT_METHODS[p.method as keyof typeof PAYMENT_METHODS] ?? p.method}${p.reference ? ` · ref ${p.reference}` : ''}`],
          ...(p.receivedBy ? [['Received by', p.receivedBy.user.name] as [string, string]] : []), ...(p.note ? [['Note', p.note] as [string, string]] : []),
        ],
        body,
      }),
    };
  }

  /** Who can see a payment: branch accounts staff, or the student it belongs to. */
  async assertSeePayment(user: SessionUser, paymentId: string) {
    const p = await this.prisma.payment.findUnique({ where: { id: paymentId }, select: { branchId: true, studentId: true } });
    if (!p) throw new NotFoundException('Receipt not found');
    if (user.studentId === p.studentId) return;
    this.assert(user, 'accounts.view', p.branchId);
  }

  async enrolmentIdsForBranches(branchIds: string[] | null, tx: Tx = this.prisma) {
    return tx.enrolment.findMany({ where: branchIds ? { batch: { branchId: { in: branchIds } } } : {}, select: { id: true } });
  }
}
