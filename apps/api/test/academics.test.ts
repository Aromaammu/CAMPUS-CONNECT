import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO, as, closeApp, getApp, prisma } from './helpers';

beforeAll(async () => { await getApp(); });
afterAll(async () => { await closeApp(); });

const branch = (code: string) => prisma().branch.findUniqueOrThrow({ where: { code } });
const emp = (email: string) => prisma().employee.findFirstOrThrow({ where: { user: { email } } });
const course = (code: string) => prisma().course.findUniqueOrThrow({ where: { code } });
const nextMonday = () => {
  const d = new Date(Date.now() + 7 * 86400000);
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

describe('course catalogue', () => {
  it('branches see only published courses; head office sees drafts too', async () => {
    const branchView = await (await as(DEMO.kochiAdmin)).get('/api/courses');
    expect(branchView.body.map((c: { code: string }) => c.code)).not.toContain('CYB-101');
    const hoView = await (await as(DEMO.academics)).get('/api/courses');
    expect(hoView.body.map((c: { code: string }) => c.code)).toContain('CYB-101');
  });

  it('only Academics admins edit the catalogue', async () => {
    const body = { code: 'NEW-01', name: 'New Course', hours: 10, modules: [{ title: 'Intro' }] };
    expect((await (await as(DEMO.kochiAdmin)).post('/api/courses', body)).status).toBe(403);
    const r = await (await as(DEMO.academics)).post('/api/courses', body);
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('DRAFT');
  });
});

describe('course requests', () => {
  it('branch requests, head office sends back, branch resubmits, head office approves into the catalogue', async () => {
    const koc = await branch('KOC01');
    const req = await (await as(DEMO.kochiAdmin)).post('/api/course-requests', { branchId: koc.id, name: 'UI/UX Design', hours: 30, syllabus: [{ title: 'Figma basics' }] });
    expect(req.status).toBe(201);
    const ho = await as(DEMO.academics);
    expect((await ho.post(`/api/course-requests/${req.body.id}/decision`, { decision: 'SEND_BACK' })).status).toBe(400); // reason needed
    expect((await ho.post(`/api/course-requests/${req.body.id}/decision`, { decision: 'SEND_BACK', note: 'Add a project module' })).status).toBe(201);
    const re = await (await as(DEMO.kochiAdmin)).put(`/api/course-requests/${req.body.id}`, { branchId: koc.id, name: 'UI/UX Design', hours: 30, syllabus: [{ title: 'Figma basics' }, { title: 'Project' }] });
    expect(re.body.status).toBe('PENDING');
    const ok = await ho.post(`/api/course-requests/${req.body.id}/decision`, { decision: 'APPROVE', code: 'UX-01' });
    expect(ok.status).toBe(201);
    const c = await prisma().course.findUniqueOrThrow({ where: { code: 'UX-01' }, include: { modules: true, branchAccess: true } });
    expect(c.status).toBe('PUBLISHED');
    expect(c.allBranches).toBe(false);
    expect(c.branchAccess.map((b) => b.branchId)).toEqual([koc.id]);
    expect(c.modules).toHaveLength(2);
    const note = await prisma().notification.findFirst({ where: { user: { email: DEMO.kochiAdmin }, title: 'Course request approved' } });
    expect(note).toBeTruthy();
    // Only the requesting branch sees it
    expect((await (await as(DEMO.tvmAdmin)).get('/api/courses')).body.map((x: { code: string }) => x.code)).not.toContain('UX-01');
    // Can't decide twice
    expect((await ho.post(`/api/course-requests/${req.body.id}/decision`, { decision: 'REJECT', note: 'again' })).status).toBe(400);
  });

  it('a Branch Admin cannot request for another branch or decide requests', async () => {
    const tvm = await branch('TVM01');
    expect((await (await as(DEMO.kochiAdmin)).post('/api/course-requests', { branchId: tvm.id, name: 'Sneaky', hours: 5 })).status).toBe(403);
    const pending = await prisma().courseRequest.findFirstOrThrow({ where: { status: 'PENDING' } });
    expect((await (await as(DEMO.kochiAdmin)).post(`/api/course-requests/${pending.id}/decision`, { decision: 'APPROVE', code: 'X-1' })).status).toBe(403);
  });
});

describe('batches', () => {
  it('creates a batch with sessions that skip holidays, and previews clashes', async () => {
    const koc = await branch('KOC01');
    const anita = await emp(DEMO.anita);
    const py = await course('PY-FS');
    const api = await as(DEMO.kochiAdmin);
    // Anita already teaches Kochi Morning Batch A at 9–11 Mon–Fri: a clash for the same slot.
    const a = await prisma().batch.findFirstOrThrow({ where: { name: 'Morning Batch A' } });
    const upcoming = await prisma().session.findFirstOrThrow({ where: { batchId: a.id, startsAt: { gt: new Date() } }, orderBy: { startsAt: 'asc' } });
    const startDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(upcoming.startsAt);
    const body = { branchId: koc.id, courseId: py.id, name: 'Morning Batch B', mode: 'ONLINE', startDate, days: [1, 2, 3, 4, 5], startTime: '09:30', endTime: '11:30', capacity: 25, teacherId: anita.id };
    const prev = await api.post('/api/batches/preview', body);
    expect(prev.status).toBe(201);
    expect(prev.body.sessions).toBe(20);
    expect(prev.body.clashCount).toBeGreaterThan(0);
    expect(prev.body.clashes[0].kind).toBe('teacher');
    const r = await api.post('/api/batches', { ...body, startTime: '12:00', endTime: '14:00' });
    expect(r.status).toBe(201);
    const sessions = await prisma().session.findMany({ where: { batchId: r.body.id } });
    expect(sessions).toHaveLength(20);
    expect(r.body.status).toBe('UPCOMING');
  });

  it('refuses rooms or teachers from another branch, and duplicate names', async () => {
    const koc = await branch('KOC01');
    const tvm = await branch('TVM01');
    const tvmRoom = await prisma().room.findFirstOrThrow({ where: { branchId: tvm.id } });
    const sanjay = await emp(DEMO.sanjay);
    const rahul = await emp(DEMO.rahul);
    const py = await course('PY-FS');
    const api = await as(DEMO.kochiAdmin);
    const base = { branchId: koc.id, courseId: py.id, name: 'X Batch', mode: 'HYBRID', startDate: nextMonday(), days: [6], startTime: '10:00', endTime: '12:00', capacity: 20, teacherId: rahul.id, roomId: tvmRoom.id };
    expect((await api.post('/api/batches', base)).status).toBe(400);
    expect((await api.post('/api/batches', { ...base, roomId: undefined, mode: 'ONLINE', teacherId: sanjay.id })).status).toBe(400);
    expect((await api.post('/api/batches', { ...base, mode: 'ONLINE', roomId: undefined, name: 'Morning Batch A' })).status).toBe(400);
  });

  it('refuses a course that is not open to the branch', async () => {
    const tvm = await branch('TVM01');
    const ux = await course('UX-01');
    const sanjay = await emp(DEMO.sanjay);
    const r = await (await as(DEMO.tvmAdmin)).post('/api/batches', { branchId: tvm.id, courseId: ux.id, name: 'UX', mode: 'ONLINE', startDate: nextMonday(), days: [1], startTime: '10:00', endTime: '12:00', capacity: 20, teacherId: sanjay.id });
    expect(r.status).toBe(400);
  });

  it('only the branch can manage its batches', async () => {
    const b = await prisma().batch.findFirstOrThrow({ where: { name: 'Afternoon Batch' } });
    expect((await (await as(DEMO.kochiAdmin)).post(`/api/batches/${b.id}/extend`, { count: 1 })).status).toBe(403);
    expect((await (await as(DEMO.anita)).post(`/api/batches/${b.id}/extend`, { count: 1 })).status).toBe(403);
  });

  it('a teacher sees batches they teach in other branches; others do not', async () => {
    const tvmBatch = await prisma().batch.findFirstOrThrow({ where: { name: 'Afternoon Batch' } });
    expect((await (await as(DEMO.anita)).get(`/api/batches/${tvmBatch.id}`)).status).toBe(200);
    const mine = await (await as(DEMO.anita)).get('/api/batches?mine=1');
    const names = mine.body.map((b: { name: string }) => b.name);
    expect(names).toEqual(expect.arrayContaining(['Afternoon Batch', 'Morning Batch A']));
    expect(names).not.toContain('Evening Batch – Hybrid');
    expect((await (await as(DEMO.kochiAdmin)).get(`/api/batches/${tvmBatch.id}`)).status).toBe(403);
  });

  it('students see only their own batches', async () => {
    const kocBatch = await prisma().batch.findFirstOrThrow({ where: { name: 'Morning Batch A' } });
    const java = await prisma().batch.findFirstOrThrow({ where: { name: 'Evening Batch – Hybrid' } });
    expect((await (await as(DEMO.arjun)).get(`/api/batches/${kocBatch.id}`)).status).toBe(200);
    expect((await (await as(DEMO.arjun)).get(`/api/batches/${java.id}`)).status).toBe(403);
    expect((await (await as(DEMO.arjun)).get(`/api/batches/${kocBatch.id}/enrolments`)).status).toBe(403);
    const mine = await (await as(DEMO.arjun)).get('/api/me/enrolments');
    expect(mine.body.map((e: { batch: { name: string } }) => e.batch.name).sort()).toEqual(['Afternoon Batch', 'Live Demo Class', 'Morning Batch A']);
  });
});

describe('sessions', () => {
  it('reschedule, cancel with a make-up class, and substitute teachers notify the batch', async () => {
    const b = await prisma().batch.findFirstOrThrow({ where: { name: 'Morning Batch A' } });
    const api = await as(DEMO.kochiAdmin);
    const [s1, s2, s3] = await prisma().session.findMany({ where: { batchId: b.id, status: 'SCHEDULED', startsAt: { gt: new Date(Date.now() + 86400000) } }, orderBy: { startsAt: 'asc' }, take: 3 });
    const target = new Date(s1.startsAt.getTime() + 86400000 * 30).toISOString().slice(0, 10);
    const r = await api.post(`/api/batches/sessions/${s1.id}/reschedule`, { date: target, startTime: '15:00', endTime: '17:00' });
    expect(r.status).toBe(201);
    const moved = await prisma().session.findUniqueOrThrow({ where: { id: s1.id } });
    expect(moved.startsAt.toISOString()).toBe(new Date(`${target}T15:00:00+05:30`).toISOString());
    const before = await prisma().session.count({ where: { batchId: b.id } });
    const c = await api.post(`/api/batches/sessions/${s2.id}/cancel`, { reason: 'Teacher training day' });
    expect(c.body.makeUp).toBe(1);
    expect(await prisma().session.count({ where: { batchId: b.id } })).toBe(before + 1);
    const rahul = await emp(DEMO.rahul);
    expect((await api.post(`/api/batches/sessions/${s3.id}/substitute`, { teacherId: rahul.id })).status).toBe(201);
    const arjunNotes = await prisma().notification.findMany({ where: { user: { email: DEMO.arjun }, type: 'N5' } });
    expect(arjunNotes.length).toBeGreaterThanOrEqual(3);
    const sms = await prisma().outboundMessage.findFirst({ where: { template: 'N5', channel: 'SMS', body: { contains: 'cancelled' } } });
    expect(sms).toBeTruthy();
    // Rahul now sees the class in his timetable
    const tt = await (await as(DEMO.rahul)).get(`/api/timetable?from=${new Date(s3.startsAt.getTime() - 1000).toISOString()}&to=${new Date(s3.endsAt.getTime() + 1000).toISOString()}`);
    expect(tt.body.some((x: { id: string; substitute: boolean }) => x.id === s3.id && x.substitute)).toBe(true);
  });

  it('cannot move a class into the past', async () => {
    const b = await prisma().batch.findFirstOrThrow({ where: { name: 'Morning Batch A' } });
    const s = await prisma().session.findFirstOrThrow({ where: { batchId: b.id, status: 'SCHEDULED' }, orderBy: { startsAt: 'desc' } });
    const r = await (await as(DEMO.kochiAdmin)).post(`/api/batches/sessions/${s.id}/reschedule`, { date: '2020-01-01', startTime: '09:00', endTime: '10:00' });
    expect(r.status).toBe(400);
  });
});

describe('enrolments', () => {
  it('enrols up to capacity and refuses one more', async () => {
    const koc = await branch('KOC01');
    const rahul = await emp(DEMO.rahul);
    const dm = await course('DM-AI');
    const api = await as(DEMO.counsellor);
    const b = await (await as(DEMO.kochiAdmin)).post('/api/batches', { branchId: koc.id, courseId: dm.id, name: 'Tiny Batch', mode: 'ONLINE', startDate: nextMonday(), days: [0], startTime: '10:00', endTime: '13:00', capacity: 2, teacherId: rahul.id });
    const students = await prisma().student.findMany({ where: { branchId: koc.id }, take: 3, orderBy: { code: 'desc' } });
    expect((await api.post(`/api/batches/${b.body.id}/enrolments`, { studentIds: students.slice(0, 2).map((s) => s.id) })).body.enrolled).toBe(2);
    const full = await api.post(`/api/batches/${b.body.id}/enrolments`, { studentIds: [students[2].id] });
    expect(full.status).toBe(400);
    expect(full.body.message).toMatch(/seat/);
  });

  it('two people enrolling at once cannot overfill a batch', async () => {
    const koc = await branch('KOC01');
    const rahul = await emp(DEMO.rahul);
    const dm = await course('DM-AI');
    const b = await (await as(DEMO.kochiAdmin)).post('/api/batches', { branchId: koc.id, courseId: dm.id, name: 'Race Batch', mode: 'ONLINE', startDate: nextMonday(), days: [0], startTime: '15:00', endTime: '17:00', capacity: 1, teacherId: rahul.id });
    const students = await prisma().student.findMany({ where: { branchId: koc.id }, take: 2, orderBy: { code: 'asc' }, skip: 5 });
    const [a, c] = await Promise.all([(await as(DEMO.counsellor)).post(`/api/batches/${b.body.id}/enrolments`, { studentIds: [students[0].id] }), (await as(DEMO.kochiAdmin)).post(`/api/batches/${b.body.id}/enrolments`, { studentIds: [students[1].id] })]);
    expect([a.status, c.status].sort()).toEqual([201, 400]);
    expect(await prisma().enrolment.count({ where: { batchId: b.body.id } })).toBe(1);
  });

  it('hold, resume, drop (with a reason) and move to a batch of the same course', async () => {
    const b = await prisma().batch.findFirstOrThrow({ where: { name: 'Morning Batch A' } });
    const target = await prisma().batch.findFirstOrThrow({ where: { name: 'Morning Batch B' } });
    const [e1, e2] = await prisma().enrolment.findMany({ where: { batchId: b.id, status: 'ACTIVE', student: { user: { email: { notIn: [DEMO.arjun, DEMO.diya] } } } }, take: 2 });
    const api = await as(DEMO.counsellor);
    expect((await api.post(`/api/batches/enrolments/${e1.id}/action`, { action: 'HOLD' })).status).toBe(201);
    expect((await api.post(`/api/batches/enrolments/${e1.id}/action`, { action: 'RESUME' })).status).toBe(201);
    expect((await api.post(`/api/batches/enrolments/${e1.id}/action`, { action: 'DROP' })).status).toBe(400);
    expect((await api.post(`/api/batches/enrolments/${e1.id}/action`, { action: 'DROP', note: 'Moved abroad' })).status).toBe(201);
    expect((await api.post(`/api/batches/enrolments/${e2.id}/action`, { action: 'MOVE', toBatchId: target.id })).status).toBe(201);
    expect((await prisma().enrolment.findUniqueOrThrow({ where: { id: e2.id } })).status).toBe('MOVED');
    expect(await prisma().enrolment.count({ where: { batchId: target.id, studentId: e2.studentId, status: 'ACTIVE' } })).toBe(1);
    const java = await prisma().batch.findFirstOrThrow({ where: { name: 'Evening Batch – Hybrid' } });
    const [e3] = await prisma().enrolment.findMany({ where: { batchId: b.id, status: 'ACTIVE' }, take: 1 });
    expect((await api.post(`/api/batches/enrolments/${e3.id}/action`, { action: 'MOVE', toBatchId: java.id })).status).toBe(400);
  });

  it('teachers cannot enrol students', async () => {
    const b = await prisma().batch.findFirstOrThrow({ where: { name: 'Morning Batch A' } });
    const s = await prisma().student.findFirstOrThrow();
    expect((await (await as(DEMO.anita)).post(`/api/batches/${b.id}/enrolments`, { studentIds: [s.id] })).status).toBe(403);
  });
});

describe('timetable', () => {
  it('a student sees classes from both branches they study in', async () => {
    const r = await (await as(DEMO.arjun)).get('/api/timetable');
    const branches = new Set(r.body.map((s: { branchCode: string }) => s.branchCode));
    expect([...branches].sort()).toEqual(['KOC01', 'TVM01']);
  });

  it('a Branch Admin sees the branch timetable but not other branches', async () => {
    const tvm = await branch('TVM01');
    expect((await (await as(DEMO.kochiAdmin)).get(`/api/timetable?scope=branch&branchId=${tvm.id}`)).status).toBe(403);
    const own = await (await as(DEMO.kochiAdmin)).get('/api/timetable?scope=branch');
    expect(own.body.every((s: { branchCode: string }) => s.branchCode === 'KOC01')).toBe(true);
  });
});
