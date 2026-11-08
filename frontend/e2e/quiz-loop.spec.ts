import { expect, test, type Page } from '@playwright/test';
import { login, seedClass } from './helpers';

/** Full teach -> attempt -> grade -> review loop through the real UI. */
const SHOTS = process.env.E2E_SHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/loop-${name}.png` });
};

test('teacher builds and assigns, student plays, teacher grades', async ({ browser, request }) => {
  test.setTimeout(180_000);
  const people = await seedClass(request);

  // ---------------- teacher: create for a class, then build the questions
  const tctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const t = await tctx.newPage();
  await login(t, people.facEmail);
  await t.goto('/faculty/library?create=1');
  await t.getByRole('button', { name: /^Quiz/ }).click();
  await t.getByPlaceholder(/e\.g\. Unit 2/).fill('E2E loop quiz');
  await t.getByRole('button', { name: `E2E ${people.sectionName}` }).click();
  await t.getByRole('dialog').getByRole('button', { name: 'Create', exact: true }).click();
  await expect(t.getByText(people.sectionLabel)).toBeVisible();

  // Q1 multiple choice
  await t.getByRole('button', { name: 'Add question' }).click();
  await t.getByRole('button', { name: /^Multiple choice/ }).click();
  await t.getByLabel('Question', { exact: true }).fill('What is 2 + 2?');
  await t.getByLabel('Option 1', { exact: true }).fill('3');
  await t.getByLabel('Option 2', { exact: true }).fill('4');
  await t.getByLabel('Mark option 2 correct').click();
  await shot(t, 'question-editor');
  await t.getByRole('button', { name: 'Save question' }).click();
  await expect(t.getByText('Q1.')).toBeVisible();

  // Q2 true / false
  await t.getByRole('button', { name: 'Add question' }).click();
  await t.getByRole('button', { name: /^True \/ False/ }).click();
  await t.getByLabel('Question', { exact: true }).fill('The earth is flat');
  await t.getByRole('button', { name: 'False' }).click();
  await t.getByRole('button', { name: 'Save question' }).click();
  await expect(t.getByText('Q2.')).toBeVisible();

  // Q3 open ended, 3 marks with a rubric
  await t.getByRole('button', { name: 'Add question' }).click();
  await t.getByRole('button', { name: /^Open ended/ }).click();
  await t.getByLabel('Question', { exact: true }).fill('Why do we test software?');
  await t.getByLabel('Marks', { exact: true }).selectOption('3');
  await t.getByRole('button', { name: 'Add criterion' }).click();
  await t.getByLabel('Criterion 1', { exact: true }).fill('Correct reason');
  await t.getByLabel('Criterion 1 marks').fill('2');
  await t.getByRole('button', { name: 'Add criterion' }).click();
  await t.getByLabel('Criterion 2', { exact: true }).fill('Clear writing');
  await t.getByLabel('Criterion 2 marks').fill('1');
  await expect(t.getByText('3 of 3 marks')).toBeVisible();
  await t.getByRole('button', { name: 'Save question' }).click();
  await expect(t.getByText('Q3.')).toBeVisible();
  await expect(t.getByText('3 questions | 5 marks')).toBeVisible();
  await shot(t, 'editor');

  // assign: the activity's class is pre-selected
  await t.getByRole('button', { name: 'Assign or host' }).click();
  await expect(t.getByRole('dialog').getByRole('button', { name: `E2E ${people.sectionName}` })).toHaveAttribute('aria-pressed', 'true');
  await t.getByRole('dialog').getByRole('button', { name: 'Assign', exact: true }).click();
  await expect(t.getByRole('heading', { name: 'E2E loop quiz' })).toBeVisible();
  await expect(t.getByText('0 of 1 submitted')).toBeVisible();

  // ---------------- student: play on a phone-sized screen
  const sctx = await browser.newContext({ viewport: { width: 412, height: 860 }, hasTouch: true, isMobile: true });
  const s = await sctx.newPage();
  await login(s, people.stuEmail);
  await expect(s.getByText('E2E loop quiz')).toBeVisible();
  await shot(s, 'student-home');
  await s.getByRole('button', { name: 'Start' }).click();
  await expect(s.getByText('What is 2 + 2?')).toBeVisible();
  await expect(s.getByText('1/3', { exact: true })).toBeVisible();
  await shot(s, 'player');

  // leaving the tab is caught and warned about
  await s.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });
  await expect(s.getByText('Warning 1 of 3')).toBeVisible();
  await s.getByRole('button', { name: 'Return to the quiz' }).click();

  await s.getByRole('button', { name: 'Option 2: 4' }).click();
  await expect(s.getByText('Correct!')).toBeVisible();
  await shot(s, 'player-feedback');
  await s.getByRole('button', { name: /Next/ }).click();

  await expect(s.getByText('The earth is flat')).toBeVisible();
  await s.keyboard.press('1'); // keyboard shortcut: tile 1 is True
  await expect(s.getByText('Incorrect')).toBeVisible();
  await s.getByRole('button', { name: /Next/ }).click();

  await expect(s.getByText('Why do we test software?')).toBeVisible();
  await s.getByPlaceholder('Type your answer').fill('To find bugs before users do.');
  await s.getByRole('button', { name: /Finish/ }).click();
  await s.getByRole('alertdialog').getByRole('button', { name: 'Submit' }).click();
  await expect(s.getByRole('heading', { name: 'Submitted' })).toBeVisible();
  await expect(s.getByText('being graded').first()).toBeVisible();

  // ---------------- teacher: grade and check the report
  await t.reload();
  await expect(t.getByText('1 of 1 submitted')).toBeVisible();
  await t.getByRole('button', { name: /Grading \(1\)/ }).click();
  await expect(t.getByText('To find bugs before users do.')).toBeVisible();
  await t.getByLabel('Correct reason marks').fill('2');
  await t.getByLabel('Clear writing marks').fill('0.5');
  await expect(t.getByText('Total 2.5 / 3')).toBeVisible();
  await t.getByLabel('Feedback').fill('Good point');
  await t.getByRole('button', { name: 'Save' }).click();
  await t.getByRole('button', { name: 'Participants' }).click();
  await expect(t.getByRole('cell', { name: '3.5 / 5' })).toBeVisible();
  await expect(t.getByText('1 violations')).toBeVisible();
  await shot(t, 'report');
  const [download] = await Promise.all([t.waitForEvent('download'), t.getByRole('button', { name: 'Excel' }).click()]);
  expect(download.suggestedFilename()).toMatch(/\.xlsx$/);

  // ---------------- student sees the graded result
  await s.reload();
  await expect(s.getByText('Teacher: Good point')).toBeVisible();
  await expect(s.getByLabel('Marks by criterion')).toContainText('Correct reason');
  await expect(s.getByText('70%')).toBeVisible();
  await shot(s, 'review');

  await tctx.close();
  await sctx.close();
});
