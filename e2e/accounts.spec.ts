import { expect, login, logout, noHorizontalScroll, test } from './fixtures';

test('accountant records a payment for an overdue student and the receipt downloads', async ({ page }) => {
  await login(page, 'kochi.accounts@demo.cc');
  await page.getByRole('link', { name: 'Dues & reminders' }).click();
  await expect(page.getByRole('heading', { name: 'Dues & reminders' })).toBeVisible();
  const first = page.getByRole('list', { name: 'Dues' }).getByRole('listitem').first();
  const name = (await first.locator('a span').first().textContent())!.split(' STU-')[0].trim();
  await first.getByRole('link').click();
  await expect(page.getByRole('heading', { name: 'Fees' })).toBeVisible();
  await page.getByRole('button', { name: 'Record payment' }).first().click();
  const dlg = page.getByRole('dialog', { name: `Record payment: ${name}` });
  await dlg.getByLabel('Method').selectOption('UPI');
  await dlg.getByRole('button', { name: 'Record payment' }).click();
  await expect(dlg.getByText(/Enter the reference number/)).toBeVisible();
  await dlg.getByLabel(/^Reference number/).fill('UPI4455667788');
  const [pdf] = await Promise.all([page.waitForEvent('download'), dlg.getByRole('button', { name: 'Record payment' }).click()]);
  expect(pdf.suggestedFilename()).toMatch(/^RCPT-KOC01-\d{4}-\d{5}\.pdf$/);
  await expect(page.getByText(/Payment recorded\. Receipt RCPT\/KOC01\//)).toBeVisible();
});

test('a 15% discount waits for the Head of Accounts, who approves it; a void is approved too', async ({ page }) => {
  await login(page, 'kochi.accounts@demo.cc');
  await page.goto('/accounts/dues?status=overdue');
  await page.getByRole('list', { name: 'Dues' }).getByRole('listitem').last().getByRole('link').click();
  await page.getByRole('button', { name: 'Change fee plan' }).first().click();
  const dlg = page.getByRole('dialog', { name: /^Fee plan:/ });
  await dlg.getByLabel(/^Discount$/).selectOption('PERCENT');
  await dlg.getByLabel('Discount %').fill('15');
  await dlg.getByLabel(/Reason for the discount/).fill('Merit scholarship');
  await dlg.getByRole('button', { name: 'Save fee plan' }).click();
  await expect(page.getByText('Fee plan saved. The discount waits for the Head of Accounts.')).toBeVisible();

  // Ask to void a receipt
  await page.goto('/accounts/receipts');
  const row = page.getByRole('list', { name: 'Receipts' }).getByRole('listitem').filter({ has: page.getByRole('button', { name: 'Void' }) }).first();
  const receiptNo = (await row.locator('div.font-semibold').first().textContent())!.split(' ·')[0];
  await row.getByRole('button', { name: 'Void' }).click();
  const c = page.getByRole('dialog', { name: `Ask to void ${receiptNo}?` });
  await c.getByLabel(/Why should it be voided/).fill('Cheque bounced');
  await c.getByRole('button', { name: 'Ask to void' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Void requested' })).toBeVisible();
  await logout(page);

  await login(page, 'accounts@demo.cc');
  await page.getByRole('link', { name: 'Approvals' }).click();
  await page.getByRole('list', { name: 'Discounts waiting' }).getByRole('listitem').filter({ hasText: 'Merit scholarship' }).getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText('Approved', { exact: true })).toBeVisible();
  await page.getByRole('list', { name: 'Voids waiting' }).getByRole('listitem').filter({ hasText: receiptNo }).getByRole('button', { name: 'Approve void' }).click();
  await expect(page.getByRole('list', { name: 'Voids waiting' }).getByText(receiptNo)).toHaveCount(0);
  await page.goto('/accounts/receipts');
  await page.getByPlaceholder('Receipt no., student or reference').fill(receiptNo);
  await expect(page.getByRole('list', { name: 'Receipts' }).getByText('Voided')).toBeVisible();
});

test('reminders, the dashboard, reports with Excel export and day close', async ({ page }) => {
  await login(page, 'accounts@demo.cc');
  await page.getByRole('link', { name: 'Accounts dashboard' }).click();
  await expect(page.getByText('Collections', { exact: true })).toBeVisible();
  await expect(page.getByRole('figure', { name: 'Daily collections chart' })).toBeVisible();
  await page.goto('/accounts/dues?status=overdue');
  await page.getByLabel('Select all').check();
  await page.getByRole('button', { name: /^Remind \d+/ }).click();
  await expect(page.getByText(/reminders? sent by email and SMS/)).toBeVisible();
  await page.goto('/accounts/reports');
  await expect(page.getByRole('heading', { name: 'By course' })).toBeVisible();
  const [x] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export receipts' }).click()]);
  expect(x.suggestedFilename()).toMatch(/^receipts-.*\.xlsx$/);
  await page.goto('/accounts/day-close');
  await expect(page.getByText('Cash', { exact: true }).first()).toBeVisible();
});

test('student sees fees and downloads statements; phone layout fits', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await login(page, 'arjun.student@demo.cc');
  await page.goto('/learn/payments');
  await expect(page.getByRole('heading', { name: 'Payments & dues' })).toBeVisible();
  await expect(page.getByText('Paid', { exact: true }).first()).toBeVisible();
  await noHorizontalScroll(page);
  const [d] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Dues statement' }).click()]);
  expect(d.suggestedFilename()).toMatch(/^dues-STU-.*\.pdf$/);
  await page.goto('/');
  await noHorizontalScroll(page);
});
