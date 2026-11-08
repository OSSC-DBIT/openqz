import { expect, test } from '@playwright/test';
import { login, ok, PW, seedClass } from './helpers';

test('questions stay hidden until the student is in full screen', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const c = await seedClass(request);
  const t = await ok<{ access_token: string }>(await request.post('/api/v1/auth/login', { data: { email: c.facEmail, password: PW } }));
  const H = { Authorization: `Bearer ${t.access_token}` };
  const act = await ok<{ id: string }>(await request.post('/api/v1/activities', { headers: H, data: { title: 'Full screen quiz', kind: 'quiz', section_ids: [c.sectionId] } }));
  await ok(
    await request.post(`/api/v1/activities/${act.id}/questions`, {
      headers: H,
      data: { type: 'mcq', stem: 'Is this full screen?', marks: 1, options: [{ text: 'Yes', correct: true }, { text: 'No' }] },
    }),
  );
  await ok(await request.post(`/api/v1/activities/${act.id}/assign`, { headers: H, data: { section_ids: [c.sectionId], max_violations: 5 } }));

  const s = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await login(s, c.stuEmail);
  await s.getByRole('button', { name: 'Start' }).click();
  await expect(s.getByRole('heading', { name: 'Is this full screen?' })).toBeVisible();

  // leaving full screen: a warning, then the gate hides the questions
  await s.evaluate(() => document.exitFullscreen().catch(() => {}));
  await expect(s.getByText('Warning 1 of 5')).toBeVisible();
  await s.getByRole('button', { name: 'Return to the quiz' }).click();
  const gate = s.getByRole('dialog', { name: 'Full screen is required' });
  await expect(gate).toBeVisible();

  await gate.getByRole('button', { name: 'Enter full screen' }).click();
  await expect(gate).toBeHidden();
  await expect(s.getByRole('button', { name: 'Option 1: Yes' })).toBeVisible();
});
