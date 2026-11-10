import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeLiveGateway, LiveGateway } from '../src/modules/live/live.gateway';
import { ensureDemoClass } from '../src/seed/live';
import { DEMO, as, closeApp, getApp, prisma } from './helpers';

let sessionId: string;
let gw: FakeLiveGateway;
beforeAll(async () => { gw = (await getApp()).get(LiveGateway) as FakeLiveGateway; });
afterAll(async () => { await closeApp(); });
beforeEach(async () => {
  ({ sessionId } = await ensureDemoClass(prisma()));
  await prisma().poll.deleteMany({ where: { sessionId } });
  await (await as(DEMO.anita)).post(`/api/live/sessions/${sessionId}/join`); // class goes live
  gw.reset();
});
const poll = { question: 'Which is a Python web framework?', options: ['Django', 'Laravel', 'Rails'], multi: false, showResults: false };

describe('polls', () => {
  it('teacher asks, students answer, results stay with the teacher until shared, and are saved', async () => {
    const t = await as(DEMO.anita);
    const p = await t.post(`/api/live/sessions/${sessionId}/polls`, poll);
    expect(p.status).toBe(201);
    expect(gw.calls.some((c) => c.fn === 'send' && (c.args[2] as { type: string }).type === 'poll')).toBe(true);

    const arjun = await as(DEMO.arjun);
    expect((await arjun.post(`/api/live/polls/${p.body.id}/vote`, { choices: [0, 1] })).status).toBe(400); // single choice
    expect((await arjun.post(`/api/live/polls/${p.body.id}/vote`, { choices: [7] })).status).toBe(400);
    const v = await arjun.post(`/api/live/polls/${p.body.id}/vote`, { choices: [0] });
    expect(v.status).toBe(200);
    expect(v.body.counts).toBeNull(); // hidden from students
    expect(v.body.myChoices).toEqual([0]);
    // Update goes to teachers only while results are hidden
    const upd = gw.calls.filter((c) => c.fn === 'send' && (c.args[2] as { type: string }).type === 'poll-update').pop()!;
    expect(upd.args[3]).toContain((await prisma().user.findUniqueOrThrow({ where: { email: DEMO.anita } })).id);
    await (await as(DEMO.diya)).post(`/api/live/polls/${p.body.id}/vote`, { choices: [1] });
    await arjun.post(`/api/live/polls/${p.body.id}/vote`, { choices: [2] }); // changes mind

    const teacherView = (await t.get(`/api/live/sessions/${sessionId}/polls`)).body[0];
    expect(teacherView.counts).toEqual([0, 1, 1]);
    expect(teacherView.voters).toBe(2);
    expect((await arjun.get(`/api/live/sessions/${sessionId}/polls`)).body[0].counts).toBeNull();
    await t.post(`/api/live/polls/${p.body.id}/results`, { showResults: true });
    expect((await arjun.get(`/api/live/sessions/${sessionId}/polls`)).body[0].counts).toEqual([0, 1, 1]);

    await t.post(`/api/live/polls/${p.body.id}/close`);
    expect((await arjun.post(`/api/live/polls/${p.body.id}/vote`, { choices: [0] })).status).toBe(400);
  });

  it('multiple choice, one open poll at a time, and saved polls for reuse', async () => {
    const t = await as(DEMO.anita);
    const first = await t.post(`/api/live/sessions/${sessionId}/polls`, { ...poll, saveTemplate: true });
    const second = await t.post(`/api/live/sessions/${sessionId}/polls`, { question: 'Pick all databases', options: ['PostgreSQL', 'Excel', 'MySQL'], multi: true });
    expect((await prisma().poll.findUniqueOrThrow({ where: { id: first.body.id } })).status).toBe('CLOSED');
    expect((await (await as(DEMO.arjun)).post(`/api/live/polls/${second.body.id}/vote`, { choices: [0, 2] })).status).toBe(200);
    const tpl = await t.get('/api/live/poll-templates');
    expect(tpl.body.map((x: { question: string }) => x.question)).toContain(poll.question);
    expect((await (await as(DEMO.rahul)).delete(`/api/live/poll-templates/${tpl.body[0].id}`)).status).toBe(404); // not his
    expect((await t.delete(`/api/live/poll-templates/${tpl.body[0].id}`)).status).toBe(200);
  });

  it('only the teacher starts or closes polls; outsiders cannot vote; teachers and observers do not vote', async () => {
    expect((await (await as(DEMO.arjun)).post(`/api/live/sessions/${sessionId}/polls`, poll)).status).toBe(403);
    const p = await (await as(DEMO.anita)).post(`/api/live/sessions/${sessionId}/polls`, poll);
    expect((await (await as(DEMO.arjun)).post(`/api/live/polls/${p.body.id}/close`)).status).toBe(403);
    expect((await (await as(DEMO.sanjay)).post(`/api/live/polls/${p.body.id}/vote`, { choices: [0] })).status).toBe(403);
    expect((await (await as(DEMO.anita)).post(`/api/live/polls/${p.body.id}/vote`, { choices: [0] })).status).toBe(403);
    expect((await (await as(DEMO.monitoring)).post(`/api/live/polls/${p.body.id}/vote`, { choices: [0] })).status).toBe(403);
    expect((await (await as(DEMO.anita)).post(`/api/live/sessions/${sessionId}/polls`, { question: 'Hi', options: ['one'] })).status).toBe(400);
  });
});
