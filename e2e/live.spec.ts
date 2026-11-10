import type { APIRequestContext, Page } from '@playwright/test';
import { expect, login, noHorizontalScroll, test } from './fixtures';

/** Moves the "Live Demo Class" (Kochi, teacher Anita, students Arjun + Diya) to right now and empties its room. */
async function demoClass(request: APIRequestContext) {
  const r = await request.post('/api/dev/demo-class', { headers: { 'x-cc': '1' } });
  expect(r.ok()).toBeTruthy();
  return (await r.json()) as { sessionId: string; batchId: string };
}

async function enter(page: Page, sessionId: string, button = /Join class|Start class|Enter silently/) {
  await page.goto(`/live/${sessionId}`);
  await page.getByRole('button', { name: button }).click();
  await expect(page.getByRole('main', { name: 'Class video' })).toBeVisible({ timeout: 20_000 });
}

const tiles = (page: Page) => page.locator('.lk-participant-tile');

test('teacher and students hold a class: video, chat, hand, reactions and teacher controls', async ({ page, another, request }) => {
  const { sessionId } = await demoClass(request);

  // Teacher checks devices and starts the class.
  await login(page, 'anita.trainer@demo.cc');
  await page.goto(`/live/${sessionId}`);
  await expect(page.getByText('You are joining as Teacher')).toBeVisible();
  await expect(page.getByLabel('Your camera preview')).toBeVisible();
  await expect(page.getByRole('meter', { name: 'Microphone level' })).toBeVisible();
  await page.getByRole('button', { name: 'Start class' }).click();
  await expect(page.getByRole('main', { name: 'Class video' })).toBeVisible({ timeout: 20_000 });
  await expect(tiles(page)).toHaveCount(1);

  // A student joins from the dashboard.
  const arjun = await another('arjun.student@demo.cc');
  await expect(arjun.getByRole('heading', { name: "Today's classes" })).toBeVisible();
  await arjun.getByRole('link', { name: /Join class/ }).first().click();
  await expect(arjun.getByText('You are joining as Student')).toBeVisible();
  await arjun.getByRole('button', { name: 'Join class' }).click();
  await expect(arjun.getByRole('main', { name: 'Class video' })).toBeVisible({ timeout: 20_000 });

  // Both see each other's video.
  await expect(tiles(page)).toHaveCount(2, { timeout: 20_000 });
  await expect(tiles(arjun)).toHaveCount(2, { timeout: 20_000 });
  await expect(page.locator('.lk-participant-tile video').first()).toBeVisible();
  await expect(page.getByText('Teacher', { exact: true }).first()).toBeVisible();

  // Chat both ways (teacher's chat panel is open on a wide screen).
  await expect(arjun.getByRole('list', { name: 'Chat messages' })).toBeVisible(); // open by default on a wide screen
  await arjun.getByRole('textbox', { name: 'Message' }).fill('Good morning, Ma\'am');
  await arjun.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('list', { name: 'Chat messages' }).getByText("Good morning, Ma'am")).toBeVisible();
  await page.getByRole('textbox', { name: 'Message' }).fill('Welcome! Today: Django forms');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(arjun.getByText('Welcome! Today: Django forms')).toBeVisible();

  // Raise hand: teacher sees the queue and lowers it.
  await arjun.getByRole('button', { name: 'Raise your hand' }).click();
  await expect(page.getByRole('button', { name: '1 raised hands' })).toBeVisible();
  await page.getByRole('button', { name: 'People', exact: true }).click();
  const hands = page.getByRole('region', { name: 'Raised hands' });
  await expect(hands.getByText('Arjun Nair')).toBeVisible();
  await hands.getByRole('button', { name: /Lower Arjun Nair's hand/ }).click();
  await expect(arjun.getByRole('button', { name: 'Raise your hand' })).toBeVisible();

  // Reaction
  await arjun.getByRole('button', { name: 'Send a reaction' }).click();
  await arjun.getByRole('menuitem', { name: 'React 👏' }).click();
  await expect(page.getByText('👏')).toBeVisible();

  // Teacher turns student chat off, then mutes everyone.
  await page.getByRole('button', { name: 'More options' }).click();
  await page.getByRole('button', { name: 'Turn off student chat' }).click();
  await expect(arjun.getByText('The teacher has turned off chat.')).toBeVisible();
  await expect(arjun.getByRole('textbox', { name: 'Message' })).toBeDisabled();
  await page.getByRole('button', { name: 'Block student microphones' }).click();
  await expect(arjun.getByRole('button', { name: 'Microphone turned off by the teacher' })).toBeDisabled({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Allow student microphones' }).click();
  await expect(arjun.getByRole('button', { name: 'Turn on microphone' })).toBeEnabled({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Close', exact: true }).click();

  // The teacher's people list shows who is in and who hasn't joined.
  await expect(page.getByRole('list', { name: 'In the class', exact: true }).getByText('Arjun Nair')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Not in the class' }).getByText('Diya Menon')).toBeVisible();

  // Teacher shares the screen: students switch to the shared screen automatically.
  await page.getByRole('button', { name: 'Share your screen' }).click();
  await expect(arjun.getByLabel('Speaker view')).toBeVisible({ timeout: 15_000 });
  await expect(tiles(arjun)).toHaveCount(3);
  await page.getByRole('button', { name: 'Stop sharing your screen' }).click();
  await expect(arjun.getByLabel('Gallery view')).toBeVisible({ timeout: 15_000 });

  // Gallery ↔ speaker view
  await page.getByRole('button', { name: 'Switch to speaker view' }).click();
  await expect(page.getByLabel('Speaker view')).toBeVisible();
  await page.getByRole('button', { name: 'Switch to gallery view' }).click();

  // End the class: students are told, and nobody can rejoin.
  await page.getByRole('button', { name: 'More options' }).click();
  await page.getByRole('button', { name: 'End class for everyone' }).click();
  await page.getByRole('dialog', { name: 'End the class for everyone?' }).getByRole('button', { name: 'End class' }).click();
  await expect(arjun.getByRole('heading', { name: 'The class has ended' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'The class has ended' })).toBeVisible({ timeout: 15_000 });
  await arjun.goto(`/live/${sessionId}`);
  await expect(arjun.getByText('This class has ended.')).toBeVisible();
});

test('only the right people get in: outsiders refused, invited guest admitted, observer stays hidden', async ({ page, another, request }) => {
  const { sessionId } = await demoClass(request);
  // A Thiruvananthapuram teacher is not part of this Kochi class.
  const sanjay = await another('sanjay.trainer@demo.cc');
  await sanjay.goto(`/live/${sessionId}`);
  await expect(sanjay.getByText(/Only students enrolled in this batch/)).toBeVisible();

  // The teacher invites him as a guest trainer from the pre-join screen.
  await login(page, 'anita.trainer@demo.cc');
  await page.goto(`/live/${sessionId}`);
  await page.getByPlaceholder('Search staff by name or email').fill('Sanjay');
  await page.getByRole('button', { name: 'Invite Sanjay Pillai' }).click();
  await expect(page.getByText('Guest added')).toBeVisible();
  await page.getByRole('button', { name: 'Start class' }).click();
  await expect(page.getByRole('main', { name: 'Class video' })).toBeVisible({ timeout: 20_000 });

  await sanjay.reload();
  await expect(sanjay.getByText('You are joining as Guest')).toBeVisible();
  await sanjay.getByRole('button', { name: 'Join class' }).click();
  await expect(tiles(page)).toHaveCount(2, { timeout: 20_000 });

  // The Academics admin observes silently: nobody sees an extra tile.
  const observer = await another('academics@demo.cc');
  await enter(observer, sessionId, 'Enter silently');
  await expect(observer.getByText('You are observing silently')).toBeVisible();
  await expect(tiles(observer)).toHaveCount(2, { timeout: 20_000 });
  await page.waitForTimeout(1500);
  await expect(tiles(page)).toHaveCount(2);
});

test('teacher locks the class and removes a student; a second device replaces the first', async ({ page, another, request }) => {
  const { sessionId } = await demoClass(request);
  await login(page, 'anita.trainer@demo.cc');
  await enter(page, sessionId, 'Start class');

  const diya = await another('diya.student@demo.cc');
  await enter(diya, sessionId);
  const arjun1 = await another('arjun.student@demo.cc');
  await enter(arjun1, sessionId);
  await expect(tiles(page)).toHaveCount(3, { timeout: 20_000 });

  // Arjun opens the class on a second device: the first one is disconnected.
  const arjun2 = await another('arjun.student@demo.cc');
  await enter(arjun2, sessionId);
  await expect(arjun1.getByRole('heading', { name: 'You joined from another device' })).toBeVisible({ timeout: 15_000 });
  await expect(tiles(page)).toHaveCount(3, { timeout: 20_000 });

  // Remove Diya
  await page.getByRole('button', { name: 'People', exact: true }).click();
  await page.getByRole('button', { name: 'Actions for Diya Menon' }).click();
  await page.getByRole('menuitem', { name: 'Remove from class' }).click();
  await page.getByRole('dialog', { name: /Remove Diya Menon/ }).getByRole('button', { name: 'Remove' }).click();
  await expect(diya.getByRole('heading', { name: 'You were removed from this class' })).toBeVisible({ timeout: 15_000 });
  await diya.goto(`/live/${sessionId}`);
  await expect(diya.getByText('The teacher removed you from this class.')).toBeVisible();

  // Lock: people who were already in may come back, nobody new gets in.
  const cands = await page.request.get(`/api/live/sessions/${sessionId}/guest-candidates?q=Sanjay`);
  await page.request.post(`/api/live/sessions/${sessionId}/guests`, { headers: { 'x-cc': '1' }, data: { userId: (await cands.json())[0].id } });
  await page.getByRole('button', { name: 'More options' }).click();
  await page.getByRole('button', { name: 'Lock the class' }).click();
  await expect(page.getByText('Class locked')).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  const sanjay = await another('sanjay.trainer@demo.cc');
  await sanjay.goto(`/live/${sessionId}`);
  await expect(sanjay.getByText('The teacher has locked this class')).toBeVisible();
  await page.getByRole('button', { name: 'Let back in' }).click();
  await diya.reload();
  await diya.getByRole('button', { name: 'Join class' }).click();
  await expect(tiles(page)).toHaveCount(3, { timeout: 20_000 });
});

test('phone: a student joins and uses chat on a 360 px screen', async ({ page, another, request }) => {
  const { sessionId } = await demoClass(request);
  await login(page, 'anita.trainer@demo.cc');
  await enter(page, sessionId, 'Start class');

  const phone = await another('arjun.student@demo.cc', { width: 360, height: 740 });
  await phone.goto(`/live/${sessionId}`);
  await noHorizontalScroll(phone);
  await phone.getByRole('button', { name: 'Join class' }).click();
  await expect(phone.getByRole('main', { name: 'Class video' })).toBeVisible({ timeout: 20_000 });
  await expect(tiles(phone)).toHaveCount(2, { timeout: 20_000 });
  await noHorizontalScroll(phone);
  for (const name of ['Turn off microphone', 'Turn off camera', 'Raise your hand', 'Chat', 'People', 'More options', 'Leave class']) {
    await expect(phone.getByRole('button', { name })).toBeInViewport();
  }
  await phone.getByRole('button', { name: 'Chat', exact: true }).click();
  await phone.getByRole('textbox', { name: 'Message' }).fill('Joining from my phone');
  await phone.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText('Joining from my phone')).toBeVisible();
  await phone.getByRole('button', { name: 'Close chat' }).click();
  await phone.getByRole('button', { name: 'Leave class' }).click();
  await expect(phone.getByRole('heading', { name: 'You left the class' })).toBeVisible();
  await phone.getByRole('button', { name: 'Rejoin class' }).click();
  await expect(phone.getByRole('main', { name: 'Class video' })).toBeVisible({ timeout: 20_000 });
});

test('owner can start the demo class from the test tools page', async ({ page }) => {
  await login(page, 'anita.trainer@demo.cc');
  await page.goto('/dev/mailbox');
  await page.getByRole('button', { name: 'Start the demo class now' }).click();
  await page.getByRole('link', { name: 'Open the class' }).click();
  await expect(page.getByRole('button', { name: 'Start class' })).toBeVisible();
});
