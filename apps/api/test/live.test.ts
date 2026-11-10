import { createHash } from 'node:crypto';
import { AccessToken, TokenVerifier } from 'livekit-server-sdk';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeLiveGateway, LiveGateway } from '../src/modules/live/live.gateway';
import { SettingsService } from '../src/common/settings.service';
import { ensureDemoClass } from '../src/seed/live';
import { DEMO, anon, as, closeApp, getApp, prisma } from './helpers';

let gw: FakeLiveGateway;
let sessionId: string;
const KEY = 'devkey';
const SECRET = 'secret_dev_livekit_key_0123456789abcdef';

beforeAll(async () => {
  const app = await getApp();
  gw = app.get(LiveGateway) as FakeLiveGateway;
});
afterAll(async () => { await closeApp(); });
beforeEach(async () => {
  gw.reset();
  ({ sessionId } = await ensureDemoClass(prisma()));
});

const userId = async (email: string) => (await prisma().user.findUniqueOrThrow({ where: { email } })).id;
const grants = async (token: string) => (await new TokenVerifier(KEY, SECRET).verify(token)).video!;
const url = (p = '') => `/api/live/sessions/${sessionId}${p}`;

async function signedWebhook(body: object) {
  const raw = JSON.stringify(body);
  const at = new AccessToken(KEY, SECRET);
  at.sha256 = createHash('sha256').update(raw).digest('base64');
  return (await anon()).post('/api/livekit/webhook').set('Authorization', await at.toJwt()).set('Content-Type', 'application/webhook+json').send(raw);
}
const nowSec = () => String(Math.floor(Date.now() / 1000));
const joined = (sid: string, identity: string, role: string) => signedWebhook({ event: 'participant_joined', room: { name: `s_${sessionId}` }, participant: { sid, identity, metadata: JSON.stringify({ role }), joinedAt: nowSec() }, createdAt: nowSec() });
const left = (sid: string, identity: string) => signedWebhook({ event: 'participant_left', room: { name: `s_${sessionId}` }, participant: { sid, identity }, createdAt: nowSec() });

describe('who may enter a class', () => {
  it('the teacher opens the class: room is created, class goes live, teacher gets host rights', async () => {
    const r = await (await as(DEMO.anita)).post(url('/join'));
    expect(r.status).toBe(200);
    expect(r.body.role).toBe('teacher');
    const g = await grants(r.body.token);
    expect(g.roomAdmin).toBe(true);
    expect(g.room).toBe(`s_${sessionId}`);
    expect((await prisma().session.findUniqueOrThrow({ where: { id: sessionId } })).status).toBe('LIVE');
    expect(gw.calls.some((c) => c.fn === 'ensureRoom')).toBe(true);
  });

  it('an enrolled student joins with student rights only (identity = their account, so a second device replaces the first)', async () => {
    const info = await (await as(DEMO.arjun)).get(url());
    expect(info.status).toBe(200);
    expect(info.body).toMatchObject({ role: 'student', refusal: null, isHost: false });
    const r = await (await as(DEMO.arjun)).post(url('/join'));
    expect(r.status).toBe(200);
    expect(r.body.identity).toBe(await userId(DEMO.arjun));
    const g = await grants(r.body.token);
    expect(g.roomAdmin).toBe(false);
    expect(g.canPublishSources).toEqual(['microphone', 'camera']);
  });

  it('refuses people who are not in the batch: other students, other branches, unrelated staff', async () => {
    const outsider = await prisma().student.findFirstOrThrow({ where: { branch: { code: 'KOC01' }, enrolments: { none: { batch: { name: 'Live Demo Class' } } }, user: { mustChangePassword: false } }, include: { user: true } });
    const outsiderApi = await as(outsider.user.email!);
    const r = await outsiderApi.get(url());
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('NOT_ALLOWED');
    expect((await outsiderApi.post(url('/join'))).status).toBe(403);
    for (const who of [DEMO.tvmAdmin, DEMO.sanjay, DEMO.accounts, DEMO.counsellor]) {
      expect((await (await as(who)).post(url('/join'))).status, who).toBe(403);
    }
  });

  it('a student on hold is refused with a clear reason', async () => {
    const diya = await prisma().student.findFirstOrThrow({ where: { user: { email: DEMO.diya } } });
    const batch = await prisma().batch.findFirstOrThrow({ where: { name: 'Live Demo Class' } });
    await prisma().enrolment.update({ where: { studentId_batchId: { studentId: diya.id, batchId: batch.id } }, data: { status: 'ON_HOLD' } });
    try {
      const r = await (await as(DEMO.diya)).post(url('/join'));
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('NOT_ACTIVE');
    } finally {
      await prisma().enrolment.update({ where: { studentId_batchId: { studentId: diya.id, batchId: batch.id } }, data: { status: 'ACTIVE' } });
    }
  });

  it('Academics and Monitoring admins and the Branch Admin enter as hidden observers', async () => {
    for (const who of [DEMO.academics, DEMO.monitoring, DEMO.kochiAdmin]) {
      const r = await (await as(who)).post(url('/join'));
      expect(r.status, who).toBe(200);
      expect(r.body.role).toBe('observer');
      const g = await grants(r.body.token);
      expect(g.hidden).toBe(true);
      expect(g.canPublish).toBe(false);
    }
    // Monitoring only watches; Academics/Branch Admin may also use teacher controls.
    expect((await (await as(DEMO.monitoring)).get(url())).body.isHost).toBe(false);
    expect((await (await as(DEMO.academics)).get(url())).body.isHost).toBe(true);
  });

  it('students can join only from 10 minutes before the start; teachers from 15', async () => {
    const start = new Date(Date.now() + 12 * 60_000);
    await prisma().session.update({ where: { id: sessionId }, data: { startsAt: start, endsAt: new Date(start.getTime() + 3600_000) } });
    const s = await (await as(DEMO.arjun)).post(url('/join'));
    expect(s.status).toBe(403);
    expect(s.body.code).toBe('TOO_EARLY');
    expect(s.body.opensAt).toBeTruthy();
    expect((await (await as(DEMO.anita)).post(url('/join'))).status).toBe(200);
  });

  it('cancelled, finished and classroom-only classes cannot be joined', async () => {
    await prisma().session.update({ where: { id: sessionId }, data: { status: 'CANCELLED' } });
    expect((await (await as(DEMO.arjun)).post(url('/join'))).body.code).toBe('CANCELLED');
    await prisma().session.update({ where: { id: sessionId }, data: { status: 'SCHEDULED', startsAt: new Date(Date.now() - 7200_000), endsAt: new Date(Date.now() - 3600_000) } });
    expect((await (await as(DEMO.arjun)).post(url('/join'))).body.code).toBe('ENDED');
    const offline = await prisma().session.findFirstOrThrow({ where: { batch: { name: 'Weekend Batch' } } });
    const r = await (await as(DEMO.blrAdmin)).get(`/api/live/sessions/${offline.id}`);
    expect(r.body.refusal).toBe('OFFLINE');
  });

  it('the network-wide live class cap is respected (setting)', async () => {
    await prisma().setting.upsert({ where: { key: 'live.maxRooms' }, create: { key: 'live.maxRooms', value: 0 }, update: { value: 0 } });
    (await getApp()).get(SettingsService).clearCache();
    try {
      const r = await (await as(DEMO.anita)).post(url('/join'));
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('NETWORK_FULL');
    } finally {
      await prisma().setting.delete({ where: { key: 'live.maxRooms' } });
      (await getApp()).get(SettingsService).clearCache();
    }
  });
});

describe('teacher controls', () => {
  it('students cannot use teacher controls', async () => {
    const r = await (await as(DEMO.arjun)).post(url('/control'), { action: 'mute-all' });
    expect(r.status).toBe(403);
  });

  it('turning chat off blocks students but not the teacher; chat is saved with the class', async () => {
    const teacher = await as(DEMO.anita);
    const student = await as(DEMO.arjun);
    expect((await student.post(url('/chat'), { text: 'Good morning' })).status).toBe(201);
    expect((await teacher.post(url('/control'), { action: 'chat-off' })).body.state.chatDisabled).toBe(true);
    const blocked = await student.post(url('/chat'), { text: 'Hello?' });
    expect(blocked.status).toBe(403);
    expect(blocked.body.message).toMatch(/turned off chat/);
    expect((await teacher.post(url('/chat'), { text: 'Questions at the end please' })).status).toBe(201);
    const log = await student.get(url('/chat'));
    expect(log.body.map((m: { text: string }) => m.text)).toEqual(['Good morning', 'Questions at the end please']);
    expect(log.body[1].role).toBe('teacher');
    expect(gw.calls.filter((c) => c.fn === 'send' && c.args[1] === 'chat')).toHaveLength(2);
    expect((await student.post(url('/chat'), { text: '   ' })).status).toBe(400);
  });

  it('lock keeps new students out but lets earlier ones back in', async () => {
    const teacher = await as(DEMO.anita);
    await joined('PA_arjun1', await userId(DEMO.arjun), 'student');
    await teacher.post(url('/control'), { action: 'lock' });
    expect((await (await as(DEMO.arjun)).post(url('/join'))).status).toBe(200);
    const late = await (await as(DEMO.diya)).post(url('/join'));
    expect(late.status).toBe(403);
    expect(late.body.code).toBe('LOCKED');
    await teacher.post(url('/control'), { action: 'unlock' });
    expect((await (await as(DEMO.diya)).post(url('/join'))).status).toBe(200);
    expect(await prisma().auditLog.count({ where: { action: 'live.lock', entityId: sessionId } })).toBe(1);
  });

  it('a removed student is disconnected and cannot come back until let back in', async () => {
    const teacher = await as(DEMO.anita);
    const diyaId = await userId(DEMO.diya);
    gw.rooms.set(`s_${sessionId}`, { metadata: '', participants: [{ identity: diyaId, name: 'Diya', metadata: '{"role":"student"}', attributes: {}, tracks: [] }] });
    expect((await teacher.post(url('/control'), { action: 'remove', identity: diyaId })).status).toBe(200);
    expect(gw.calls.some((c) => c.fn === 'remove' && c.args[1] === diyaId)).toBe(true);
    expect((await (await as(DEMO.diya)).post(url('/join'))).body.code).toBe('REMOVED');
    expect(await prisma().auditLog.count({ where: { action: 'live.remove', entityId: sessionId } })).toBe(1);
    await teacher.post(url('/control'), { action: 'let-back', identity: diyaId });
    expect((await (await as(DEMO.diya)).post(url('/join'))).status).toBe(200);
  });

  it('a teacher cannot be removed; a person action needs a person', async () => {
    const academics = await as(DEMO.academics);
    expect((await academics.post(url('/control'), { action: 'remove', identity: await userId(DEMO.anita) })).status).toBe(403);
    expect((await academics.post(url('/control'), { action: 'mute' })).status).toBe(400);
  });

  it('mute all mutes every student microphone; blocking cameras also changes student permissions', async () => {
    const teacher = await as(DEMO.anita);
    const anitaId = await userId(DEMO.anita);
    const arjunId = await userId(DEMO.arjun);
    gw.rooms.set(`s_${sessionId}`, {
      metadata: '',
      participants: [
        { identity: anitaId, name: 'Anita', metadata: '{"role":"teacher"}', attributes: {}, tracks: [{ sid: 'TR_t_mic', source: 'microphone', muted: false }] },
        { identity: arjunId, name: 'Arjun', metadata: '{"role":"student"}', attributes: { hand: '123' }, tracks: [{ sid: 'TR_a_mic', source: 'microphone', muted: false }, { sid: 'TR_a_cam', source: 'camera', muted: false }] },
      ],
    });
    await teacher.post(url('/control'), { action: 'mute-all' });
    const muted = gw.calls.filter((c) => c.fn === 'muteTrack').map((c) => c.args[2]);
    expect(muted).toEqual(['TR_a_mic']);
    await teacher.post(url('/join')); // room goes live so metadata is pushed
    const r = await teacher.post(url('/control'), { action: 'cam-block' });
    expect(r.body.state.camAllowed).toBe(false);
    const upd = gw.calls.find((c) => c.fn === 'updateParticipant' && c.args[1] === arjunId);
    expect((upd!.args[2] as { permission: { canPublishSources: string[] } }).permission.canPublishSources).toEqual(['microphone']);
    expect(gw.calls.some((c) => c.fn === 'muteTrack' && c.args[2] === 'TR_a_cam')).toBe(true);
    // New students now join without camera rights
    expect((await grants((await (await as(DEMO.arjun)).post(url('/join'))).body.token)).canPublishSources).toEqual(['microphone']);
    await teacher.post(url('/control'), { action: 'lower-all-hands' });
    expect(gw.calls.some((c) => c.fn === 'updateParticipant' && (c.args[2] as { attributes?: { hand: string } }).attributes?.hand === '')).toBe(true);
  });

  it('a teacher can let one student share their screen', async () => {
    const teacher = await as(DEMO.anita);
    const arjunId = await userId(DEMO.arjun);
    await teacher.post(url('/control'), { action: 'share-allow', identity: arjunId });
    expect((await grants((await (await as(DEMO.arjun)).post(url('/join'))).body.token)).canPublishSources).toContain('screen_share');
    expect((await grants((await (await as(DEMO.diya)).post(url('/join'))).body.token)).canPublishSources).not.toContain('screen_share');
    await teacher.post(url('/control'), { action: 'share-revoke', identity: arjunId });
    expect((await grants((await (await as(DEMO.arjun)).post(url('/join'))).body.token)).canPublishSources).not.toContain('screen_share');
  });

  it('ending the class closes the room and nobody can rejoin', async () => {
    const teacher = await as(DEMO.anita);
    await teacher.post(url('/join'));
    await joined('PA_d1', await userId(DEMO.diya), 'student');
    const r = await teacher.post(url('/control'), { action: 'end' });
    expect(r.body.ended).toBe(true);
    expect(gw.calls.some((c) => c.fn === 'closeRoom')).toBe(true);
    const s = await prisma().session.findUniqueOrThrow({ where: { id: sessionId } });
    expect(s.status).toBe('COMPLETED');
    expect(await prisma().presenceInterval.count({ where: { sessionId, leftAt: null } })).toBe(0);
    expect((await (await as(DEMO.arjun)).post(url('/join'))).body.code).toBe('ENDED');
  });
});

describe('guests', () => {
  it('the teacher invites a guest trainer from another branch, who can then join', async () => {
    const teacher = await as(DEMO.anita);
    const cands = await teacher.get(url('/guest-candidates?q=sanjay'));
    expect(cands.body[0].name).toMatch(/Sanjay/);
    expect((await teacher.post(url('/guests'), { userId: cands.body[0].id })).status).toBe(201);
    const r = await (await as(DEMO.sanjay)).post(url('/join'));
    expect(r.status).toBe(200);
    expect(r.body.role).toBe('guest');
    expect((await teacher.get(url('/people'))).body.guests[0].name).toMatch(/Sanjay/);
    await teacher.delete(url(`/guests/${cands.body[0].id}`));
    expect((await (await as(DEMO.sanjay)).post(url('/join'))).status).toBe(403);
  });

  it('students and other branches cannot add guests; students cannot be guests', async () => {
    const sanjayId = await userId(DEMO.sanjay);
    expect((await (await as(DEMO.arjun)).post(url('/guests'), { userId: sanjayId })).status).toBe(403);
    expect((await (await as(DEMO.tvmAdmin)).post(url('/guests'), { userId: sanjayId })).status).toBe(403);
    expect((await (await as(DEMO.anita)).post(url('/guests'), { userId: await userId(DEMO.diya) })).status).toBe(400);
  });
});

describe('presence from the class server', () => {
  it('records joins and leaves; a reconnect from a second device closes the right connection', async () => {
    const arjunId = await userId(DEMO.arjun);
    expect((await joined('PA_1', arjunId, 'student')).status).toBe(200);
    expect((await joined('PA_2', arjunId, 'student')).status).toBe(200); // second device: new connection first…
    expect((await left('PA_1', arjunId)).status).toBe(200); // …then the old one is dropped
    const rows = await prisma().presenceInterval.findMany({ where: { sessionId, userId: arjunId }, orderBy: { joinedAt: 'asc' } });
    expect(rows.find((r) => r.participantSid === 'PA_1')!.leftAt).not.toBeNull();
    expect(rows.find((r) => r.participantSid === 'PA_2')!.leftAt).toBeNull();
    // duplicate delivery is ignored
    await joined('PA_2', arjunId, 'student');
    expect(await prisma().presenceInterval.count({ where: { sessionId, userId: arjunId } })).toBe(2);
    const people = await (await as(DEMO.anita)).get(url('/people'));
    const me = people.body.students.find((s: { userId: string }) => s.userId === arjunId);
    expect(me.inRoom).toBe(true);
    expect(me.firstJoinAt).toBeTruthy();
  });

  it('the teacher joining marks when the class really started', async () => {
    await joined('PA_t', await userId(DEMO.anita), 'teacher');
    const s = await prisma().session.findUniqueOrThrow({ where: { id: sessionId } });
    expect(s.teacherJoinedAt).not.toBeNull();
    expect(s.status).toBe('LIVE');
  });

  it('rejects events without a valid signature', async () => {
    const r = await (await anon()).post('/api/livekit/webhook').set('Authorization', 'nope').set('Content-Type', 'application/webhook+json').send('{"event":"room_finished"}');
    expect(r.status).toBe(401);
  });

  it('only teachers and branch staff see the people list', async () => {
    expect((await (await as(DEMO.arjun)).get(url('/people'))).status).toBe(403);
    expect((await (await as(DEMO.tvmAdmin)).get(url('/people'))).status).toBe(403);
    expect((await (await as(DEMO.kochiAdmin)).get(url('/people'))).status).toBe(200);
  });
});
