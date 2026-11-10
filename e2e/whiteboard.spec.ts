import type { Page } from '@playwright/test';
import { expect, login, test } from './fixtures';

/** Count of drawn (non-white) pixels on the whiteboard canvas. */
const ink = (p: Page) => p.evaluate(() => {
  const c = document.querySelector('[aria-label="Whiteboard"] canvas.excalidraw__canvas.static') as HTMLCanvasElement | null;
  if (!c) return -1;
  const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 16) if (d[i] < 200 || d[i + 1] < 200 || d[i + 2] < 200) n++;
  return n;
});

async function drawRectangle(p: Page, x: number, y: number) {
  const box = (await p.locator('[aria-label="Whiteboard"] canvas.excalidraw__canvas.interactive').boundingBox())!;
  await p.locator('[aria-label="Whiteboard"]').getByTitle(/Rectangle/).first().click();
  await p.mouse.move(box.x + x, box.y + y);
  await p.mouse.down();
  await p.mouse.move(box.x + x + 160, box.y + y + 90, { steps: 8 });
  await p.mouse.up();
}

test('shared whiteboard: teacher draws, students watch, a student gets the pen, the board is saved', async ({ page, another, request }) => {
  const { sessionId } = (await (await request.post('/api/dev/demo-class', { headers: { 'x-cc': '1' } })).json()) as { sessionId: string };
  await login(page, 'anita.trainer@demo.cc');
  await page.goto(`/live/${sessionId}`);
  await page.getByRole('button', { name: 'Start class' }).click();
  await expect(page.getByRole('main', { name: 'Class video' })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Close chat' }).click();

  const arjun = await another('arjun.student@demo.cc');
  await arjun.goto(`/live/${sessionId}`);
  await arjun.getByRole('button', { name: 'Join class' }).click();
  await expect(arjun.getByRole('main', { name: 'Class video' })).toBeVisible({ timeout: 20_000 });
  await arjun.getByRole('button', { name: 'Close chat' }).click();

  await page.getByRole('button', { name: 'Open the whiteboard' }).click();
  await expect(page.getByText('Whiteboard: you are drawing')).toBeVisible({ timeout: 20_000 });
  await expect(arjun.getByText('Whiteboard: the teacher is drawing')).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1000);
  const before = await ink(arjun);
  await drawRectangle(page, 420, 300);
  await expect.poll(() => ink(arjun), { timeout: 10_000 }).toBeGreaterThan(before + 50);

  // Give Arjun the pen; his drawing reaches the teacher.
  await page.getByRole('button', { name: 'People', exact: true }).click();
  await page.getByRole('button', { name: 'Actions for Arjun Nair' }).click();
  await page.getByRole('menuitem', { name: 'Give the whiteboard pen' }).click();
  await expect(arjun.getByText('You have the pen', { exact: true })).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Close people' }).click();
  await page.waitForTimeout(500);
  const teacherBefore = await ink(page);
  await drawRectangle(arjun, 620, 420);
  await expect.poll(() => ink(page), { timeout: 10_000 }).toBeGreaterThan(teacherBefore + 50);

  await page.getByRole('button', { name: 'Save to class materials' }).click();
  await expect(page.getByText('Board saved to the class materials')).toBeVisible({ timeout: 15_000 });

  await page.goto(`/sessions/${sessionId}`);
  await page.getByRole('tab', { name: 'Whiteboards' }).click();
  await expect(page.getByRole('img', { name: /Whiteboard 1/ })).toBeVisible();
});
