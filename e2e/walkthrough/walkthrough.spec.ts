import { mkdirSync } from 'node:fs';
import { expect, login, noHorizontalScroll, test } from '../fixtures';
import { PUBLIC_STOPS, TOURS } from './screens';

const OUT = 'docs/walkthrough/screens';
mkdirSync(OUT, { recursive: true });

test.describe.configure({ mode: 'serial' });

test('public screens', async ({ page }, info) => {
  for (const stop of PUBLIC_STOPS) {
    await page.goto(stop.path);
    if (stop.expect) await expect(page.getByRole('heading', { name: stop.expect }).first()).toBeVisible();
    await page.waitForLoadState('networkidle');
    await noHorizontalScroll(page);
    await page.screenshot({ path: `${OUT}/${info.project.name}-public-${slug(stop.name)}.png`, fullPage: true });
  }
});

for (const tour of TOURS) {
  test(`${tour.role} screens`, async ({ page }, info) => {
    await login(page, tour.email);
    for (const stop of tour.stops) {
      await page.goto(stop.path);
      await page.waitForLoadState('networkidle');
      if (stop.expect) await expect(page.getByRole('heading', { name: stop.expect }).first()).toBeVisible();
      await expect(page.getByText('Loading…')).toHaveCount(0, { timeout: 15_000 });
      await noHorizontalScroll(page);
      await page.screenshot({ path: `${OUT}/${info.project.name}-${tour.role}-${slug(stop.name)}.png`, fullPage: true });
    }
  });
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
