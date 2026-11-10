import { expect, login, logout, noHorizontalScroll, test } from './fixtures';

const nextWeekday = (dow: number) => {
  const d = new Date(Date.now() + 3 * 86400000);
  while (d.getUTCDay() !== dow) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

test('Branch Admin creates a batch with a timetable preview, enrols students and reschedules a class', async ({ page }) => {
  await login(page, 'kochi.admin@demo.cc');
  await page.getByRole('link', { name: 'Batches', exact: true }).click();
  await page.getByRole('link', { name: 'New batch' }).click();
  await page.getByLabel(/^Course/).selectOption({ label: 'Data Analytics with Python (80 h)' });
  await page.getByLabel(/^Batch name/).fill('Weekend Data Batch');
  await page.getByLabel(/^Start date/).fill(nextWeekday(6));
  for (const d of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']) await page.getByRole('button', { name: d, exact: true }).click();
  await page.getByRole('button', { name: 'Sat', exact: true }).click();
  await page.getByRole('button', { name: 'Sun', exact: true }).click();
  await page.getByLabel(/^Starts at/).fill('10:00');
  await page.getByLabel(/^Ends at/).fill('14:00');
  await page.getByLabel(/^Main teacher/).selectOption({ label: 'Rahul Menon · Trainer' });
  await expect(page.getByText('20 classes')).toBeVisible();
  await expect(page.getByText(/No clashes/)).toBeVisible();
  await page.getByRole('button', { name: 'Create batch' }).click();
  await expect(page.getByRole('heading', { name: /Weekend Data Batch/ })).toBeVisible();
  await expect(page.getByText('20 classes')).toBeVisible();

  await page.getByRole('tab', { name: /Students/ }).click();
  await page.getByRole('button', { name: 'Enrol students' }).click();
  const dlg = page.getByRole('dialog', { name: /Enrol students/ });
  const boxes = dlg.getByRole('checkbox');
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await dlg.getByRole('button', { name: 'Enrol 2' }).click();
  await expect(page.getByText('2 of 30 seats filled')).toBeVisible();

  await page.getByRole('tab', { name: 'Classes' }).click();
  await page.getByRole('button', { name: 'Change class 1', exact: true }).click();
  await page.getByRole('button', { name: 'Reschedule' }).click();
  const mv = page.getByRole('dialog', { name: /Reschedule class 1/ });
  await mv.getByLabel('Starts').fill('11:00');
  await mv.getByLabel('Ends').fill('15:00');
  await mv.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(/Class moved/)).toBeVisible();
  await expect(page.getByText(/11:00 am–3:00 pm/).first()).toBeVisible();

  await page.getByRole('button', { name: 'Change class 2', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel this class' }).click();
  const cn = page.getByRole('dialog', { name: /Cancel class 2/ });
  await cn.getByLabel(/Reason/).fill('Branch maintenance');
  await cn.getByRole('button', { name: 'Cancel class' }).click();
  await expect(page.getByText(/Class cancelled/)).toBeVisible();
});

test('branch requests a course and head office approves it', async ({ page }) => {
  await login(page, 'tvm.admin@demo.cc');
  await page.getByRole('link', { name: 'Course requests' }).click();
  await page.getByRole('button', { name: 'New request' }).click();
  const dlg = page.getByRole('dialog', { name: 'Request a new course' });
  await dlg.getByLabel(/^Course name/).fill('Flutter App Development');
  await dlg.getByLabel(/^Total hours/).fill('50');
  await dlg.getByLabel('Module 1 title').fill('Dart basics');
  await expect(dlg.getByLabel('Branch')).not.toHaveValue(''); // their only branch is picked for them
  await dlg.getByRole('button', { name: 'Send request' }).click();
  await expect(page.getByText('Flutter App Development')).toBeVisible();
  await logout(page);

  await login(page, 'academics@demo.cc');
  await page.getByRole('link', { name: 'Course requests' }).click();
  const card = page.locator('section', { hasText: 'Flutter App Development' });
  await card.getByRole('button', { name: 'Decide' }).click();
  const dec = page.getByRole('dialog');
  await dec.getByLabel(/^Course code/).fill('FLUT-01');
  await dec.getByRole('button', { name: 'Approve' }).last().click();
  await expect(page.getByText(/Approved and added/)).toBeVisible();
  await page.getByRole('link', { name: 'Courses', exact: true }).click();
  await expect(page.getByText('Flutter App Development')).toBeVisible();
});

test('a student sees both branches in the timetable and opens a course', async ({ page }) => {
  await login(page, 'arjun.student@demo.cc');
  await page.getByRole('link', { name: 'My courses' }).click();
  await expect(page.getByText('Kochi – Palarivattom').first()).toBeVisible();
  await expect(page.getByText('Thiruvananthapuram – Technopark')).toBeVisible();
  await page.getByRole('link', { name: /Morning Batch A/ }).click();
  await expect(page.getByRole('heading', { name: /Morning Batch A/ })).toBeVisible();
  await expect(page.getByRole('tab', { name: /Students/ })).toHaveCount(0);
  await page.getByRole('link', { name: 'Timetable' }).click();
  await page.getByRole('tab', { name: 'List' }).click();
  await expect(page.getByText(/KOC01 · Morning Batch A/).first()).toBeVisible();
});

test('a teacher sees batches in both branches', async ({ page }) => {
  await login(page, 'anita.trainer@demo.cc');
  await page.getByRole('link', { name: 'My batches' }).click();
  await expect(page.getByRole('link', { name: /Morning Batch A/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Afternoon Batch/ })).toBeVisible();
});

test('phone: timetable and batch page fit the screen', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 760 });
  await login(page, 'anita.trainer@demo.cc');
  await page.goto('/timetable');
  await expect(page.getByRole('heading', { name: 'Timetable' })).toBeVisible();
  await noHorizontalScroll(page);
  await page.goto('/teach/batches');
  await page.getByRole('link', { name: /Morning Batch A/ }).click();
  await expect(page.getByRole('heading', { name: /Morning Batch A/ })).toBeVisible();
  await noHorizontalScroll(page);
});
