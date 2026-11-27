import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { login, makeUser, ok, PW, seedClass } from './helpers';

const SHOTS = process.env.E2E_SHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/rooms-${name}.png` });
};

/** Build a one-question quiz through the API as the given user. */
async function quickQuiz(request: APIRequestContext, email: string, title: string) {
  const t = await ok<{ access_token: string }>(await request.post('/api/v1/auth/login', { data: { privacy_accepted: true, email, password: PW } }));
  const H = { Authorization: `Bearer ${t.access_token}` };
  const act = await ok<{ id: string }>(await request.post('/api/v1/activities', { headers: H, data: { title, kind: 'quiz' } }));
  await ok(
    await request.post(`/api/v1/activities/${act.id}/questions`, {
      headers: H,
      data: { type: 'mcq', stem: 'Capital of Karnataka?', marks: 1, options: [{ text: 'Mysuru' }, { text: 'Bengaluru', correct: true }] },
    }),
  );
  return act.id;
}

async function hostRoom(page: Page, activityId: string) {
  await page.goto(`/faculty/activities/${activityId}`);
  await page.getByRole('button', { name: 'Assign or host' }).click();
  const hostChoice = page.getByRole('radio', { name: /Host a room/ });
  if (await hostChoice.count()) await hostChoice.click(); // clubs only have rooms
  await page.getByRole('dialog').getByRole('button', { name: 'Host room' }).click();
  const codeEl = page.getByLabel(/^Join code /);
  await expect(codeEl).toBeVisible();
  return ((await codeEl.textContent()) ?? '').replace(/\D/g, '');
}

async function joinAndPlay(page: Page, code: string, team?: string) {
  await page.goto('/join');
  await page.getByLabel('Join code').fill(code);
  await page.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(page.getByText('Capital of Karnataka?').or(page.getByRole('button', { name: 'Join and start' }))).toBeVisible();
  if (team) await page.getByLabel('Your name or team name').fill(team);
  await page.getByRole('button', { name: 'Join and start' }).click();
  await expect(page.getByText('Capital of Karnataka?')).toBeVisible();
  await page.getByRole('button', { name: /Option \d: Bengaluru/ }).click();
  await page.getByRole('button', { name: /Finish/ }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByRole('heading', { name: 'Submitted' })).toBeVisible();
}

test('faculty hosts a room; a student from another class joins with the code', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const host = await seedClass(request);
  const other = await seedClass(request); // a student who is NOT in the host's class
  const actId = await quickQuiz(request, host.facEmail, 'Room quiz');

  const hctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const h = await hctx.newPage();
  await login(h, host.facEmail);
  const code = await hostRoom(h, actId);
  expect(code).toMatch(/^\d{6}$/);
  await expect(h.getByRole('img', { name: /QR code/ })).toBeVisible();
  await shot(h, 'host');
  // projector lobby
  await h.getByRole('button', { name: 'Present' }).click();
  const lobby = h.getByRole('dialog', { name: 'Room lobby' });
  await expect(lobby.getByText('Waiting for players to join...')).toBeVisible();
  await shot(h, 'lobby');
  await lobby.getByRole('button', { name: 'Close' }).click();

  const sctx = await browser.newContext({ viewport: { width: 412, height: 860 }, isMobile: true, hasTouch: true });
  const s = await sctx.newPage();
  await login(s, other.stuEmail);
  // wrong code first
  await s.goto('/join');
  await s.getByLabel('Join code').fill('000000');
  await s.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(s.getByRole('alert')).toContainText('No activity with that code');
  await shot(s, 'join');
  await joinAndPlay(s, code);

  await expect(h.getByText(/1 joined \| 1 finished/)).toBeVisible({ timeout: 15_000 });
  // a teacher's room is not a leaderboard
  await expect(h.getByText(/Leaderboard:/)).toHaveCount(0);

  // the host takes the student out of the room, then lets them back in
  await h.getByRole('button', { name: 'Players', exact: true }).click();
  const box = h.getByRole('dialog', { name: 'Players in this room' });
  await expect(box.getByRole('list', { name: 'Joined' })).toContainText('finished');
  await box.getByRole('button', { name: /^Remove / }).click();
  await h.getByRole('dialog', { name: /^Remove .* from this room\?$/ }).getByRole('button', { name: 'Remove', exact: true }).click();
  const removed = box.getByRole('list', { name: 'Removed' });
  await expect(removed).toBeVisible();
  await shot(h, 'players');
  await removed.getByRole('button', { name: /^Let .* back in$/ }).click();
  await expect(removed).toHaveCount(0);
  await box.getByRole('button', { name: 'Done' }).click();

  // the host stops new joins: another student is turned away
  await h.getByRole('button', { name: 'Stop new joins' }).click();
  await expect(h.getByText('closed to new players')).toBeVisible();
  const late = await seedClass(request);
  const l = await (await browser.newContext()).newPage();
  await login(l, late.stuEmail);
  await l.goto(`/join/${code}`);
  await expect(l.getByText('not accepting players')).toBeVisible();

  await hctx.close();
  await sctx.close();
});

test('a club organiser hosts a room', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const base = await seedClass(request);
  const clubEmail = `club.${base.tag}@openqz.dev`;
  await makeUser(request, base.H, 'club', `CL${base.tag}`.toUpperCase(), clubEmail, 'Tech Club');

  const cctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const c = await cctx.newPage();
  await login(c, clubEmail);
  // clubs create without picking classes
  await c.goto('/faculty/library?create=1');
  await c.getByRole('button', { name: /^Quiz/ }).click();
  await expect(c.getByText('shared with a join code')).toBeVisible();
  await c.getByRole('button', { name: 'Cancel' }).click();

  const actId = await quickQuiz(request, clubEmail, 'Tech fest round 1');
  const code = await hostRoom(c, actId);
  // rules for the room, shown to students when they enter the code
  await c.getByRole('button', { name: 'Add instructions' }).click();
  await c.getByLabel('Instructions or rules').fill('One attempt per team. No searching online.');
  await c.getByRole('dialog', { name: 'Instructions for this room' }).getByRole('button', { name: 'Save' }).click();
  await expect(c.getByRole('button', { name: 'Edit instructions' })).toBeVisible();
  const s = await (await browser.newContext()).newPage();
  await login(s, base.stuEmail);
  await s.goto(`/join/${code}`);
  await expect(s.getByText('One attempt per team. No searching online.')).toBeVisible();
  await joinAndPlay(s, code, 'Tech Titans');
  await expect(c.getByText(/1 joined \| 1 finished/)).toBeVisible({ timeout: 15_000 });
  // a club's room report is a leaderboard in points: place, team, points, time taken
  await expect(c.getByText(/Leaderboard:/)).toBeVisible();
  await c.getByRole('button', { name: 'Participants', exact: true }).click();
  await expect(c.getByRole('columnheader', { name: 'Time taken' })).toBeVisible();
  await expect(c.getByRole('columnheader', { name: 'Points' })).toBeVisible();
  await expect(c.getByRole('row').nth(1).getByRole('cell').first()).toHaveText('1');
  await expect(c.getByRole('row').nth(1)).toContainText('Tech Titans');
  await cctx.close();
});
