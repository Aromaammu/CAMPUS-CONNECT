// Quick visual check: node tools/scripts/shot.mjs <path> [email] [width] [out.png] [theme]
// Logs in (if email given), opens the page, saves a screenshot, prints console errors.
import { chromium } from '@playwright/test';

const [path = '/', email, width = '1280', out = 'shot.png', theme = 'light'] = process.argv.slice(2);
const base = process.env.BASE || 'http://localhost:5173';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: Number(width), height: 900 }, colorScheme: theme });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
if (email) {
  await page.goto(base + '/login');
  await page.getByLabel('Email or mobile number').fill(email);
  await page.getByLabel('Password').fill('Demo@1234');
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15000 });
}
await page.goto(base + path);
await page.waitForLoadState('networkidle');
await page.waitForTimeout(500);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
await page.screenshot({ path: out, fullPage: true });
console.log(JSON.stringify({ url: page.url(), overflow, errors }));
await browser.close();
