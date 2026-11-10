import ExcelJS from 'exceljs';
import { expect, lastMessageTo, login, logout, noHorizontalScroll, test } from './fixtures';

test('director adds a branch and its Branch Admin, who sets a password from the welcome link', async ({ page }) => {
  await login(page, 'director@demo.cc');
  await page.getByRole('link', { name: 'Branches' }).click();
  await page.getByRole('button', { name: 'Add branch' }).click();
  const dlg = page.getByRole('dialog', { name: 'Add a branch' });
  await dlg.getByLabel('Branch code').fill('TCR01');
  await dlg.getByLabel('Branch name').fill('Thrissur – Round North');
  await dlg.getByLabel('City').fill('Thrissur');
  await dlg.getByLabel('State').fill('Kerala');
  await dlg.getByLabel('PIN code').fill('680001');
  await dlg.getByRole('button', { name: 'Add branch' }).click();
  await expect(page.getByRole('heading', { name: /Thrissur – Round North/ })).toBeVisible();
  await expect(page.getByText('No Branch Admin yet')).toBeVisible();

  await page.getByRole('button', { name: 'Add Branch Admin' }).click();
  const emp = page.getByRole('dialog', { name: 'Add a Branch Admin' });
  await emp.getByLabel('Full name').fill('Reshma Paul');
  await emp.getByLabel(/^Mobile/).fill('9744000001');
  await emp.getByLabel('Email').fill('tcr.admin@demo.cc');
  await expect(emp.getByLabel('Designation')).toHaveValue(/.+/);
  await emp.getByRole('button', { name: 'Add employee' }).click();
  await expect(page.getByText('Reshma Paul', { exact: true })).toBeVisible();
  const admins = await (await page.request.get('/api/employees?q=Reshma')).json();
  expect(admins.rows[0].branch.code).toBe('TCR01');

  // Rooms tab
  await page.getByRole('tab', { name: /Rooms/ }).click();
  await page.getByRole('button', { name: 'Add room' }).click();
  await page.getByRole('dialog').getByLabel('Room name').fill('Lab A');
  await page.getByRole('dialog').getByLabel('Seats').fill('28');
  await page.getByRole('button', { name: 'Save room' }).click();
  await expect(page.getByRole('cell', { name: 'Lab A' })).toBeVisible();
  await logout(page);

  const mail = await lastMessageTo(page, 'tcr.admin@demo.cc');
  const path = /\/reset-password\?token=[\w-]+/.exec(mail.body)![0];
  await page.goto(path);
  await page.getByLabel('New password').fill('Thrissur2026');
  await page.getByLabel('Type it again').fill('Thrissur2026');
  await page.getByRole('button', { name: 'Save new password' }).click();
  await login(page, 'tcr.admin@demo.cc', 'Thrissur2026');
  await expect(page).toHaveURL(/first-login/);
  await page.getByLabel(/I have read and agree/).check();
  await page.getByRole('button', { name: 'Agree and continue' }).click();
  await page.getByRole('link', { name: 'Branches' }).click();
  await expect(page.getByRole('cell', { name: 'TCR01' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'KOC01' })).toHaveCount(0);
});

test('Branch Admin adds a student and uploads students from Excel', async ({ page }) => {
  await login(page, 'kochi.admin@demo.cc');
  await page.getByRole('link', { name: 'Students' }).click();
  await page.getByRole('button', { name: 'Add student' }).click();
  const dlg = page.getByRole('dialog', { name: 'Add a student' });
  await dlg.getByLabel('Full name').fill('Nandana Suresh');
  await dlg.getByLabel(/^Mobile/).fill('9744000101');
  await dlg.getByLabel('Email').fill('nandana@demo.cc');
  await dlg.getByLabel('Date of birth').fill('2004-07-21');
  await expect(dlg.getByLabel(/^Home branch/)).not.toHaveValue(''); // their only branch is picked for them
  await dlg.getByRole('button', { name: 'Add student' }).click();
  await expect(page.getByText(/Nandana Suresh added/)).toBeVisible();

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Students');
  ws.addRow(['Full name', 'Mobile', 'Email', 'Date of birth (DD-MM-YYYY)', 'Address', 'Guardian name', 'Guardian mobile']);
  ws.addRow(['Excel One', '9744000201', 'excel1@demo.cc', '01-02-2003', '', '', '']);
  ws.addRow(['Excel Two', '9744000202', '', '', '', '', '']);
  ws.addRow(['Broken Row', '123', '', '', '', '', '']);
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());

  await page.getByRole('button', { name: 'Upload Excel' }).click();
  const imp = page.getByRole('dialog', { name: 'Upload students from Excel' });
  await imp.locator('input[type=file]').setInputFiles({ name: 'students.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer });
  await imp.getByRole('button', { name: 'Check file' }).click();
  await expect(imp.getByText('2 of 3 rows are ready')).toBeVisible();
  await expect(imp.getByText('Mobile must be a 10-digit Indian number')).toBeVisible();
  await imp.getByRole('button', { name: 'Import 2 students' }).click();
  await expect(imp.getByText('2 students imported')).toBeVisible();
  await imp.getByRole('button', { name: 'Done' }).click();

  await page.getByPlaceholder('Search name, ID, email, mobile').fill('Excel');
  await expect(page.getByRole('link', { name: /Excel One/ })).toBeVisible();
  await page.getByRole('link', { name: /Excel One/ }).click();
  await expect(page.getByRole('heading', { name: /Excel One/ })).toBeVisible();
  await expect(page.getByText(/STU-KOC01-\d{2}-\d{4}/)).toBeVisible();
  await page.getByRole('button', { name: 'Change status' }).click();
  await page.getByRole('dialog').getByLabel('Status').selectOption('ON_HOLD');
  await page.getByRole('button', { name: 'Save status' }).click();
  await expect(page.getByText('Status changed')).toBeVisible();
});

test('Branch Admin cannot open another branch', async ({ page }) => {
  await login(page, 'kochi.admin@demo.cc');
  const res = await page.request.get('/api/branches/options');
  const own = (await res.json()) as { code: string }[];
  expect(own.map((b) => b.code)).toEqual(['KOC01']);
  const all = await page.request.get('/api/branches');
  expect((await all.json()).length).toBe(1);
});

test('designations: a Branch Admin creates one with chosen permissions', async ({ page }) => {
  await login(page, 'kochi.admin@demo.cc');
  await page.getByRole('link', { name: 'Departments & designations' }).click();
  await page.getByRole('button', { name: 'Add' }).nth(1).click();
  const dlg = page.getByRole('dialog', { name: 'Add a designation' });
  await dlg.getByLabel(/^Name/).fill('Placement Officer');
  await dlg.getByLabel('See students').check();
  await dlg.getByLabel('Answer help desk tickets').check();
  await dlg.getByRole('button', { name: 'Save designation' }).click();
  await expect(page.getByText('Placement Officer')).toBeVisible();
});

test('settings: change an attendance rule and see it in the audit log', async ({ page }) => {
  await login(page, 'ops@demo.cc');
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Attendance' }).click();
  await page.getByLabel('Late after (minutes)').fill('12');
  await page.getByRole('button', { name: 'Save attendance' }).click();
  await expect(page.getByText('Settings saved')).toBeVisible();
  await page.getByRole('link', { name: 'Audit log' }).click();
  await expect(page.getByText(/Changed 1 setting: attendance.lateMinutes/)).toBeVisible();
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Attendance' }).click();
  await page.getByLabel('Late after (minutes)').fill('10');
  await page.getByRole('button', { name: 'Save attendance' }).click();
  await expect(page.getByText('Settings saved')).toBeVisible();
});

test('director gives an Admin a new module', async ({ page }) => {
  await login(page, 'director@demo.cc');
  await page.getByRole('link', { name: 'Admins & modules' }).click();
  await page.getByRole('button', { name: 'Edit modules' }).first().click();
  const dlg = page.getByRole('dialog');
  await expect(dlg.getByRole('heading', { name: /Edit/ })).toBeVisible();
  await dlg.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Admin updated')).toBeVisible();
});

test('phone layout: menu drawer and lists fit the screen', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 760 });
  await login(page, 'kochi.admin@demo.cc');
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('dialog', { name: 'Menu' }).getByRole('link', { name: 'Employees' }).click();
  await expect(page.getByRole('heading', { name: 'Employees' })).toBeVisible();
  await noHorizontalScroll(page);
});
