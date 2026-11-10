import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO, anon, as, closeApp, getApp, prisma, tokenFor } from './helpers';

beforeAll(async () => { await getApp(); });
afterAll(async () => { await closeApp(); });
const uid = async (email: string) => (await prisma().user.findUniqueOrThrow({ where: { email } })).id;

describe('who may message whom', () => {
  it('a student messages their teacher; never another student; not a teacher of another branch', async () => {
    const st = await as(DEMO.arjun);
    const d = await st.post('/api/messages/direct', { userId: await uid(DEMO.anita) });
    expect(d.status).toBe(201);
    expect((await st.post('/api/messages/direct', { userId: await uid(DEMO.diya) })).status).toBe(403);
    expect((await st.post('/api/messages/direct', { userId: await uid('priya.trainer@demo.cc') })).status).toBe(403);
    const contacts = await st.get('/api/messages/contacts?q=diya');
    expect(contacts.body).toHaveLength(0);
    const again = await st.post('/api/messages/direct', { userId: await uid(DEMO.anita) });
    expect(again.body.id).toBe(d.body.id); // the same conversation is reused
    // staff ↔ staff anywhere
    expect((await (await as('priya.trainer@demo.cc')).post('/api/messages/direct', { userId: await uid(DEMO.sanjay) })).status).toBe(201);
  });
});

describe('conversations', () => {
  it('sending, unread counts, read receipts, replies, edit and delete within 15 minutes', async () => {
    const st = await as(DEMO.arjun);
    const t = await as(DEMO.anita);
    const { body: { id } } = await st.post('/api/messages/direct', { userId: await uid(DEMO.anita) });
    const m1 = await st.post(`/api/messages/conversations/${id}/messages`, { text: 'Sir, is the class on tomorrow?' });
    expect(m1.status).toBe(201);
    expect((await st.post(`/api/messages/conversations/${id}/messages`, { text: '   ' })).status).toBe(400);
    const before = (await t.get('/api/messages/unread')).body.total;
    expect(before).toBeGreaterThan(0);
    const reply = await t.post(`/api/messages/conversations/${id}/messages`, { text: 'Yes, 9 am as usual', replyToId: m1.body.id });
    expect(reply.body.replyTo.text).toMatch(/class on tomorrow/);
    await t.post(`/api/messages/conversations/${id}/read`);
    const conv = await st.get(`/api/messages/conversations/${id}`);
    expect(conv.body.people.find((p: { id: string }) => p.id === conv.body.otherUserId).lastReadAt).toBeTruthy();
    expect((await st.patch(`/api/messages/${m1.body.id}`, { text: 'Ma\'am, is the class on tomorrow?' })).body.editedAt).toBeTruthy();
    expect((await t.patch(`/api/messages/${m1.body.id}`, { text: 'Not mine' })).status).toBe(403);
    await prisma().message.update({ where: { id: reply.body.id }, data: { createdAt: new Date(Date.now() - 16 * 60_000) } });
    expect((await t.delete(`/api/messages/${reply.body.id}`)).status).toBe(400);
    const del = await st.delete(`/api/messages/${m1.body.id}`);
    expect(del.body).toMatchObject({ deleted: true, text: null });
    expect((await (await as(DEMO.diya)).get(`/api/messages/conversations/${id}/messages`)).status).toBe(403);
  });

  it('batch groups are created automatically; announcements-only lets only teachers post', async () => {
    const list = await (await as(DEMO.diya)).get('/api/messages/conversations');
    const group = list.body.find((c: { kind: string; title: string }) => c.kind === 'BATCH' && c.title.startsWith('Morning Batch A'));
    expect(group).toBeTruthy();
    await (await as(DEMO.anita)).get('/api/messages/conversations'); // teacher joins her groups
    expect((await (await as(DEMO.diya)).post(`/api/messages/conversations/${group.id}/messages`, { text: 'Hello everyone' })).status).toBe(201);
    expect((await (await as(DEMO.diya)).patch(`/api/messages/conversations/${group.id}`, { announcementsOnly: true })).status).toBe(403);
    expect((await (await as(DEMO.anita)).patch(`/api/messages/conversations/${group.id}`, { announcementsOnly: true })).status).toBe(200);
    const blocked = await (await as(DEMO.diya)).post(`/api/messages/conversations/${group.id}/messages`, { text: 'Can I post?' });
    expect(blocked.status).toBe(403);
    expect((await (await as(DEMO.anita)).post(`/api/messages/conversations/${group.id}/messages`, { text: 'Exam on Friday' })).status).toBe(201);
    await (await as(DEMO.anita)).patch(`/api/messages/conversations/${group.id}`, { announcementsOnly: false });
    const found = await (await as(DEMO.diya)).get('/api/messages/search?q=exam on');
    expect(found.body[0].text).toBe('Exam on Friday');
  });

  it('staff groups: staff only, owner manages members, others can leave', async () => {
    const owner = await as(DEMO.kochiAdmin);
    expect((await owner.post('/api/messages/groups', { title: 'KOC01 Trainers', memberIds: [await uid(DEMO.arjun)] })).status).toBe(400);
    const g = await owner.post('/api/messages/groups', { title: 'KOC01 Trainers', memberIds: [await uid(DEMO.anita), await uid(DEMO.rahul)] });
    expect(g.status).toBe(201);
    expect((await (await as(DEMO.arjun)).post('/api/messages/groups', { title: 'Students club', memberIds: [await uid(DEMO.diya)] })).status).toBe(403);
    expect((await (await as(DEMO.rahul)).post(`/api/messages/conversations/${g.body.id}/members`, { add: [await uid(DEMO.sanjay)] })).status).toBe(403);
    expect((await (await as(DEMO.rahul)).post(`/api/messages/conversations/${g.body.id}/members`, { remove: [await uid(DEMO.rahul)] })).status).toBe(200);
    expect((await (await as(DEMO.rahul)).get(`/api/messages/conversations/${g.body.id}/messages`)).status).toBe(403);
  });

  it('files: checked by content and opened through private links for members only', async () => {
    const st = await as(DEMO.arjun);
    const { body: { id } } = await st.post('/api/messages/direct', { userId: await uid(DEMO.anita) });
    const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(50, 2)]);
    const up = await (await anon()).post('/api/messages/upload').set('Authorization', `Bearer ${await tokenFor(DEMO.arjun)}`).attach('file', PNG, 'error.png');
    const m = await st.post(`/api/messages/conversations/${id}/messages`, { fileId: up.body.id });
    expect(m.body.file.name).toBe('error.png');
    const link = await (await as(DEMO.anita)).get(`/api/messages/${m.body.id}/file`);
    expect((await (await anon()).get(link.body.url)).status).toBe(200);
    expect((await (await as(DEMO.rahul)).get(`/api/messages/${m.body.id}/file`)).status).toBe(403);
  });
});

describe('moderation', () => {
  it('Branch Admins and Communication admins review chats with students and hide messages with a reason, audited', async () => {
    const st = await as(DEMO.arjun);
    const { body: { id } } = await st.post('/api/messages/direct', { userId: await uid(DEMO.anita) });
    const m = await st.post(`/api/messages/conversations/${id}/messages`, { text: 'Something rude' });
    const mods = await (await as(DEMO.kochiAdmin)).get('/api/messages/moderation/conversations');
    expect(mods.body.map((c: { id: string }) => c.id)).toContain(id);
    expect((await (await as(DEMO.tvmAdmin)).post(`/api/messages/${m.body.id}/hide`, { reason: 'Rude' })).status).toBe(403);
    expect((await (await as(DEMO.anita)).post(`/api/messages/${m.body.id}/hide`, { reason: 'Rude' })).status).toBe(403);
    expect((await (await as(DEMO.monitoring)).post(`/api/messages/${m.body.id}/hide`, { reason: 'x' })).status).toBe(400);
    const h = await (await as(DEMO.monitoring)).post(`/api/messages/${m.body.id}/hide`, { reason: 'Rude language' });
    expect(h.status).toBe(200);
    expect(h.body.hiddenReason).toBe('Rude language');
    const seen = (await st.get(`/api/messages/conversations/${id}/messages`)).body.messages.find((x: { id: string }) => x.id === m.body.id);
    expect(seen).toMatchObject({ hidden: true, text: null, hiddenReason: null });
    expect(await prisma().auditLog.count({ where: { action: 'moderation.hide', entityId: m.body.id } })).toBe(1);
    // staff-only chats are private
    const { body: g } = await (await as(DEMO.kochiAdmin)).post('/api/messages/groups', { title: 'Admins only', memberIds: [await uid(DEMO.rahul)] });
    expect((await (await as(DEMO.monitoring)).get(`/api/messages/conversations/${g.id}/messages`)).status).toBe(403);
  });
});

describe('announcements', () => {
  it('head office announces to everyone; Branch Admins only to their branch or batches; read counts are kept', async () => {
    const ho = await as(DEMO.monitoring); // Communication module
    const all = await ho.post('/api/announcements', { title: 'Diwali holidays', body: 'All branches are closed on 08-11-2026.', scope: 'ALL' });
    expect(all.status).toBe(201);
    expect(all.body.recipients).toBeGreaterThan(30);
    const koc = await prisma().branch.findUniqueOrThrow({ where: { code: 'KOC01' } });
    const tvm = await prisma().branch.findUniqueOrThrow({ where: { code: 'TVM01' } });
    const admin = await as(DEMO.kochiAdmin);
    expect((await admin.post('/api/announcements', { title: 'All of you', body: 'Hello network', scope: 'ALL' })).status).toBe(403);
    expect((await admin.post('/api/announcements', { title: 'Visit TVM', body: 'Hello', scope: 'BRANCHES', branchIds: [tvm.id] })).status).toBe(403);
    const b = await admin.post('/api/announcements', { title: 'Lab closed Saturday', body: 'Lab 1 is under maintenance.', scope: 'BRANCHES', branchIds: [koc.id], audience: 'STUDENTS' });
    expect(b.status).toBe(201);
    expect((await (await as(DEMO.arjun)).post('/api/announcements', { title: 'x x x', body: 'y y y', scope: 'ALL' })).status).toBe(403);

    const diya = await (await as(DEMO.diya)).get('/api/announcements/mine');
    expect(diya.body.rows.map((r: { title: string }) => r.title)).toEqual(expect.arrayContaining(['Lab closed Saturday', 'Diwali holidays']));
    const sanjay = await (await as(DEMO.sanjay)).get('/api/announcements/mine');
    expect(sanjay.body.rows.map((r: { title: string }) => r.title)).not.toContain('Lab closed Saturday');
    expect((await (await as(DEMO.anita)).get('/api/announcements/mine')).body.rows.map((r: { title: string }) => r.title)).not.toContain('Lab closed Saturday'); // students only
    await (await as(DEMO.diya)).post(`/api/announcements/${b.body.id}/read`);
    const sent = await admin.get('/api/announcements/sent');
    const row = sent.body.find((r: { id: string }) => r.id === b.body.id);
    expect(row.reads).toBe(1);
    expect(row.reach).toBeGreaterThan(5);
  });
});
