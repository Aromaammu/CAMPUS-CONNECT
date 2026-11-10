import { TokenVerifier } from 'livekit-server-sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO, as, closeApp, getApp, prisma } from './helpers';

beforeAll(async () => { await getApp(); });
afterAll(async () => { await closeApp(); });
const uid = async (email: string) => (await prisma().user.findUniqueOrThrow({ where: { email } })).id;
const grants = async (token: string) => (await new TokenVerifier('devkey', 'secret_dev_livekit_key_0123456789abcdef').verify(token)).video!;

describe('staff meetings', () => {
  it('a teacher starts an instant meeting; invited staff join with full rights; others are refused', async () => {
    const host = await as(DEMO.anita);
    const m = await host.post('/api/meetings', { title: 'Python syllabus review', participantIds: [await uid(DEMO.rahul), await uid(DEMO.sanjay)] });
    expect(m.status).toBe(201);
    const rahulId = await uid(DEMO.rahul);
    expect(await prisma().notification.count({ where: { userId: rahulId, type: 'MEETING' } })).toBeGreaterThan(0);
    const h = await host.post(`/api/live/meetings/${m.body.id}/join`);
    expect(h.status).toBe(200);
    expect((await grants(h.body.token)).roomAdmin).toBe(true);
    expect((await prisma().meeting.findUniqueOrThrow({ where: { id: m.body.id } })).status).toBe('LIVE');
    const g = await (await as(DEMO.rahul)).post(`/api/live/meetings/${m.body.id}/join`);
    expect(g.body.role).toBe('guest');
    expect((await grants(g.body.token)).canPublishSources).toContain('screen_share');
    const info = await (await as(DEMO.rahul)).get(`/api/live/meetings/${m.body.id}`);
    expect(info.body).toMatchObject({ kind: 'meeting', role: 'guest', isHost: false });
    for (const who of [DEMO.kochiAdmin, DEMO.arjun]) expect((await (await as(who)).post(`/api/live/meetings/${m.body.id}/join`)).status, who).toBe(403);
  });

  it('meetings are staff-only unless started from a chat; only meeting hosts may start them', async () => {
    expect((await (await as(DEMO.anita)).post('/api/meetings', { title: 'Talk', participantIds: [await uid(DEMO.arjun)] })).status).toBe(400);
    expect((await (await as(DEMO.arjun)).post('/api/meetings', { title: 'Talk', participantIds: [await uid(DEMO.anita)] })).status).toBe(403);
    // A call from a 1-to-1 chat with a student reaches that student.
    const { body: chat } = await (await as(DEMO.anita)).post('/api/messages/direct', { userId: await uid(DEMO.arjun) });
    const call = await (await as(DEMO.anita)).post('/api/meetings', { title: 'Call with Arjun', conversationId: chat.id });
    expect(call.status).toBe(201);
    await (await as(DEMO.anita)).post(`/api/live/meetings/${call.body.id}/join`);
    expect((await (await as(DEMO.arjun)).post(`/api/live/meetings/${call.body.id}/join`)).status).toBe(200);
    expect((await (await as(DEMO.diya)).post(`/api/live/meetings/${call.body.id}/join`)).status).toBe(403);
  });

  it('host controls, chat and polls work in meetings; ending closes it for everyone', async () => {
    const host = await as(DEMO.kochiAdmin);
    const m = await host.post('/api/meetings', { title: 'Branch staff huddle', participantIds: [await uid(DEMO.rahul)] });
    await host.post(`/api/live/meetings/${m.body.id}/join`);
    const rahul = await as(DEMO.rahul);
    expect((await rahul.post(`/api/live/meetings/${m.body.id}/chat`, { text: 'Joining in 2 min' })).status).toBe(201);
    expect((await rahul.post(`/api/live/meetings/${m.body.id}/control`, { action: 'lock' })).status).toBe(403);
    expect((await host.post(`/api/live/meetings/${m.body.id}/control`, { action: 'chat-off' })).body.state.chatDisabled).toBe(true);
    expect((await rahul.post(`/api/live/meetings/${m.body.id}/chat`, { text: 'Hello?' })).status).toBe(403);
    expect((await host.post(`/api/live/meetings/${m.body.id}/control`, { action: 'mic-block' })).status).toBe(400);
    const p = await host.post(`/api/live/meetings/${m.body.id}/polls`, { question: 'Move the review to Friday?', options: ['Yes', 'No'] });
    expect(p.status).toBe(201);
    expect((await rahul.post(`/api/live/polls/${p.body.id}/vote`, { choices: [0] })).status).toBe(200);
    expect((await host.get(`/api/live/meetings/${m.body.id}/polls`)).body[0].counts).toEqual([1, 0]);
    expect((await host.post(`/api/live/meetings/${m.body.id}/control`, { action: 'end' })).body.ended).toBe(true);
    const after = await rahul.post(`/api/live/meetings/${m.body.id}/join`);
    expect(after.status).toBe(403);
    expect(after.body.message).toBe('This meeting has ended.');
    const past = await rahul.get('/api/meetings?when=past');
    expect(past.body.map((x: { id: string }) => x.id)).toContain(m.body.id);
  });

  it('scheduled meetings open 15 minutes early and can be cancelled by the host', async () => {
    const at = new Date(Date.now() + 2 * 3600_000).toISOString();
    const host = await as(DEMO.anita);
    const m = await host.post('/api/meetings', { title: 'Monthly review', scheduledAt: at, participantIds: [await uid(DEMO.rahul)] });
    const early = await (await as(DEMO.rahul)).post(`/api/live/meetings/${m.body.id}/join`);
    expect(early.body.code).toBe('TOO_EARLY');
    const upcoming = await (await as(DEMO.rahul)).get('/api/meetings');
    expect(upcoming.body.map((x: { id: string }) => x.id)).toContain(m.body.id);
    expect((await (await as(DEMO.rahul)).post(`/api/meetings/${m.body.id}/cancel`)).status).toBe(403);
    expect((await host.post(`/api/meetings/${m.body.id}/cancel`)).status).toBe(200);
    expect((await (await as(DEMO.rahul)).get(`/api/live/meetings/${m.body.id}`)).body.refusal).toBe('CANCELLED');
  });
});
