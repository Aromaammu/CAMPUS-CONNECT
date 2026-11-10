import { BadRequestException, Body, Controller, ForbiddenException, Get, Global, HttpCode, Module, Param, Post, Query } from '@nestjs/common';
import { LiveControlInput, MeetingInput, SessionUser, formatDateTime, liveChatSchema, liveControlSchema, liveHandSchema, meetingSchema } from '@cc/shared';
import { Prisma } from '@prisma/client';
import { CurrentUser, RequirePerm } from '../../common/auth';
import { Zod } from '../../common/http';
import { PrismaService } from '../../common/prisma.service';
import { NotifyService } from '../notifications/notify.service';
import { MessagingService } from '../messaging/messaging.service';
import { MeetingsService } from './meetings.service';

/** C6 Staff meetings: instant or scheduled, or a call started from a chat. */
@Controller('meetings')
export class MeetingsController {
  constructor(private prisma: PrismaService, private meetings: MeetingsService, private notify: NotifyService, private messaging: MessagingService) {}

  @Post()
  @RequirePerm('meetings.host')
  async create(@CurrentUser() user: SessionUser, @Body(new Zod(meetingSchema)) body: MeetingInput) {
    let participantIds = [...new Set(body.participantIds.filter((x) => x !== user.id))];
    if (body.conversationId) {
      const c = await this.messaging.load(body.conversationId);
      if (!c.members.some((m) => m.userId === user.id)) throw new ForbiddenException('You are not in this conversation');
    } else {
      const people = await this.prisma.user.findMany({ where: { id: { in: participantIds }, status: 'ACTIVE' }, select: { id: true, kind: true } });
      if (people.length !== participantIds.length) throw new BadRequestException('Someone in the list was not found');
      if (people.some((p) => p.kind === 'STUDENT')) throw new BadRequestException('Staff meetings are for staff. Start a call from a chat to talk with a student.');
      if (!participantIds.length) throw new BadRequestException('Invite at least one person');
    }
    if (body.scheduledAt && new Date(body.scheduledAt).getTime() < Date.now() - 5 * 60_000) throw new BadRequestException('Choose a time in the future');
    const m = await this.prisma.meeting.create({
      data: {
        title: body.title, hostId: user.id, scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : null, durationMin: body.durationMin,
        conversationId: body.conversationId ?? null, record: body.record, participants: { create: participantIds.map((userId) => ({ userId })) },
      },
    });
    const invited = [...(await this.meetings.invited(await this.meetings.load(m.id)))].filter((x) => x !== user.id);
    participantIds = invited;
    await this.notify.sendMany(participantIds, {
      type: 'MEETING', title: body.scheduledAt ? `${user.name} invited you to "${body.title}"` : `${user.name} started "${body.title}". Join now`,
      body: body.scheduledAt ? formatDateTime(body.scheduledAt) : undefined, link: `/meet/${m.id}`, email: !!body.scheduledAt,
    });
    return { id: m.id };
  }

  @Get()
  async list(@CurrentUser() user: SessionUser, @Query('when') when: 'upcoming' | 'past' = 'upcoming') {
    const convs = (await this.prisma.conversationMember.findMany({ where: { userId: user.id }, select: { conversationId: true } })).map((c) => c.conversationId);
    const mine = { OR: [{ hostId: user.id }, { participants: { some: { userId: user.id } } }, { conversationId: { in: convs } }] };
    const recent = new Date(Date.now() - 12 * 3600_000);
    const where: Prisma.MeetingWhereInput = when === 'upcoming'
      ? { AND: [mine, { cancelledAt: null }, { status: { not: 'ENDED' } }, { OR: [{ scheduledAt: { gte: recent } }, { scheduledAt: null, createdAt: { gte: recent } }, { status: 'LIVE' }] }] }
      : { AND: [mine, { OR: [{ status: 'ENDED' }, { cancelledAt: { not: null } }] }] };
    const rows = await this.prisma.meeting.findMany({ where, include: { host: { select: { name: true } }, _count: { select: { participants: true } } }, orderBy: when === 'upcoming' ? { scheduledAt: 'asc' } : { createdAt: 'desc' }, take: 100 });
    return rows.map((m) => ({ id: m.id, title: m.title, host: m.host.name, isHost: m.hostId === user.id, scheduledAt: m.scheduledAt, durationMin: m.durationMin, status: m.cancelledAt ? 'CANCELLED' : m.status, startedAt: m.startedAt, endedAt: m.endedAt, invited: m._count.participants + 1, fromChat: !!m.conversationId, createdAt: m.createdAt }));
  }

  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    const m = await this.meetings.load(id);
    if (m.hostId !== user.id) throw new ForbiddenException('Only the host can cancel the meeting');
    if (m.status !== 'SCHEDULED') throw new BadRequestException('Only meetings that have not started can be cancelled');
    await this.prisma.meeting.update({ where: { id }, data: { cancelledAt: new Date() } });
    const invited = [...(await this.meetings.invited(m))].filter((x) => x !== user.id);
    await this.notify.sendMany(invited, { type: 'MEETING', title: `Meeting cancelled: ${m.title}`, link: '/meetings', email: true });
    return { ok: true };
  }
}

/** The class room endpoints, for a meeting room. */
@Controller('live/meetings/:id')
export class MeetingRoomController {
  constructor(private meetings: MeetingsService) {}

  @Get() info(@CurrentUser() user: SessionUser, @Param('id') id: string) { return this.meetings.info(user, id); }
  @Post('join') @HttpCode(200) join(@CurrentUser() user: SessionUser, @Param('id') id: string) { return this.meetings.join(user, id); }
  @Post('control') @HttpCode(200) control(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body(new Zod(liveControlSchema)) body: LiveControlInput) { return this.meetings.control(user, id, body); }
  @Post('hand') @HttpCode(200) hand(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body(new Zod(liveHandSchema)) body: { raised: boolean }) { return this.meetings.hand(user, id, body.raised); }
  @Get('chat') chat(@CurrentUser() user: SessionUser, @Param('id') id: string) { return this.meetings.chat(user, id); }
  @Post('chat') postChat(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body(new Zod(liveChatSchema)) body: { text: string }) { return this.meetings.postChat(user, id, body.text); }
  @Get('people') people(@CurrentUser() user: SessionUser, @Param('id') id: string) { return this.meetings.people(user, id); }
}

@Global()
@Module({ controllers: [MeetingsController, MeetingRoomController], providers: [MeetingsService], exports: [MeetingsService] })
export class MeetingsModule {}
