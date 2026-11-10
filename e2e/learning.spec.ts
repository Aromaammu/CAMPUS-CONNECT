import { expect, login, logout, noHorizontalScroll, test } from './fixtures';

test('teacher shares a link with two batches; a student in the other branch opens materials', async ({ page, another }) => {
  await login(page, 'anita.trainer@demo.cc');
  await page.getByRole('link', { name: 'My batches' }).click();
  await page.getByRole('link', { name: /Morning Batch A/ }).click();
  await page.getByRole('tab', { name: 'Materials' }).click();
  await page.getByRole('button', { name: 'Add material' }).click();
  const dlg = page.getByRole('dialog', { name: 'Add material' });
  await dlg.getByRole('tab', { name: 'Add a link' }).click();
  await dlg.getByLabel(/^Link/).fill('https://docs.djangoproject.com/en/stable/topics/forms/');
  await dlg.getByLabel(/^Title/).fill('Django forms guide');
  await dlg.getByLabel('Course module').selectOption({ label: '4. Django web apps' });
  await dlg.getByLabel(/Afternoon Batch/).check();
  await dlg.getByRole('button', { name: 'Add material' }).click();
  await expect(page.getByText('Material added. Students have been told.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Django forms guide', exact: true })).toBeVisible();

  const arjun = await another('arjun.student@demo.cc');
  await arjun.getByRole('link', { name: 'My courses' }).click();
  await arjun.getByRole('link', { name: /Python Full Stack, Afternoon Batch/ }).click();
  await arjun.getByRole('tab', { name: 'Materials' }).click();
  await expect(arjun.getByRole('button', { name: 'Django forms guide', exact: true })).toBeVisible();
  await expect(arjun.getByRole('button', { name: 'Add material' })).toHaveCount(0);
  const [dl] = await Promise.all([arjun.waitForEvent('download'), arjun.getByRole('listitem').filter({ hasText: 'Django cheat sheet' }).getByRole('button', { name: 'Download' }).click()]);
  expect(dl.suggestedFilename()).toBe('django-cheat-sheet.txt');
});

test('teacher gives marks and feedback; the student sees them, rates a class and downloads the report', async ({ page, another }) => {
  await login(page, 'anita.trainer@demo.cc');
  await page.goto('/teach/batches');
  await page.getByRole('link', { name: /Morning Batch A/ }).click();
  await page.getByRole('button', { name: /Show \d+ past classes/ }).click();
  await page.getByRole('main').getByRole('link', { name: 'Attendance', exact: true }).last().click();
  await page.getByRole('tab', { name: 'Marks' }).click();
  const diya = page.getByRole('list', { name: 'Marks' }).getByRole('listitem', { name: 'Diya Menon' });
  await diya.getByRole('radio', { name: /^5/ }).click();
  await diya.getByLabel('Remark for Diya Menon').fill('Brilliant debugging');
  await page.getByRole('button', { name: 'Save marks' }).click();
  await expect(page.getByText('Marks saved')).toBeVisible();

  await page.goto('/teach/batches');
  await page.getByRole('link', { name: /Morning Batch A/ }).click();
  await page.getByRole('tab', { name: 'Progress' }).click();
  await page.getByRole('list', { name: 'Student progress' }).getByRole('listitem').filter({ hasText: 'Diya Menon' }).getByRole('button', { name: 'Give feedback' }).click();
  const dlg = page.getByRole('dialog', { name: 'Feedback for Diya Menon' });
  await dlg.getByLabel('Feedback').fill('Keep practising Django querysets.');
  await dlg.getByRole('button', { name: 'Send feedback' }).click();
  await expect(page.getByText('Feedback sent to Diya Menon')).toBeVisible();

  const st = await another('diya.student@demo.cc');
  await st.getByRole('link', { name: 'Performance & feedback' }).click();
  await expect(st.getByText('Brilliant debugging')).toBeVisible();
  await expect(st.getByText('Keep practising Django querysets.')).toBeVisible();
  const rate = st.getByRole('listitem', { name: /Rate class/ }).first();
  if (await rate.count()) {
    await rate.getByRole('radio', { name: '4 stars' }).click();
    await rate.getByRole('button', { name: 'Send' }).click();
    await expect(st.getByText('Thanks for your rating')).toBeVisible();
  }
  const [pdf] = await Promise.all([st.waitForEvent('download'), st.getByRole('button', { name: 'Download report (PDF)' }).click()]);
  expect(pdf.suggestedFilename()).toMatch(/^performance-STU-.*\.pdf$/);
});

test('final project: submit, changes requested, resubmit, teacher approves, Branch Admin completes the course', async ({ page, another }) => {
  const arjun = await another('arjun.student@demo.cc');
  await arjun.getByRole('link', { name: 'Final project' }).click();
  const card = arjun.locator('section, div.card').filter({ hasText: 'Morning Batch A' }).first();
  await card.getByRole('button', { name: 'Submit your project' }).click();
  let dlg = arjun.getByRole('dialog', { name: 'Submit your project' });
  await dlg.getByLabel(/^Project title/).fill('Student blog');
  await dlg.getByLabel(/^Link/).fill('https://github.com/arjun/student-blog');
  await dlg.getByRole('button', { name: 'Send to teacher' }).click();
  await expect(arjun.getByText('Project sent to your teacher')).toBeVisible();

  await login(page, 'anita.trainer@demo.cc');
  await page.getByRole('link', { name: 'Project reviews' }).click();
  await page.getByRole('link', { name: /Arjun Nair · Student blog/ }).click();
  await page.getByLabel('Comments for the student').fill('Please add a README with setup steps.');
  await page.getByRole('button', { name: 'Request changes' }).click();
  await expect(page.getByText('Saved. The student has been told.')).toBeVisible();

  await arjun.reload();
  await expect(arjun.getByText('Please add a README with setup steps.')).toBeVisible();
  await card.getByRole('button', { name: 'Submit a new version' }).click();
  dlg = arjun.getByRole('dialog', { name: 'Submit your project' });
  await dlg.getByLabel('Description').fill('Added README and tests');
  await dlg.getByRole('button', { name: 'Send to teacher' }).click();
  await expect(arjun.getByText('Project sent to your teacher')).toBeVisible();

  await page.reload();
  await expect(page.getByText('Version 2 submitted', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByText('Approved and sent to the Branch Admin')).toBeVisible();
  await logout(page);

  await login(page, 'kochi.admin@demo.cc');
  await page.getByRole('link', { name: 'Project approvals' }).click();
  await page.getByRole('link', { name: /Arjun Nair · Student blog/ }).click();
  await page.getByRole('button', { name: 'Approve and complete the course' }).click();
  await expect(page.getByText('Approved. The course is marked Completed.')).toBeVisible();
  await arjun.reload();
  await expect(card.getByText('Completed', { exact: true }).first()).toBeVisible();
});

test('phone: student performance and project pages fit the screen', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await login(page, 'arjun.student@demo.cc');
  for (const path of ['/learn/performance', '/learn/projects', '/']) {
    await page.goto(path);
    await expect(page.getByText('Loading…')).toHaveCount(0);
    await noHorizontalScroll(page);
  }
});
