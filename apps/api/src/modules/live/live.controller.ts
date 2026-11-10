import { BadRequestException, Body, Controller, Delete, Get, Headers, HttpCode, Logger, Param, Post, Query, Req, UnauthorizedException } from '@nestjs/common';
import {
  LIVE_REFUSALS, LiveControlInput, LiveParticipantMeta, SessionUser, liveChatSchema, liveControlSchema, liveGuestSchema, liveHandSchema, parseLiveRoomName,
} from '@cc/shared';
import type { Request } from 'express';
import { CurrentUser, Public } from '../../common/auth';
import { Zod, clientIp } from '../../common/http';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { LiveGateway } from './live.gateway';
import { LiveService } from './live.service';

@Controller('live')
export class LiveController {
  constructor(private live: LiveService, private prisma: PrismaService, private audit: AuditService) {}

  /** Pre-join screen: class details, the viewer's role and whether they may enter now. */
  @Get('sessions/:id')
  async info(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    const a = await this.live.access(user, id);
    const s = a.session;
    const teacher = s.teacher?.user.name ?? s.batch.teachers.find((t) => t.role === 'MAIN')?.employee.user.name ?? null;
    return {
      session: { id: s.id, position: s.position, startsAt: s.startsAt, endsAt: s.endsAt, status: s.status, topic: s.topic, liveStartedAt: s.liveStartedAt },
      batch: { id: s.batchId, name: s.batch.name, mode: s.batch.mode, course: s.batch.course.name, branch: s.batch.branch },
      teacher,
      role: a.role,
      isHost: a.isHost,
      canManageGuests: a.canManageGuests,
      refusal: a.refusal,
      refusalMessage: a.refusal ? LIVE_REFUSALS[a.refusal] : null,
      opensAt: a.opensAt,
      state: this.live.stateOf(s),
    };
  }

  @Post('sessions/:id/join')
  @HttpCode(200)
  join(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.live.join(user, id);
  }

  @Post('sessions/:id/control')
  @HttpCode(200)
  control(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body(new Zod(liveControlSchema)) body: LiveControlInput, @Req() req: Request) {
    return this.live.control(user, id, body, clientIp(req) ?? undefined);
  }

  @Post('sessions/:id/hand')
  @HttpCode(200)
  hand(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body(new Zod(liveHandSchema)) body: { raised: boolean }) {
    return this.live.setHand(user, id, body.raised);
  }

  @Get('sessions/:id/chat')
  chat(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.live.chat(user, id);
  }

  @Post('sessions/:id/chat')
  @HttpCode(201)
  postChat(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body(new Zod(liveChatSchema)) body: { text: string }) {
    return this.live.postChat(user, id, body.text);
  }

  @Get('sessions/:id/people')
  people(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.live.people(user, id);
  }

  /** Staff who can be invited as guests (guest trainer, observer from head office). */
  @Get('sessions/:id/guest-candidates')
  async candidates(@CurrentUser() user: SessionUser, @Param('id') id: string, @Query('q') q = '') {
    await this.live.assertManageGuests(user, id);
    const term = q.trim();
    if (term.length < 2) return [];
    const rows = await this.prisma.user.findMany({
      where: {
        status: 'ACTIVE', kind: { in: ['EMPLOYEE', 'ADMIN', 'SUPER_ADMIN'] }, id: { not: user.id },
        OR: [{ name: { contains: term, mode: 'insensitive' } }, { email: { contains: term, mode: 'insensitive' } }],
      },
      select: { id: true, name: true, kind: true, employee: { select: { designation: { select: { name: true } }, branch: { select: { code: true } } } } },
      orderBy: { name: 'asc' },
      take: 15,
    });
    return rows.map((u) => ({ id: u.id, name: u.name, detail: u.employee ? `${u.employee.designation.name} · ${u.employee.branch.code}` : 'Head office' }));
  }

  @Post('sessions/:id/guests')
  async addGuest(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body(new Zod(liveGuestSchema)) body: { userId: string }, @Req() req: Request) {
    const a = await this.live.assertManageGuests(user, id);
    const guest = await this.prisma.user.findFirst({ where: { id: body.userId, status: 'ACTIVE', kind: { in: ['EMPLOYEE', 'ADMIN', 'SUPER_ADMIN'] } }, select: { id: true, name: true } });
    if (!guest) throw new BadRequestException('Only staff members can be added as guests');
    await this.prisma.$transaction(async (tx) => {
      await tx.sessionGuest.upsert({ where: { sessionId_userId: { sessionId: id, userId: guest.id } }, create: { sessionId: id, userId: guest.id, addedById: user.id }, update: {} });
      await this.audit.record({ actorId: user.id, action: 'live.guest.add', entity: 'Session', entityId: id, branchId: a.session.batch.branchId, summary: `Added ${guest.name} as a guest to ${a.session.batch.name} class ${a.session.position}`, ip: clientIp(req) ?? undefined }, tx);
    });
    return { ok: true };
  }

  @Delete('sessions/:id/guests/:userId')
  async removeGuest(@CurrentUser() user: SessionUser, @Param('id') id: string, @Param('userId') userId: string, @Req() req: Request) {
    const a = await this.live.assertManageGuests(user, id);
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.sessionGuest.deleteMany({ where: { sessionId: id, userId } });
      if (count) await this.audit.record({ actorId: user.id, action: 'live.guest.remove', entity: 'Session', entityId: id, branchId: a.session.batch.branchId, summary: `Removed a guest from ${a.session.batch.name} class ${a.session.position}`, ip: clientIp(req) ?? undefined }, tx);
    });
    return { ok: true };
  }
}

/** The class server tells us who joined and left; attendance is computed from this (CLAUDE.md §6.10). */
@Controller('livekit')
export class LiveWebhookController {
  private log = new Logger('LiveWebhook');
  constructor(private gw: LiveGateway, private prisma: PrismaService) {}

  @Public()
  @Post('webhook')
  @HttpCode(200)
  async webhook(@Req() req: Request, @Headers('authorization') auth?: string) {
    const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
    let ev;
    try {
      ev = await this.gw.receiveWebhook(raw, auth);
    } catch {
      throw new UnauthorizedException('Bad signature');
    }
    const target = ev.room?.name ? parseLiveRoomName(ev.room.name) : null;
    if (!target || target.kind !== 'session') return { ok: true };
    const sessionId = target.id;
    const exists = await this.prisma.session.findUnique({ where: { id: sessionId }, select: { id: true, status: true, endsAt: true, teacherJoinedAt: true } });
    if (!exists) return { ok: true };
    const at = new Date(Number(ev.createdAt ?? 0) * 1000 || Date.now());
    const p = ev.participant;

    if (ev.event === 'participant_joined' && p) {
      let role: string | null = null;
      try { role = (JSON.parse(p.metadata || '{}') as LiveParticipantMeta).role ?? null; } catch { /* ignore */ }
      const joinedAt = p.joinedAt ? new Date(Number(p.joinedAt) * 1000) : at;
      const user = await this.prisma.user.findUnique({ where: { id: p.identity }, select: { id: true } });
      if (!user) return { ok: true };
      await this.prisma.presenceInterval.upsert({ where: { participantSid: p.sid }, create: { sessionId, userId: p.identity, joinedAt, participantSid: p.sid, role }, update: {} });
      if (role === 'teacher') {
        await this.prisma.session.updateMany({ where: { id: sessionId, teacherJoinedAt: null }, data: { teacherJoinedAt: joinedAt } });
        await this.prisma.session.updateMany({ where: { id: sessionId, status: 'SCHEDULED' }, data: { status: 'LIVE', liveStartedAt: joinedAt } });
      }
    } else if (ev.event === 'participant_left' && p) {
      await this.prisma.presenceInterval.updateMany({ where: { participantSid: p.sid, leftAt: null }, data: { leftAt: at } });
    } else if (ev.event === 'room_finished') {
      await this.prisma.presenceInterval.updateMany({ where: { sessionId, leftAt: null }, data: { leftAt: at } });
      if (exists.status === 'LIVE' && at >= exists.endsAt) await this.prisma.session.update({ where: { id: sessionId }, data: { status: 'COMPLETED', liveEndedAt: at } });
    }
    this.log.debug(`${ev.event} ${ev.room?.name} ${p?.identity ?? ''}`);
    return { ok: true };
  }
}
