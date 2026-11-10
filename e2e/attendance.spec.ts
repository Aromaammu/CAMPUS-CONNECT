import type { APIRequestContext } from '@playwright/test';
import { expect, login, noHorizontalScroll, test } from './fixtures';

async function demoClass(request: APIRequestContext) {
  const r = await request.post('/api/dev/demo-class', { headers: { 'x-cc': '1' } });
  return (await r.json()) as { sessionId: string; batchId: string };
}
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(200, 7)]);

test('check-in during a live class, then the teacher reviews and corrects the attendance sheet', async ({ page, another, request }) => {
  const { sessionId } = await demoClass(request);
  await login(page, 'anita.trainer@demo.cc');
  await page.goto(`/live/${sessionId}`);
  await page.getByRole('button', { name: 'Start class' }).click();
  await expect(page.getByRole('main', { name: 'Class video' })).toBeVisible({ timeout: 20_000 });

  const arjun = await another('arjun.student@demo.cc');
  await arjun.goto(`/live/${sessionId}`);
  await arjun.getByRole('button', { name: 'Join class' }).click();
  await expect(arjun.getByRole('main', { name: 'Class video' })).toBeVisible({ timeout: 20_000 });

  // Teacher's live attendance panel and a check-in
  await page.getByRole('button', { name: 'Attendance', exact: true }).click();
  const panel = page.getByRole('list', { name: 'Live attendance' });
  await expect(panel.getByText('Arjun Nair')).toBeVisible();
  await page.getByRole('button', { name: 'Ask students to check in' }).click();
  const prompt = arjun.getByRole('alertdialog', { name: 'Mark your attendance' });
  await expect(prompt).toBeVisible({ timeout: 10_000 });
  await prompt.getByRole('button', { name: "I'm present" }).click();
  await expect(arjun.getByText('You are checked in')).toBeVisible();
  await expect(page.getByText(/1 of \d+ answered/)).toBeVisible({ timeout: 15_000 });

  // End the class; attendance is saved
  await page.getByRole('button', { name: 'More options' }).click();
  await page.getByRole('button', { name: 'End class for everyone' }).click();
  await page.getByRole('dialog', { name: 'End the class for everyone?' }).getByRole('button', { name: 'End class' }).click();
  await expect(page.getByRole('heading', { name: 'The class has ended' })).toBeVisible({ timeout: 15_000 });

  // Attendance sheet from the batch page
  await page.goto('/teach/batches');
  await page.getByRole('link', { name: /Live Demo Class/ }).click();
  await page.getByRole('main').getByRole('link', { name: 'Attendance', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: /Live Demo Class · Class 1/ })).toBeVisible();
  const sheet = page.getByRole('list', { name: 'Attendance sheet' });
  const diya = sheet.getByRole('listitem', { name: 'Diya Menon' });
  await expect(diya.getByText(/Did not join/)).toBeVisible();
  await expect(sheet.getByRole('listitem', { name: 'Arjun Nair' }).getByText(/check-ins 1\/1/)).toBeVisible();

  // Override needs a reason
  await diya.getByRole('radio', { name: 'Excused' }).click();
  await page.getByRole('button', { name: 'Save attendance' }).click();
  await expect(page.getByText('Give a reason when you change online attendance')).toBeVisible();
  await diya.getByLabel('Reason for Diya Menon').fill('Medical leave, informed in advance');
  await page.getByRole('button', { name: 'Save attendance' }).click();
  await expect(page.getByText('Attendance saved (1 changed)')).toBeVisible();
  await expect(diya.getByText(/Medical leave/)).toBeVisible();

  // Chat log tab
  await page.getByRole('tab', { name: 'Chat log' }).click();
  await expect(page.getByText('No chat messages in this class')).toBeVisible();
});

test('a student requests attendance with a screenshot and the teacher approves it', async ({ page, another, request }) => {
  const { sessionId } = await demoClass(request);
  // Class runs and ends without Diya.
  await login(page, 'anita.trainer@demo.cc');
  await page.goto(`/live/${sessionId}`);
  await page.getByRole('button', { name: 'Start class' }).click();
  await expect(page.getByRole('main', { name: 'Class video' })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'More options' }).click();
  await page.getByRole('button', { name: 'End class for everyone' }).click();
  await page.getByRole('dialog', { name: 'End the class for everyone?' }).getByRole('button', { name: 'End class' }).click();
  await expect(page.getByRole('heading', { name: 'The class has ended' })).toBeVisible({ timeout: 15_000 });

  const diya = await another('diya.student@demo.cc');
  await diya.getByRole('link', { name: 'Attendance' }).click();
  await expect(diya.getByRole('heading', { name: 'Attendance' })).toBeVisible();
  const classes = diya.getByRole('list', { name: 'Classes in Live Demo Class' });
  await classes.getByRole('button', { name: 'Request attendance' }).first().click();
  const dlg = diya.getByRole('dialog', { name: 'Request attendance' });
  await dlg.getByLabel(/^Reason/).selectOption('My internet dropped');
  await dlg.getByLabel('More details (optional)').fill('Power cut in Kakkanad');
  await dlg.getByLabel('Screenshot (optional)').setInputFiles({ name: 'router.png', mimeType: 'image/png', buffer: PNG });
  await expect(dlg.getByText('router.png attached')).toBeVisible();
  await dlg.getByRole('button', { name: 'Send request' }).click();
  await expect(diya.getByText('Request sent to your teacher')).toBeVisible();
  await expect(classes.getByText(/Request: Waiting for teacher/)).toBeVisible();

  await page.goto('/');
  await page.getByRole('link', { name: 'Attendance requests' }).click();
  const card = page.getByRole('region', { name: 'Request from Diya Menon' });
  await expect(card.getByText('Power cut in Kakkanad')).toBeVisible();
  await expect(card.getByRole('button', { name: 'View screenshot' })).toBeVisible();
  await card.getByRole('button', { name: 'Approve as Present' }).click();
  await expect(page.getByText('Approved. The student has been told.')).toBeVisible();

  await diya.reload();
  await expect(classes.getByText(/Request: Approved/)).toBeVisible();
  await expect(classes.getByText('Present').first()).toBeVisible();
});

test('Branch Admin sees attendance by batch and students below the minimum', async ({ page }) => {
  await login(page, 'kochi.admin@demo.cc');
  await page.getByRole('link', { name: 'Attendance', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Attendance' })).toBeVisible();
  await page.getByRole('tab', { name: /By batch/ }).click();
  await expect(page.getByText(/Morning Batch A/)).toBeVisible();
  await page.getByRole('tab', { name: /Low attendance/ }).click();
  await expect(page.getByRole('list', { name: 'Low attendance' }).getByRole('listitem').first()).toBeVisible();
});

test('Branch Admin corrects a classroom roster after the teacher lock; phone layout fits', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await login(page, 'blr.admin@demo.cc');
  await page.goto('/batches');
  await page.getByRole('link', { name: /Weekend Batch/ }).first().click();
  await page.getByRole('button', { name: /Show \d+ past classes/ }).click();
  await noHorizontalScroll(page);
  await page.screenshot({ path: 'test-results/phone-class-rows.png', fullPage: true });
  await page.getByRole('main').getByRole('link', { name: 'Attendance', exact: true }).first().click();
  await expect(page.getByText('Attendance is locked')).toBeVisible();
  await noHorizontalScroll(page);
  const first = page.getByRole('list', { name: 'Attendance sheet' }).getByRole('listitem').first();
  const current = await first.getByRole('radio', { checked: true }).textContent();
  await first.getByRole('radio', { name: current === 'Late' ? 'Present' : 'Late' }).click();
  await page.getByRole('button', { name: 'Save attendance' }).click();
  await expect(page.getByText('Attendance saved (1 changed)')).toBeVisible();
});
