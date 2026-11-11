import { expect, test } from '@playwright/test';
import { ADMIN, ADMIN_PW, login, ok, PW, seedClass } from './helpers';

/** A one-question quiz assigned to the class through the API, with the given settings. */
async function assignQuiz(request: Parameters<typeof seedClass>[0], c: Awaited<ReturnType<typeof seedClass>>, title: string, settings: Record<string, unknown>) {
  const t = await ok<{ access_token: string }>(await request.post('/api/v1/auth/login', { data: { email: c.facEmail, password: PW } }));
  const H = { Authorization: `Bearer ${t.access_token}` };
  const act = await ok<{ id: string }>(await request.post('/api/v1/activities', { headers: H, data: { title, kind: 'quiz' } }));
  await ok(
    await request.post(`/api/v1/activities/${act.id}/questions`, {
      headers: H,
      data: { type: 'mcq', stem: 'Capital of Karnataka?', marks: 1, options: [{ text: 'Mysuru' }, { text: 'Bengaluru', correct: true }] },
    }),
  );
  await ok(await request.post(`/api/v1/activities/${act.id}/assign`, { headers: H, data: { section_ids: [c.sectionId], require_fullscreen: false, ...settings } }));
}

test('a scheduled activity shows as not started; instructions are read before starting', async ({ page, request }) => {
  const c = await seedClass(request);
  const later = `Later ${c.tag}`;
  const now = `Now ${c.tag}`;
  await assignQuiz(request, c, later, { start_at: new Date(Date.now() + 2 * 3600e3).toISOString(), instructions: 'Bring your ID card.' });
  await assignQuiz(request, c, now, { instructions: 'Keep a calculator ready.' });

  await login(page, c.stuEmail);
  const scheduled = page.locator('div.rounded-2xl', { has: page.getByRole('heading', { name: later }) });
  await expect(scheduled.getByText('not started', { exact: true })).toBeVisible();
  await expect(scheduled.getByRole('button', { name: 'Not started yet' })).toBeDisabled();
  await expect(scheduled.getByRole('button', { name: 'Start', exact: true })).toHaveCount(0);
  await scheduled.getByRole('button', { name: 'Instructions' }).click();
  await expect(page.getByRole('dialog').getByText('Bring your ID card.')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();

  // the open one: Start shows the teacher's note first, then the quiz
  const open = page.locator('div.rounded-2xl', { has: page.getByRole('heading', { name: now }) });
  await open.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByRole('dialog').getByText('Keep a calculator ready.')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Start now' }).click();
  await expect(page.getByText('Capital of Karnataka?')).toBeVisible();
});

test('the sign-in page takes a join code: unknown live code leads a student to the room after sign-in', async ({ page, request }) => {
  const c = await seedClass(request);
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Have a join code?' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Scan QR code' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Join code' }).fill('000001');
  await page.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'room' })).toBeVisible();

  await page.getByLabel('Email').fill(c.stuEmail);
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(PW);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/join\/000001$/);
});

test('admin adds a teacher in two departments and sees the statistics', async ({ page, request }) => {
  const c = await seedClass(request);
  const depts = await ok<{ id: number; code: string }[]>(await request.get('/api/v1/departments', { headers: c.H }));
  if (!depts.some((d) => d.code === 'E2X')) await ok(await request.post('/api/v1/departments', { headers: c.H, data: { code: 'E2X', name: 'E2E second' } }));
  await assignQuiz(request, c, `Stats ${c.tag}`, {});

  await login(page, ADMIN, ADMIN_PW);
  await page.goto('/admin/users');
  await page.getByRole('button', { name: 'Add user' }).click();
  const dlg = page.getByRole('dialog');
  const id = `T${c.tag}`.toUpperCase();
  await dlg.getByLabel('Username (USN / employee ID)').fill(id);
  await dlg.getByLabel('Role').selectOption('faculty');
  await dlg.getByLabel('Full name').fill('Two Dept Teacher');
  await dlg.getByLabel('Email (used to sign in)').fill(`two.${c.tag}@openqz.dev`);
  await dlg.getByLabel('Phone (optional)').fill('+91 98765 43210');
  await dlg.getByLabel('Designation (optional)').fill('Assistant Professor');
  await dlg.getByRole('button', { name: 'E2E', exact: true }).click();
  await dlg.getByRole('button', { name: 'E2X', exact: true }).click();
  await dlg.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('dialog', { name: 'Temporary password' })).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  await page.getByPlaceholder('Search by name, email, phone or USN').fill(id);
  const row = page.getByRole('row').filter({ hasText: id });
  await expect(row).toContainText('Assistant Professor');
  await expect(row).toContainText('E2E, E2X');

  await page.goto('/admin/stats');
  await expect(page.getByRole('heading', { name: 'Statistics' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'By department' })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'E2E tests' }).first()).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: c.facEmail })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Excel' }).click();
  expect((await download).suggestedFilename()).toBe('openqz-stats.xlsx');
});

test('a question timer moves on by itself when time runs out', async ({ page, request }) => {
  const c = await seedClass(request);
  const t = await ok<{ access_token: string }>(await request.post('/api/v1/auth/login', { data: { email: c.facEmail, password: PW } }));
  const H = { Authorization: `Bearer ${t.access_token}` };
  const title = `Timed ${c.tag}`;
  const act = await ok<{ id: string }>(await request.post('/api/v1/activities', { headers: H, data: { title, kind: 'quiz' } }));
  for (const stem of ['First timed question?', 'Second timed question?']) {
    await ok(
      await request.post(`/api/v1/activities/${act.id}/questions`, {
        headers: H,
        data: { type: 'mcq', stem, marks: 1, time_limit_seconds: 5, options: [{ text: 'Yes', correct: true }, { text: 'No' }] },
      }),
    );
  }
  await ok(await request.post(`/api/v1/activities/${act.id}/assign`, { headers: H, data: { section_ids: [c.sectionId], require_fullscreen: false, instant_feedback: false } }));

  await login(page, c.stuEmail);
  await page.locator('div.rounded-2xl', { has: page.getByRole('heading', { name: title }) }).getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByText('First timed question?')).toBeVisible();
  // touch nothing: after 5 seconds the player must show the next question on its own
  await expect(page.getByText('Second timed question?')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('First timed question?')).toHaveCount(0);
});

test('the sign-in page asks other browsers to switch to Chrome, Safari or Edge', async ({ browser, baseURL }) => {
  const firefox = await browser.newContext({ baseURL, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0' });
  const page = await firefox.newPage();
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Open OpenQZ in Chrome, Safari or Edge' })).toBeVisible();
  await expect(page.getByLabel('Email')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sign in' })).toHaveCount(0);
  await firefox.close();

  const safari = await browser.newContext({ baseURL, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' });
  const ok2 = await safari.newPage();
  await ok2.goto('/login');
  await expect(ok2.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await safari.close();
});

test('a custom question time is set on the clock; the answer box stays readable in dark mode', async ({ page, request }) => {
  const c = await seedClass(request);
  const t = await ok<{ access_token: string }>(await request.post('/api/v1/auth/login', { data: { email: c.facEmail, password: PW } }));
  const H = { Authorization: `Bearer ${t.access_token}` };
  const title = `Clock ${c.tag}`;
  const act = await ok<{ id: string }>(await request.post('/api/v1/activities', { headers: H, data: { title, kind: 'quiz' } }));
  await ok(await request.post(`/api/v1/activities/${act.id}/questions`, { headers: H, data: { type: 'open_ended', stem: 'Explain recursion in your words', marks: 2 } }));

  // teacher: Custom... in the timer list opens the clock
  await login(page, c.facEmail);
  await page.goto(`/faculty/activities/${act.id}`);
  const timer = page.getByLabel('Question 1 timer');
  await timer.selectOption('custom');
  const clock = page.getByRole('dialog', { name: 'Custom time' });
  await clock.getByLabel('Minutes', { exact: true }).fill('2');
  await clock.getByLabel('Seconds', { exact: true }).fill('15');
  await clock.getByRole('button', { name: 'Set timer' }).click();
  await expect(clock).toHaveCount(0);
  await expect(timer).toHaveValue('135');
  await expect(timer.locator('option:checked')).toHaveText('2 min 15 s');
  await ok(await request.post(`/api/v1/activities/${act.id}/assign`, { headers: H, data: { section_ids: [c.sectionId], require_fullscreen: false } }));

  // student, dark mode: what they type is dark text on the white box
  await page.evaluate(() => window.localStorage.clear());
  await page.context().clearCookies();
  await page.emulateMedia({ colorScheme: 'dark' });
  await login(page, c.stuEmail);
  await page.locator('div.rounded-2xl', { has: page.getByRole('heading', { name: title }) }).getByRole('button', { name: 'Start', exact: true }).click();
  const box = page.getByLabel('Your answer');
  await box.fill('A function that calls itself');
  const seen = await box.evaluate((el) => {
    const s = getComputedStyle(el);
    return { color: s.color, background: s.backgroundColor };
  });
  expect(seen).toEqual({ color: 'rgb(29, 27, 44)', background: 'rgb(255, 255, 255)' });
  if (process.env.E2E_SHOTS_DIR) await page.screenshot({ path: `${process.env.E2E_SHOTS_DIR}/answer-box-${test.info().project.name}.png` });
});

test('admin deletes a person for good: sees what goes, types the ID and their own password', async ({ page, request }) => {
  const c = await seedClass(request);
  const id = `ES${c.tag}`.toUpperCase();
  await login(page, ADMIN, ADMIN_PW);
  await page.goto('/admin/users');
  await page.getByPlaceholder('Search by name, email, phone or USN').fill(id);
  await page.getByRole('button', { name: `Delete ${id} for good` }).click();
  const dlg = page.getByRole('dialog');
  await expect(dlg.getByText('This cannot be undone.')).toBeVisible();
  const go = dlg.getByRole('button', { name: 'Delete for good' });
  await expect(go).toBeDisabled();

  // a wrong password is refused and nothing is deleted
  await dlg.getByLabel(`Type "${id}" to confirm`).fill(id);
  await dlg.getByRole('textbox', { name: 'Your password', exact: true }).fill('not-the-password');
  await go.click();
  await expect(dlg.getByRole('alert')).toContainText('not your password');

  await dlg.getByRole('textbox', { name: 'Your password', exact: true }).fill(ADMIN_PW);
  await go.click();
  await expect(dlg).toHaveCount(0);
  await expect(page.getByText('No users found')).toBeVisible();
  const gone = await request.post('/api/v1/auth/login', { data: { email: c.stuEmail, password: PW } });
  expect(gone.status()).toBe(401);
});
