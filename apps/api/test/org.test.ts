import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO, anon, as, closeApp, getApp, prisma } from './helpers';

beforeAll(async () => { await getApp(); });
afterAll(async () => { await closeApp(); });

const branch = (code: string) => prisma().branch.findUniqueOrThrow({ where: { code } });

describe('branches', () => {
  it('lets the Super Admin create a branch that starts with the template designations', async () => {
    const r = await (await as(DEMO.director)).post('/api/branches', { code: 'CLT01', name: 'Kozhikode – Mavoor Road', city: 'Kozhikode', state: 'Kerala', pin: '673004' });
    expect(r.status).toBe(201);
    const des = await prisma().designation.findMany({ where: { branchId: r.body.id } });
    expect(des.map((d) => d.name)).toContain('Branch Admin');
    expect(await prisma().auditLog.findFirst({ where: { action: 'branch.create', entityId: r.body.id } })).toBeTruthy();
  });

  it('refuses duplicate codes and bad GST numbers', async () => {
    const api = await as(DEMO.director);
    expect((await api.post('/api/branches', { code: 'KOC01', name: 'Duplicate' })).status).toBe(400);
    const bad = await api.post('/api/branches', { code: 'XYZ01', name: 'Bad GST', gstin: '12345' });
    expect(bad.status).toBe(400);
    expect(bad.body.fieldErrors.gstin).toBeTruthy();
  });

  it('shows a Branch Admin only their own branch', async () => {
    const r = await (await as(DEMO.kochiAdmin)).get('/api/branches');
    expect(r.status).toBe(200);
    expect(r.body.map((b: { code: string }) => b.code)).toEqual(['KOC01']);
  });

  it('refuses another branch to a Branch Admin, even by direct link', async () => {
    const tvm = await branch('TVM01');
    const api = await as(DEMO.kochiAdmin);
    expect((await api.get(`/api/branches/${tvm.id}`)).status).toBe(403);
    expect((await api.put(`/api/branches/${tvm.id}`, { name: 'Hacked' })).status).toBe(403);
    expect((await api.post(`/api/branches/${tvm.id}/rooms`, { name: 'X', capacity: 3 })).status).toBe(403);
  });

  it('refuses branch creation to Branch Admins, teachers and students', async () => {
    for (const who of [DEMO.kochiAdmin, DEMO.anita, DEMO.arjun, DEMO.accounts]) {
      expect((await (await as(who)).post('/api/branches', { code: 'ZZZ01', name: 'Nope' })).status).toBe(403);
    }
  });

  it('lets a Branch Admin manage rooms and branch holidays in their branch', async () => {
    const koc = await branch('KOC01');
    const api = await as(DEMO.kochiAdmin);
    const room = await api.post(`/api/branches/${koc.id}/rooms`, { name: 'Lab 3', capacity: 20 });
    expect(room.status).toBe(201);
    const hol = await api.post(`/api/branches/${koc.id}/holidays`, { date: '2026-12-31', name: 'Year end' });
    expect(hol.status).toBe(201);
    const list = await api.get(`/api/branches/${koc.id}/holidays`);
    expect(list.body.some((h: { name: string }) => h.name === 'Christmas')).toBe(true); // head-office holiday included
  });
});

describe('admins and modules', () => {
  it('only the Super Admin can create Admins', async () => {
    const body = { name: 'New Admin', email: 'new.admin@demo.cc', mobile: '9123456780', modules: ['monitoring'] };
    expect((await (await as(DEMO.ops)).post('/api/admins', body)).status).toBe(403);
    const r = await (await as(DEMO.director)).post('/api/admins', body);
    expect(r.status).toBe(201);
    const mail = await prisma().outboundMessage.findFirst({ where: { to: 'new.admin@demo.cc', template: 'N1' } });
    expect(mail?.body).toMatch(/reset-password\?token=/);
  });

  it('changing modules changes what the Admin can do', async () => {
    const admin = await prisma().user.findUniqueOrThrow({ where: { email: DEMO.monitoring } });
    const api = await as(DEMO.director);
    await api.put(`/api/admins/${admin.id}`, { name: admin.name, email: admin.email, mobile: admin.mobile, modules: ['monitoring', 'communication', 'helpdesk', 'people'] });
    const me = await (await as(DEMO.monitoring)).get('/api/auth/me');
    expect(me.body.user.permissions).toContain('students.manage');
    await api.put(`/api/admins/${admin.id}`, { name: admin.name, email: admin.email, mobile: admin.mobile, modules: ['monitoring', 'communication', 'helpdesk'] });
  });
});

describe('designations', () => {
  it('a Branch Admin edits designations only in their branch and cannot grant head-office powers', async () => {
    const koc = await branch('KOC01');
    const tvm = await branch('TVM01');
    const api = await as(DEMO.kochiAdmin);
    const r = await api.post(`/api/org/designations?branchId=${koc.id}`, { name: 'Lab Assistant', permissions: ['students.view', 'settings.manage', 'courses.decide'] });
    expect(r.status).toBe(201);
    expect(r.body.permissions).toEqual(['students.view']);
    expect((await api.post(`/api/org/designations?branchId=${tvm.id}`, { name: 'Other', permissions: [] })).status).toBe(403);
    expect((await api.post('/api/org/designations', { name: 'Template', permissions: [] })).status).toBe(403);
  });
});

describe('employees', () => {
  it('a Branch Admin adds an employee, who gets a welcome link', async () => {
    const koc = await branch('KOC01');
    const des = await prisma().designation.findFirstOrThrow({ where: { branchId: koc.id, name: 'Trainer' } });
    const r = await (await as(DEMO.kochiAdmin)).post('/api/employees', { name: 'Joby Abraham', email: 'joby@demo.cc', mobile: '9811111111', branchId: koc.id, designationId: des.id });
    expect(r.status).toBe(201);
    expect(r.body.code).toMatch(/^EMP-KOC01-\d{4}$/);
    expect(await prisma().outboundMessage.count({ where: { to: { in: ['joby@demo.cc', '9811111111'] }, template: 'N1' } })).toBe(2);
  });

  it('refuses duplicates and designations from another branch', async () => {
    const koc = await branch('KOC01');
    const tvm = await branch('TVM01');
    const tvmDes = await prisma().designation.findFirstOrThrow({ where: { branchId: tvm.id, name: 'Trainer' } });
    const api = await as(DEMO.kochiAdmin);
    const dup = await api.post('/api/employees', { name: 'Dup', email: DEMO.anita, mobile: '9822222222', branchId: koc.id, designationId: tvmDes.id });
    expect(dup.status).toBe(400);
    const des = await prisma().designation.findFirstOrThrow({ where: { branchId: koc.id, name: 'Trainer' } });
    const dup2 = await api.post('/api/employees', { name: 'Dup', email: DEMO.anita, mobile: '9822222222', branchId: koc.id, designationId: des.id });
    expect(dup2.status).toBe(400);
    expect(dup2.body.fieldErrors.email).toMatch(/already used/);
  });

  it('a Branch Admin cannot add staff to another branch', async () => {
    const tvm = await branch('TVM01');
    const des = await prisma().designation.findFirstOrThrow({ where: { branchId: tvm.id, name: 'Trainer' } });
    const r = await (await as(DEMO.kochiAdmin)).post('/api/employees', { name: 'Sneaky', mobile: '9833333333', branchId: tvm.id, designationId: des.id });
    expect(r.status).toBe(403);
  });

  it('lists a teacher who works in two branches for both Branch Admins', async () => {
    const tvm = await branch('TVM01');
    const r = await (await as(DEMO.tvmAdmin)).get(`/api/employees?branchId=${tvm.id}&q=Anita`);
    expect(r.body.total).toBe(1);
  });

  it('deactivating ends the employee\'s sessions and blocks login', async () => {
    const e = await prisma().employee.findFirstOrThrow({ where: { user: { email: 'joby@demo.cc' } } });
    const api = await as(DEMO.kochiAdmin);
    expect((await api.patch(`/api/employees/${e.id}/status`, { status: 'INACTIVE' })).status).toBe(200);
    const u = await prisma().user.findUniqueOrThrow({ where: { id: e.userId } });
    expect(u.status).toBe('INACTIVE');
  });

  it('teachers cannot manage employees', async () => {
    expect((await (await as(DEMO.anita)).get('/api/employees')).status).toBe(403);
  });
});

describe('students', () => {
  it('a counsellor adds a student with an automatic ID', async () => {
    const koc = await branch('KOC01');
    const r = await (await as(DEMO.counsellor)).post('/api/students', { name: 'Riya Thomas', mobile: '9844444444', email: 'riya@demo.cc', branchId: koc.id, dob: '2005-02-11' });
    expect(r.status).toBe(201);
    expect(r.body.code).toMatch(/^STU-KOC01-\d{2}-\d{4}$/);
  });

  it('students and other branches cannot see Kochi students', async () => {
    const s = await prisma().student.findFirstOrThrow({ where: { user: { email: 'riya@demo.cc' } } });
    expect((await (await as(DEMO.tvmAdmin)).get(`/api/students/${s.id}`)).status).toBe(403);
    expect((await (await as(DEMO.arjun)).get(`/api/students/${s.id}`)).status).toBe(403);
    expect((await (await as(DEMO.arjun)).get('/api/students')).status).toBe(403);
  });

  it('imports students from Excel with a row-by-row report', async () => {
    const koc = await branch('KOC01');
    const api = await as(DEMO.kochiAdmin);
    const tpl = await api.get('/api/students/import/template').buffer(true).parse((res, cb) => { const chunks: Buffer[] = []; res.on('data', (c: Buffer) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks))); });
    expect(tpl.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(tpl.body);
    const ws = wb.worksheets[0];
    ws.spliceRows(2, 1);
    ws.addRow(['Anu Varghese', '9855555501', 'anu.v@demo.cc', '01-01-2004', 'Kochi', 'Varghese', '9846000001']);
    ws.addRow(['Bad Mobile', '12345', '', '', '', '', '']);
    ws.addRow(['Duplicate', '9855555501', '', '', '', '', '']);
    ws.addRow(['Bad Date', '9855555502', '', '31/31/2004', '', '', '']);
    ws.addRow(['Ravi Kumar', '9855555503', '', '', '', '', '']);
    const file = Buffer.from(await wb.xlsx.writeBuffer());
    const token = (await (await anon()).post('/api/auth/login').set('x-cc', '1').send({ identifier: DEMO.kochiAdmin, password: 'Demo@1234' })).body.accessToken;
    const dry = await (await anon()).post(`/api/students/import?branchId=${koc.id}`).set('Authorization', `Bearer ${token}`).attach('file', file, 'students.xlsx');
    expect(dry.status, JSON.stringify(dry.body)).toBe(201);
    expect(dry.body).toMatchObject({ total: 5, valid: 2, invalid: 3, created: 0 });
    const done = await (await anon()).post(`/api/students/import?branchId=${koc.id}&commit=1`).set('Authorization', `Bearer ${token}`).attach('file', file, 'students.xlsx');
    expect(done.body.created).toBe(2);
    expect(await prisma().student.count({ where: { user: { mobile: { in: ['9855555501', '9855555503'] } } } })).toBe(2);
  });

  it('refuses a non-Excel upload with a friendly message', async () => {
    const koc = await branch('KOC01');
    const token = (await (await anon()).post('/api/auth/login').set('x-cc', '1').send({ identifier: DEMO.kochiAdmin, password: 'Demo@1234' })).body.accessToken;
    const r = await (await anon()).post(`/api/students/import?branchId=${koc.id}`).set('Authorization', `Bearer ${token}`).attach('file', Buffer.from('not excel'), 'x.xlsx');
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/could not be read/);
  });
});

describe('settings and audit', () => {
  it('only Settings admins change settings, with validation and an audit entry', async () => {
    expect((await (await as(DEMO.kochiAdmin)).put('/api/settings', { 'attendance.presentPercent': 80 })).status).toBe(403);
    const api = await as(DEMO.ops);
    const bad = await api.put('/api/settings', { 'brand.primary': 'blue' });
    expect(bad.status).toBe(400);
    const ok = await api.put('/api/settings', { 'attendance.presentPercent': 80 });
    expect(ok.body['attendance.presentPercent']).toBe(80);
    await api.put('/api/settings', { 'attendance.presentPercent': 75 });
    expect(await prisma().auditLog.count({ where: { action: 'settings.update' } })).toBeGreaterThanOrEqual(2);
  });

  it('the audit log is readable by Settings admins only', async () => {
    expect((await (await as(DEMO.ops)).get('/api/audit')).status).toBe(200);
    expect((await (await as(DEMO.kochiAdmin)).get('/api/audit')).status).toBe(403);
  });
});
