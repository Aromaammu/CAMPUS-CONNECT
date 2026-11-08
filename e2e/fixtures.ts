import { Page, expect, test as base } from '@playwright/test';

export const PASSWORD = 'Demo@1234';

/** Fails the test on any console error, uncaught exception or failed API request. */
export const test = base.extend<{ watch: void }>({
  watch: [async ({ page }, use) => {
    const problems: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error' && !/Download the React DevTools|Failed to load resource: the server responded with a status of 4\d\d/.test(m.text())) problems.push(`console: ${m.text()}`); });
    page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
    page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 500) problems.push(`API ${r.status()} ${r.url()}`); });
    await use();
    expect(problems, problems.join('\n')).toEqual([]);
  }, { auto: true }],
});
export { expect };

export async function login(page: Page, email: string, password = PASSWORD) {
  await page.goto('/login');
  await page.getByLabel('Email or mobile number').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

export async function logout(page: Page) {
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Log out' }).click();
  await page.waitForURL('**/login');
}

export async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, 'page scrolls sideways').toBeLessThanOrEqual(1);
}

export async function lastMessageTo(page: Page, to: string) {
  const res = await page.request.get(`/api/dev/mailbox?to=${encodeURIComponent(to)}&take=1`);
  const [m] = await res.json();
  return m as { body: string; subject: string | null };
}
