import { expect, login, noHorizontalScroll, test } from './fixtures';

test('student and teacher chat live: unread badge, reply, read receipt, file', async ({ page, another }) => {
  await login(page, 'arjun.student@demo.cc');
  await page.getByRole('link', { name: 'Messages', exact: true }).first().click();
  await page.getByRole('button', { name: 'New chat' }).click();
  const dlg = page.getByRole('dialog', { name: 'New chat' });
  await dlg.getByPlaceholder('Search by name or email').fill('Anita');
  await dlg.getByRole('button', { name: /Anita Joseph/ }).click();
  await expect(page.getByRole('heading', { name: 'Anita Joseph' })).toBeVisible();
  await page.getByLabel('Message', { exact: true }).fill('Good morning Ma\'am, is there class tomorrow?');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('log', { name: 'Messages' }).getByText('is there class tomorrow?')).toBeVisible();

  const anita = await another('anita.trainer@demo.cc');
  await expect(anita.getByRole('link', { name: /Messages, \d+ unread/ })).toBeVisible({ timeout: 15_000 });
  await anita.getByRole('link', { name: /Messages, \d+ unread/ }).click();
  await anita.getByRole('link', { name: /^Arjun Nair/ }).click();
  await expect(anita.getByText('is there class tomorrow?')).toBeVisible();
  // Arjun sees it was read
  await expect(page.getByText('Seen', { exact: true })).toBeVisible({ timeout: 15_000 });

  // Reply arrives live
  await anita.locator('[data-message]').filter({ hasText: 'class tomorrow' }).getByRole('button', { name: 'Reply' }).click();
  await anita.getByLabel('Message', { exact: true }).fill('Yes, 9 am as usual.');
  await anita.getByLabel('Message', { exact: true }).press('Enter');
  await expect(page.getByText('Yes, 9 am as usual.')).toBeVisible({ timeout: 15_000 });

  // A file
  const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(80, 4)]);
  await page.getByLabel('Attach a file').setInputFiles({ name: 'homework.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByText('Attached:')).toBeVisible();
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(anita.getByRole('button', { name: 'homework.png' })).toBeVisible({ timeout: 15_000 });
});

test('batch group: the teacher makes it teachers-only; students then read only', async ({ page, another }) => {
  await login(page, 'anita.trainer@demo.cc');
  await page.goto('/messages');
  await page.getByRole('link', { name: /^Morning Batch A · KOC01/ }).click();
  await page.getByLabel('Message', { exact: true }).fill('Exam on Friday at 9 am.');
  await page.getByRole('button', { name: 'Send message' }).click();
  await page.getByRole('button', { name: /Teachers only/ }).click();
  await expect(page.getByText('Only teachers can post now')).toBeVisible();

  const diya = await another('diya.student@demo.cc');
  await diya.goto('/messages');
  await diya.getByRole('link', { name: /^Morning Batch A · KOC01/ }).click();
  await expect(diya.getByRole('log', { name: 'Messages' }).getByText('Exam on Friday at 9 am.')).toBeVisible();
  await expect(diya.getByText('Only teachers can post in this group.')).toBeVisible();
  await page.getByRole('button', { name: /Let everyone post/ }).click();
});

test('announcement to every branch reaches a student, who marks it read', async ({ page, another }) => {
  await login(page, 'monitoring@demo.cc');
  await page.getByRole('link', { name: 'Send announcements' }).click();
  await page.getByRole('button', { name: 'New announcement' }).click();
  const dlg = page.getByRole('dialog', { name: 'New announcement' });
  await dlg.getByLabel(/^Title/).fill('Placement drive on 20-11-2026');
  await dlg.getByLabel(/^Message/).fill('Infopark companies are hiring. Register with your branch.');
  await dlg.getByRole('button', { name: 'Send announcement' }).click();
  await expect(page.getByText(/Sent to \d+ people/)).toBeVisible();

  const arjun = await another('arjun.student@demo.cc');
  await arjun.getByRole('link', { name: 'Announcements', exact: true }).click();
  const art = arjun.getByRole('article', { name: 'Placement drive on 20-11-2026' });
  await expect(art.getByText('New')).toBeVisible();
  await art.getByRole('button', { name: 'Mark as read' }).click();
  await expect(art.getByText('New')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('list', { name: 'Sent announcements' }).getByRole('listitem').filter({ hasText: 'Placement drive' }).getByText(/1 of \d+ read/)).toBeVisible();
});

test('moderator hides a message in a chat with a student', async ({ page, another }) => {
  const arjun = await another('arjun.student@demo.cc');
  await arjun.goto('/messages');
  await arjun.getByRole('button', { name: 'New chat' }).click();
  await arjun.getByRole('dialog', { name: 'New chat' }).getByPlaceholder('Search by name or email').fill('Rahul');
  await arjun.getByRole('dialog', { name: 'New chat' }).getByRole('button', { name: /Rahul Menon/ }).click();
  await arjun.getByLabel('Message', { exact: true }).fill('This is a rude message');
  await arjun.getByRole('button', { name: 'Send message' }).click();
  await expect(arjun.getByText('This is a rude message')).toBeVisible();

  await login(page, 'kochi.admin@demo.cc');
  await page.getByRole('link', { name: 'Chat moderation' }).click();
  await page.getByRole('link', { name: /Arjun Nair ↔ Rahul Menon|Rahul Menon ↔ Arjun Nair/ }).click();
  await page.locator('[data-message]').filter({ hasText: 'rude message' }).getByRole('button', { name: 'Hide message' }).click();
  const c = page.getByRole('dialog', { name: 'Hide this message?' });
  await c.getByLabel(/Reason/).fill('Disrespectful language');
  await c.getByRole('button', { name: 'Hide' }).click();
  await expect(page.getByText('Hidden: Disrespectful language')).toBeVisible();
  await expect(arjun.getByText('Hidden by a moderator')).toBeVisible({ timeout: 15_000 });
});

test('a teacher starts a staff meeting; a colleague joins from the meetings page', async ({ page, another }) => {
  await login(page, 'anita.trainer@demo.cc');
  await page.getByRole('link', { name: 'Staff meetings' }).click();
  await page.getByRole('button', { name: 'New meeting' }).click();
  const dlg = page.getByRole('dialog', { name: 'New meeting' });
  await dlg.getByLabel(/^Title/).fill('Python syllabus review');
  await dlg.getByPlaceholder('Add staff by name or email').fill('Rahul');
  await dlg.getByRole('button', { name: /Rahul Menon/ }).click();
  await dlg.getByRole('button', { name: 'Start now' }).last().click();
  await expect(page.getByText('You are joining as Host')).toBeVisible();
  await page.getByRole('button', { name: 'Start meeting' }).click();
  await expect(page.getByRole('main', { name: 'Class video' })).toBeVisible({ timeout: 20_000 });

  const rahul = await another('rahul.trainer@demo.cc');
  await rahul.getByRole('link', { name: 'Staff meetings' }).click();
  await rahul.getByRole('listitem').filter({ hasText: 'Python syllabus review' }).getByRole('link', { name: 'Join' }).click();
  await expect(rahul.getByText('You are joining as Participant')).toBeVisible();
  await rahul.getByRole('button', { name: 'Join meeting' }).click();
  await expect(page.locator('.lk-participant-tile')).toHaveCount(2, { timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Attendance', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'More options' }).click();
  await page.getByRole('button', { name: 'End meeting for everyone' }).click();
  await page.getByRole('dialog', { name: 'End the meeting for everyone?' }).getByRole('button', { name: 'End meeting' }).click();
  await expect(rahul.getByRole('heading', { name: 'The meeting has ended' })).toBeVisible({ timeout: 15_000 });
});

test('phone: conversation list and a chat fit the screen', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await login(page, 'diya.student@demo.cc');
  await page.goto('/messages');
  await expect(page.getByRole('heading', { name: 'Messages' })).toBeVisible();
  await noHorizontalScroll(page);
  await page.getByRole('link', { name: /^Morning Batch A · KOC01/ }).click();
  await expect(page.getByRole('link', { name: 'Back to conversations' })).toBeVisible();
  await noHorizontalScroll(page);
});
