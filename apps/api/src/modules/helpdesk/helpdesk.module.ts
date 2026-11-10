import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, Module, NotFoundException, OnModuleInit, Param, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Prisma } from '@prisma/client';
import { SessionUser, TICKET_CATEGORIES, addBusinessDays, can, ticketReplySchema, ticketSchema, ticketStatusSchema } from '@cc/shared';
import { z } from 'zod';
import { CurrentUser, branchesFor } from '../../common/auth';
import { FilesService } from '../../common/files.service';
import { Zod } from '../../common/http';
import { IdService } from '../../common/ids.service';
import { JobsService } from '../../common/jobs.service';
import { PrismaService } from '../../common/prisma.service';
import { SettingsService } from '../../common/settings.service';
import { AttendanceService } from '../attendance/attendance.service';
import { NotifyService } from '../notifications/notify.service';

const OPEN = ['OPEN', 'IN_PROGRESS', 'WAITING'];
const include = {
  branch: { select: { id: true, code: true, name: true } },
  raisedBy: { select: { id: true, name: true, kind: true, student: { select: { code: true } } } },
  assignee: { select: { id: true, user: { select: { id: true, name: true } } } },
} satisfies Prisma.TicketInclude;

/** PRD §14 help desk: raise → branch replies → statuses; SLA first reply; escalation to the Help Desk Admin. */
@Controller('helpdesk')
export class HelpdeskController {
  constructor(private prisma: PrismaService, private ids: IdService, private files: FilesService, private notify: NotifyService, private settings: SettingsService, private att: AttendanceService) {}

  private handler(user: SessionUser, branchId: string) { return can(user, 'helpdesk.handle', branchId); }

  private async holidays(branchId: string) {
    const rows = await this.prisma.holiday.findMany({ where: { OR: [{ branchId: null }, { branchId }] }, select: { date: true } });
    return new Set(rows.map((h) => h.date.toISOString().slice(0, 10)));
  }

  private async withSla<T extends { createdAt: Date; firstResponseAt: Date | null; status: string; branchId: string }>(t: T) {
    const days = await this.settings.get('helpdesk.firstReplyBusinessDays');
    const due = addBusinessDays(t.createdAt, days, await this.holidays(t.branchId));
    return { ...t, replyDueAt: due, replyOverdue: !t.firstResponseAt && OPEN.includes(t.status) && Date.now() > due.getTime() };
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  async upload(@CurrentUser() user: SessionUser, @UploadedFile() file?: Express.Multer.File) {
    const f = await this.files.save(file, { purpose: 'ticket', userId: user.id, kinds: ['image', 'pdf', 'office', 'text'], maxMb: 20 });
    return { id: f.id, name: f.name };
  }

  private async checkFiles(user: SessionUser, ids: string[]) {
    if (!ids.length) return;
    const n = await this.prisma.fileObject.count({ where: { id: { in: ids }, uploadedById: user.id, purpose: 'ticket' } });
    if (n !== new Set(ids).size) throw new BadRequestException('Attach the files again');
  }

  @Post('tickets')
  async create(@CurrentUser() user: SessionUser, @Body(new Zod(ticketSchema)) body: z.infer<typeof ticketSchema>) {
    const branchId = user.kind === 'STUDENT' ? user.homeBranchId : body.branchId || user.homeBranchId;
    if (!branchId) throw new BadRequestException('Choose a branch');
    if (user.kind !== 'STUDENT' && user.branchIds !== null && !user.branchIds.includes(branchId)) throw new ForbiddenException('You can only raise tickets for your branches');
    await this.checkFiles(user, body.fileIds);
    const branch = await this.prisma.branch.findUniqueOrThrow({ where: { id: branchId } });
    const t = await this.prisma.$transaction(async (tx) => {
      const number = await this.ids.ticketNo(tx, branchId, branch.code);
      return tx.ticket.create({ data: { number, branchId, raisedById: user.id, category: body.category, subject: body.subject, messages: { create: { authorId: user.id, body: body.description, fileIds: body.fileIds } } } });
    });
    const staff = await this.att.branchStaffWith('helpdesk.handle', branchId);
    await this.notify.sendMany(staff, { type: 'N17', title: `New ticket ${t.number}: ${body.subject}`, body: `${TICKET_CATEGORIES[body.category]} · from ${user.name}`, link: `/helpdesk/${t.id}`, email: true });
    return t;
  }

  @Get('tickets')
  async list(@CurrentUser() user: SessionUser, @Query() q: Record<string, string>) {
    const scope = q.scope === 'mine' ? 'mine' : 'branch';
    let where: Prisma.TicketWhereInput;
    if (scope === 'mine' || user.kind === 'STUDENT') where = { raisedById: user.id };
    else {
      const b = branchesFor(user, 'helpdesk.handle');
      if (b !== null && !b.length) throw new ForbiddenException('You do not handle help desk tickets');
      where = b === null ? {} : { branchId: { in: q.branchId && b.includes(q.branchId) ? [q.branchId] : b } };
      if (q.branchId && b === null) where = { branchId: q.branchId };
    }
    if (q.status === 'open') where.status = { in: OPEN };
    else if (q.status === 'closed') where.status = { in: ['RESOLVED', 'CLOSED'] };
    if (q.escalated === '1') where.escalatedAt = { not: null };
    if (q.q) where.OR = [{ number: { contains: q.q, mode: 'insensitive' } }, { subject: { contains: q.q, mode: 'insensitive' } }, { raisedBy: { name: { contains: q.q, mode: 'insensitive' } } }];
    const page = Math.max(1, Number(q.page) || 1);
    const [total, rows] = await Promise.all([
      this.prisma.ticket.count({ where }),
      this.prisma.ticket.findMany({ where, include: { ...include, _count: { select: { messages: true } } }, orderBy: [{ updatedAt: 'desc' }], take: 25, skip: (page - 1) * 25 }),
    ]);
    const out = [];
    for (const t of rows) out.push(await this.withSla(t));
    return { total, page, pageSize: 25, rows: out };
  }

  private async load(user: SessionUser, id: string) {
    const t = await this.prisma.ticket.findUnique({ where: { id }, include });
    if (!t) throw new NotFoundException('Ticket not found');
    const mine = t.raisedById === user.id;
    const handler = this.handler(user, t.branchId);
    if (!mine && !handler) throw new ForbiddenException('You do not have access to this ticket');
    return { t, mine, handler };
  }

  @Get('tickets/:id')
  async get(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    const { t, mine, handler } = await this.load(user, id);
    const msgs = await this.prisma.ticketMessage.findMany({ where: { ticketId: id, ...(handler ? {} : { internal: false }) }, include: { author: { select: { id: true, name: true, kind: true } } }, orderBy: { createdAt: 'asc' } });
    const fileIds = [...new Set(msgs.flatMap((m) => m.fileIds))];
    const files = await this.prisma.fileObject.findMany({ where: { id: { in: fileIds } }, select: { id: true, name: true } });
    const reopenDays = await this.settings.get('helpdesk.reopenDays');
    const canReopen = mine && ['RESOLVED', 'CLOSED'].includes(t.status) && !!t.resolvedAt && Date.now() - t.resolvedAt.getTime() <= reopenDays * 86400_000;
    const staff = handler ? await this.prisma.employee.findMany({ where: { OR: [{ branchId: t.branchId }, { extraBranches: { some: { branchId: t.branchId } } }], user: { status: 'ACTIVE' } }, select: { id: true, user: { select: { name: true } }, designation: { select: { name: true } } }, orderBy: { user: { name: 'asc' } } }) : [];
    return {
      ...(await this.withSla(t)), mine, handler, canReopen, reopenDays, staff,
      messages: msgs.map((m) => ({ ...m, files: m.fileIds.map((fid) => ({ id: fid, name: files.find((f) => f.id === fid)?.name ?? 'File', url: this.files.signedUrl(fid, user.id) })) })),
    };
  }

  @Post('tickets/:id/messages')
  async reply(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body(new Zod(ticketReplySchema)) body: z.infer<typeof ticketReplySchema>) {
    const { t, mine, handler } = await this.load(user, id);
    if (t.status === 'CLOSED') throw new BadRequestException(mine ? 'This ticket is closed. Reopen it to reply.' : 'This ticket is closed');
    if (body.internal && !handler) throw new ForbiddenException('Only staff can add internal notes');
    await this.checkFiles(user, body.fileIds);
    const now = new Date();
    const data: Prisma.TicketUpdateInput = {};
    if (handler && !mine && !body.internal) {
      if (!t.firstResponseAt) data.firstResponseAt = now;
      data.status = body.status ?? (t.status === 'OPEN' ? 'IN_PROGRESS' : t.status);
      if (data.status === 'RESOLVED') data.resolvedAt = now;
    } else if (mine && ['WAITING', 'RESOLVED'].includes(t.status)) data.status = 'IN_PROGRESS';
    await this.prisma.$transaction([
      this.prisma.ticketMessage.create({ data: { ticketId: id, authorId: user.id, body: body.body, internal: body.internal, fileIds: body.fileIds } }),
      this.prisma.ticket.update({ where: { id }, data: { ...data, updatedAt: now } }),
    ]);
    if (!body.internal) {
      if (mine) {
        const to = t.assignee ? [t.assignee.user.id] : await this.att.branchStaffWith('helpdesk.handle', t.branchId);
        await this.notify.sendMany(to, { type: 'N17', title: `${t.number}: new reply from ${user.name}`, body: body.body.slice(0, 140), link: `/helpdesk/${id}` });
      } else {
        await this.notify.send(t.raisedById, { type: 'N17', title: `${t.number}: ${user.name} replied`, body: body.body.slice(0, 140), link: `/helpdesk/${id}`, email: true });
      }
    }
    return { ok: true };
  }

  @Post('tickets/:id/status')
  @HttpCode(200)
  async status(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body(new Zod(ticketStatusSchema)) body: z.infer<typeof ticketStatusSchema>) {
    const { t, mine, handler } = await this.load(user, id);
    const now = new Date();
    if (!handler) {
      // The person who raised it may close it, or reopen it within N days of it being resolved.
      if (body.status === 'CLOSED') { await this.prisma.ticket.update({ where: { id }, data: { status: 'CLOSED', closedAt: now } }); return { status: 'CLOSED' }; }
      const days = await this.settings.get('helpdesk.reopenDays');
      if (body.status === 'OPEN' && mine && ['RESOLVED', 'CLOSED'].includes(t.status) && t.resolvedAt && now.getTime() - t.resolvedAt.getTime() <= days * 86400_000) {
        await this.prisma.ticket.update({ where: { id }, data: { status: 'OPEN', closedAt: null, resolvedAt: null } });
        const to = t.assignee ? [t.assignee.user.id] : await this.att.branchStaffWith('helpdesk.handle', t.branchId);
        await this.notify.sendMany(to, { type: 'N17', title: `${t.number} was reopened by ${user.name}`, link: `/helpdesk/${id}` });
        return { status: 'OPEN' };
      }
      throw new ForbiddenException(body.status === 'OPEN' ? `Tickets can be reopened within ${days} days of being resolved` : 'Only the branch can change this');
    }
    const data: Prisma.TicketUpdateInput = { status: body.status };
    if (body.status === 'RESOLVED') data.resolvedAt = now;
    if (body.status === 'CLOSED') data.closedAt = now;
    if (body.status === 'OPEN') { data.resolvedAt = null; data.closedAt = null; }
    await this.prisma.ticket.update({ where: { id }, data });
    if (body.status === 'RESOLVED' || body.status === 'WAITING') {
      await this.notify.send(t.raisedById, { type: 'N17', title: body.status === 'RESOLVED' ? `${t.number} is resolved` : `${t.number}: the branch needs a reply from you`, link: `/helpdesk/${id}`, email: true });
    }
    return { status: body.status };
  }

  @Post('tickets/:id/assign')
  @HttpCode(200)
  async assign(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body(new Zod(z.object({ employeeId: z.string().nullable() }))) body: { employeeId: string | null }) {
    const { t, handler } = await this.load(user, id);
    if (!handler) throw new ForbiddenException('Only the branch can assign tickets');
    if (body.employeeId) {
      const e = await this.prisma.employee.findUnique({ where: { id: body.employeeId }, include: { extraBranches: true } });
      if (!e || (e.branchId !== t.branchId && !e.extraBranches.some((b) => b.branchId === t.branchId))) throw new BadRequestException('Choose someone from this branch');
      await this.notify.send(e.userId, { type: 'N17', title: `Ticket ${t.number} assigned to you`, body: t.subject, link: `/helpdesk/${id}`, email: true });
    }
    await this.prisma.ticket.update({ where: { id }, data: { assigneeId: body.employeeId } });
    return { ok: true };
  }
}

@Module({ controllers: [HelpdeskController] })
export class HelpdeskModule implements OnModuleInit {
  constructor(private jobs: JobsService, private prisma: PrismaService, private settings: SettingsService, private notify: NotifyService) {}

  onModuleInit() { this.jobs.register('helpdesk.sla', 30 * 60_000, () => this.sla()); }

  /** Escalate to the Help Desk Admin after N business days unresolved; close resolved tickets after the reopen window. */
  async sla(now = new Date()) {
    const days = await this.settings.get('helpdesk.escalateBusinessDays');
    const reopenDays = await this.settings.get('helpdesk.reopenDays');
    const open = await this.prisma.ticket.findMany({ where: { status: { in: OPEN }, escalatedAt: null }, include: { branch: { select: { code: true } } } });
    const holidays = new Set((await this.prisma.holiday.findMany({ select: { date: true } })).map((h) => h.date.toISOString().slice(0, 10)));
    const admins = (await this.prisma.user.findMany({ where: { status: 'ACTIVE', OR: [{ kind: 'SUPER_ADMIN' }, { kind: 'ADMIN', adminModules: { some: { module: 'helpdesk' } } }] }, select: { id: true } })).map((u) => u.id);
    for (const t of open) {
      if (now.getTime() < addBusinessDays(t.createdAt, days, holidays).getTime()) continue;
      const { count } = await this.prisma.ticket.updateMany({ where: { id: t.id, escalatedAt: null }, data: { escalatedAt: now } });
      if (count) await this.notify.sendMany(admins, { type: 'N17', title: `Escalated: ${t.number} (${t.branch.code})`, body: `${t.subject}. Not resolved within ${days} business days.`, link: `/helpdesk/${t.id}`, email: true });
    }
    await this.prisma.ticket.updateMany({ where: { status: 'RESOLVED', resolvedAt: { lt: new Date(now.getTime() - reopenDays * 86400_000) } }, data: { status: 'CLOSED', closedAt: now } });
  }
}
