import { Page, expect, test as base, type ViewportSize } from '@playwright/test';

export const PASSWORD = 'Demo@1234';

function guard(page: Page, problems: string[], who = '') {
  const tag = who ? `[${who}] ` : '';
  page.on('console', (m) => { if (m.type() === 'error' && !/Download the React DevTools|Failed to load resource: the server responded with a status of 4\d\d/.test(m.text())) problems.push(`${tag}console: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`${tag}page error: ${e.message}`));
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 500) problems.push(`${tag}API ${r.status()} ${r.url()}`); });
}

/** Fails the test on any console error, uncaught exception or failed API request, in every browser it opens. */
export const test = base.extend<{ watch: void; another: (email: string, viewport?: ViewportSize) => Promise<Page> }>({
  watch: [async ({ page }, use) => {
    const problems: string[] = [];
    guard(page, problems);
    await use();
    expect(problems, problems.join('\n')).toEqual([]);
  }, { auto: true }],
  /** A second person in their own browser (own cookies, fake camera and microphone), already logged in. */
  another: async ({ browser, baseURL }, use) => {
    const problems: string[] = [];
    const contexts: Awaited<ReturnType<typeof browser.newContext>>[] = [];
    await use(async (email, viewport) => {
      const ctx = await browser.newContext({ baseURL, permissions: ['camera', 'microphone'], viewport: viewport ?? { width: 1280, height: 860 } });
      contexts.push(ctx);
      const page = await ctx.newPage();
      guard(page, problems, email);
      await login(page, email);
      return page;
    });
    await Promise.all(contexts.map((c) => c.close()));
    expect(problems, problems.join('\n')).toEqual([]);
  },
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
