import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { login, ok, PW, seedClass } from './helpers';

/**
 * Import questions into a quiz from pasted text (the same review screen serves a Google Form
 * link and a spreadsheet): read, mark the answer the source did not give, add, and see them
 * in the editor. Pasted text is used here because it needs nothing outside this machine.
 */
const TEXT = `1. What is 2 + 2?
A) 3
*B) 4
C) 5

2. Which are even?
A) 2
B) 3
C) 4

3. The earth is flat
Answer: false`;

test('teacher imports questions, marks the missing answer and adds them', async ({ page, request }) => {
  const people = await seedClass(request);
  const t = await ok<{ access_token: string }>(await request.post('/api/v1/auth/login', { data: { email: people.facEmail, password: PW } }));
  const act = await ok<{ id: string }>(
    await request.post('/api/v1/activities', { headers: { Authorization: `Bearer ${t.access_token}` }, data: { title: `Import ${people.tag}`, kind: 'quiz', section_ids: [people.sectionId] } }),
  );

  await login(page, people.facEmail);
  await page.goto(`/faculty/activities/${act.id}`);
  await page.getByRole('button', { name: 'Import a set' }).click();
  const dlg = page.getByRole('dialog', { name: 'Import questions' });
  await expect(dlg.getByRole('tab', { name: /Google Form/ })).toHaveAttribute('aria-selected', 'true');

  // a link that is not a Google Form is refused with a plain message
  await dlg.getByLabel('Link of the Google Form').fill('https://example.com/forms/d/abc/viewform');
  await dlg.getByRole('button', { name: 'Read questions' }).click();
  await expect(dlg.getByRole('alert')).toContainText('Google Form');

  await dlg.getByRole('tab', { name: /Paste text/ }).click();
  await dlg.getByLabel('Questions').fill(TEXT);
  await dlg.getByRole('button', { name: 'Read questions' }).click();

  // Q2 came without a key: it waits until the teacher taps the right answers
  await expect(dlg.getByText('2 ready')).toBeVisible();
  await expect(dlg.getByText('1 need an answer')).toBeVisible();
  await expect(dlg.getByRole('button', { name: 'Add 2 questions' })).toBeVisible();
  await dlg.getByRole('button', { name: 'Question 2, option 2', exact: true }).click();
  await dlg.getByRole('button', { name: 'Question 2, option 4', exact: true }).click();
  await expect(dlg.getByText('3 ready')).toBeVisible();

  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);

  // fits a small phone
  const before = page.viewportSize();
  await page.setViewportSize({ width: 320, height: 700 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  if (before) await page.setViewportSize(before);

  await dlg.getByRole('button', { name: 'Add 3 questions' }).click();
  await expect(dlg).toBeHidden();
  await expect(page.getByRole('heading', { name: '3 questions' })).toBeVisible();
  await expect(page.getByText('What is 2 + 2?')).toBeVisible();
  await expect(page.getByText('Which are even?')).toBeVisible();
  await expect(page.getByText('Answer: False')).toBeVisible();
});
