import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, NotFoundException, Param, Post, Put, Query, Req, Res } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  FeePlanInput, INSTALMENT_STATE, PAYMENT_METHODS, PaymentInput, SessionUser, batchFeeSchema, can, courseFeeSchema, decisionSchema, feePlanSchema, formatDate, formatINR,
  instalmentState, istDateKey, paymentSchema, refundSchema, remindSchema, rupeesToPaise, voidRequestSchema,
} from '@cc/shared';
import ExcelJS from 'exceljs';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AuditService } from '../../common/audit.service';
import { CurrentUser, RequirePerm, branchesFor } from '../../common/auth';
import { Zod, clientIp } from '../../common/http';
import { PrismaService } from '../../common/prisma.service';
import { SettingsService } from '../../common/settings.service';
import { NotifyService } from '../notifications/notify.service';
import { AccountsService } from './accounts.service';

const ip = (req: Request) => clientIp(req) ?? undefined;

/** Branch filter for accounts lists: the branches where the person holds `perm`, optionally narrowed to one. */
function scopeOf(user: SessionUser, perm: 'accounts.view' | 'accounts.approve', branchId?: string) {
  const scope = branchesFor(user, perm);
  if (scope !== null && !scope.length) throw new ForbiddenException('You do not have access to this');
  if (branchId && scope !== null && !scope.includes(branchId)) throw new ForbiddenException('You do not have access to this branch');
  return branchId ? [branchId] : scope;
}

@Controller('accounts')
export class AccountsController {
  constructor(private acc: AccountsService, private prisma: PrismaService, private settings: SettingsService, private notify: NotifyService, private audit: AuditService) {}

  // ── Ledger, plans, payments ──

  /** AC3: every enrolment of a student with fee plan, instalments and payments. */
  @Get('students/:studentId')
  async student(@CurrentUser() user: SessionUser, @Param('studentId') studentId: string) {
    const enrolments = await this.prisma.enrolment.findMany({ where: { studentId, status: { not: 'MOVED' } }, include: { batch: { select: { branchId: true } } }, orderBy: { enrolledOn: 'desc' } });
    const mine = enrolments.filter((e) => can(user, 'accounts.view', e.batch.branchId));
    if (!mine.length) throw new ForbiddenException('You do not have access to this student\'s fees');
    const out = [];
    for (const e of mine) out.push({ ...(await this.acc.ledger(e.id)), canRecord: can(user, 'accounts.record', e.batch.branchId), canSetPrice: can(user, 'fees.manage', e.batch.branchId) });
    return out;
  }

  @Post('fee-plans')
  savePlan(@CurrentUser() user: SessionUser, @Body(new Zod(feePlanSchema)) body: FeePlanInput, @Req() req: Request) {
    return this.acc.savePlan(user, body, ip(req));
  }

  @Post('payments')
  record(@CurrentUser() user: SessionUser, @Body(new Zod(paymentSchema)) body: PaymentInput, @Req() req: Request) {
    return this.acc.recordPayment(user, body, ip(req));
  }

  @Post('adjustments')
  other(@CurrentUser() user: SessionUser, @Body(new Zod(refundSchema)) body: z.infer<typeof refundSchema>, @Req() req: Request) {
    return this.acc.recordOther(user, body, ip(req));
  }

  @Get('payments/:id/receipt.pdf')
  async receipt(@CurrentUser() user: SessionUser, @Param('id') id: string, @Res() res: Response) {
    await this.acc.assertSeePayment(user, id);
    const r = await this.acc.receiptPdf(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${r.name}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.end(r.buffer);
  }

  @Post('payments/:id/void')
  @HttpCode(200)
  async requestVoid(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body(new Zod(voidRequestSchema)) body: { reason: string }, @Req() req: Request) {
    await this.acc.requestVoid(user, id, body.reason, ip(req));
    return { ok: true };
  }

  @Post('payments/:id/void-decision')
  @HttpCode(200)
  async decideVoid(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body(new Zod(decisionSchema)) body: { approve: boolean; note?: string }, @Req() req: Request) {
    await this.acc.decideVoid(user, id, body.approve, body.note, ip(req));
    return { ok: true };
  }

  @Post('fee-plans/:id/discount-decision')
  @HttpCode(200)
  async decideDiscount(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body(new Zod(decisionSchema)) body: { approve: boolean; note?: string }, @Req() req: Request) {
    await this.acc.decideDiscount(user, id, body.approve, body.note, ip(req));
    return { ok: true };
  }

  /** AC8: voids and discounts waiting for the Head of Accounts. */
  @Get('approvals')
  @RequirePerm('accounts.approve')
  async approvals(@CurrentUser() user: SessionUser) {
    const scope = scopeOf(user, 'accounts.approve');
    const branch = scope ? { in: scope } : undefined;
    const [voids, discounts] = await Promise.all([
      this.prisma.payment.findMany({ where: { status: 'VOID_PENDING', ...(branch ? { branchId: branch } : {}) }, include: { student: { select: { code: true, user: { select: { name: true } } } }, branch: { select: { code: true } } }, orderBy: { createdAt: 'asc' } }),
      this.prisma.feePlan.findMany({ where: { discountStatus: 'PENDING', ...(branch ? { enrolment: { batch: { branchId: branch } } } : {}) }, include: { enrolment: { include: { student: { select: { code: true, user: { select: { name: true } } } }, batch: { select: { name: true, branch: { select: { code: true } } } } } } }, orderBy: { createdAt: 'asc' } }),
    ]);
    const requesters = await this.prisma.user.findMany({ where: { id: { in: [...voids.map((v) => v.voidRequestedBy ?? ''), ...discounts.map((d) => d.createdById)] } }, select: { id: true, name: true } });
    const who = (id: string | null) => requesters.find((r) => r.id === id)?.name ?? '';
    return {
      voids: voids.map((v) => ({ id: v.id, receiptNo: v.receiptNo, amountPaise: v.amountPaise, paidOn: v.paidOn, method: v.method, reason: v.voidReason, requestedBy: who(v.voidRequestedBy), student: v.student, branch: v.branch.code })),
      discounts: discounts.map((d) => ({ id: d.id, totalPaise: d.totalPaise, discountPaise: d.discountPaise, reason: d.discountReason, requestedBy: who(d.createdById), student: d.enrolment.student, batch: d.enrolment.batch.name, branch: d.enrolment.batch.branch.code })),
    };
  }

  /** AC5: receipts (payments, refunds, adjustments) with search. */
  @Get('receipts')
  async receipts(@CurrentUser() user: SessionUser, @Query() q: Record<string, string>) {
    const scope = scopeOf(user, 'accounts.view', q.branchId || undefined);
    const where: Prisma.PaymentWhereInput = {
      ...(scope ? { branchId: { in: scope } } : {}),
      ...(q.from ? { paidOn: { gte: new Date(q.from), ...(q.to ? { lte: new Date(q.to) } : {}) } } : q.to ? { paidOn: { lte: new Date(q.to) } } : {}),
      ...(q.method ? { method: q.method } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.q ? { OR: [{ receiptNo: { contains: q.q, mode: 'insensitive' } }, { student: { user: { name: { contains: q.q, mode: 'insensitive' } } } }, { student: { code: { contains: q.q, mode: 'insensitive' } } }, { reference: { contains: q.q, mode: 'insensitive' } }] } : {}),
    };
    const page = Math.max(1, Number(q.page) || 1);
    const [total, rows] = await Promise.all([
      this.prisma.payment.count({ where }),
      this.prisma.payment.findMany({ where, include: { student: { select: { id: true, code: true, user: { select: { name: true } } } }, branch: { select: { code: true } }, enrolment: { select: { batch: { select: { name: true } } } } }, orderBy: [{ paidOn: 'desc' }, { createdAt: 'desc' }], take: 25, skip: (page - 1) * 25 }),
    ]);
    return { total, page, pageSize: 25, rows: rows.map((p) => ({ ...p, paidOn: p.paidOn.toISOString().slice(0, 10), canRequestVoid: p.status === 'VALID' && p.kind === 'PAYMENT' && can(user, 'accounts.record', p.branchId) })) };
  }

  // ── Dues and reminders ──

  /** AC6: unpaid instalments by state. */
  @Get('dues')
  async dues(@CurrentUser() user: SessionUser, @Query() q: Record<string, string>) {
    return this.duesRows(user, q);
  }

  private async duesRows(user: SessionUser, q: Record<string, string>) {
    const scope = scopeOf(user, 'accounts.view', q.branchId || undefined);
    const today = istDateKey(new Date());
    const soon = await this.settings.get('accounts.reminderDaysBefore');
    const rows = await this.prisma.instalment.findMany({
      where: {
        feePlan: { enrolment: { status: { in: ['ACTIVE', 'ON_HOLD', 'COMPLETED'] }, ...(scope ? { batch: { branchId: { in: scope } } } : {}), ...(q.q ? { student: { OR: [{ code: { contains: q.q, mode: 'insensitive' } }, { user: { name: { contains: q.q, mode: 'insensitive' } } }] } } : {}) } },
        ...(q.status === 'upcoming' ? {} : { dueDate: { lte: new Date(Date.now() + (soon + 1) * 86400_000) } }),
      },
      include: { feePlan: { include: { enrolment: { include: { student: { select: { id: true, code: true, user: { select: { name: true, mobile: true } } } }, batch: { select: { name: true, branch: { select: { code: true } } } } } } } } },
      orderBy: { dueDate: 'asc' }, take: 1000,
    });
    const out = rows
      .filter((i) => i.paidPaise < i.amountPaise)
      .map((i) => {
        const dueDate = i.dueDate.toISOString().slice(0, 10);
        const state = instalmentState({ dueDate, amountPaise: i.amountPaise, paidPaise: i.paidPaise }, today, soon);
        const e = i.feePlan.enrolment;
        return { id: i.id, seq: i.seq, dueDate, amountPaise: i.amountPaise, paidPaise: i.paidPaise, duePaise: i.amountPaise - i.paidPaise, state, lastReminderAt: i.lastReminderAt, enrolmentId: e.id, student: e.student, batch: e.batch.name, branch: e.batch.branch.code };
      })
      .filter((r) => !q.status || q.status === 'all' || (q.status === 'overdue' && r.state === 'OVERDUE') || (q.status === 'today' && r.state === 'DUE_TODAY') || (q.status === 'soon' && r.state === 'DUE_SOON') || (q.status === 'upcoming' && r.state === 'UPCOMING'));
    return { today, rows: out, totalPaise: out.reduce((a, r) => a + r.duePaise, 0) };
  }

  @Post('dues/remind')
  @HttpCode(200)
  async remind(@CurrentUser() user: SessionUser, @Body(new Zod(remindSchema)) body: { instalmentIds: string[] }) {
    const rows = await this.prisma.instalment.findMany({ where: { id: { in: body.instalmentIds } }, include: { feePlan: { include: { enrolment: { include: { student: { select: { userId: true } }, batch: { select: { name: true, branchId: true } } } } } } } });
    let sent = 0;
    for (const i of rows) {
      if (!can(user, 'accounts.record', i.feePlan.enrolment.batch.branchId) || i.paidPaise >= i.amountPaise) continue;
      await this.acc.sendReminder(i, 'manual');
      sent++;
    }
    return { sent };
  }

  // ── Reports ──

  /** AC1 / AC7: sales, collections, pending, overdue, discounts and refunds, with breakdowns. */
  @Get('summary')
  async summary(@CurrentUser() user: SessionUser, @Query() q: Record<string, string>) {
    const scope = scopeOf(user, 'accounts.view', q.branchId || undefined);
    const to = q.to ? new Date(q.to) : new Date(istDateKey(new Date()));
    const from = q.from ? new Date(q.from) : new Date(to.getTime() - 29 * 86400_000);
    const branchWhere = scope ? { branchId: { in: scope } } : {};
    const [payments, plans, instalments, branches] = await Promise.all([
      this.prisma.payment.findMany({ where: { ...branchWhere, status: { not: 'VOIDED' }, paidOn: { gte: from, lte: to } }, include: { enrolment: { select: { batch: { select: { id: true, name: true, course: { select: { id: true, name: true } } } } } } } }),
      this.prisma.feePlan.findMany({ where: { createdAt: { gte: from, lte: new Date(to.getTime() + 86400_000) }, enrolment: scope ? { batch: { branchId: { in: scope } } } : {} }, select: { netPaise: true, discountPaise: true, discountStatus: true } }),
      this.prisma.instalment.findMany({ where: { feePlan: { enrolment: { status: { in: ['ACTIVE', 'ON_HOLD', 'COMPLETED'] }, ...(scope ? { batch: { branchId: { in: scope } } } : {}) } } }, select: { dueDate: true, amountPaise: true, paidPaise: true } }),
      this.prisma.branch.findMany({ where: scope ? { id: { in: scope } } : {}, select: { id: true, code: true, name: true } }),
    ]);
    const todayKey = istDateKey(new Date());
    const collections = payments.filter((p) => p.kind === 'PAYMENT');
    const sum = (xs: { amountPaise: number }[]) => xs.reduce((a, x) => a + x.amountPaise, 0);
    const groupBy = <K extends string>(xs: typeof collections, key: (p: (typeof collections)[number]) => K) => {
      const m = new Map<K, number>();
      xs.forEach((p) => m.set(key(p), (m.get(key(p)) ?? 0) + p.amountPaise));
      return [...m.entries()].map(([k, v]) => ({ key: k, amountPaise: v })).sort((a, b) => b.amountPaise - a.amountPaise);
    };
    const daily = new Map<string, number>();
    for (let d = new Date(from); d <= to; d = new Date(d.getTime() + 86400_000)) daily.set(d.toISOString().slice(0, 10), 0);
    collections.forEach((p) => { const k = p.paidOn.toISOString().slice(0, 10); daily.set(k, (daily.get(k) ?? 0) + p.amountPaise); });
    return {
      from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10),
      salesPaise: plans.reduce((a, p) => a + p.netPaise, 0),
      collectionsPaise: sum(collections),
      refundsPaise: sum(payments.filter((p) => p.kind === 'REFUND')),
      adjustmentsPaise: sum(payments.filter((p) => p.kind === 'ADJUSTMENT')),
      discountsPaise: plans.filter((p) => p.discountStatus === 'APPROVED').reduce((a, p) => a + p.discountPaise, 0),
      pendingPaise: instalments.filter((i) => i.dueDate.toISOString().slice(0, 10) >= todayKey).reduce((a, i) => a + Math.max(0, i.amountPaise - i.paidPaise), 0),
      overduePaise: instalments.filter((i) => i.dueDate.toISOString().slice(0, 10) < todayKey).reduce((a, i) => a + Math.max(0, i.amountPaise - i.paidPaise), 0),
      byMethod: groupBy(collections, (p) => p.method).map((r) => ({ ...r, label: PAYMENT_METHODS[r.key as keyof typeof PAYMENT_METHODS] ?? r.key })),
      byBranch: groupBy(collections, (p) => p.branchId).map((r) => ({ ...r, label: branches.find((b) => b.id === r.key)?.code ?? '?' })),
      byCourse: groupBy(collections, (p) => p.enrolment.batch.course.name).map((r) => ({ ...r, label: r.key })),
      byBatch: groupBy(collections, (p) => p.enrolment.batch.name).map((r) => ({ ...r, label: r.key })),
      daily: [...daily.entries()].map(([date, amountPaise]) => ({ date, amountPaise })),
    };
  }

  /** AC9: one day's collections per branch, with cash by the person who received it. */
  @Get('day-close')
  async dayClose(@CurrentUser() user: SessionUser, @Query('branchId') branchId?: string, @Query('date') date?: string) {
    const scope = scopeOf(user, 'accounts.view', branchId || undefined);
    const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : istDateKey(new Date());
    const rows = await this.prisma.payment.findMany({
      where: { ...(scope ? { branchId: { in: scope } } : {}), paidOn: new Date(day), status: { not: 'VOIDED' } },
      include: { receivedBy: { select: { user: { select: { name: true } } } }, branch: { select: { code: true } }, student: { select: { code: true, user: { select: { name: true } } } } },
      orderBy: { createdAt: 'asc' },
    });
    const people = new Map<string, { name: string; branch: string; cashPaise: number; otherPaise: number; refundsPaise: number; count: number }>();
    for (const p of rows) {
      const key = `${p.branchId}:${p.receivedById ?? p.recordedByUserId}`;
      const cur = people.get(key) ?? { name: p.receivedBy?.user.name ?? 'Head office', branch: p.branch.code, cashPaise: 0, otherPaise: 0, refundsPaise: 0, count: 0 };
      if (p.kind === 'REFUND') cur.refundsPaise += p.amountPaise;
      else if (p.kind === 'PAYMENT') { if (p.method === 'CASH') cur.cashPaise += p.amountPaise; else cur.otherPaise += p.amountPaise; }
      cur.count++;
      people.set(key, cur);
    }
    return {
      date: day,
      byPerson: [...people.values()],
      totals: {
        cashPaise: rows.filter((p) => p.kind === 'PAYMENT' && p.method === 'CASH').reduce((a, p) => a + p.amountPaise, 0),
        otherPaise: rows.filter((p) => p.kind === 'PAYMENT' && p.method !== 'CASH').reduce((a, p) => a + p.amountPaise, 0),
        refundsPaise: rows.filter((p) => p.kind === 'REFUND').reduce((a, p) => a + p.amountPaise, 0),
      },
      payments: rows.map((p) => ({ id: p.id, receiptNo: p.receiptNo, kind: p.kind, status: p.status, amountPaise: p.amountPaise, method: p.method, student: p.student, receivedBy: p.receivedBy?.user.name ?? null })),
    };
  }

  /** Excel export (PRD §11.3): receipts or dues for the chosen filters. */
  @Get('export.xlsx')
  async export(@CurrentUser() user: SessionUser, @Query() q: Record<string, string>, @Res() res: Response) {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Campus Connect';
    const money = (p: number) => p / 100;
    if (q.type === 'dues') {
      const d = await this.duesRows(user, { ...q, status: q.status || 'all' });
      const ws = wb.addWorksheet('Dues');
      ws.columns = [{ header: 'Student', key: 's', width: 26 }, { header: 'ID', key: 'c', width: 22 }, { header: 'Branch', key: 'b', width: 8 }, { header: 'Batch', key: 'bt', width: 24 }, { header: 'Instalment', key: 'n', width: 10 }, { header: 'Due date', key: 'd', width: 12 }, { header: 'Due (₹)', key: 'a', width: 12 }, { header: 'Status', key: 'st', width: 12 }];
      d.rows.forEach((r) => ws.addRow({ s: r.student.user.name, c: r.student.code, b: r.branch, bt: r.batch, n: r.seq, d: formatDate(r.dueDate), a: money(r.duePaise), st: INSTALMENT_STATE[r.state] }));
    } else {
      const scope = scopeOf(user, 'accounts.view', q.branchId || undefined);
      const rows = await this.prisma.payment.findMany({
        where: { ...(scope ? { branchId: { in: scope } } : {}), ...(q.from || q.to ? { paidOn: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}) },
        include: { student: { select: { code: true, user: { select: { name: true } } } }, branch: { select: { code: true } }, enrolment: { select: { batch: { select: { name: true, course: { select: { name: true } } } } } }, receivedBy: { select: { user: { select: { name: true } } } } },
        orderBy: { paidOn: 'asc' }, take: 20_000,
      });
      const ws = wb.addWorksheet('Receipts');
      ws.columns = [{ header: 'Receipt', key: 'r', width: 24 }, { header: 'Date', key: 'd', width: 12 }, { header: 'Type', key: 'k', width: 12 }, { header: 'Status', key: 'st', width: 12 }, { header: 'Student', key: 's', width: 26 }, { header: 'ID', key: 'c', width: 22 }, { header: 'Branch', key: 'b', width: 8 }, { header: 'Course', key: 'co', width: 26 }, { header: 'Batch', key: 'bt', width: 24 }, { header: 'Method', key: 'm', width: 14 }, { header: 'Reference', key: 'ref', width: 18 }, { header: 'Amount (₹)', key: 'a', width: 12 }, { header: 'Received by', key: 'rb', width: 20 }];
      rows.forEach((p) => ws.addRow({ r: p.receiptNo, d: formatDate(p.paidOn), k: p.kind, st: p.status, s: p.student.user.name, c: p.student.code, b: p.branch.code, co: p.enrolment.batch.course.name, bt: p.enrolment.batch.name, m: PAYMENT_METHODS[p.method as keyof typeof PAYMENT_METHODS] ?? p.method, ref: p.reference ?? '', a: money(p.amountPaise), rb: p.receivedBy?.user.name ?? '' }));
    }
    wb.worksheets[0].getRow(1).font = { bold: true };
    await this.audit.record({ actorId: user.id, action: 'export.accounts', entity: 'Export', summary: `Exported ${q.type === 'dues' ? 'dues' : 'receipts'} to Excel` });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${q.type === 'dues' ? 'dues' : 'receipts'}-${istDateKey(new Date())}.xlsx"`);
    res.end(Buffer.from(await wb.xlsx.writeBuffer()));
  }

  // ── Fees (AC2) ──

  @Get('fees')
  async fees(@CurrentUser() user: SessionUser) {
    const scope = branchesFor(user, 'accounts.view');
    if (scope !== null && !scope.length && !user.permissions.includes('fees.manage')) throw new ForbiddenException('You do not have access to this');
    const [courses, batches] = await Promise.all([
      this.prisma.course.findMany({ where: { status: 'PUBLISHED' }, select: { id: true, code: true, name: true, defaultFeePaise: true, feeLocked: true }, orderBy: { name: 'asc' } }),
      this.prisma.batch.findMany({ where: { status: { not: 'CANCELLED' }, ...(scope ? { branchId: { in: scope } } : {}) }, select: { id: true, name: true, feePaise: true, branchId: true, branch: { select: { code: true } }, course: { select: { id: true, name: true, defaultFeePaise: true, feeLocked: true } } }, orderBy: [{ branchId: 'asc' }, { name: 'asc' }] }),
    ]);
    return {
      canLock: user.permissions.includes('accounts.approve'),
      courses,
      batches: batches.map((b) => ({ ...b, canSetPrice: can(user, 'fees.manage', b.branchId) && !b.course.feeLocked })),
    };
  }

  @Put('fees/batches/:id')
  async batchFee(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body(new Zod(batchFeeSchema)) body: { fee: number | null }, @Req() req: Request) {
    const b = await this.prisma.batch.findUnique({ where: { id }, include: { course: true } });
    if (!b) throw new NotFoundException('Batch not found');
    this.acc.assert(user, 'fees.manage', b.branchId);
    if (b.course.feeLocked) throw new BadRequestException('Head office has locked the price of this course');
    const feePaise = body.fee === null ? null : rupeesToPaise(body.fee);
    await this.prisma.$transaction(async (tx) => {
      await tx.batch.update({ where: { id }, data: { feePaise } });
      await this.audit.record({ actorId: user.id, action: 'fees.batch.price', entity: 'Batch', entityId: id, branchId: b.branchId, summary: `Price of ${b.name}: ${feePaise === null ? `course default ${formatINR(b.course.defaultFeePaise)}` : formatINR(feePaise)}`, ip: ip(req) }, tx);
    });
    return { ok: true };
  }

  @Put('fees/courses/:id')
  @RequirePerm('accounts.approve')
  async courseFee(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body(new Zod(courseFeeSchema)) body: z.infer<typeof courseFeeSchema>, @Req() req: Request) {
    const c = await this.prisma.course.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Course not found');
    const data = { ...(body.defaultFee !== undefined ? { defaultFeePaise: rupeesToPaise(body.defaultFee) } : {}), ...(body.feeLocked !== undefined ? { feeLocked: body.feeLocked } : {}) };
    await this.prisma.$transaction(async (tx) => {
      await tx.course.update({ where: { id }, data });
      await this.audit.record({ actorId: user.id, action: 'fees.course', entity: 'Course', entityId: id, summary: `${c.name}: ${body.defaultFee !== undefined ? `default fee ${formatINR(rupeesToPaise(body.defaultFee))}` : ''}${body.feeLocked !== undefined ? ` ${body.feeLocked ? 'locked' : 'unlocked'} for branches` : ''}`, ip: ip(req) }, tx);
    });
    return { ok: true };
  }
}
