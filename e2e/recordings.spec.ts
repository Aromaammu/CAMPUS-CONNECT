import { expect, login, test } from './fixtures';

test('a student watches a class recording in the app, with their name as watermark and no download', async ({ page }) => {
  await login(page, 'arjun.student@demo.cc');
  await page.getByRole('link', { name: 'My courses' }).click();
  await page.getByRole('link', { name: /Python Full Stack, Morning Batch A/ }).click();
  await page.getByRole('tab', { name: 'Recordings' }).click();
  const list = page.getByRole('list', { name: 'Recordings' });
  await expect(list.getByRole('link')).toHaveCount(2); // the hidden one is not shown
  await list.getByRole('link').first().click();
  const video = page.getByLabel(/^Recording:/);
  await expect(video).toBeVisible();
  await expect(video).toHaveAttribute('controlslist', /nodownload/);
  await expect(page.getByTestId('watermark')).toContainText('Arjun Nair');
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 15_000 }).toBeGreaterThan(0);
});

test('a class is recorded automatically and appears in the batch after it ends', async ({ page, another, request }) => {
  const { sessionId } = (await (await request.post('/api/dev/demo-class', { headers: { 'x-cc': '1' } })).json()) as { sessionId: string };
  await login(page, 'anita.trainer@demo.cc');
  await page.goto(`/live/${sessionId}`);
  await page.getByRole('button', { name: 'Start class' }).click();
  await expect(page.getByRole('status', { name: 'This class is being recorded' })).toBeVisible({ timeout: 20_000 });
  const arjun = await another('arjun.student@demo.cc');
  await arjun.goto(`/live/${sessionId}`);
  await arjun.getByRole('button', { name: 'Join class' }).click();
  await expect(arjun.getByRole('status', { name: 'This class is being recorded' })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'More options' }).click();
  await page.getByRole('button', { name: 'End class for everyone' }).click();
  await page.getByRole('dialog', { name: 'End the class for everyone?' }).getByRole('button', { name: 'End class' }).click();
  await expect(arjun.getByRole('heading', { name: 'The class has ended' })).toBeVisible({ timeout: 15_000 });
  await arjun.getByRole('link', { name: 'Back to the batch' }).click();
  await arjun.getByRole('tab', { name: 'Recordings' }).click();
  await expect(arjun.getByRole('list', { name: 'Recordings' }).getByRole('link', { name: /Live Demo Class · Class 1/ }).first()).toBeVisible();
});

test('Branch Admin renames, hides, deletes and restores a recording', async ({ page }) => {
  await login(page, 'kochi.admin@demo.cc');
  await page.getByRole('link', { name: 'Recordings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Recordings' })).toBeVisible();
  const first = page.getByRole('list', { name: 'Recordings' }).getByRole('listitem').first();
  await first.getByRole('button', { name: /^Rename/ }).click();
  await page.getByRole('dialog', { name: 'Rename recording' }).getByLabel('Title').fill('Django forms – full class');
  await page.getByRole('dialog', { name: 'Rename recording' }).getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Django forms – full class')).toBeVisible();
  const row = page.getByRole('listitem').filter({ hasText: 'Django forms – full class' });
  await row.getByRole('button', { name: 'Hide' }).click();
  await expect(row.getByText('Hidden', { exact: true })).toBeVisible();
  await row.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('Recording deleted')).toBeVisible();
  await page.getByRole('tab', { name: 'Recently deleted' }).click();
  await page.getByRole('listitem').filter({ hasText: 'Django forms – full class' }).getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByText('Recording restored')).toBeVisible();
});
