import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RecordingsService } from '../src/modules/recordings/recordings.service';
import { ensureDemoClass } from '../src/seed/live';
import { DEMO, anon, as, closeApp, getApp, prisma, tokenFor } from './helpers';

let sessionId: string;
let batchId: string;
beforeAll(async () => { await getApp(); });
afterAll(async () => { await closeApp(); });
beforeEach(async () => {
  ({ sessionId, batchId } = await ensureDemoClass(prisma()));
  await prisma().recording.deleteMany({ where: { sessionId } });
});
const seeded = (hidden = false) => prisma().recording.findFirstOrThrow({ where: { hidden, session: { batch: { name: 'Morning Batch A' } } } });

describe('recording a class', () => {
  it('auto-records when the teacher arrives; ending the class produces a ready recording and tells the students', async () => {
    await (await as(DEMO.anita)).post(`/api/live/sessions/${sessionId}/join`);
    const rec = await prisma().recording.findFirstOrThrow({ where: { sessionId } });
    expect(rec.status).toBe('RECORDING');
    expect((await (await as(DEMO.arjun)).get(`/api/live/sessions/${sessionId}`)).body.state.recording).toBe(true);
    await (await as(DEMO.anita)).post(`/api/live/sessions/${sessionId}/control`, { action: 'end' });
    const done = await prisma().recording.findUniqueOrThrow({ where: { id: rec.id } });
    expect(done.status).toBe('READY');
    expect(done.fileId).toBeTruthy();
    expect(done.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 179 * 86400_000);
    const arjun = await prisma().user.findUniqueOrThrow({ where: { email: DEMO.arjun } });
    expect(await prisma().notification.count({ where: { userId: arjun.id, type: 'N9' } })).toBeGreaterThan(0);
  });

  it('the teacher can stop and start again (a second part); students cannot record', async () => {
    await prisma().batch.update({ where: { id: batchId }, data: { autoRecord: false } });
    const t = await as(DEMO.anita);
    await t.post(`/api/live/sessions/${sessionId}/join`);
    expect(await prisma().recording.count({ where: { sessionId } })).toBe(0);
    expect((await (await as(DEMO.arjun)).post(`/api/live/sessions/${sessionId}/recording`, { action: 'start' })).status).toBe(403);
    await t.post(`/api/live/sessions/${sessionId}/recording`, { action: 'start' });
    await t.post(`/api/live/sessions/${sessionId}/recording`, { action: 'start' }); // already recording: no duplicate
    await t.post(`/api/live/sessions/${sessionId}/recording`, { action: 'stop' });
    await t.post(`/api/live/sessions/${sessionId}/recording`, { action: 'start' });
    await t.post(`/api/live/sessions/${sessionId}/recording`, { action: 'stop' });
    const rows = await prisma().recording.findMany({ where: { sessionId }, orderBy: { createdAt: 'asc' } });
    expect(rows.map((r) => r.status)).toEqual(['READY', 'READY']);
    expect(rows[1].title).toMatch(/part 2/);
    await prisma().batch.update({ where: { id: batchId }, data: { autoRecord: true } });
  });


  it('a recording left running from an earlier visit shows REC again when the teacher comes back', async () => {
    await (await as(DEMO.anita)).post(`/api/live/sessions/${sessionId}/join`);
    await prisma().session.update({ where: { id: sessionId }, data: { recordingActive: false } }); // flag lost, recording still running
    await (await as(DEMO.anita)).post(`/api/live/sessions/${sessionId}/join`);
    expect((await prisma().session.findUniqueOrThrow({ where: { id: sessionId } })).recordingActive).toBe(true);
    expect(await prisma().recording.count({ where: { sessionId, status: 'RECORDING' } })).toBe(1);
  });
});

describe('watching', () => {
  it('students of the batch watch through a private link with their name as watermark; nobody else can', async () => {
    const r = await seeded();
    const play = await (await as(DEMO.arjun)).get(`/api/recordings/${r.id}/play`);
    expect(play.status, `student plays ${r.title}: ${JSON.stringify(play.body)}`).toBe(200);
    expect(play.body.watermark).toMatch(/Arjun Nair/);
    const video = await (await anon()).get(play.body.url).set('Range', 'bytes=0-99');
    expect(video.status, 'video range request').toBe(206);
    expect(video.headers['content-type']).toBe('video/webm');
    expect(video.headers['content-disposition']).toMatch(/^inline/);
    for (const who of [DEMO.newStudent, DEMO.tvmAdmin, DEMO.sanjay, DEMO.accounts]) {
      expect((await (await as(who)).get(`/api/recordings/${r.id}/play`)).status, who).toBe(403);
    }
    expect((await (await as(DEMO.anita)).get(`/api/recordings/${r.id}/play`)).status, 'teacher plays').toBe(200);
  });

  it('hidden recordings disappear for students but not for the branch', async () => {
    const hidden = await seeded(true);
    expect((await (await as(DEMO.arjun)).get(`/api/recordings/${hidden.id}/play`)).status).toBe(403);
    const { batchId: hb } = await prisma().session.findUniqueOrThrow({ where: { id: hidden.sessionId! } });
    const list = await (await as(DEMO.arjun)).get(`/api/batches/${hb}/recordings`);
    expect(list.body.map((x: { id: string }) => x.id)).not.toContain(hidden.id);
    expect((await (await as(DEMO.kochiAdmin)).get(`/api/recordings/${hidden.id}/play`)).status).toBe(200);
  });
});

describe('branch controls', () => {
  it('Branch Admin renames, hides, deletes and restores; every change is audited; other branches refused', async () => {
    const r = await seeded();
    const admin = await as(DEMO.kochiAdmin);
    expect((await admin.patch(`/api/recordings/${r.id}`, { title: 'Django forms (with Q&A)' })).status).toBe(200);
    expect((await admin.patch(`/api/recordings/${r.id}`, { hidden: true })).status).toBe(200);
    expect((await (await as(DEMO.tvmAdmin)).patch(`/api/recordings/${r.id}`, { title: 'Hacked' })).status).toBe(403);
    expect((await (await as(DEMO.anita)).delete(`/api/recordings/${r.id}`)).status).toBe(403); // teachers don't manage
    expect((await admin.delete(`/api/recordings/${r.id}`)).status).toBe(200);
    expect((await (await as(DEMO.arjun)).get(`/api/recordings/${r.id}/play`)).status).toBe(404); // deleted: gone for students
    const bin = await admin.get('/api/recordings?deleted=1');
    expect(bin.body.rows.map((x: { id: string }) => x.id)).toContain(r.id);
    expect((await admin.post(`/api/recordings/${r.id}/restore`)).status).toBe(200);
    await admin.patch(`/api/recordings/${r.id}`, { hidden: false });
    const actions = (await prisma().auditLog.findMany({ where: { entityId: r.id } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['recording.rename', 'recording.visibility', 'recording.delete', 'recording.restore']));
    // Academics admin manages every branch
    expect((await (await as(DEMO.academics)).get('/api/recordings')).body.rows.length).toBeGreaterThan(0);
  });

  it('replacing the video checks it is really a video', async () => {
    const r = await seeded();
    const send = async (buf: Buffer, name: string) => (await anon()).post(`/api/recordings/${r.id}/replace`).set('Authorization', `Bearer ${await tokenFor(DEMO.kochiAdmin)}`).attach('file', buf, name);
    expect((await send(Buffer.from('not really a video'), 'class.webm')).status).toBe(400);
    const webm = Buffer.concat([Buffer.from('1a45dfa3', 'hex'), Buffer.alloc(500, 1)]);
    expect((await send(webm, 'edited.webm')).status).toBe(201);
    expect(await prisma().auditLog.count({ where: { entityId: r.id, action: 'recording.replace' } })).toBe(1);
  });

  it('expired recordings go to the bin, and are removed for good after 7 days', async () => {
    const svc = (await getApp()).get(RecordingsService);
    const r = await prisma().recording.findFirstOrThrow({ where: { session: { batch: { name: 'Afternoon Batch' } } } });
    await prisma().recording.update({ where: { id: r.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await svc.retention();
    expect((await prisma().recording.findUniqueOrThrow({ where: { id: r.id } })).deletedAt).not.toBeNull();
    await svc.retention(new Date(Date.now() + 8 * 86400_000));
    expect(await prisma().recording.findUnique({ where: { id: r.id } })).toBeNull();
    expect(await prisma().fileObject.findUnique({ where: { id: r.fileId! } })).toBeNull();
  });
});
