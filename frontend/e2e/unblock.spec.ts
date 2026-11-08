import { expect, test } from '@playwright/test';
import { login, ok, PW, seedClass } from './helpers';

test('a student blocked for leaving the quiz is let back in by the teacher', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const c = await seedClass(request);
  const t = await ok<{ access_token: string }>(await request.post('/api/v1/auth/login', { data: { email: c.facEmail, password: PW } }));
  const H = { Authorization: `Bearer ${t.access_token}` };
  const act = await ok<{ id: string }>(await request.post('/api/v1/activities', { headers: H, data: { title: 'Strict quiz', kind: 'quiz', section_ids: [c.sectionId] } }));
  for (const stem of ['First question?', 'Second question?']) {
    await ok(
      await request.post(`/api/v1/activities/${act.id}/questions`, {
        headers: H,
        data: { type: 'mcq', stem, marks: 1, options: [{ text: 'Yes', correct: true }, { text: 'No' }] },
      }),
    );
  }
  const asg = await ok<{ id: string }>(
    await request.post(`/api/v1/activities/${act.id}/assign`, { headers: H, data: { section_ids: [c.sectionId], max_violations: 1, instant_feedback: false } }),
  );

  // student leaves the tab once: with a limit of 1 the quiz is submitted
  const s = await (await browser.newContext({ viewport: { width: 412, height: 860 }, isMobile: true, hasTouch: true })).newPage();
  await login(s, c.stuEmail);
  await s.getByRole('button', { name: 'Start' }).click();
  await expect(s.getByText('First question?')).toBeVisible();
  await s.getByRole('button', { name: 'Option 1: Yes' }).click();
  await s.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });
  await expect(s.getByText('You left the quiz too many times')).toBeVisible();
  await expect(s.getByText(/ask your teacher to/)).toBeVisible();

  // teacher unblocks from the report
  const f = await (await browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
  await login(f, c.facEmail);
  await f.goto(`/faculty/reports/${asg.id}`);
  await expect(f.getByRole('img', { name: 'Q1: incorrect' }).or(f.getByRole('img', { name: 'Q1: correct' }))).toBeVisible();
  await f.getByRole('button', { name: 'Participants' }).click();
  await expect(f.getByText('blocked', { exact: true })).toBeVisible();
  await f.getByRole('button', { name: 'Unblock' }).click();
  await f.getByLabel('Extra minutes').fill('2');
  await f.getByRole('dialog').getByRole('button', { name: 'Unblock' }).click();
  await expect(f.getByText('unblocked 1x')).toBeVisible();

  // the waiting student gets a Continue button and carries on
  await expect(s.getByText('Your teacher let you back in.')).toBeVisible({ timeout: 15_000 });
  await s.getByRole('button', { name: 'Continue the quiz' }).click();
  await expect(s.getByRole('heading', { name: /First question\?|Second question\?/ })).toBeVisible();
});
