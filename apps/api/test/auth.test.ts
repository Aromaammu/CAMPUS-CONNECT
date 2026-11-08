import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO, anon, as, closeApp, getApp, prisma } from './helpers';

beforeAll(async () => { await getApp(); });
afterAll(async () => { await closeApp(); });

const login = async (identifier: string, password = 'Demo@1234') => (await anon()).post('/api/auth/login').set('x-cc', '1').send({ identifier, password });
const cookie = (res: { headers: Record<string, unknown> }, name: string) => {
  const list = (res.headers['set-cookie'] as string[] | undefined) ?? [];
  const c = list.find((x) => x.startsWith(`${name}=`));
  return c ? c.split(';')[0].slice(name.length + 1) : undefined;
};

describe('login', () => {
  it('logs in with email and with mobile', async () => {
    expect((await login(DEMO.director)).status).toBe(200);
    const u = await prisma().user.findUniqueOrThrow({ where: { email: DEMO.anita } });
    expect((await login(u.mobile!)).status).toBe(200);
    expect((await login(`+91 ${u.mobile!.slice(0, 5)} ${u.mobile!.slice(5)}`)).status).toBe(200);
  });

  it('gives the same message for unknown users and wrong passwords', async () => {
    const a = await login('nobody@demo.cc');
    const b = await login(DEMO.diya, 'wrong-password1');
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.message).toBe(b.body.message);
  });

  it('locks the account after 5 wrong passwords, even when guesses arrive at once', async () => {
    const email = 'student15@demo.cc';
    await Promise.all([1, 2, 3, 4, 5].map(() => login(email, 'wrong-password1')));
    const r = await login(email);
    expect(r.status).toBe(403);
    expect(r.body.message).toMatch(/Try again in/);
    const audit = await prisma().auditLog.findFirst({ where: { action: 'auth.locked' } });
    expect(audit).toBeTruthy();
  });

  it('refuses inactive accounts', async () => {
    await prisma().user.update({ where: { email: 'student16@demo.cc' }, data: { status: 'INACTIVE' } });
    const r = await login('student16@demo.cc');
    expect(r.status).toBe(403);
  });

  it('blocks state-changing requests that lack the app header (CSRF defence)', async () => {
    const r = await (await anon()).post('/api/auth/login').send({ identifier: DEMO.director, password: 'Demo@1234' });
    expect(r.status).toBe(403);
  });
});

describe('session', () => {
  it('answers quietly for visitors', async () => {
    const r = await (await anon()).get('/api/auth/session');
    expect(r.status).toBe(200);
    expect(r.body.user).toBeNull();
  });

  it('needs a login for private endpoints', async () => {
    expect((await (await anon()).get('/api/auth/me')).status).toBe(401);
  });

  it('returns permissions and branches for an employee', async () => {
    const r = await (await as(DEMO.anita)).get('/api/auth/me');
    expect(r.status).toBe(200);
    expect(r.body.user.kind).toBe('EMPLOYEE');
    expect(r.body.user.permissions).toContain('sessions.teach');
    expect(r.body.user.permissions).not.toContain('settings.manage');
    expect(r.body.user.branchIds).toHaveLength(2);
  });

  it('gives an Admin only the permissions of their modules, in all branches', async () => {
    const r = await (await as(DEMO.accounts)).get('/api/auth/me');
    expect(r.body.user.modules).toEqual(['accounts']);
    expect(r.body.user.permissions).toContain('accounts.approve');
    expect(r.body.user.permissions).not.toContain('students.manage');
    expect(r.body.user.branchIds).toBeNull();
  });

  it('rotates refresh tokens and ends every session when an old one is reused', async () => {
    const first = await login(DEMO.rahul);
    const rt1 = cookie(first, 'cc_rt')!;
    const r2 = await (await anon()).post('/api/auth/refresh').set('x-cc', '1').set('Cookie', `cc_rt=${rt1}`);
    expect(r2.status).toBe(200);
    const rt2 = cookie(r2, 'cc_rt')!;
    expect(rt2).not.toBe(rt1);
    const reuse = await (await anon()).post('/api/auth/refresh').set('x-cc', '1').set('Cookie', `cc_rt=${rt1}`);
    expect(reuse.status).toBe(401);
    const after = await (await anon()).post('/api/auth/refresh').set('x-cc', '1').set('Cookie', `cc_rt=${rt2}`);
    expect(after.status).toBe(401);
  });
});

describe('first login', () => {
  it('blocks everything except the password screen until a new password is set', async () => {
    const res = await login(DEMO.newStaff);
    const t = res.body.accessToken;
    const me = await (await anon()).get('/api/auth/me').set('Authorization', `Bearer ${t}`);
    expect(me.status).toBe(200);
    expect(me.body.user.mustChangePassword).toBe(true);
    expect(me.body.needsConsent).toBe(true);
  });

  it('requires consent, and guardian consent for students under 18', async () => {
    const t = (await login(DEMO.newStudent)).body.accessToken;
    const send = (body: object) => anon().then((a) => a.post('/api/auth/change-password').set('Authorization', `Bearer ${t}`).send(body));
    const noConsent = await send({ newPassword: 'Newpass123', confirmPassword: 'Newpass123' });
    expect(noConsent.status).toBe(400);
    expect(noConsent.body.fieldErrors.consent).toBeTruthy();
    const noGuardian = await send({ newPassword: 'Newpass123', confirmPassword: 'Newpass123', consent: true });
    expect(noGuardian.status).toBe(400);
    expect(noGuardian.body.fieldErrors.guardianConsent).toBeTruthy();
    const ok = await send({ newPassword: 'Newpass123', confirmPassword: 'Newpass123', consent: true, guardianConsent: true });
    expect(ok.status).toBe(200);
    const c = await prisma().consent.findFirst({ where: { user: { email: DEMO.newStudent } } });
    expect(c?.guardianConsent).toBe(true);
    expect((await login(DEMO.newStudent, 'Newpass123')).status).toBe(200);
  });
});

describe('forgot and reset password', () => {
  it('emails a one-time link that sets a new password', async () => {
    const a = await anon();
    expect((await a.post('/api/auth/forgot-password').set('x-cc', '1').send({ identifier: 'student17@demo.cc' })).status).toBe(200);
    const mail = await prisma().outboundMessage.findFirstOrThrow({ where: { to: 'student17@demo.cc' }, orderBy: { createdAt: 'desc' } });
    const token = /token=([\w-]+)/.exec(mail.body)![1];
    const r = await a.post('/api/auth/reset-password').set('x-cc', '1').send({ token, newPassword: 'Fresh1234', confirmPassword: 'Fresh1234' });
    expect(r.status).toBe(200);
    expect((await login('student17@demo.cc', 'Fresh1234')).status).toBe(200);
    const again = await a.post('/api/auth/reset-password').set('x-cc', '1').send({ token, newPassword: 'Other1234', confirmPassword: 'Other1234' });
    expect(again.status).toBe(400);
  });

  it('answers the same for unknown accounts', async () => {
    const r = await (await anon()).post('/api/auth/forgot-password').set('x-cc', '1').send({ identifier: 'ghost@demo.cc' });
    expect(r.status).toBe(200);
  });
});

describe('SMS code login', () => {
  it('logs in with a 6-digit code and refuses wrong codes', async () => {
    const u = await prisma().user.findUniqueOrThrow({ where: { email: 'student18@demo.cc' } });
    const a = await anon();
    expect((await a.post('/api/auth/otp/request').set('x-cc', '1').send({ mobile: u.mobile })).status).toBe(200);
    const sms = await prisma().outboundMessage.findFirstOrThrow({ where: { to: u.mobile! }, orderBy: { createdAt: 'desc' } });
    const code = /^(\d{6})/.exec(sms.body)![1];
    const wrong = code === '000000' ? '111111' : '000000';
    expect((await a.post('/api/auth/otp/verify').set('x-cc', '1').send({ mobile: u.mobile, code: wrong })).status).toBe(401);
    expect((await a.post('/api/auth/otp/verify').set('x-cc', '1').send({ mobile: u.mobile, code })).status).toBe(200);
    expect((await a.post('/api/auth/otp/verify').set('x-cc', '1').send({ mobile: u.mobile, code })).status).toBe(401);
  });

  it('makes people wait 30 seconds between codes', async () => {
    const u = await prisma().user.findUniqueOrThrow({ where: { email: 'student19@demo.cc' } });
    const a = await anon();
    expect((await a.post('/api/auth/otp/request').set('x-cc', '1').send({ mobile: u.mobile })).status).toBe(200);
    expect((await a.post('/api/auth/otp/request').set('x-cc', '1').send({ mobile: u.mobile })).status).toBe(400);
  });
});

describe('audit log', () => {
  it('can never be changed or deleted', async () => {
    const row = await prisma().auditLog.findFirstOrThrow();
    await expect(prisma().auditLog.update({ where: { id: row.id }, data: { summary: 'tampered' } })).rejects.toThrow(/append-only/);
    await expect(prisma().auditLog.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
  });
});
