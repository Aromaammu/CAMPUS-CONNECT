import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { LIVE_REFUSALS, LiveChatMessage, LiveControlInput, LiveParticipantMeta, LiveRefusal, LiveRole, LiveRoomState, SessionUser, liveRoomName } from '@cc/shared';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit.service';
import { PrismaService } from '../../common/prisma.service';
import { SettingsService } from '../../common/settings.service';
import { LiveGateway, LiveParticipant, Permission } from '../live/live.gateway';

interface MeetingState extends LiveRoomState { removedUserIds: string[] }
const EMPTY: MeetingState = { chatDisabled: false, locked: false, micAllowed: true, camAllowed: true, shareUserIds: [], board: false, penUserIds: [], recording: false, removedUserIds: [] };
const FULL: Permission = { canPublish: true, canSubscribe: true, canPublishData: true, canPublishSources: ['microphone', 'camera', 'screen_share', 'screen_share_audio'] };
/** Meeting wording for the same refusal reasons. */
const MEETING_REFUSALS: Partial<Record<LiveRefusal, string>> = {
  NOT_ALLOWED: 'Only people invited to this meeting can join it.',
  CANCELLED: 'This meeting was cancelled.',
  TOO_EARLY: 'This meeting has not opened yet.',
  ENDED: 'This meeting has ended.',
  LOCKED: 'The host has locked this meeting.',
  REMOVED: 'The host removed you from this meeting.',
  NETWORK_FULL: LIVE_REFUSALS.NETWORK_FULL,
};
const refusalText = (r: LiveRefusal) => MEETING_REFUSALS[r] ?? LIVE_REFUSALS[r];
const meetingInclude = { host: { select: { id: true, name: true } }, participants: { select: { userId: true } } } satisfies Prisma.MeetingInclude;
type MeetingFull = Prisma.MeetingGetPayload<{ include: typeof meetingInclude }>;

/**
 * Staff meetings (PRD §7.3) in the same room as classes: video, screen share, chat, polls, whiteboard.
 * The host has teacher controls; everyone else joins as a guest. No attendance.
 */
@Injectable()
export class MeetingsService {
  constructor(private prisma: PrismaService, private gw: LiveGateway, private settings: SettingsService, private audit: AuditService) {}

  room(id: string) { return liveRoomName('meeting', id); }
  state(m: { state: Prisma.JsonValue }): MeetingState { return { ...EMPTY, ...((m.state ?? {}) as Partial<MeetingState>) }; }
  publicState(s: MeetingState): LiveRoomState { const { removedUserIds: _r, ...rest } = s; void _r; return rest; }

  async load(id: string): Promise<MeetingFull> {
    const m = await this.prisma.meeting.findUnique({ where: { id }, include: meetingInclude });
    if (!m) throw new NotFoundException('Meeting not found');
    return m;
  }

  /** Invited people, the host, and members of the chat it was started from. */
  async invited(m: MeetingFull) {
    const ids = new Set([m.hostId, ...m.participants.map((p) => p.userId)]);
    if (m.conversationId) (await this.prisma.conversationMember.findMany({ where: { conversationId: m.conversationId }, select: { userId: true } })).forEach((x) => ids.add(x.userId));
    return ids;
  }

  window(m: MeetingFull) {
    const start = m.scheduledAt ?? m.createdAt;
    return { start, end: new Date(start.getTime() + m.durationMin * 60_000), opensAt: new Date(start.getTime() - 15 * 60_000) };
  }

  async access(user: SessionUser, id: string) {
    const m = await this.load(id);
    const invited = await this.invited(m);
    if (!invited.has(user.id)) throw new ForbiddenException({ message: 'Only people invited to this meeting can join it.', code: 'NOT_ALLOWED' });
    const role: LiveRole = m.hostId === user.id ? 'teacher' : 'guest';
    const st = this.state(m);
    const w = this.window(m);
    const now = new Date();
    let refusal: LiveRefusal | null = null;
    if (m.cancelledAt) refusal = 'CANCELLED';
    else if (m.status === 'ENDED') refusal = 'ENDED';
    else if (m.status !== 'LIVE' && m.scheduledAt && now < w.opensAt) refusal = 'TOO_EARLY';
    else if (m.status !== 'LIVE' && now.getTime() > w.end.getTime() + 60 * 60_000) refusal = 'ENDED';
    else if (role !== 'teacher' && st.removedUserIds.includes(user.id)) refusal = 'REMOVED';
    else if (role !== 'teacher' && st.locked && m.status === 'LIVE') refusal = 'LOCKED';
    return { m, role, isHost: role === 'teacher', refusal, opensAt: w.opensAt, st, invited };
  }

  /** Same shape as a class's pre-join info, so the class room screens serve meetings too. */
  async info(user: SessionUser, id: string) {
    const a = await this.access(user, id);
    const w = this.window(a.m);
    return {
      kind: 'meeting', base: `/live/meetings/${id}`,
      session: { id, position: 0, startsAt: w.start, endsAt: w.end, status: a.m.cancelledAt ? 'CANCELLED' : a.m.status === 'ENDED' ? 'COMPLETED' : a.m.status, topic: null, liveStartedAt: a.m.startedAt },
      batch: { id: '', name: a.m.title, mode: 'ONLINE', course: 'Staff meeting', branch: { id: '', code: '', name: `Host: ${a.m.host.name}` } },
      teacher: a.m.host.name, role: a.role, isHost: a.isHost, canManageGuests: false,
      refusal: a.refusal, refusalMessage: a.refusal ? refusalText(a.refusal) : null,
      opensAt: a.opensAt, state: this.publicState(a.st),
    };
  }

  async join(user: SessionUser, id: string) {
    const a = await this.access(user, id);
    if (a.refusal) throw new ForbiddenException({ message: refusalText(a.refusal), code: a.refusal });
    const room = this.room(id);
    if (a.m.status !== 'LIVE') {
      const max = await this.settings.get('live.maxRooms');
      const live = (await this.prisma.session.count({ where: { status: 'LIVE' } })) + (await this.prisma.meeting.count({ where: { status: 'LIVE', id: { not: id } } }));
      if (live >= max) throw new ForbiddenException({ message: refusalText('NETWORK_FULL'), code: 'NETWORK_FULL' });
    }
    await this.gw.ensureRoom(room, (await this.settings.get('live.maxPerRoom')) + 10, JSON.stringify(this.publicState(a.st)));
    if (a.isHost && a.m.status !== 'LIVE') await this.prisma.meeting.update({ where: { id }, data: { status: 'LIVE', startedAt: a.m.startedAt ?? new Date() } });
    const meta: LiveParticipantMeta = { role: a.role };
    const token = await this.gw.token({ room, identity: user.id, name: user.name, metadata: JSON.stringify(meta), perm: FULL, roomAdmin: a.isHost });
    return { token, url: this.gw.publicUrl, room, role: a.role, identity: user.id, isHost: a.isHost };
  }

  private async saveState(id: string, st: MeetingState, live: boolean) {
    await this.prisma.meeting.update({ where: { id }, data: { state: st as unknown as Prisma.InputJsonValue } });
    if (live) await this.gw.setRoomMetadata(this.room(id), JSON.stringify(this.publicState(st)));
  }

  async control(user: SessionUser, id: string, input: LiveControlInput) {
    const a = await this.access(user, id);
    if (!a.isHost) throw new ForbiddenException('Only the host can do this');
    const room = this.room(id);
    const st = { ...a.st };
    const target = input.identity;
    const people = async () => this.gw.participants(room);
    const mute = async (list: LiveParticipant[], sources: string[]) => { for (const p of list) for (const t of p.tracks) if (sources.includes(t.source) && !t.muted) await this.gw.muteTrack(room, p.identity, t.sid); };
    const one = async () => (await people()).filter((p) => p.identity === target);
    switch (input.action) {
      case 'mute': await mute(await one(), ['microphone']); break;
      case 'camera-off': await mute(await one(), ['camera']); break;
      case 'stop-share': await mute(await one(), ['screen_share', 'screen_share_audio']); break;
      case 'mute-all': await mute((await people()).filter((p) => p.identity !== user.id), ['microphone']); break;
      case 'remove':
        if (target === a.m.hostId) throw new ForbiddenException('You cannot remove the host');
        st.removedUserIds = [...new Set([...st.removedUserIds, target!])];
        st.penUserIds = st.penUserIds.filter((x) => x !== target);
        if ((await one()).length) await this.gw.remove(room, target!);
        break;
      case 'let-back': st.removedUserIds = st.removedUserIds.filter((x) => x !== target); break;
      case 'lower-hand': if ((await one()).length) await this.gw.updateParticipant(room, target!, { attributes: { hand: '' } }); break;
      case 'lower-all-hands': for (const p of await people()) if (p.attributes.hand) await this.gw.updateParticipant(room, p.identity, { attributes: { hand: '' } }); break;
      case 'lock': st.locked = true; break;
      case 'unlock': st.locked = false; break;
      case 'chat-off': st.chatDisabled = true; break;
      case 'chat-on': st.chatDisabled = false; break;
      case 'board-open': st.board = true; break;
      case 'board-close': st.board = false; st.penUserIds = []; break;
      case 'pen-give': st.penUserIds = [...new Set([...st.penUserIds, target!])]; break;
      case 'pen-take': st.penUserIds = st.penUserIds.filter((x) => x !== target); break;
      case 'end': {
        await this.prisma.meeting.update({ where: { id }, data: { status: 'ENDED', endedAt: new Date() } });
        await this.gw.send(room, 'notice', { type: 'ended', by: user.name }).catch(() => undefined);
        await this.gw.closeRoom(room);
        await this.audit.record({ actorId: user.id, action: 'meeting.end', entity: 'Meeting', entityId: id, summary: `Ended the meeting "${a.m.title}"` });
        return { state: this.publicState(st), removedUserIds: st.removedUserIds, ended: true };
      }
      default: throw new BadRequestException('That control is not available in meetings');
    }
    await this.saveState(id, st, a.m.status === 'LIVE');
    return { state: this.publicState(st), removedUserIds: st.removedUserIds };
  }

  async hand(user: SessionUser, id: string, raised: boolean) {
    const a = await this.access(user, id);
    if (a.refusal) throw new ForbiddenException(refusalText(a.refusal));
    await this.gw.updateParticipant(this.room(id), user.id, { attributes: { hand: raised ? String(Date.now()) : '' } });
    return { raised };
  }

  async chat(user: SessionUser, id: string): Promise<LiveChatMessage[]> {
    const a = await this.access(user, id);
    const rows = await this.prisma.classChatMessage.findMany({ where: { meetingId: id, hiddenAt: null }, orderBy: { createdAt: 'desc' }, take: 300, include: { user: { select: { name: true } } } });
    return rows.reverse().map((m) => ({ id: m.id, userId: m.userId, name: m.user.name, text: m.text, createdAt: m.createdAt.toISOString(), role: m.userId === a.m.hostId ? 'teacher' : 'guest' }));
  }

  async postChat(user: SessionUser, id: string, text: string): Promise<LiveChatMessage> {
    const a = await this.access(user, id);
    if (a.refusal) throw new ForbiddenException(refusalText(a.refusal));
    if (a.st.chatDisabled && !a.isHost) throw new ForbiddenException('The host has turned off chat');
    const m = await this.prisma.classChatMessage.create({ data: { meetingId: id, userId: user.id, text } });
    const msg: LiveChatMessage = { id: m.id, userId: user.id, name: user.name, role: a.role, text, createdAt: m.createdAt.toISOString() };
    await this.gw.send(this.room(id), 'chat', msg);
    return msg;
  }

  /** People panel: invited people who are not in the room right now. */
  async people(user: SessionUser, id: string) {
    const a = await this.access(user, id);
    if (!a.isHost) throw new ForbiddenException('Only the host can see this');
    const here = new Set((await this.gw.participants(this.room(id))).map((p) => p.identity));
    const users = await this.prisma.user.findMany({ where: { id: { in: [...a.invited] } }, select: { id: true, name: true, email: true } });
    return {
      students: users.filter((u) => u.id !== a.m.hostId).map((u) => ({ userId: u.id, name: u.name, code: u.email ?? '', inRoom: here.has(u.id), firstJoinAt: null, lastLeftAt: null, seconds: 0, removed: a.st.removedUserIds.includes(u.id) })),
      guests: [], removedUserIds: a.st.removedUserIds,
    };
  }
}
