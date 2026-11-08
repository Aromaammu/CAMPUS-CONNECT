import { expect, lastMessageTo, login, logout, test } from './fixtures';

test('director logs in, sees the dashboard and logs out', async ({ page }) => {
  await login(page, 'director@demo.cc');
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening), Dr\./ })).toBeVisible();
  await expect(page.getByText('Super Admin').first()).toBeVisible();
  await logout(page);
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
});

test('wrong password shows a friendly message', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email or mobile number').fill('diya.student@demo.cc');
  await page.getByLabel('Password').fill('not-it-123');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByText('The email/mobile or password is not correct')).toBeVisible();
});

test('a new student sets a password and gives guardian consent on first login', async ({ page }) => {
  await login(page, 'new.student@demo.cc');
  await expect(page).toHaveURL(/first-login/);
  await page.getByLabel('New password').fill('Kevin2026pass');
  await page.getByLabel('Type it again').fill('Kevin2026pass');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page.getByText('Please accept the Privacy Policy and Terms')).toBeVisible();
  await page.getByLabel(/I have read and agree/).check();
  await page.getByLabel(/My parent or guardian/).check();
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page.getByRole('heading', { name: /Kevin/ })).toBeVisible();
});

test('forgot password sends a link that works', async ({ page }) => {
  await page.goto('/forgot-password');
  await page.getByLabel('Email or mobile number').fill('student20@demo.cc');
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByText(/we have sent a reset link/)).toBeVisible();
  const mail = await lastMessageTo(page, 'student20@demo.cc');
  const path = /\/reset-password\?token=[\w-]+/.exec(mail.body)![0];
  await page.goto(path);
  await page.getByLabel('New password').fill('Reset2026ok');
  await page.getByLabel('Type it again').fill('Reset2026ok');
  await page.getByRole('button', { name: 'Save new password' }).click();
  await expect(page).toHaveURL(/\/login/);
  await login(page, 'student20@demo.cc', 'Reset2026ok');
  await expect(page.getByRole('heading', { name: /Good/ })).toBeVisible();
});

test('SMS code login', async ({ page }) => {
  const res = await page.request.post('/api/auth/login', { headers: { 'x-cc': '1' }, data: { identifier: 'student21@demo.cc', password: 'Demo@1234' } });
  expect(res.ok()).toBeTruthy();
  const session = await (await page.request.get('/api/auth/session')).json();
  const mobile = session.user.mobile as string;
  await page.request.post('/api/auth/logout', { headers: { 'x-cc': '1' } });
  await page.goto('/login');
  await page.getByRole('tab', { name: 'SMS code' }).click();
  await page.getByLabel('Mobile number').fill(mobile);
  await page.getByRole('button', { name: 'Send code' }).click();
  await expect(page.getByLabel('6-digit code')).toBeVisible();
  const sms = await lastMessageTo(page, mobile);
  await page.getByLabel('6-digit code').fill(/^(\d{6})/.exec(sms.body)![1]);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('heading', { name: /Good/ })).toBeVisible();
});

test('profile: change password', async ({ page }) => {
  await login(page, 'student22@demo.cc');
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: /My profile/ }).click();
  await page.getByLabel('Current password').fill('Demo@1234');
  await page.getByLabel('New password').fill('Changed2026');
  await page.getByLabel('Type it again').fill('Changed2026');
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByText('Password changed')).toBeVisible();
});

test('privacy and terms pages are public', async ({ page }) => {
  await page.goto('/privacy');
  await expect(page.getByRole('heading', { name: 'Privacy Policy' })).toBeVisible();
  await expect(page.getByText(/Digital Personal Data Protection Act, 2023/)).toBeVisible();
  await page.goto('/terms');
  await expect(page.getByRole('heading', { name: 'Terms of Use' })).toBeVisible();
});
