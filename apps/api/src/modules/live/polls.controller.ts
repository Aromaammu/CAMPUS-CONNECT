import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, HttpCode, NotFoundException, Param, Post } from '@nestjs/common';
import { PollInput, PollView, SessionUser, pollSchema, pollVoteSchema } from '@cc/shared';
import { z } from 'zod';
import { CurrentUser } from '../../common/auth';
import { Zod } from '../../common/http';
import { PrismaService } from '../../common/prisma.service';
import { LiveGateway } from './live.gateway';
import { LiveService } from './live.service';

type PollRow = { id: string; question: string; options: string[]; multi: boolean; status: string; showResults: boolean; createdAt: Date; votes: { userId: string; choices: number[] }[] };

function tally(p: PollRow) {
  const counts = p.options.map(() => 0);
  for (const v of p.votes) for (const c of v.choices) if (c < counts.length) counts[c]++;
  return counts;
}

/** Live polls: teacher asks, students answer, results live; all saved with the class (PRD §7.2). */
@Controller('live')
export class PollsController {
  constructor(private prisma: PrismaService, private live: LiveService, private gw: LiveGateway) {}

  view(p: PollRow, userId: string, host: boolean): PollView {
    const mine = p.votes.find((v) => v.userId === userId);
    const visible = host || p.showResults;
    return {
      id: p.id, question: p.question, options: p.options, multi: p.multi, status: p.status as PollView['status'], showResults: p.showResults, createdAt: p.createdAt.toISOString(),
      counts: visible ? tally(p) : null, voters: visible ? p.votes.length : null, myChoices: mine?.choices ?? null,
    };
  }

  private async pollFor(user: SessionUser, pollId: string) {
    const p = await this.prisma.poll.findUnique({ where: { id: pollId }, include: { votes: true } });
    if (!p || !p.sessionId) throw new NotFoundException('Poll not found');
    const a = await this.live.access(user, p.sessionId);
    return { p, a };
  }

  /** Tell the room something changed: full results to everyone if they may see them, otherwise only to teachers. */
  private async broadcast(p: PollRow & { sessionId: string | null }, teacherIds: string[], kind: 'poll' | 'poll-update') {
    const room = this.live.roomOf(p.sessionId!);
    const payload = { type: kind, pollId: p.id, status: p.status, counts: tally(p), voters: p.votes.length };
    if (kind === 'poll' || p.showResults) await this.gw.send(room, 'notice', payload).catch(() => undefined);
    else await this.gw.send(room, 'notice', payload, teacherIds).catch(() => undefined);
  }

  @Get('sessions/:id/polls')
  async list(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    const a = await this.live.access(user, id);
    const host = a.isHost || a.canManageGuests;
    const polls = await this.prisma.poll.findMany({ where: { sessionId: id }, include: { votes: true }, orderBy: { createdAt: 'desc' } });
    return polls.map((p) => this.view(p, user.id, host));
  }

  @Post('sessions/:id/polls')
  async create(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body(new Zod(pollSchema)) body: PollInput) {
    const a = await this.live.access(user, id);
    if (!a.isHost) throw new ForbiddenException('Only the teacher can start a poll');
    if (a.session.status !== 'LIVE') throw new BadRequestException('Start the class first');
    const p = await this.prisma.$transaction(async (tx) => {
      // One question at a time: starting a poll closes the previous one.
      await tx.poll.updateMany({ where: { sessionId: id, status: 'OPEN' }, data: { status: 'CLOSED', closedAt: new Date() } });
      if (body.saveTemplate) await tx.pollTemplate.create({ data: { ownerId: user.id, question: body.question, options: body.options, multi: body.multi } });
      return tx.poll.create({ data: { sessionId: id, createdById: user.id, question: body.question, options: body.options, multi: body.multi, showResults: body.showResults }, include: { votes: true } });
    });
    await this.broadcast(p, this.live.teacherUserIds(a.session), 'poll');
    return this.view(p, user.id, true);
  }

  @Post('polls/:pollId/vote')
  @HttpCode(200)
  async vote(@CurrentUser() user: SessionUser, @Param('pollId') pollId: string, @Body(new Zod(pollVoteSchema)) body: z.infer<typeof pollVoteSchema>) {
    const { p, a } = await this.pollFor(user, pollId);
    if (a.refusal) throw new ForbiddenException('You are not in this class');
    if (a.role === 'observer' || a.role === 'teacher') throw new ForbiddenException('Only students and guests answer polls');
    if (p.status !== 'OPEN') throw new BadRequestException('This poll has closed');
    const choices = [...new Set(body.choices)].sort();
    if (choices.some((c) => c >= p.options.length)) throw new BadRequestException('Choose one of the answers');
    if (!p.multi && choices.length !== 1) throw new BadRequestException('Choose one answer');
    await this.prisma.pollVote.upsert({ where: { pollId_userId: { pollId, userId: user.id } }, create: { pollId, userId: user.id, choices }, update: { choices, at: new Date() } });
    const fresh = await this.prisma.poll.findUniqueOrThrow({ where: { id: pollId }, include: { votes: true } });
    await this.broadcast(fresh, this.live.teacherUserIds(a.session), 'poll-update');
    return this.view(fresh, user.id, false);
  }

  @Post('polls/:pollId/close')
  @HttpCode(200)
  async close(@CurrentUser() user: SessionUser, @Param('pollId') pollId: string) {
    const { a } = await this.pollFor(user, pollId);
    if (!a.isHost) throw new ForbiddenException('Only the teacher can close a poll');
    const p = await this.prisma.poll.update({ where: { id: pollId }, data: { status: 'CLOSED', closedAt: new Date() }, include: { votes: true } });
    await this.broadcast(p, this.live.teacherUserIds(a.session), 'poll');
    return this.view(p, user.id, true);
  }

  @Post('polls/:pollId/results')
  @HttpCode(200)
  async results(@CurrentUser() user: SessionUser, @Param('pollId') pollId: string, @Body(new Zod(z.object({ showResults: z.boolean() }))) body: { showResults: boolean }) {
    const { a } = await this.pollFor(user, pollId);
    if (!a.isHost) throw new ForbiddenException('Only the teacher can change this');
    const p = await this.prisma.poll.update({ where: { id: pollId }, data: { showResults: body.showResults }, include: { votes: true } });
    await this.broadcast(p, this.live.teacherUserIds(a.session), 'poll');
    return this.view(p, user.id, true);
  }

  @Get('poll-templates')
  templates(@CurrentUser() user: SessionUser) {
    return this.prisma.pollTemplate.findMany({ where: { ownerId: user.id }, orderBy: { createdAt: 'desc' }, take: 50 });
  }

  @Delete('poll-templates/:id')
  async deleteTemplate(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    const { count } = await this.prisma.pollTemplate.deleteMany({ where: { id, ownerId: user.id } });
    if (!count) throw new NotFoundException('Saved poll not found');
    return { ok: true };
  }
}
