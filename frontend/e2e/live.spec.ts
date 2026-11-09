import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { login, ok, PW, seedClass } from './helpers';

/** Live (Kahoot-style) game: host screen shows the question, phones show only the answers. */
async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const serious = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

test('host runs a live game; a student and a guest play on phones', async ({ browser, request }, info) => {
  test.skip(info.project.name !== 'desktop', 'one run: it drives three browsers itself');
  test.setTimeout(180_000);
  const c = await seedClass(request);
  const t = await ok<{ access_token: string }>(await request.post('/api/v1/auth/login', { data: { email: c.facEmail, password: PW } }));
  const H = { Authorization: `Bearer ${t.access_token}` };
  const act = await ok<{ id: string }>(await request.post('/api/v1/activities', { headers: H, data: { title: 'Live fest round', kind: 'quiz', section_ids: [c.sectionId] } }));
  for (const [stem, right, wrong] of [
    ['Capital of Karnataka?', 'Bengaluru', 'Mysuru'],
    ['Largest planet?', 'Jupiter', 'Mars'],
  ])
    await ok(
      await request.post(`/api/v1/activities/${act.id}/questions`, {
        headers: H,
        data: { type: 'mcq', stem, marks: 1, time_limit_seconds: 20, options: [{ text: wrong }, { text: right, correct: true }] },
      }),
    );

  // ---- host starts a live game from the share dialog, guests allowed
  const host = await (await browser.newContext({ viewport: { width: 1366, height: 860 } })).newPage();
  await login(host, c.facEmail);
  await host.goto(`/faculty/activities/${act.id}`);
  await host.getByRole('button', { name: 'Assign or host' }).click();
  await host.getByRole('radio', { name: /Live game/ }).click();
  await host.getByLabel('Scoring').selectOption('marks_speed');
  await host.getByLabel(/Let guests join/).check();
  await host.getByRole('button', { name: 'Start live game' }).click();
  const codeEl = host.getByLabel(/^Join code /);
  await expect(codeEl).toBeVisible();
  const code = ((await codeEl.textContent()) ?? '').replace(/\D/g, '');
  expect(code).toMatch(/^\d{6}$/);
  await expect(host.getByText('Waiting for players to join...')).toBeVisible();
  await axe(host);

  // ---- a signed-in student types the code in the normal join box: it forwards to the live game
  const stu = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
  await login(stu, c.stuEmail);
  await stu.goto(`/join/${code}`);
  await expect(stu.getByText(/Joining as/)).toBeVisible();
  await stu.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(stu.getByRole('heading', { name: "You're in!" })).toBeVisible();

  // ---- a guest with no account joins with a nickname
  const guest = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
  await guest.goto('/live');
  await guest.getByLabel('Game code').fill(code);
  await guest.getByRole('button', { name: 'Enter' }).click();
  await guest.getByLabel('Your nickname').fill('Guest Ninja');
  await axe(guest);
  await guest.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(guest.getByRole('heading', { name: "You're in!" })).toBeVisible();

  const players = host.getByRole('list', { name: 'Players' });
  await expect(players.getByRole('button', { name: /Guest Ninja/ })).toBeVisible();
  await expect(players.getByRole('button', { name: /E2E student/ })).toBeVisible();

  // ---- question 1: the big screen has the question, phones only the answer tiles
  await host.getByRole('button', { name: 'Start' }).click();
  await expect(host.getByRole('heading', { name: 'Capital of Karnataka?' })).toBeVisible();
  await expect(stu.getByText('Capital of Karnataka?')).toHaveCount(0);
  await stu.getByRole('button', { name: 'Answer 2: Bengaluru' }).click({ timeout: 15_000 });
  await expect(stu.getByRole('heading', { name: 'Answer locked in' })).toBeVisible();
  await axe(guest);
  await guest.getByRole('button', { name: 'Answer 1: Mysuru' }).click({ timeout: 15_000 });

  // everyone answered: the host screen reveals by itself; phones learn how they did
  await expect(host.getByRole('button', { name: 'Leaderboard' })).toBeVisible({ timeout: 10_000 });
  await expect(stu.getByRole('heading', { name: 'Correct!' })).toBeVisible({ timeout: 5_000 });
  await expect(guest.getByRole('heading', { name: 'Not this time' })).toBeVisible({ timeout: 5_000 });

  await host.getByRole('button', { name: 'Leaderboard' }).click();
  await expect(host.getByRole('heading', { name: 'Leaderboard' })).toBeVisible();
  await expect(host.getByRole('listitem').first()).toContainText('E2E student');
  await expect(stu.getByText('1st')).toBeVisible();

  // ---- question 2, then the podium
  await host.getByRole('button', { name: 'Next question' }).click();
  await expect(host.getByRole('heading', { name: 'Largest planet?' })).toBeVisible();
  await stu.getByRole('button', { name: 'Answer 2: Jupiter' }).click({ timeout: 15_000 });
  await guest.getByRole('button', { name: 'Answer 2: Jupiter' }).click({ timeout: 15_000 });
  await expect(host.getByRole('button', { name: /Finish/ })).toBeVisible({ timeout: 10_000 });
  await host.getByRole('button', { name: /Finish/ }).click();
  await expect(host.getByRole('heading', { name: 'Final results' })).toBeVisible();
  await expect(stu.getByRole('heading', { name: '1st place' })).toBeVisible({ timeout: 5_000 });
  await expect(guest.getByRole('heading', { name: '2nd place' })).toBeVisible({ timeout: 5_000 });

  // ---- results page: marks obtained per player
  await host.getByRole('link', { name: 'View results' }).click();
  await expect(host.getByRole('heading', { name: 'Live fest round' })).toBeVisible();
  await expect(host.getByRole('cell', { name: '2 / 2' }).first()).toBeVisible();
  await expect(host.getByText('Guest Ninja')).toBeVisible();
});
