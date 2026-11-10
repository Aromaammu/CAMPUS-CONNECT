import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, HttpCode, NotFoundException, Param, Patch, Post, Query, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Prisma } from '@prisma/client';
import { SessionUser, can, directSchema, groupMembersSchema, groupSchema, hideMessageSchema, messageEditSchema, messageSchema } from '@cc/shared';
import type { Request } from 'express';
import { z } from 'zod';
import { AuditService } from '../../common/audit.service';
import { CurrentUser, RequirePerm } from '../../common/auth';
import { FilesService } from '../../common/files.service';
import { Zod, clientIp } from '../../common/http';
import { PrismaService } from '../../common/prisma.service';
import { Realtime } from '../../common/realtime.gateway';
import { SettingsService } from '../../common/settings.service';
import { MessagingService } from './messaging.service';

const msgInclude = { sender: { select: { id: true, name: true, kind: true } } } satisfies Prisma.MessageInclude;
type Msg = Prisma.MessageGetPayload<{ include: typeof msgInclude }>;

@Controller('messages')
export class MessagingController {
  constructor(
    private prisma: PrismaService, private msg: MessagingService, private files: FilesService, private rt: Realtime,
    private settings: SettingsService, private audit: AuditService,
  ) {}

  /** What members see: deleted and hidden messages keep their place but lose their content. */
  private async view(m: Msg, moderator = false) {
    const [file, reply] = await Promise.all([
      m.fileId && !m.deletedAt && (!m.hiddenAt || moderator) ? this.prisma.fileObject.findUnique({ where: { id: m.fileId }, select: { id: true, name: true, mime: true, sizeBytes: true } }) : null,
      m.replyToId ? this.prisma.message.findUnique({ where: { id: m.replyToId }, include: msgInclude }) : null,
    ]);
    const visible = !m.deletedAt && (!m.hiddenAt || moderator);
    return {
      id: m.id, conversationId: m.conversationId, sender: m.sender, createdAt: m.createdAt, editedAt: m.editedAt,
      text: visible ? m.text : null, file, deleted: !!m.deletedAt, hidden: !!m.hiddenAt,
      hiddenReason: moderator ? m.hiddenReason : null,
      replyTo: reply ? { id: reply.id, sender: reply.sender.name, text: reply.deletedAt || reply.hiddenAt ? null : (reply.text ?? (reply.fileId ? 'File' : '')).slice(0, 140) } : null,
    };
  }

  private async summary(user: SessionUser, c: Awaited<ReturnType<MessagingService['load']>>) {
    const me = c.members.find((m) => m.userId === user.id);
    const [last, unread] = await Promise.all([
      this.prisma.message.findFirst({ where: { conversationId: c.id }, orderBy: { createdAt: 'desc' }, include: msgInclude }),
      me ? this.prisma.message.count({ where: { conversationId: c.id, senderId: { not: user.id }, deletedAt: null, ...(me.lastReadAt ? { createdAt: { gt: me.lastReadAt } } : {}) } }) : 0,
    ]);
    let title = c.title ?? 'Conversation';
    let otherUserId: string | null = null;
    let subtitle: string | null = null;
    if (c.kind === 'DIRECT') {
      otherUserId = c.members.find((m) => m.userId !== user.id)?.userId ?? null;
      const other = otherUserId ? await this.prisma.user.findUnique({ where: { id: otherUserId }, select: { name: true, kind: true, employee: { select: { designation: { select: { name: true } }, branch: { select: { code: true } } } }, student: { select: { code: true } } } }) : null;
      title = other?.name ?? 'Conversation';
      subtitle = other?.employee ? `${other.employee.designation.name} · ${other.employee.branch.code}` : other?.student ? `Student · ${other.student.code}` : other?.kind === 'STUDENT' ? 'Student' : 'Head office';
    } else subtitle = c.kind === 'BATCH' ? 'Batch group' : `${c.members.length} members`;
    return {
      id: c.id, kind: c.kind, title, subtitle, otherUserId, announcementsOnly: c.announcementsOnly, unread,
      role: me?.role ?? null, members: c.members.length, lastMessageAt: c.lastMessageAt,
      canPost: !!me && !(c.announcementsOnly && me.role === 'MEMBER'),
      last: last ? { text: last.deletedAt ? 'Message deleted' : last.hiddenAt ? 'Message hidden' : (last.text ?? (last.fileId ? 'Sent a file' : '')).slice(0, 100), sender: last.sender.name, mine: last.senderId === user.id, createdAt: last.createdAt } : null,
    };
  }

  @Get('conversations')
  async list(@CurrentUser() user: SessionUser) {
    await this.msg.syncBatchGroups(user);
    const rows = await this.prisma.conversation.findMany({
      where: { members: { some: { userId: user.id } } },
      include: { members: true, batch: { include: { teachers: { include: { employee: true } } } } },
      orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: 200,
    });
    const out = [];
    for (const c of rows) out.push(await this.summary(user, c));
    return out;
  }

  @Get('unread')
  async unread(@CurrentUser() user: SessionUser) {
    const mine = await this.prisma.conversationMember.findMany({ where: { userId: user.id }, select: { conversationId: true, lastReadAt: true } });
    let total = 0;
    for (const m of mine) total += await this.prisma.message.count({ where: { conversationId: m.conversationId, senderId: { not: user.id }, deletedAt: null, ...(m.lastReadAt ? { createdAt: { gt: m.lastReadAt } } : {}) } });
    return { total };
  }

  /** People I may start a 1-to-1 chat with. */
  @Get('contacts')
  async contacts(@CurrentUser() user: SessionUser, @Query('q') q = '') {
    const term = q.trim();
    if (term.length < 2) return [];
    const rows = await this.prisma.user.findMany({
      where: { id: { not: user.id }, status: 'ACTIVE', mustChangePassword: false, ...(user.kind === 'STUDENT' ? { kind: { not: 'STUDENT' } } : {}), OR: [{ name: { contains: term, mode: 'insensitive' } }, { email: { contains: term, mode: 'insensitive' } }] },
      select: { id: true, name: true, kind: true, employee: { select: { designation: { select: { name: true } }, branch: { select: { code: true } } } }, student: { select: { code: true } } },
      orderBy: { name: 'asc' }, take: 40,
    });
    const out = [];
    for (const r of rows) {
      if (out.length >= 15) break;
      if (await this.msg.canDirect(user, r.id)) out.push({ id: r.id, name: r.name, detail: r.employee ? `${r.employee.designation.name} · ${r.employee.branch.code}` : r.student ? `Student · ${r.student.code}` : 'Head office', kind: r.kind });
    }
    return out;
  }

  @Post('direct')
  async direct(@CurrentUser() user: SessionUser, @Body(new Zod(directSchema)) body: { userId: string }) {
    if (!(await this.msg.canDirect(user, body.userId))) {
      throw new ForbiddenException(user.kind === 'STUDENT' ? 'Students can message their teachers and branch staff' : 'You cannot message this person');
    }
    const other = await this.prisma.user.findUniqueOrThrow({ where: { id: body.userId }, select: { kind: true } });
    const key = [user.id, body.userId].sort().join(':');
    const c = await this.prisma.conversation.upsert({
      where: { directKey: key },
      create: { kind: 'DIRECT', directKey: key, createdById: user.id, involvesStudent: user.kind === 'STUDENT' || other.kind === 'STUDENT', members: { create: [{ userId: user.id }, { userId: body.userId }] } },
      update: {},
    });
    return { id: c.id };
  }

  @Post('groups')
  @RequirePerm('messaging.groups')
  async group(@CurrentUser() user: SessionUser, @Body(new Zod(groupSchema)) body: z.infer<typeof groupSchema>) {
    const ids = [...new Set(body.memberIds.filter((x) => x !== user.id))];
    const people = await this.prisma.user.findMany({ where: { id: { in: ids }, status: 'ACTIVE' }, select: { id: true, kind: true } });
    if (people.length !== ids.length) throw new BadRequestException('Someone in the list was not found');
    if (people.some((p) => p.kind === 'STUDENT')) throw new BadRequestException('Staff groups are for staff only. Students talk to you in their batch group.');
    const c = await this.prisma.conversation.create({
      data: { kind: 'GROUP', title: body.title, createdById: user.id, members: { create: [{ userId: user.id, role: 'OWNER' }, ...ids.map((userId) => ({ userId }))] } },
    });
    this.rt.toUsers(ids, 'conversation', { id: c.id });
    return { id: c.id };
  }

  @Get('conversations/:id')
  async get(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    const c = await this.msg.load(id);
    const r = await this.msg.assertRead(user, c);
    const members = await this.prisma.user.findMany({ where: { id: { in: c.members.map((m) => m.userId) } }, select: { id: true, name: true, kind: true } });
    const canManageBatch = c.batch ? (can(user, 'batches.manage', c.batch.branchId) || (!!user.employeeId && c.batch.teachers.some((t) => t.employeeId === user.employeeId))) : false;
    return {
      ...(await this.summary(user, c)),
      moderator: r.moderator, isMember: !!r.member,
      people: c.members.map((m) => ({ ...members.find((u) => u.id === m.userId), role: m.role, lastReadAt: m.lastReadAt })),
      canManage: c.kind === 'GROUP' ? ['OWNER', 'ADMIN'].includes(r.member?.role ?? '') : c.kind === 'BATCH' ? canManageBatch : false,
    };
  }

  @Get('conversations/:id/messages')
  async messages(@CurrentUser() user: SessionUser, @Param('id') id: string, @Query('before') before?: string) {
    const c = await this.msg.load(id);
    const r = await this.msg.assertRead(user, c);
    const rows = await this.prisma.message.findMany({
      where: { conversationId: id, ...(before ? { createdAt: { lt: new Date(before) } } : {}) },
      include: msgInclude, orderBy: { createdAt: 'desc' }, take: 50,
    });
    const out = [];
    for (const m of rows.reverse()) out.push(await this.view(m, r.moderator));
    return { messages: out, more: rows.length === 50 };
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 1024 * 1024 * 1024 } }))
  async upload(@CurrentUser() user: SessionUser, @UploadedFile() file?: Express.Multer.File) {
    const f = await this.files.save(file, { purpose: 'chat', userId: user.id, kinds: ['image', 'pdf', 'office', 'text', 'video'] });
    return { id: f.id, name: f.name, mime: f.mime, sizeBytes: f.sizeBytes };
  }

  @Post('conversations/:id/messages')
  async send(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body(new Zod(messageSchema)) body: z.infer<typeof messageSchema>) {
    const c = await this.msg.load(id);
    await this.msg.assertPost(user, c);
    if (body.fileId) {
      const f = await this.prisma.fileObject.findUnique({ where: { id: body.fileId } });
      if (!f || f.uploadedById !== user.id || f.purpose !== 'chat') throw new BadRequestException('Attach the file again');
    }
    if (body.replyToId && !(await this.prisma.message.count({ where: { id: body.replyToId, conversationId: id } }))) throw new BadRequestException('That message is not in this conversation');
    const now = new Date();
    const m = await this.prisma.$transaction(async (tx) => {
      const created = await tx.message.create({ data: { conversationId: id, senderId: user.id, text: body.text || null, fileId: body.fileId ?? null, replyToId: body.replyToId ?? null }, include: msgInclude });
      await tx.conversation.update({ where: { id }, data: { lastMessageAt: now } });
      await tx.conversationMember.update({ where: { conversationId_userId: { conversationId: id, userId: user.id } }, data: { lastReadAt: now } });
      return created;
    });
    const v = await this.view(m);
    this.rt.toUsers(c.members.map((x) => x.userId), 'message', v);
    return v;
  }

  @Patch(':messageId')
  async edit(@CurrentUser() user: SessionUser, @Param('messageId') messageId: string, @Body(new Zod(messageEditSchema)) body: { text: string }) {
    const m = await this.ownRecent(user, messageId);
    const u = await this.prisma.message.update({ where: { id: m.id }, data: { text: body.text, editedAt: new Date() }, include: msgInclude });
    const v = await this.view(u);
    const c = await this.msg.load(m.conversationId);
    this.rt.toUsers(c.members.map((x) => x.userId), 'message-updated', v);
    return v;
  }

  @Delete(':messageId')
  async remove(@CurrentUser() user: SessionUser, @Param('messageId') messageId: string) {
    const m = await this.ownRecent(user, messageId);
    const u = await this.prisma.message.update({ where: { id: m.id }, data: { deletedAt: new Date() }, include: msgInclude });
    const v = await this.view(u);
    const c = await this.msg.load(m.conversationId);
    this.rt.toUsers(c.members.map((x) => x.userId), 'message-updated', v);
    return v;
  }

  private async ownRecent(user: SessionUser, messageId: string) {
    const m = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!m || m.deletedAt) throw new NotFoundException('Message not found');
    if (m.senderId !== user.id) throw new ForbiddenException('You can only change your own messages');
    const minutes = await this.settings.get('chat.editMinutes');
    if (Date.now() - m.createdAt.getTime() > minutes * 60_000) throw new BadRequestException(`Messages can be changed for ${minutes} minutes after sending`);
    return m;
  }

  @Post('conversations/:id/read')
  @HttpCode(200)
  async read(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    const c = await this.msg.load(id);
    const r = await this.msg.assertRead(user, c);
    if (!r.member) return { ok: true };
    const at = new Date();
    await this.prisma.conversationMember.update({ where: { conversationId_userId: { conversationId: id, userId: user.id } }, data: { lastReadAt: at } });
    this.rt.toUsers(c.members.map((x) => x.userId), 'read', { conversationId: id, userId: user.id, at });
    return { ok: true };
  }

  @Get(':messageId/file')
  async file(@CurrentUser() user: SessionUser, @Param('messageId') messageId: string) {
    const m = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!m?.fileId || m.deletedAt) throw new NotFoundException('File not found');
    const c = await this.msg.load(m.conversationId);
    const r = await this.msg.assertRead(user, c);
    if (m.hiddenAt && !r.moderator) throw new NotFoundException('File not found');
    return { url: this.files.signedUrl(m.fileId, user.id) };
  }

  @Get('search')
  async search(@CurrentUser() user: SessionUser, @Query('q') q = '') {
    const term = q.trim();
    if (term.length < 2) return [];
    const rows = await this.prisma.message.findMany({
      where: { text: { contains: term, mode: 'insensitive' }, deletedAt: null, hiddenAt: null, conversation: { members: { some: { userId: user.id } } } },
      include: { ...msgInclude, conversation: { select: { id: true, kind: true, title: true } } }, orderBy: { createdAt: 'desc' }, take: 30,
    });
    return rows.map((m) => ({ id: m.id, conversationId: m.conversationId, conversationTitle: m.conversation.title, kind: m.conversation.kind, sender: m.sender.name, text: m.text, createdAt: m.createdAt }));
  }

  /** Group owners rename and change members; batch teachers switch "announcements only". */
  @Patch('conversations/:id')
  async update(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body(new Zod(z.object({ title: z.string().trim().min(3).max(80).optional(), announcementsOnly: z.boolean().optional() }))) body: { title?: string; announcementsOnly?: boolean }) {
    const c = await this.msg.load(id);
    const me = c.members.find((m) => m.userId === user.id);
    if (c.kind === 'GROUP') {
      if (!me || !['OWNER', 'ADMIN'].includes(me.role)) throw new ForbiddenException('Only the group owner can change it');
      await this.prisma.conversation.update({ where: { id }, data: { title: body.title ?? c.title } });
    } else if (c.kind === 'BATCH' && c.batch) {
      const ok = can(user, 'batches.manage', c.batch.branchId) || (!!user.employeeId && c.batch.teachers.some((t) => t.employeeId === user.employeeId));
      if (!ok || body.announcementsOnly === undefined) throw new ForbiddenException('Only the batch teacher can change this');
      await this.prisma.$transaction([
        this.prisma.conversation.update({ where: { id }, data: { announcementsOnly: body.announcementsOnly } }),
        this.prisma.batch.update({ where: { id: c.batch.id }, data: { groupAnnounceOnly: body.announcementsOnly } }),
      ]);
    } else throw new ForbiddenException('This conversation cannot be changed');
    this.rt.toUsers(c.members.map((m) => m.userId), 'conversation', { id });
    return { ok: true };
  }

  @Post('conversations/:id/members')
  @HttpCode(200)
  async members(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body(new Zod(groupMembersSchema)) body: z.infer<typeof groupMembersSchema>) {
    const c = await this.msg.load(id);
    const me = c.members.find((m) => m.userId === user.id);
    if (c.kind !== 'GROUP') throw new BadRequestException('Only staff groups have members you can change');
    const leaving = body.remove.length === 1 && body.remove[0] === user.id && !body.add.length;
    if (!leaving && (!me || !['OWNER', 'ADMIN'].includes(me.role))) throw new ForbiddenException('Only the group owner can change members');
    const add = await this.prisma.user.findMany({ where: { id: { in: body.add }, status: 'ACTIVE' }, select: { id: true, kind: true } });
    if (add.some((u) => u.kind === 'STUDENT')) throw new BadRequestException('Staff groups are for staff only');
    await this.prisma.$transaction([
      ...add.map((u) => this.prisma.conversationMember.upsert({ where: { conversationId_userId: { conversationId: id, userId: u.id } }, create: { conversationId: id, userId: u.id }, update: {} })),
      this.prisma.conversationMember.deleteMany({ where: { conversationId: id, userId: { in: body.remove }, ...(leaving ? {} : { role: { not: 'OWNER' } }) } }),
    ]);
    this.rt.toUsers([...c.members.map((m) => m.userId), ...add.map((u) => u.id)], 'conversation', { id });
    return { ok: true };
  }

  // ── Moderation (PRD §12) ──

  @Post(':messageId/hide')
  @HttpCode(200)
  async hide(@CurrentUser() user: SessionUser, @Param('messageId') messageId: string, @Body(new Zod(hideMessageSchema)) body: { reason: string }, @Req() req: Request) {
    return this.setHidden(user, messageId, body.reason, req);
  }

  @Post(':messageId/unhide')
  @HttpCode(200)
  async unhide(@CurrentUser() user: SessionUser, @Param('messageId') messageId: string, @Req() req: Request) {
    return this.setHidden(user, messageId, null, req);
  }

  private async setHidden(user: SessionUser, messageId: string, reason: string | null, req: Request) {
    const m = await this.prisma.message.findUnique({ where: { id: messageId }, include: msgInclude });
    if (!m) throw new NotFoundException('Message not found');
    const c = await this.msg.load(m.conversationId);
    if (!(await this.msg.canModerate(user, c))) throw new ForbiddenException('Only moderators can hide messages');
    const u = await this.prisma.$transaction(async (tx) => {
      const x = await tx.message.update({ where: { id: messageId }, data: reason ? { hiddenAt: new Date(), hiddenById: user.id, hiddenReason: reason } : { hiddenAt: null, hiddenById: null, hiddenReason: null }, include: msgInclude });
      await this.audit.record({
        actorId: user.id, action: reason ? 'moderation.hide' : 'moderation.unhide', entity: 'Message', entityId: messageId, branchId: c.batch?.branchId ?? null,
        summary: reason ? `Hid a message by ${m.sender.name}: ${reason}` : `Showed again a message by ${m.sender.name}`, before: { text: m.text }, ip: clientIp(req) ?? undefined,
      }, tx);
      return x;
    });
    const v = await this.view(u);
    this.rt.toUsers(c.members.map((x) => x.userId), 'message-updated', v);
    return this.view(u, true);
  }

  /** AD14: conversations with students that this moderator may review. */
  @Get('moderation/conversations')
  @RequirePerm('moderation.review')
  async moderation(@CurrentUser() user: SessionUser, @Query('q') q = '') {
    const where: Prisma.ConversationWhereInput = { involvesStudent: true, ...(q.trim() ? { OR: [{ title: { contains: q.trim(), mode: 'insensitive' } }, { members: { some: { user: { name: { contains: q.trim(), mode: 'insensitive' } } } } }] } : {}) };
    const rows = await this.prisma.conversation.findMany({ where, include: { members: true, batch: { include: { teachers: { include: { employee: true } } } } }, orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }], take: 300 });
    const out = [];
    for (const c of rows) {
      if (out.length >= 100) break;
      if (!(await this.msg.canModerate(user, c))) continue;
      const names = await this.prisma.user.findMany({ where: { id: { in: c.members.map((m) => m.userId) } }, select: { name: true }, take: 3 });
      const hidden = await this.prisma.message.count({ where: { conversationId: c.id, hiddenAt: { not: null } } });
      out.push({ id: c.id, kind: c.kind, title: c.kind === 'DIRECT' ? names.map((n) => n.name).join(' ↔ ') : c.title, members: c.members.length, lastMessageAt: c.lastMessageAt, hidden });
    }
    return out;
  }
}
