import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AttendanceModule } from '../src/modules/attendance/attendance.module';
import { ensureDemoClass } from '../src/seed/live';
import { DEMO, anon, as, closeApp, getApp, prisma, tokenFor } from './helpers';

let sessionId: string;
let batchId: string;
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(64, 1)]);
const min = (m: number) => new Date(Date.now() + m * 60_000);

beforeAll(async () => { await getApp(); });
afterAll(async () => { await closeApp(); });
beforeEach(async () => {
  ({ sessionId, batchId } = await ensureDemoClass(prisma()));
  await prisma().attendance.deleteMany({ where: { sessionId } });
  await prisma().attendanceRequest.deleteMany({ where: { sessionId } });
  await prisma().checkinWindow.deleteMany({ where: { sessionId } });
  await prisma().batch.update({ where: { id: batchId }, data: { checkinRequired: false } });
});

const student = (email: string) => prisma().student.findFirstOrThrow({ where: { user: { email } }, include: { user: true } });
const job = async () => (await getApp()).get(AttendanceModule);

/** A 2-hour class that ran from 120 minutes ago until now, with these stays (minutes from the start). */
async function pastClass(stays: Record<string, [number, number][]>) {
  const start = min(-120);
  await prisma().session.update({ where: { id: sessionId }, data: { startsAt: start, endsAt: min(0), status: 'LIVE', liveStartedAt: start } });
  for (const [email, list] of Object.entries(stays)) {
    const s = await student(email);
    for (const [a, b] of list) {
      await prisma().presenceInterval.create({ data: { sessionId, userId: s.userId, role: 'student', joinedAt: new Date(start.getTime() + a * 60_000), leftAt: new Date(start.getTime() + b * 60_000) } });
    }
  }
}
const statusOf = async (email: string) => (await prisma().attendance.findFirst({ where: { sessionId, student: { user: { email } } } }))?.status;

describe('automatic attendance', () => {
  it('ending the class saves Present, Late and Absent from time in class (reconnects merged)', async () => {
    await pastClass({ [DEMO.arjun]: [[0, 60], [55, 120]], [DEMO.diya]: [[20, 120]] });
    const t = await as(DEMO.anita);
    const live = await t.get(`/api/attendance/sessions/${sessionId}`);
    expect(live.status).toBe(200);
    expect(live.body.rows.find((r: { name: string }) => r.name === 'Arjun Nair').status).toBe('PRESENT');
    expect((await t.post(`/api/live/sessions/${sessionId}/control`, { action: 'end' })).status).toBe(200);
    expect(await statusOf(DEMO.arjun)).toBe('PRESENT');
    expect(await statusOf(DEMO.diya)).toBe('LATE');
    const others = await prisma().attendance.findMany({ where: { sessionId, status: 'ABSENT' } });
    expect(others.length).toBe(4);
    expect(others[0].reason).toBe('Did not join');
    expect((await prisma().session.findUniqueOrThrow({ where: { id: sessionId } })).attendanceFinalizedAt).not.toBeNull();
  });

  it('when check-ins are required, a missed check-in means Absent; late answers are refused', async () => {
    await prisma().batch.update({ where: { id: batchId }, data: { checkinRequired: true } });
    await pastClass({ [DEMO.arjun]: [[0, 120]], [DEMO.diya]: [[0, 120]] });
    const t = await as(DEMO.anita);
    const w = await t.post(`/api/attendance/sessions/${sessionId}/checkins`);
    expect(w.status).toBe(201);
    expect((await t.post(`/api/attendance/sessions/${sessionId}/checkins`)).status).toBe(400); // one at a time
    const open = await (await as(DEMO.arjun)).get(`/api/attendance/sessions/${sessionId}/checkin`);
    expect(open.body.open.windowId).toBe(w.body.id);
    expect((await (await as(DEMO.arjun)).post(`/api/attendance/checkins/${w.body.id}`)).status).toBe(200);
    expect((await (await as(DEMO.anita)).post(`/api/attendance/checkins/${w.body.id}`)).status).toBe(403); // teachers don't check in
    await prisma().checkinWindow.update({ where: { id: w.body.id }, data: { closesAt: min(-1) } });
    expect((await (await as(DEMO.diya)).post(`/api/attendance/checkins/${w.body.id}`)).status).toBe(400);
    await t.post(`/api/live/sessions/${sessionId}/control`, { action: 'end' });
    expect(await statusOf(DEMO.arjun)).toBe('PRESENT');
    const diya = await prisma().attendance.findFirstOrThrow({ where: { sessionId, student: { user: { email: DEMO.diya } } } });
    expect(diya.status).toBe('ABSENT');
    expect(diya.reason).toBe('Missed a check-in');
  });

  it('the job saves attendance for classes nobody ended, and closes them', async () => {
    await pastClass({ [DEMO.arjun]: [[0, 120]] });
    await prisma().session.update({ where: { id: sessionId }, data: { endsAt: min(-70) } });
    await (await job()).finalizeEnded();
    const s = await prisma().session.findUniqueOrThrow({ where: { id: sessionId } });
    expect(s.status).toBe('COMPLETED');
    expect(await statusOf(DEMO.arjun)).toBe('PRESENT');
  });
});

describe('text in every language', () => {
  it('stores Malayalam, Hindi, emoji and ₹ in chat, and arrows in the audit log (database is Unicode)', async () => {
    const enc = await prisma().$queryRaw<{ e: string }[]>`SELECT pg_encoding_to_char(encoding) AS e FROM pg_database WHERE datname = current_database()`;
    expect(enc[0].e).toBe('UTF8');
    await (await as(DEMO.anita)).post(`/api/live/sessions/${sessionId}/join`);
    const text = 'നമസ്കാരം 🙏 नमस्ते · fee ₹1,23,456';
    const r = await (await as(DEMO.arjun)).post(`/api/live/sessions/${sessionId}/chat`, { text });
    expect(r.status).toBe(201);
    expect((await (await as(DEMO.arjun)).get(`/api/live/sessions/${sessionId}/chat`)).body[0].text).toBe(text);
    await pastClass({});
    await (await as(DEMO.anita)).post(`/api/live/sessions/${sessionId}/control`, { action: 'end' });
    const diya = await student(DEMO.diya);
    const m = await (await as(DEMO.anita)).put(`/api/attendance/sessions/${sessionId}`, { marks: [{ studentId: diya.id, status: 'EXCUSED', reason: 'ആശുപത്രി (hospital)' }] });
    expect(m.status).toBe(200);
    const log = await prisma().auditLog.findFirstOrThrow({ where: { action: 'attendance.mark', entityId: sessionId } });
    expect(log.summary).toContain('ABSENT → EXCUSED');
  });
});

describe('roster and manual marks', () => {
  it('the teacher overrides online attendance only with a reason; it is audited; automatic saves keep it', async () => {
    await pastClass({ [DEMO.arjun]: [[0, 120]] });
    const diya = await student(DEMO.diya);
    const t = await as(DEMO.anita);
    const audits = await prisma().auditLog.count({ where: { action: 'attendance.mark', entityId: sessionId } });
    expect((await t.put(`/api/attendance/sessions/${sessionId}`, { marks: [{ studentId: diya.id, status: 'PRESENT' }] })).status).toBe(400);
    expect((await t.put(`/api/attendance/sessions/${sessionId}`, { marks: [{ studentId: diya.id, status: 'PRESENT', reason: 'Was in class on my phone hotspot' }] })).status).toBe(200);
    await t.post(`/api/live/sessions/${sessionId}/control`, { action: 'end' });
    const row = await prisma().attendance.findFirstOrThrow({ where: { sessionId, studentId: diya.id } });
    expect(row.status).toBe('PRESENT');
    expect(row.source).toBe('MANUAL');
    expect(await prisma().auditLog.count({ where: { action: 'attendance.mark', entityId: sessionId } })).toBe(audits + 1);
  });

  it('offline classes use a roster without reasons; unmarked students are saved Absent', async () => {
    const s = await prisma().session.findFirstOrThrow({ where: { batch: { name: 'Weekend Batch' }, status: 'SCHEDULED' }, orderBy: { startsAt: 'asc' }, include: { batch: { include: { enrolments: true } } } });
    await prisma().session.update({ where: { id: s.id }, data: { startsAt: min(-180), endsAt: min(-60) } });
    const [first, second] = s.batch.enrolments;
    const t = await as('priya.trainer@demo.cc');
    const r = await t.put(`/api/attendance/sessions/${s.id}`, { marks: [{ studentId: first.studentId, status: 'PRESENT' }, { studentId: second.studentId, status: 'EXCUSED' }] });
    expect(r.status).toBe(200);
    await (await job()).finalizeEnded();
    const rows = await prisma().attendance.findMany({ where: { sessionId: s.id } });
    expect(rows.find((x) => x.studentId === first.studentId)!.source).toBe('ROSTER');
    expect(rows.find((x) => x.studentId === second.studentId)!.status).toBe('EXCUSED');
    expect(rows.filter((x) => x.source === 'NONE').every((x) => x.status === 'ABSENT')).toBe(true);
  });

  it('attendance locks 48 hours after the class: teacher refused, Branch Admin allowed', async () => {
    await pastClass({});
    await prisma().session.update({ where: { id: sessionId }, data: { startsAt: min(-60 * 60), endsAt: min(-59 * 60), status: 'COMPLETED' } });
    const arjun = await student(DEMO.arjun);
    const mark = { marks: [{ studentId: arjun.id, status: 'EXCUSED', reason: 'Medical certificate received' }] };
    const teacher = await (await as(DEMO.rahul)).put(`/api/attendance/sessions/${sessionId}`, mark);
    expect(teacher.status).toBe(403);
    expect(teacher.body.message).toMatch(/locked/);
    expect((await (await as(DEMO.kochiAdmin)).put(`/api/attendance/sessions/${sessionId}`, mark)).status).toBe(200);
  });

  it('students, other branches and unrelated teachers cannot see or change a roster', async () => {
    for (const who of [DEMO.arjun, DEMO.tvmAdmin, DEMO.sanjay, DEMO.accounts]) {
      expect((await (await as(who)).get(`/api/attendance/sessions/${sessionId}`)).status, who).toBe(403);
    }
    const arjun = await student(DEMO.arjun);
    expect((await (await as(DEMO.tvmAdmin)).put(`/api/attendance/sessions/${sessionId}`, { marks: [{ studentId: arjun.id, status: 'PRESENT', reason: 'x x x' }] })).status).toBe(403);
    expect((await (await as(DEMO.arjun)).post(`/api/attendance/sessions/${sessionId}/checkins`)).status).toBe(403);
  });
});

describe('attendance requests', () => {
  async function endedWithBothAbsent() {
    await pastClass({});
    await (await as(DEMO.anita)).post(`/api/live/sessions/${sessionId}/control`, { action: 'end' });
  }

  it('student asks with a screenshot, teacher approves as Late, student is told; asking twice is refused', async () => {
    await endedWithBothAbsent();
    const s = await as(DEMO.arjun);
    const upload = async (buf: Buffer, name: string) => (await anon()).post('/api/attendance/requests/attachment').set('Authorization', `Bearer ${await tokenFor(DEMO.arjun)}`).attach('file', buf, name);
    const up = await upload(PNG, 'screenshot.png');
    expect(up.status).toBe(201);
    const fake = await upload(Buffer.from('just text pretending'), 'shot.png');
    expect(fake.status).toBe(400); // type checked from content, not the name
    const r = await s.post('/api/attendance/requests', { sessionId, reason: 'My internet dropped', note: 'Power cut at home', attachmentId: up.body.id });
    expect(r.status).toBe(201);
    expect((await s.post('/api/attendance/requests', { sessionId, reason: 'Other' })).status).toBe(400);

    const t = await as(DEMO.anita);
    const list = await t.get('/api/attendance/requests');
    const mine = list.body.rows.find((x: { id: string }) => x.id === r.body.id);
    expect(mine.canDecide).toBe(true);
    const link = await t.get(`/api/attendance/requests/${r.body.id}/attachment`);
    const file = await (await anon()).get(link.body.url);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toBe('image/png');
    expect((await (await anon()).get(link.body.url.replace(/s=[^&]+/, 's=forged'))).status).toBe(404);

    expect((await (await as(DEMO.diya)).get(`/api/attendance/requests/${r.body.id}/attachment`)).status).toBe(403);
    expect((await t.post(`/api/attendance/requests/${r.body.id}/decision`, { approve: true, status: 'LATE' })).status).toBe(200);
    expect(await statusOf(DEMO.arjun)).toBe('LATE');
    expect((await t.post(`/api/attendance/requests/${r.body.id}/decision`, { approve: false, note: 'Changed my mind' })).status).toBe(400);
    const arjun = await student(DEMO.arjun);
    expect(await prisma().notification.count({ where: { userId: arjun.userId, type: 'N6', title: { contains: 'approved' } } })).toBeGreaterThan(0);
    expect(await prisma().auditLog.count({ where: { action: 'attendance.request.approve', entityId: r.body.id } })).toBe(1);
  });

  it('undecided requests escalate to the Branch Admin; then only they decide, and a rejection needs a reason', async () => {
    await endedWithBothAbsent();
    const r = await (await as(DEMO.diya)).post('/api/attendance/requests', { sessionId, reason: 'I missed the check-in' });
    expect(r.status).toBe(201);
    expect((await (await as(DEMO.tvmAdmin)).post(`/api/attendance/requests/${r.body.id}/decision`, { approve: true })).status).toBe(403);
    await prisma().attendanceRequest.update({ where: { id: r.body.id }, data: { createdAt: min(-3 * 24 * 60) } });
    await (await job()).escalate();
    expect((await prisma().attendanceRequest.findUniqueOrThrow({ where: { id: r.body.id } })).status).toBe('ESCALATED');
    const bindu = await prisma().user.findUniqueOrThrow({ where: { email: DEMO.kochiAdmin } });
    expect(await prisma().notification.count({ where: { userId: bindu.id, type: 'N6' } })).toBeGreaterThan(0);
    expect((await (await as(DEMO.rahul)).post(`/api/attendance/requests/${r.body.id}/decision`, { approve: true })).status).toBe(403);
    const admin = await as(DEMO.kochiAdmin);
    expect((await admin.post(`/api/attendance/requests/${r.body.id}/decision`, { approve: false })).status).toBe(400);
    expect((await admin.post(`/api/attendance/requests/${r.body.id}/decision`, { approve: false, note: 'No sign of you in class' })).status).toBe(200);
    expect(await statusOf(DEMO.diya)).toBe('ABSENT');
  });

  it('requests are only allowed within 3 days, after the class, for your own batch', async () => {
    await endedWithBothAbsent();
    await prisma().session.update({ where: { id: sessionId }, data: { endsAt: min(-4 * 24 * 60) } });
    const late = await (await as(DEMO.arjun)).post('/api/attendance/requests', { sessionId, reason: 'Other' });
    expect(late.status).toBe(400);
    expect(late.body.message).toMatch(/within 3 days/);
    const other = await prisma().session.findFirstOrThrow({ where: { batch: { name: 'Evening Batch – Hybrid' } } });
    expect((await (await as(DEMO.arjun)).post('/api/attendance/requests', { sessionId: other.id, reason: 'Other' })).status).toBe(403);
    expect((await (await as(DEMO.anita)).post('/api/attendance/requests', { sessionId, reason: 'Other' })).status).toBe(403);
  });
});

describe('student view, overview and alerts', () => {
  it('a student sees their attendance percentage per batch and which classes they can still request', async () => {
    await pastClass({});
    await (await as(DEMO.anita)).post(`/api/live/sessions/${sessionId}/control`, { action: 'end' });
    const r = await (await as(DEMO.arjun)).get('/api/me/attendance');
    expect(r.status).toBe(200);
    const demo = r.body.batches.find((b: { batch: { name: string } }) => b.batch.name === 'Live Demo Class');
    expect(demo.sessions[0].attendance.status).toBe('ABSENT');
    expect(demo.sessions[0].canRequest).toBe(true);
    const morning = r.body.batches.find((b: { batch: { name: string } }) => b.batch.name === 'Morning Batch A');
    expect(morning.percent).toBeGreaterThan(50);
    expect((await (await as(DEMO.anita)).get('/api/me/attendance')).status).toBe(403);
  });

  it('Branch Admin overview lists low-attendance students; other branches are refused', async () => {
    const koc = await prisma().branch.findUniqueOrThrow({ where: { code: 'KOC01' } });
    const r = await (await as(DEMO.kochiAdmin)).get(`/api/attendance/overview?branchId=${koc.id}`);
    expect(r.status).toBe(200);
    expect(r.body.low.length).toBeGreaterThan(0);
    expect(r.body.low[0].percent).toBeLessThan(75);
    expect((await (await as(DEMO.tvmAdmin)).get(`/api/attendance/overview?branchId=${koc.id}`)).status).toBe(403);
    expect((await (await as(DEMO.rahul)).get('/api/attendance/overview')).status).toBe(403);
  });

  it('low attendance alerts go to the student and Branch Admin once a week', async () => {
    const before = await prisma().notification.count({ where: { type: 'N7' } });
    await (await job()).lowAttendanceAlerts();
    const after = await prisma().notification.count({ where: { type: 'N7' } });
    expect(after).toBeGreaterThan(before);
    await (await job()).lowAttendanceAlerts();
    expect(await prisma().notification.count({ where: { type: 'N7' } })).toBe(after);
  });
});
