import { Controller, ForbiddenException, Get, Module, NotFoundException, OnModuleInit, Param, Res } from '@nestjs/common';
import { INSTALMENT_STATE, PAYMENT_METHODS, SessionUser, can, formatDate, formatINR, istDateKey } from '@cc/shared';
import type { Response } from 'express';
import type { Content } from 'pdfmake/interfaces';
import { CurrentUser } from '../../common/auth';
import { JobsService } from '../../common/jobs.service';
import { PdfService } from '../../common/pdf.service';
import { PrismaService } from '../../common/prisma.service';
import { SettingsService } from '../../common/settings.service';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';

/** S7 and the student's payment / dues statements (PRD §10). */
@Controller()
export class StudentFeesController {
  constructor(private acc: AccountsService, private prisma: PrismaService, private pdf: PdfService) {}

  @Get('me/fees')
  async mine(@CurrentUser() user: SessionUser) {
    if (!user.studentId) throw new ForbiddenException('Only students have fees');
    const enrolments = await this.prisma.enrolment.findMany({ where: { studentId: user.studentId, status: { not: 'MOVED' } }, orderBy: { enrolledOn: 'desc' } });
    const out = [];
    for (const e of enrolments) out.push(await this.acc.ledger(e.id));
    return out;
  }

  private async studentFor(user: SessionUser, id: string) {
    const sid = id === 'me' ? user.studentId : id;
    if (!sid) throw new ForbiddenException('Only students have statements');
    const s = await this.prisma.student.findUnique({ where: { id: sid }, include: { user: true, branch: true, enrolments: { where: { status: { not: 'MOVED' } }, include: { batch: { select: { branchId: true } } } } } });
    if (!s) throw new NotFoundException('Student not found');
    if (user.studentId !== s.id && !s.enrolments.some((e) => can(user, 'accounts.view', e.batch.branchId))) throw new ForbiddenException('You do not have access to this student\'s fees');
    return s;
  }

  private send(res: Response, name: string, buf: Buffer) {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.end(buf);
  }

  @Get('reports/students/:id/payments.pdf')
  async payments(@CurrentUser() user: SessionUser, @Param('id') id: string, @Res() res: Response) {
    const s = await this.studentFor(user, id);
    const body: Content[] = [];
    for (const e of s.enrolments) {
      const l = await this.acc.ledger(e.id);
      body.push({ text: `${l.enrolment.batch.course.name} · ${l.enrolment.batch.name} (${l.enrolment.batch.branch.code})`, style: 'h2' });
      body.push({ text: l.plan ? `Fee ${formatINR(l.plan.totalPaise)}${l.plan.discountPaise ? ` − discount ${formatINR(l.plan.discountPaise)}` : ''} = ${formatINR(l.plan.netPaise)} · paid ${formatINR(l.totals.paidPaise)} · balance ${formatINR(l.totals.balancePaise)}` : 'No fee plan yet.', margin: [0, 0, 0, 6] });
      const rows = l.payments.filter((p) => p.status !== 'VOIDED');
      if (rows.length) body.push(this.pdf.table(['Date', 'Receipt', 'Type', 'Method', 'Amount'], rows.map((p) => [formatDate(p.paidOn), p.receiptNo, p.kind === 'PAYMENT' ? 'Payment' : p.kind === 'REFUND' ? 'Refund' : 'Adjustment', PAYMENT_METHODS[p.method as keyof typeof PAYMENT_METHODS] ?? p.method, `${p.kind === 'REFUND' ? '−' : ''}${formatINR(p.amountPaise, { decimals: true })}`]), [60, 120, 60, 70, '*']));
    }
    const buf = await this.pdf.render({ title: 'Payment statement', meta: [['Student', `${s.user.name} (${s.code})`], ['Branch', s.branch.name], ['As on', formatDate(new Date())]], body });
    this.send(res, `payments-${s.code}.pdf`, buf);
  }

  @Get('reports/students/:id/dues.pdf')
  async dues(@CurrentUser() user: SessionUser, @Param('id') id: string, @Res() res: Response) {
    const s = await this.studentFor(user, id);
    const body: Content[] = [];
    let total = 0;
    for (const e of s.enrolments) {
      const l = await this.acc.ledger(e.id);
      const open = l.instalments.filter((i) => i.state !== 'PAID');
      if (!open.length) continue;
      body.push({ text: `${l.enrolment.batch.course.name} · ${l.enrolment.batch.name} (${l.enrolment.batch.branch.code})`, style: 'h2' });
      body.push(this.pdf.table(['Instalment', 'Due date', 'Amount', 'Paid', 'Due', 'Status'], open.map((i) => [`#${i.seq}`, formatDate(i.dueDate), formatINR(i.amountPaise), formatINR(i.paidPaise), formatINR(i.amountPaise - i.paidPaise), INSTALMENT_STATE[i.state]])));
      total += open.reduce((a, i) => a + i.amountPaise - i.paidPaise, 0);
    }
    if (!body.length) body.push({ text: 'Nothing is due. Thank you!', margin: [0, 6, 0, 0] });
    else body.unshift({ text: `Total due: ${formatINR(total)}`, bold: true, fontSize: 13, margin: [0, 0, 0, 4] });
    const buf = await this.pdf.render({ title: 'Dues statement', meta: [['Student', `${s.user.name} (${s.code})`], ['Branch', s.branch.name], ['As on', formatDate(new Date())]], body });
    this.send(res, `dues-${s.code}.pdf`, buf);
  }
}

@Module({ controllers: [AccountsController, StudentFeesController], providers: [AccountsService, PdfService], exports: [AccountsService] })
export class AccountsModule implements OnModuleInit {
  constructor(private jobs: JobsService, private prisma: PrismaService, private settings: SettingsService, private acc: AccountsService) {}

  onModuleInit() {
    this.jobs.register('accounts.reminders', 60 * 60_000, () => this.reminders());
  }

  /** PRD §11.3: automatic reminders 3 days before, on the day, then weekly while overdue (daytime IST only). */
  async reminders(now = new Date(), force = false) {
    const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false }).format(now));
    if (!force && (hour < 9 || hour > 19)) return;
    const today = istDateKey(now);
    const before = await this.settings.get('accounts.reminderDaysBefore');
    const every = await this.settings.get('accounts.overdueReminderDays');
    const soonDate = new Date(new Date(`${today}T00:00:00Z`).getTime() + before * 86400_000);
    const rows = await this.prisma.instalment.findMany({
      where: { dueDate: { lte: soonDate }, feePlan: { enrolment: { status: 'ACTIVE' } } },
      include: { feePlan: { include: { enrolment: { include: { student: { select: { userId: true } }, batch: { select: { name: true } } } } } } },
    });
    for (const i of rows) {
      if (i.paidPaise >= i.amountPaise) continue;
      const due = i.dueDate.toISOString().slice(0, 10);
      let kind: 'soon' | 'today' | 'overdue' | null = null;
      if (due === soonDate.toISOString().slice(0, 10)) kind = 'soon';
      else if (due === today) kind = 'today';
      else if (due < today && (!i.lastReminderAt || now.getTime() - i.lastReminderAt.getTime() >= every * 86400_000)) kind = 'overdue';
      if (!kind) continue;
      await this.jobs.once(`fee:${kind}:${i.id}:${today}`, () => this.acc.sendReminder(i, kind!));
    }
  }
}
