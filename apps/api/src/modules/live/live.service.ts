import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  LIVE_REFUSALS, LiveChatMessage, LiveControlInput, LiveParticipantMeta, LiveRefusal, LiveRole, LiveRoomState, SessionUser, can, liveRoomName, presenceSeconds,
} from '@cc/shared';
import { AuditService } from '../../common/audit.service';
import { PrismaService } from '../../common/prisma.service';
import { SettingsService } from '../../common/settings.service';
import { LiveGateway, LiveParticipant, Permission } from './live.gateway';

const sessionInclude = {
  batch: { include: { course: { select: { name: true, code: true } }, branch: { select: { id: true, code: true, name: true } }, teachers: { include: { employee: { include: { user: { select: { id: true, name: true } } } } } } } },
  teacher: { include: { user: { select: { id: true, name: true } } } },
} as const;

type LoadedSession = NonNullable<Awaited<ReturnType<LiveService['load']>>>;

export interface LiveAccess {
  session: LoadedSession;
  role: LiveRole;
  isHost: boolean;
  canManageGuests: boolean;
  refusal: LiveRefusal | null;
  opensAt: Date;
  studentCode: string | null;
}

const refuse = (code: LiveRefusal, extra: Record<string, unknown> = {}) => new ForbiddenException({ message: LIVE_REFUSALS[code], code, ...extra });

const roleOf = (p: LiveParticipant): LiveRole | null => {
  try {
    return (JSON.parse(p.metadata || '{}') as LiveParticipantMeta).role ?? null;
  } catch {
    return null;
  }
};

@Injectable()
export class LiveService {
  constructor(private prisma: PrismaService, private settings: SettingsService, private audit: AuditService, private gw: LiveGateway) {}

  load(id: string) {
    return this.prisma.session.findUnique({ where: { id }, include: sessionInclude });
  }

  roomOf(sessionId: string) {
    return liveRoomName('session', sessionId);
  }

  stateOf(s: { chatDisabled: boolean; locked: boolean; micAllowed: boolean; camAllowed: boolean; shareUserIds: string[] }): LiveRoomState {
    return { chatDisabled: s.chatDisabled, locked: s.locked, micAllowed: s.micAllowed, camAllowed: s.camAllowed, shareUserIds: s.shareUserIds };
  }

  teacherUserIds(s: LoadedSession) {
    const ids = s.batch.teachers.map((t) => t.employee.user.id);
    if (s.teacher) ids.push(s.teacher.user.id);
    return ids;
  }

  /** Works out who this person is in the class and whether they may enter right now (PRD §7.1). */
  async access(user: SessionUser, sessionId: string): Promise<LiveAccess> {
    const s = await this.load(sessionId);
    if (!s) throw new NotFoundException('Class not found');
    const branchId = s.batch.branchId;
    let role: LiveRole | null = null;
    let studentCode: string | null = null;
    let enrolmentInactive = false;

    if (user.employeeId && (s.teacherId === user.employeeId || s.batch.teachers.some((t) => t.employeeId === user.employeeId))) role = 'teacher';
    if (!role && user.studentId) {
      const e = await this.prisma.enrolment.findUnique({ where: { studentId_batchId: { studentId: user.studentId, batchId: s.batchId } }, include: { student: { select: { code: true } } } });
      if (e && e.status === 'ACTIVE') { role = 'student'; studentCode = e.student.code; }
      else if (e && e.status !== 'MOVED') enrolmentInactive = true;
    }
    if (!role && (await this.prisma.sessionGuest.count({ where: { sessionId, userId: user.id } }))) role = 'guest';
    const oversees = can(user, 'attendance.oversee', branchId);
    if (!role && user.kind !== 'STUDENT' && (oversees || can(user, 'reports.view', branchId))) role = 'observer';
    if (!role) throw refuse(enrolmentInactive ? 'NOT_ACTIVE' : 'NOT_ALLOWED');

    const isHost = role === 'teacher' || (role === 'observer' && oversees);
    const canManageGuests = role === 'teacher' || can(user, 'batches.manage', branchId);
    const set = await this.settings.all();
    const early = role === 'student' ? set['live.studentEarlyMinutes'] : set['live.teacherEarlyMinutes'];
    const opensAt = new Date(s.startsAt.getTime() - early * 60_000);
    const now = new Date();

    let refusal: LiveRefusal | null = null;
    if (s.status === 'CANCELLED') refusal = 'CANCELLED';
    else if (s.batch.mode === 'OFFLINE') refusal = 'OFFLINE';
    else if (s.status === 'COMPLETED') refusal = role === 'teacher' && now < s.endsAt ? null : 'ENDED';
    else if (s.status === 'SCHEDULED') refusal = now < opensAt ? 'TOO_EARLY' : now > s.endsAt ? 'ENDED' : null;

    if (!refusal && (role === 'student' || role === 'guest')) {
      if (s.removedUserIds.includes(user.id)) refusal = 'REMOVED';
      else if (s.locked && !(await this.prisma.presenceInterval.count({ where: { sessionId, userId: user.id } }))) refusal = 'LOCKED';
    }
    return { session: s, role, isHost, canManageGuests, refusal, opensAt, studentCode };
  }

  permissionFor(role: LiveRole, state: LiveRoomState, userId: string): Permission {
    if (role === 'observer') return { canPublish: false, canSubscribe: true, canPublishData: false, canPublishSources: [], hidden: true };
    if (role === 'teacher' || role === 'guest') return { canPublish: true, canSubscribe: true, canPublishData: true, canPublishSources: ['microphone', 'camera', 'screen_share', 'screen_share_audio'] };
    const sources: Permission['canPublishSources'] = [];
    if (state.micAllowed) sources.push('microphone');
    if (state.camAllowed) sources.push('camera');
    if (state.shareUserIds.includes(userId)) sources.push('screen_share', 'screen_share_audio');
    return { canPublish: sources.length > 0, canSubscribe: true, canPublishData: true, canPublishSources: sources };
  }

  /** Mints the class-server pass after every entry rule passes. */
  async join(user: SessionUser, sessionId: string) {
    const a = await this.access(user, sessionId);
    if (a.refusal) throw refuse(a.refusal, a.refusal === 'TOO_EARLY' ? { opensAt: a.opensAt } : {});
    const s = a.session;
    const set = await this.settings.all();
    const room = this.roomOf(s.id);
    if (s.status !== 'LIVE') {
      const live = await this.prisma.session.count({ where: { status: 'LIVE', id: { not: s.id } } });
      if (live >= set['live.maxRooms']) throw refuse('NETWORK_FULL');
    } else if (a.role !== 'teacher' && a.role !== 'observer') {
      const inRoom = (await this.gw.participants(room)).filter((p) => p.identity !== user.id && roleOf(p) !== 'observer').length;
      if (inRoom >= set['live.maxPerRoom']) throw refuse('ROOM_FULL');
    }
    const state = this.stateOf(s);
    // Head-room above the class cap for teachers and silent observers.
    await this.gw.ensureRoom(room, set['live.maxPerRoom'] + 10, JSON.stringify(state));
    if (a.role === 'teacher' && s.status !== 'LIVE') {
      const now = new Date();
      await this.prisma.session.update({ where: { id: s.id }, data: { status: 'LIVE', liveStartedAt: s.liveStartedAt ?? now, liveEndedAt: null } });
    }
    const meta: LiveParticipantMeta = { role: a.role, ...(a.studentCode ? { code: a.studentCode } : {}) };
    const token = await this.gw.token({
      room, identity: user.id, name: user.name, metadata: JSON.stringify(meta), perm: this.permissionFor(a.role, state, user.id), roomAdmin: a.isHost,
    });
    return { token, url: this.gw.publicUrl, room, role: a.role, identity: user.id, isHost: a.isHost };
  }

  /** Teacher controls (PRD §7.2). */
  async control(user: SessionUser, sessionId: string, input: LiveControlInput, ip?: string) {
    const a = await this.access(user, sessionId);
    if (!a.isHost) throw new ForbiddenException('Only the teacher can do this');
    const s = a.session;
    const room = this.roomOf(s.id);
    const teacherIds = this.teacherUserIds(s);
    const target = input.identity;
    if (target && teacherIds.includes(target) && ['remove', 'mute', 'camera-off', 'stop-share'].includes(input.action) && target !== user.id) {
      throw new ForbiddenException('You cannot do that to a teacher');
    }
    const people = () => this.gw.participants(room);
    const muteSources = async (list: LiveParticipant[], sources: string[]) => {
      for (const p of list) for (const t of p.tracks) if (sources.includes(t.source) && !t.muted) await this.gw.muteTrack(room, p.identity, t.sid);
    };
    const students = (list: LiveParticipant[]) => list.filter((p) => roleOf(p) === 'student');
    const one = async () => (await people()).filter((p) => p.identity === target);
    const data: Partial<{ chatDisabled: boolean; locked: boolean; micAllowed: boolean; camAllowed: boolean; shareUserIds: string[]; removedUserIds: string[] }> = {};
    let state = this.stateOf(s);
    const refreshPerms = async (list: LiveParticipant[]) => {
      for (const p of list) await this.gw.updateParticipant(room, p.identity, { permission: this.permissionFor('student', state, p.identity) });
    };

    switch (input.action) {
      case 'mute': await muteSources(await one(), ['microphone']); break;
      case 'camera-off': await muteSources(await one(), ['camera']); break;
      case 'stop-share':
      case 'share-revoke': {
        data.shareUserIds = s.shareUserIds.filter((x) => x !== target);
        state = { ...state, shareUserIds: data.shareUserIds };
        const list = await one();
        await muteSources(list, ['screen_share', 'screen_share_audio']);
        await refreshPerms(students(list));
        break;
      }
      case 'share-allow': {
        data.shareUserIds = [...new Set([...s.shareUserIds, target!])];
        state = { ...state, shareUserIds: data.shareUserIds };
        await refreshPerms(students(await one()));
        break;
      }
      case 'remove': {
        data.removedUserIds = [...new Set([...s.removedUserIds, target!])];
        data.shareUserIds = s.shareUserIds.filter((x) => x !== target);
        if ((await one()).length) await this.gw.remove(room, target!);
        const who = await this.prisma.user.findUnique({ where: { id: target! }, select: { name: true } });
        await this.audit.record({ actorId: user.id, action: 'live.remove', entity: 'Session', entityId: s.id, branchId: s.batch.branchId, summary: `Removed ${who?.name ?? 'a participant'} from ${s.batch.name} class ${s.position}`, ip });
        break;
      }
      case 'let-back': data.removedUserIds = s.removedUserIds.filter((x) => x !== target); break;
      case 'lower-hand': if ((await one()).length) await this.gw.updateParticipant(room, target!, { attributes: { hand: '' } }); break;
      case 'lower-all-hands':
        for (const p of await people()) if (p.attributes.hand) await this.gw.updateParticipant(room, p.identity, { attributes: { hand: '' } });
        break;
      case 'mute-all': await muteSources((await people()).filter((p) => !teacherIds.includes(p.identity) && p.identity !== user.id), ['microphone']); break;
      case 'lock': data.locked = true; break;
      case 'unlock': data.locked = false; break;
      case 'chat-off': data.chatDisabled = true; break;
      case 'chat-on': data.chatDisabled = false; break;
      case 'mic-allow':
      case 'mic-block':
      case 'cam-allow':
      case 'cam-block': {
        const allow = input.action.endsWith('allow');
        if (input.action.startsWith('mic')) data.micAllowed = allow; else data.camAllowed = allow;
        state = { ...state, ...data };
        const list = students(await people());
        if (!allow) await muteSources(list, [input.action.startsWith('mic') ? 'microphone' : 'camera']);
        await refreshPerms(list);
        break;
      }
      case 'end': return this.end(user, a, ip);
    }
    const updated = Object.keys(data).length ? await this.prisma.session.update({ where: { id: s.id }, data }) : s;
    const next = this.stateOf(updated);
    if (['lock', 'unlock', 'chat-off', 'chat-on', 'mic-allow', 'mic-block', 'cam-allow', 'cam-block', 'share-allow', 'share-revoke', 'stop-share', 'remove'].includes(input.action) && updated.status === 'LIVE') {
      await this.gw.setRoomMetadata(room, JSON.stringify(next));
    }
    if (input.action === 'lock' || input.action === 'unlock') {
      await this.audit.record({ actorId: user.id, action: `live.${input.action}`, entity: 'Session', entityId: s.id, branchId: s.batch.branchId, summary: `${input.action === 'lock' ? 'Locked' : 'Unlocked'} ${s.batch.name} class ${s.position}`, ip });
    }
    return { state: next, removedUserIds: updated.removedUserIds };
  }

  private async end(user: SessionUser, a: LiveAccess, ip?: string) {
    const s = a.session;
    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.presenceInterval.updateMany({ where: { sessionId: s.id, leftAt: null }, data: { leftAt: now } });
      const u = await tx.session.update({ where: { id: s.id }, data: { status: 'COMPLETED', liveEndedAt: now } });
      await this.audit.record({ actorId: user.id, action: 'live.end', entity: 'Session', entityId: s.id, branchId: s.batch.branchId, summary: `Ended ${s.batch.name} class ${s.position}`, ip }, tx);
      return u;
    });
    await this.gw.send(this.roomOf(s.id), 'notice', { type: 'ended', by: user.name }).catch(() => undefined);
    await this.gw.closeRoom(this.roomOf(s.id));
    return { state: this.stateOf(updated), removedUserIds: updated.removedUserIds, ended: true };
  }

  async setHand(user: SessionUser, sessionId: string, raised: boolean) {
    const a = await this.access(user, sessionId);
    if (a.refusal) throw refuse(a.refusal);
    if (a.role === 'observer') throw new ForbiddenException('Observers cannot raise a hand');
    await this.gw.updateParticipant(this.roomOf(sessionId), user.id, { attributes: { hand: raised ? String(Date.now()) : '' } });
    return { raised };
  }

  async postChat(user: SessionUser, sessionId: string, text: string): Promise<LiveChatMessage> {
    const a = await this.access(user, sessionId);
    if (a.refusal) throw refuse(a.refusal);
    if (a.role === 'observer' && !a.isHost) throw new ForbiddenException('Observers cannot send messages');
    if (a.role === 'student' && a.session.chatDisabled) throw new ForbiddenException('The teacher has turned off chat');
    const m = await this.prisma.classChatMessage.create({ data: { sessionId, userId: user.id, text } });
    const msg: LiveChatMessage = { id: m.id, userId: user.id, name: user.name, role: a.role, text: m.text, createdAt: m.createdAt.toISOString() };
    await this.gw.send(this.roomOf(sessionId), 'chat', msg);
    return msg;
  }

  async chat(user: SessionUser, sessionId: string): Promise<LiveChatMessage[]> {
    const a = await this.access(user, sessionId);
    const teachers = new Set(this.teacherUserIds(a.session));
    const rows = await this.prisma.classChatMessage.findMany({
      where: { sessionId, hiddenAt: null }, orderBy: { createdAt: 'desc' }, take: 300, include: { user: { select: { name: true, kind: true } } },
    });
    return rows.reverse().map((m) => ({
      id: m.id, userId: m.userId, name: m.user.name, text: m.text, createdAt: m.createdAt.toISOString(),
      role: teachers.has(m.userId) ? 'teacher' : m.user.kind === 'STUDENT' ? 'student' : null,
    }));
  }

  /** Enrolled students with who is in, who left and for how long; plus guests (host only). */
  async people(user: SessionUser, sessionId: string) {
    const a = await this.access(user, sessionId);
    if (!a.isHost && !a.canManageGuests) throw new ForbiddenException('Only the teacher can see this');
    const s = a.session;
    const [enrolments, intervals, guests] = await Promise.all([
      this.prisma.enrolment.findMany({ where: { batchId: s.batchId, status: 'ACTIVE' }, include: { student: { select: { code: true, user: { select: { id: true, name: true } } } } }, orderBy: { student: { user: { name: 'asc' } } } }),
      this.prisma.presenceInterval.findMany({ where: { sessionId }, orderBy: { joinedAt: 'asc' } }),
      this.prisma.sessionGuest.findMany({ where: { sessionId }, include: { user: { select: { id: true, name: true, email: true, employee: { select: { designation: { select: { name: true } }, branch: { select: { code: true } } } } } } } }),
    ]);
    const byUser = new Map<string, typeof intervals>();
    for (const i of intervals) byUser.set(i.userId, [...(byUser.get(i.userId) ?? []), i]);
    const now = new Date();
    const to = s.liveEndedAt ?? now;
    return {
      students: enrolments.map((e) => {
        const mine = byUser.get(e.student.user.id) ?? [];
        return {
          userId: e.student.user.id, name: e.student.user.name, code: e.student.code,
          inRoom: mine.some((i) => !i.leftAt),
          firstJoinAt: mine[0]?.joinedAt ?? null,
          lastLeftAt: mine.length && mine.every((i) => i.leftAt) ? mine[mine.length - 1].leftAt : null,
          seconds: presenceSeconds(mine, new Date(0), to, now),
          removed: s.removedUserIds.includes(e.student.user.id),
        };
      }),
      guests: guests.map((g) => ({ userId: g.user.id, name: g.user.name, detail: g.user.employee ? `${g.user.employee.designation.name} · ${g.user.employee.branch.code}` : 'Head office' })),
      removedUserIds: s.removedUserIds,
    };
  }

  async assertManageGuests(user: SessionUser, sessionId: string) {
    const a = await this.access(user, sessionId);
    if (!a.canManageGuests) throw new ForbiddenException('Only the teacher or Branch Admin can add guests');
    return a;
  }
}
