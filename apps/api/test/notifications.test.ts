import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HelpdeskModule } from '../src/modules/helpdesk/helpdesk.module';
import { ClassReminderJob } from '../src/modules/notifications/notifications.controller';
import { NotifyService } from '../src/modules/notifications/notify.service';
import { ensureDemoClass } from '../src/seed/live';
import { DEMO, as, closeApp, getApp, prisma } from './helpers';

beforeAll(async () => { await getApp(); });
afterAll(async () => { await closeApp(); });
const uid = async (email: string) => (await prisma().user.findUniqueOrThrow({ where: { email } })).id;
const SUB = { endpoint: 'https://push.example.test/abc123', keys: { p256dh: 'BOrLx2kG7n2Z1dP4o2bY5fAq9oG2xk3', auth: 'k8JV6vR1aXQ' } };

describe('notification centre and preferences', () => {
  it('lists my notifications, counts unread and marks them read', async () => {
    const n = (await getApp()).get(NotifyService);
    await n.send(await uid(DEMO.diya), { type: 'N10', title: 'Test feedback note', link: '/learn/performance' });
    const d = await as(DEMO.diya);
    const list = await d.get('/api/notifications');
    expect(list.body.unread).toBeGreaterThan(0);
    expect(list.body.rows[0].title).toBe('Test feedback note');
    await d.post('/api/notifications/read', { all: true });
    expect((await d.get('/api/notifications')).body.unread).toBe(0);
  });

  it('email and push can be switched off for ordinary messages, never for essential ones', async () => {
    const d = await as(DEMO.diya);
    await d.put('/api/notifications/prefs', { prefs: [{ type: 'N10', email: false, push: false }, { type: 'N12', email: false, push: false }] });
    const prefs = await d.get('/api/notifications/prefs');
    expect(prefs.body.find((p: { type: string }) => p.type === 'N10')).toMatchObject({ email: false, push: false });
    expect(prefs.body.find((p: { type: string }) => p.type === 'N12')).toMatchObject({ email: true, push: true, essential: true });
    // With a browser subscribed, pushes are recorded in the test mailbox
    expect((await d.post('/api/notifications/push-subscriptions', SUB)).status).toBe(201);
    const n = (await getApp()).get(NotifyService);
    const before = await prisma().outboundMessage.count({ where: { channel: 'PUSH', to: DEMO.diya } });
    await n.send(await uid(DEMO.diya), { type: 'N10', title: 'Muted feedback', email: true });
    expect(await prisma().outboundMessage.count({ where: { channel: 'PUSH', to: DEMO.diya } })).toBe(before);
    expect(await prisma().outboundMessage.count({ where: { channel: 'EMAIL', to: DEMO.diya, subject: 'Muted feedback' } })).toBe(0);
    await n.send(await uid(DEMO.diya), { type: 'N12', title: 'Fee due today', email: true });
    expect(await prisma().outboundMessage.count({ where: { channel: 'PUSH', to: DEMO.diya } })).toBe(before + 1);
    expect(await prisma().outboundMessage.count({ where: { channel: 'EMAIL', to: DEMO.diya, subject: 'Fee due today' } })).toBe(1);
    await d.delete('/api/notifications/push-subscriptions');
  });

  it('message wording is editable in Settings and used for email and SMS', async () => {
    const admin = await as(DEMO.ops); // Settings module
    expect((await (await as(DEMO.kochiAdmin)).put('/api/settings/templates/N13', { body: 'x x x' })).status).toBe(403);
    expect((await admin.put('/api/settings/templates/N13', { subject: 'Thank you {name}', body: 'Dear {name},\n{title}. {body}', smsBody: 'CampusConnect: {title}', smsTemplateId: '1107161234567890' })).status).toBe(200);
    await (await getApp()).get(NotifyService).send(await uid(DEMO.arjun), { type: 'N13', title: 'Payment received: ₹1,000', body: 'Receipt RCPT/KOC01/2026/09999', email: true, sms: true });
    const email = await prisma().outboundMessage.findFirstOrThrow({ where: { channel: 'EMAIL', to: DEMO.arjun, template: 'N13' }, orderBy: { createdAt: 'desc' } });
    expect(email.subject).toBe('Thank you Arjun Nair');
    expect(email.body).toContain('Dear Arjun Nair,');
    const sms = await prisma().outboundMessage.findFirstOrThrow({ where: { channel: 'SMS', template: 'N13' }, orderBy: { createdAt: 'desc' } });
    expect(sms.body).toBe('CampusConnect: Payment received: ₹1,000');
    await admin.delete('/api/settings/templates/N13');
  });

  it('students are told 15 minutes before class (once) and when the teacher starts it', async () => {
    const { sessionId } = await ensureDemoClass(prisma());
    await prisma().session.update({ where: { id: sessionId }, data: { startsAt: new Date(Date.now() + 14 * 60_000), endsAt: new Date(Date.now() + 74 * 60_000) } });
    const job = (await getApp()).get(ClassReminderJob);
    const arjun = await uid(DEMO.arjun);
    const before = await prisma().notification.count({ where: { type: 'N3', userId: arjun } });
    await job.run();
    await job.run();
    expect(await prisma().notification.count({ where: { type: 'N3', userId: arjun } })).toBe(before + 1);
    const b4 = await prisma().notification.count({ where: { type: 'N4', userId: arjun } });
    await (await as(DEMO.anita)).post(`/api/live/sessions/${sessionId}/join`);
    expect(await prisma().notification.count({ where: { type: 'N4', userId: arjun } })).toBe(b4 + 1);
  });
});

describe('help desk', () => {
  it('a student raises a ticket; the branch replies, works on it and resolves it; the student can reopen within 7 days', async () => {
    const st = await as(DEMO.arjun);
    const t = await st.post('/api/helpdesk/tickets', { category: 'CLASS', subject: 'Cannot see the recording', description: 'Class 5 recording does not play.' });
    expect(t.status).toBe(201);
    expect(t.body.number).toMatch(/^TKT-KOC01-\d{6}$/);
    expect(await prisma().notification.count({ where: { type: 'N17', userId: await uid(DEMO.kochiAdmin), title: { contains: t.body.number } } })).toBe(1);
    expect((await (await as(DEMO.tvmAdmin)).get(`/api/helpdesk/tickets/${t.body.id}`)).status).toBe(403);
    expect((await (await as(DEMO.diya)).get(`/api/helpdesk/tickets/${t.body.id}`)).status).toBe(403);
    const admin = await as(DEMO.kochiAdmin);
    await admin.post(`/api/helpdesk/tickets/${t.body.id}/messages`, { body: 'Checked: the file is being replaced.', internal: true });
    const seen = await st.get(`/api/helpdesk/tickets/${t.body.id}`);
    expect(seen.body.messages).toHaveLength(1); // internal note hidden from the student
    await admin.post(`/api/helpdesk/tickets/${t.body.id}/messages`, { body: 'Please try again now.', status: 'RESOLVED' });
    const done = await prisma().ticket.findUniqueOrThrow({ where: { id: t.body.id } });
    expect(done.status).toBe('RESOLVED');
    expect(done.firstResponseAt).not.toBeNull();
    expect(await prisma().outboundMessage.count({ where: { channel: 'EMAIL', to: DEMO.arjun, template: 'N17' } })).toBeGreaterThan(0);
    expect((await st.post(`/api/helpdesk/tickets/${t.body.id}/status`, { status: 'OPEN' })).body.status).toBe('OPEN');
    await prisma().ticket.update({ where: { id: t.body.id }, data: { status: 'RESOLVED', resolvedAt: new Date(Date.now() - 8 * 86400_000) } });
    expect((await st.post(`/api/helpdesk/tickets/${t.body.id}/status`, { status: 'OPEN' })).status).toBe(403);
    expect((await st.post(`/api/helpdesk/tickets/${t.body.id}/status`, { status: 'IN_PROGRESS' })).status).toBe(403);
  });

  it('unanswered tickets escalate to the Help Desk Admin after 3 business days; branches see only their own', async () => {
    const mod = (await getApp()).get(HelpdeskModule);
    const st = await as(DEMO.diya);
    const t = await st.post('/api/helpdesk/tickets', { category: 'OTHER', subject: 'Wi-Fi password', description: 'The lab Wi-Fi password changed.' });
    await prisma().ticket.update({ where: { id: t.body.id }, data: { createdAt: new Date(Date.now() - 6 * 86400_000) } });
    await mod.sla();
    expect((await prisma().ticket.findUniqueOrThrow({ where: { id: t.body.id } })).escalatedAt).not.toBeNull();
    expect(await prisma().notification.count({ where: { type: 'N17', userId: await uid(DEMO.monitoring), title: { contains: 'Escalated' } } })).toBeGreaterThan(0);
    const list = await (await as(DEMO.kochiAdmin)).get('/api/helpdesk/tickets?status=open');
    expect(list.body.rows.find((r: { id: string }) => r.id === t.body.id).replyOverdue).toBe(true);
    const tvm = await (await as(DEMO.tvmAdmin)).get('/api/helpdesk/tickets');
    expect(tvm.body.rows.every((r: { branch: { code: string } }) => r.branch.code === 'TVM01')).toBe(true);
    const all = await (await as(DEMO.monitoring)).get('/api/helpdesk/tickets?escalated=1');
    expect(all.body.rows.map((r: { id: string }) => r.id)).toContain(t.body.id);
    expect((await (await as(DEMO.arjun)).get('/api/helpdesk/tickets')).body.rows.every((r: { raisedBy: { name: string } }) => r.raisedBy.name === 'Arjun Nair')).toBe(true);
  });
});
