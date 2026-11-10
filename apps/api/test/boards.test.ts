import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ensureDemoClass } from '../src/seed/live';
import { DEMO, anon, as, closeApp, getApp, prisma, tokenFor } from './helpers';

let sessionId: string;
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(100, 3)]);
beforeAll(async () => { await getApp(); });
afterAll(async () => { await closeApp(); });
beforeEach(async () => {
  ({ sessionId } = await ensureDemoClass(prisma()));
  await (await as(DEMO.anita)).post(`/api/live/sessions/${sessionId}/join`);
});
const saveAs = async (email: string, buf = PNG) => (await anon()).post(`/api/live/sessions/${sessionId}/boards`).set('Authorization', `Bearer ${await tokenFor(email)}`).attach('file', buf, 'board.png');

describe('whiteboard', () => {
  it('teacher opens the board and gives a student the pen; closing the board takes all pens back', async () => {
    const t = await as(DEMO.anita);
    const arjun = (await prisma().user.findUniqueOrThrow({ where: { email: DEMO.arjun } })).id;
    expect((await t.post(`/api/live/sessions/${sessionId}/control`, { action: 'board-open' })).body.state.board).toBe(true);
    expect((await t.post(`/api/live/sessions/${sessionId}/control`, { action: 'pen-give', identity: arjun })).body.state.penUserIds).toEqual([arjun]);
    expect((await (await as(DEMO.arjun)).get(`/api/live/sessions/${sessionId}`)).body.state.penUserIds).toEqual([arjun]);
    const closed = await t.post(`/api/live/sessions/${sessionId}/control`, { action: 'board-close' });
    expect(closed.body.state).toMatchObject({ board: false, penUserIds: [] });
    expect((await (await as(DEMO.arjun)).post(`/api/live/sessions/${sessionId}/control`, { action: 'board-open' })).status).toBe(403);
  });

  it('only the teacher saves the board; it becomes a class material the batch can open', async () => {
    expect((await saveAs(DEMO.arjun)).status).toBe(403);
    expect((await saveAs(DEMO.anita, Buffer.from('<svg>not a png</svg>'))).status).toBe(400);
    const r = await saveAs(DEMO.anita);
    expect(r.status).toBe(201);
    const m = await prisma().material.findUniqueOrThrow({ where: { id: r.body.id }, include: { shares: true } });
    expect(m.kind).toBe('WHITEBOARD');
    expect(m.shares).toHaveLength(1);
    const list = await (await as(DEMO.arjun)).get(`/api/live/sessions/${sessionId}/boards`);
    expect(list.body).toHaveLength(1);
    const img = await (await anon()).get(list.body[0].url);
    expect(img.status).toBe(200);
    expect(img.headers['content-type']).toBe('image/png');
    expect((await (await as(DEMO.sanjay)).get(`/api/live/sessions/${sessionId}/boards`)).status).toBe(403);
  });
});
