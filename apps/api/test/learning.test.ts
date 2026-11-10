import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO, anon, as, closeApp, getApp, prisma, tokenFor } from './helpers';

beforeAll(async () => { await getApp(); });
afterAll(async () => { await closeApp(); });
const batch = (name: string) => prisma().batch.findFirstOrThrow({ where: { name } });
const student = (email: string) => prisma().student.findFirstOrThrow({ where: { user: { email } } });
const enrolment = async (email: string, batchName: string) => prisma().enrolment.findFirstOrThrow({ where: { student: { user: { email } }, batch: { name: batchName } } });
const uploadAs = async (email: string, path: string, buf: Buffer, name: string) => (await anon()).post(path).set('Authorization', `Bearer ${await tokenFor(email)}`).attach('file', buf, name);
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 32)]);

describe('materials', () => {
  it('teacher uploads a file and shares it with both of her batches; students of those batches open it, others cannot', async () => {
    const morning = await batch('Morning Batch A');
    const tvm = await batch('Afternoon Batch');
    const share = await (await as(DEMO.anita)).get(`/api/materials/batches?batchId=${morning.id}`);
    expect(share.body.map((b: { name: string }) => b.name)).toEqual(expect.arrayContaining(['Morning Batch A', 'Afternoon Batch']));
    const up = await uploadAs(DEMO.anita, '/api/materials/upload', PDF, 'Week 3 slides.pdf');
    expect(up.status).toBe(201);
    const m = await (await as(DEMO.anita)).post('/api/materials', { title: 'Week 3 slides', batchIds: [morning.id, tvm.id], fileId: up.body.id });
    expect(m.status).toBe(201);
    const list = await (await as(DEMO.arjun)).get(`/api/batches/${tvm.id}/materials`);
    expect(list.body.rows.map((r: { title: string }) => r.title)).toContain('Week 3 slides');
    expect(list.body.canManage).toBe(false);
    const open = await (await as(DEMO.arjun)).get(`/api/materials/${m.body.id}/open?download=1`);
    const file = await (await anon()).get(open.body.url);
    expect(file.headers['content-disposition']).toMatch(/^attachment/);
    expect((await (await as(DEMO.newStudent)).get(`/api/materials/${m.body.id}/open`)).status).toBe(403);
    const arjun = await student(DEMO.arjun);
    expect(await prisma().notification.count({ where: { userId: arjun.userId, type: 'N8' } })).toBeGreaterThan(0);
  });

  it('only batch teachers or the Branch Admin add materials; links must be real links; sharing stays within the course', async () => {
    const morning = await batch('Morning Batch A');
    const java = await batch('Evening Batch – Hybrid');
    expect((await (await as(DEMO.arjun)).post('/api/materials', { title: 'Notes', batchIds: [morning.id], url: 'https://x.io' })).status).toBe(403);
    expect((await (await as(DEMO.sanjay)).post('/api/materials', { title: 'Notes', batchIds: [morning.id], url: 'https://x.io' })).status).toBe(403);
    expect((await (await as(DEMO.anita)).post('/api/materials', { title: 'Notes', batchIds: [morning.id], url: 'javascript:alert(1)' })).status).toBe(400);
    expect((await (await as(DEMO.kochiAdmin)).post('/api/materials', { title: 'Mixed', batchIds: [morning.id, java.id], url: 'https://x.io' })).status).toBe(400);
    const ok = await (await as(DEMO.kochiAdmin)).post('/api/materials', { title: 'Branch notice board', batchIds: [morning.id], url: 'https://example.com/board' });
    expect(ok.status).toBe(201);
    expect((await (await as(DEMO.rahul)).delete(`/api/materials/${ok.body.id}`)).status).toBe(403);
    expect((await (await as(DEMO.kochiAdmin)).delete(`/api/materials/${ok.body.id}`)).status).toBe(200);
  });
});

describe('performance and feedback', () => {
  it('teacher gives 1–5 marks per class; the student sees marks and a running average', async () => {
    const morning = await batch('Morning Batch A');
    const s = await prisma().session.findFirstOrThrow({ where: { batchId: morning.id, status: 'COMPLETED' }, orderBy: { startsAt: 'desc' } });
    const arjun = await student(DEMO.arjun);
    const t = await as(DEMO.anita);
    expect((await t.put(`/api/performance/sessions/${s.id}`, { marks: [{ studentId: arjun.id, mark: 6 }] })).status).toBe(400);
    expect((await t.put(`/api/performance/sessions/${s.id}`, { marks: [{ studentId: arjun.id, mark: 5, remark: 'Great answers' }] })).status).toBe(200);
    const grid = await t.get(`/api/performance/sessions/${s.id}`);
    expect(grid.body.rows.find((r: { studentId: string }) => r.studentId === arjun.id).mark).toBe(5);
    const me = await (await as(DEMO.arjun)).get('/api/me/performance');
    const mb = me.body.find((b: { batch: { name: string } }) => b.batch.name === 'Morning Batch A');
    expect(mb.marks[0]).toMatchObject({ mark: 5, remark: 'Great answers' });
    expect(mb.average).toBeGreaterThan(0);
    expect((await (await as(DEMO.arjun)).put(`/api/performance/sessions/${s.id}`, { marks: [{ studentId: arjun.id, mark: 5 }] })).status).toBe(403);
    expect((await (await as(DEMO.tvmAdmin)).get(`/api/performance/sessions/${s.id}`)).status).toBe(403);
  });

  it('teacher writes feedback and end-of-course forms; the student is told', async () => {
    const morning = await batch('Morning Batch A');
    const diya = await student(DEMO.diya);
    const t = await as(DEMO.anita);
    expect((await t.post('/api/feedback/teacher', { kind: 'TEACHER_NOTE', studentId: diya.id, batchId: morning.id, comment: 'Lovely project idea' })).status).toBe(201);
    const ratings = { understanding: 5, practice: 4, participation: 4, punctuality: 5 };
    expect((await t.post('/api/feedback/teacher', { kind: 'TEACHER_END', studentId: diya.id, batchId: morning.id, ratings })).status).toBe(201);
    await t.post('/api/feedback/teacher', { kind: 'TEACHER_END', studentId: diya.id, batchId: morning.id, ratings: { ...ratings, practice: 5 } });
    expect(await prisma().feedback.count({ where: { kind: 'TEACHER_END', studentId: diya.id } })).toBe(1); // updated, not duplicated
    expect(await prisma().notification.count({ where: { userId: diya.userId, type: 'N10' } })).toBeGreaterThan(0);
    expect((await (await as(DEMO.rahul)).post('/api/feedback/teacher', { kind: 'TEACHER_NOTE', studentId: diya.id, batchId: (await batch('Weekend Batch')).id, comment: 'x x x' })).status).toBe(403);
  });

  it('students rate classes they attended (once each, within a week); teachers see averages without names', async () => {
    const due = await (await as(DEMO.arjun)).get('/api/me/feedback-due');
    expect(due.status).toBe(200);
    const morning = await batch('Morning Batch A');
    const s = await prisma().session.findFirstOrThrow({ where: { batchId: morning.id, status: 'COMPLETED' }, orderBy: { startsAt: 'desc' } });
    const st = await as(DEMO.arjun);
    expect((await st.post(`/api/feedback/sessions/${s.id}/rating`, { rating: 0 })).status).toBe(400);
    expect((await st.post(`/api/feedback/sessions/${s.id}/rating`, { rating: 4, comment: 'Liked the examples' })).status).toBe(201);
    await st.post(`/api/feedback/sessions/${s.id}/rating`, { rating: 5 });
    const arjun = await student(DEMO.arjun);
    expect(await prisma().feedback.count({ where: { kind: 'STUDENT_SESSION', studentId: arjun.id, sessionId: s.id } })).toBe(1);
    const old = await prisma().session.findFirstOrThrow({ where: { batchId: morning.id, status: 'COMPLETED' }, orderBy: { startsAt: 'asc' } });
    if (old.endsAt.getTime() < Date.now() - 7 * 86400_000) expect((await st.post(`/api/feedback/sessions/${old.id}/rating`, { rating: 3 })).status).toBe(400);
    expect((await (await as(DEMO.anita)).post(`/api/feedback/sessions/${s.id}/rating`, { rating: 5 })).status).toBe(403);
    const recv = await (await as(DEMO.anita)).get('/api/feedback/received');
    const mb = recv.body.batches.find((b: { batch: { name: string } }) => b.batch.name === 'Morning Batch A');
    expect(mb.classAverage).toBeGreaterThan(0);
    expect(mb.comments.every((c: { from: string | null }) => c.from === null)).toBe(true);
    expect((await (await as(DEMO.arjun)).post('/api/feedback/course', { batchId: morning.id, ratings: { teaching: 5, content: 4, pace: 3, support: 4 } })).status).toBe(201);
  });
});

describe('final project', () => {
  it('student submits → teacher asks for changes → resubmits (versions kept) → teacher approves → Branch Admin completes the course', async () => {
    const e = await enrolment(DEMO.arjun, 'Morning Batch A');
    const up = await uploadAs(DEMO.arjun, '/api/projects/upload', PDF, 'report.pdf');
    const st = await as(DEMO.arjun);
    expect((await st.post(`/api/me/projects/${e.id}/submit`, { title: 'Blog app' })).status).toBe(400); // needs a link or file
    const s1 = await st.post(`/api/me/projects/${e.id}/submit`, { title: 'Blog app', link: 'https://github.com/arjun/blog', fileIds: [up.body.id] });
    expect(s1.status).toBe(201);
    expect((await st.post(`/api/me/projects/${e.id}/submit`, { title: 'Again', link: 'https://x.io' })).status).toBe(400); // already with the teacher
    const projectId = s1.body.id;
    const t = await as(DEMO.anita);
    const queue = await t.get('/api/projects?stage=review');
    expect(queue.body.map((p: { id: string }) => p.id)).toContain(projectId);
    expect((await t.post(`/api/projects/${projectId}/review`, { decision: 'CHANGES' })).status).toBe(400); // needs a comment
    expect((await t.post(`/api/projects/${projectId}/review`, { decision: 'CHANGES', comment: 'Add comments and tests' })).status).toBe(200);
    expect((await st.post(`/api/me/projects/${e.id}/submit`, { title: 'Blog app v2', link: 'https://github.com/arjun/blog' })).status).toBe(201);
    expect((await (await as(DEMO.kochiAdmin)).post(`/api/projects/${projectId}/review`, { decision: 'APPROVE' })).status).toBe(403); // teacher first
    expect((await t.post(`/api/projects/${projectId}/review`, { decision: 'APPROVE' })).status).toBe(200);
    expect((await (await as(DEMO.tvmAdmin)).post(`/api/projects/${projectId}/review`, { decision: 'APPROVE' })).status).toBe(403);
    expect((await (await as(DEMO.kochiAdmin)).post(`/api/projects/${projectId}/review`, { decision: 'APPROVE' })).status).toBe(200);
    const p = await (await as(DEMO.arjun)).get(`/api/projects/${projectId}`);
    expect(p.body.status).toBe('COMPLETED');
    expect(p.body.submissions.map((x: { version: number }) => x.version)).toEqual([2, 1]);
    expect((await prisma().enrolment.findUniqueOrThrow({ where: { id: e.id } })).status).toBe('COMPLETED');
    expect(await prisma().auditLog.count({ where: { entityId: projectId, action: 'project.approve' } })).toBe(1);
    expect((await (await as(DEMO.diya)).get(`/api/projects/${projectId}`)).status).toBe(403);
  });

  it('submissions are closed until the hours are done or the branch opens them', async () => {
    const e = await enrolment(DEMO.arjun, 'Afternoon Batch');
    const r = await (await as(DEMO.arjun)).post(`/api/me/projects/${e.id}/submit`, { title: 'Early', link: 'https://x.io' });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/open when the course hours are complete/);
    expect((await (await as(DEMO.anita)).post(`/api/batches/${e.batchId}/projects-open`, { open: true })).status).toBe(403);
    expect((await (await as(DEMO.tvmAdmin)).post(`/api/batches/${e.batchId}/projects-open`, { open: true })).status).toBe(200);
    expect((await (await as(DEMO.arjun)).post(`/api/me/projects/${e.id}/submit`, { title: 'Early', link: 'https://x.io' })).status).toBe(201);
  });
});

describe('reports', () => {
  it('students download their attendance and performance reports as PDF; staff of other branches cannot', async () => {
    const a = await (await as(DEMO.diya)).get('/api/reports/students/me/attendance.pdf');
    expect(a.status).toBe(200);
    expect(a.headers['content-type']).toBe('application/pdf');
    expect(a.body.subarray(0, 4).toString()).toBe('%PDF');
    expect((await (await as(DEMO.diya)).get('/api/reports/students/me/performance.pdf')).status).toBe(200);
    const diya = await student(DEMO.diya);
    expect((await (await as(DEMO.kochiAdmin)).get(`/api/reports/students/${diya.id}/attendance.pdf`)).status).toBe(200);
    expect((await (await as(DEMO.tvmAdmin)).get(`/api/reports/students/${diya.id}/attendance.pdf`)).status).toBe(403);
    expect((await (await as(DEMO.arjun)).get(`/api/reports/students/${diya.id}/attendance.pdf`)).status).toBe(403);
  });
});
