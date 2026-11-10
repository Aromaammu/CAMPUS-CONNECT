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

// Phase 3: the class room (C3 pre-join check, C4 live class room), teacher and student side.
test('live class screens', async ({ page, another, request }, info) => {
  const r = await request.post('/api/dev/demo-class', { headers: { 'x-cc': '1' } });
  const { sessionId } = (await r.json()) as { sessionId: string };
  const shot = (p: typeof page, name: string) => p.screenshot({ path: `${OUT}/${info.project.name}-live-${slug(name)}.png` });
  const wide = (page.viewportSize()?.width ?? 1366) >= 1024;

  await login(page, 'anita.trainer@demo.cc');
  await page.goto(`/live/${sessionId}`);
  await expect(page.getByText('You are joining as Teacher')).toBeVisible();
  await expect(page.getByLabel('Your camera preview')).toBeVisible();
  await page.waitForFunction(() => (document.querySelector('video[aria-label="Your camera preview"]') as HTMLVideoElement | null)?.readyState === 4);
  await noHorizontalScroll(page);
  await page.screenshot({ path: `${OUT}/${info.project.name}-live-teacher-pre-join.png`, fullPage: true });
  await page.getByRole('button', { name: 'Start class' }).click();
  await expect(page.getByRole('main', { name: 'Class video' })).toBeVisible({ timeout: 20_000 });

  const student = await another('arjun.student@demo.cc', page.viewportSize() ?? undefined);
  await student.goto(`/live/${sessionId}`);
  await expect(student.getByText('You are joining as Student')).toBeVisible();
  await student.waitForFunction(() => (document.querySelector('video[aria-label="Your camera preview"]') as HTMLVideoElement | null)?.readyState === 4);
  await noHorizontalScroll(student);
  await student.screenshot({ path: `${OUT}/${info.project.name}-live-student-pre-join.png`, fullPage: true });
  await student.getByRole('button', { name: 'Join class' }).click();
  await expect(page.locator('.lk-participant-tile')).toHaveCount(2, { timeout: 20_000 });
  await expect(student.locator('.lk-participant-tile')).toHaveCount(2, { timeout: 20_000 });
  if (!wide) await student.getByRole('button', { name: 'Chat', exact: true }).click();
  await student.getByRole('textbox', { name: 'Message' }).fill('Good morning!');
  await student.getByRole('button', { name: 'Send message' }).click();
  await student.getByRole('button', { name: 'Raise your hand' }).click();
  await expect(page.getByRole('button', { name: '1 raised hands' })).toBeVisible();
  await page.waitForTimeout(1500); // let video frames arrive
  await noHorizontalScroll(student);
  await shot(student, 'student-room-chat');
  if (!wide) await student.getByRole('button', { name: 'Close chat' }).click();
  await shot(student, 'student-room');

  await page.getByRole('button', { name: 'People', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Raised hands' })).toBeVisible();
  await noHorizontalScroll(page);
  await shot(page, 'teacher-room-people');
  await page.getByRole('button', { name: 'More options' }).click();
  await expect(page.getByRole('region', { name: 'Class controls' })).toBeVisible();
  await shot(page, 'teacher-class-controls');
  await page.getByRole('button', { name: 'End class for everyone' }).click();
  await page.getByRole('dialog', { name: 'End the class for everyone?' }).getByRole('button', { name: 'End class' }).click();
  await expect(student.getByRole('heading', { name: 'The class has ended' })).toBeVisible({ timeout: 15_000 });
  await shot(student, 'student-class-ended');
});

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
