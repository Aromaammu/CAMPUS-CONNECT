import { expect, login, test } from './fixtures';

test('teacher runs a poll: students answer, results shared, saved with the class', async ({ page, another, request }) => {
  const { sessionId } = (await (await request.post('/api/dev/demo-class', { headers: { 'x-cc': '1' } })).json()) as { sessionId: string };
  await login(page, 'anita.trainer@demo.cc');
  await page.goto(`/live/${sessionId}`);
  await page.getByRole('button', { name: 'Start class' }).click();
  await expect(page.getByRole('main', { name: 'Class video' })).toBeVisible({ timeout: 20_000 });

  const arjun = await another('arjun.student@demo.cc');
  await arjun.goto(`/live/${sessionId}`);
  await arjun.getByRole('button', { name: 'Join class' }).click();
  await expect(arjun.getByRole('main', { name: 'Class video' })).toBeVisible({ timeout: 20_000 });

  await page.getByRole('button', { name: 'Polls', exact: true }).click();
  await page.getByRole('button', { name: 'New poll' }).click();
  const form = page.getByRole('form', { name: 'New poll' });
  await form.getByLabel('Question').fill('Which framework did we use today?');
  await form.getByRole('textbox', { name: 'Answer 1', exact: true }).fill('Django');
  await form.getByRole('textbox', { name: 'Answer 2', exact: true }).fill('Flask');
  await form.getByRole('button', { name: 'Add an answer' }).click();
  await form.getByRole('textbox', { name: 'Answer 3', exact: true }).fill('FastAPI');
  await form.getByLabel('Students see the results').uncheck();
  await form.getByLabel('Save this poll to use again').check();
  await form.getByRole('button', { name: 'Send poll' }).click();
  await expect(page.getByText('Poll sent to the class')).toBeVisible();

  const card = arjun.getByRole('region', { name: 'Poll' });
  await expect(card.getByText('Which framework did we use today?')).toBeVisible({ timeout: 10_000 });
  await card.getByLabel('Django').check();
  await card.getByRole('button', { name: 'Send answer' }).click();
  await expect(card.getByText(/The teacher will share results/)).toBeVisible();
  await expect(page.getByText('1 answered', { exact: false })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('list', { name: 'Results: Which framework did we use today?' }).getByText('1 · 100%')).toBeVisible();

  await page.getByRole('button', { name: 'Show results to students' }).click();
  await expect(card.getByRole('list', { name: /Results/ }).getByText('1 · 100%')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Close poll', exact: true }).click();
  await expect(card.getByText('Poll results')).toBeVisible({ timeout: 10_000 });

  // After class: results on the session page
  await page.goto(`/sessions/${sessionId}`);
  await page.getByRole('tab', { name: 'Polls' }).click();
  await expect(page.getByRole('list', { name: 'Results: Which framework did we use today?' }).getByText('Django')).toBeVisible();
});
