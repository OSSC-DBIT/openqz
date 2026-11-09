import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { ADMIN, ADMIN_PW } from './helpers';

/** Automated WCAG 2.1 AA checks (axe-core) on the main screens. */
const STUDENT = process.env.E2E_STUDENT_EMAIL ?? 'student@openqz.dev';
const STUDENT_PW = process.env.E2E_STUDENT_PASSWORD ?? 'Student@2026';
const FACULTY = process.env.E2E_FACULTY_EMAIL ?? 'faculty@openqz.dev';
const FACULTY_PW = process.env.E2E_FACULTY_PASSWORD ?? 'Faculty@2026';

async function audit(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const serious = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

async function signIn(page: Page, email: string, pw: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(pw);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('login page', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await audit(page);
});

test('student home', async ({ page }) => {
  await signIn(page, STUDENT, STUDENT_PW);
  await expect(page.getByRole('heading', { name: /Hi,/ })).toBeVisible();
  await audit(page);
});

test('join with code page', async ({ page }) => {
  await signIn(page, STUDENT, STUDENT_PW);
  await expect(page.getByRole('heading', { name: /Hi,/ })).toBeVisible();
  await page.goto('/join');
  await expect(page.getByRole('heading', { name: 'Join an activity' })).toBeVisible();
  await audit(page);
});

test('create dialog with the class picker', async ({ page }) => {
  await signIn(page, FACULTY, FACULTY_PW);
  await expect(page.getByRole('heading', { name: /Hello/ })).toBeVisible();
  await page.goto('/faculty/library?create=1');
  await page.getByRole('button', { name: /^Quiz/ }).click();
  await audit(page);
});

test('faculty library', async ({ page }) => {
  await signIn(page, FACULTY, FACULTY_PW);
  await expect(page.getByRole('heading', { name: /Hello/ })).toBeVisible();
  await page.goto('/faculty/library');
  await expect(page.getByRole('heading', { name: 'My library' })).toBeVisible();
  await audit(page);
});

test('faculty home', async ({ page }) => {
  await signIn(page, FACULTY, FACULTY_PW);
  await expect(page.getByRole('heading', { name: /Hello/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Recently assigned' })).toBeVisible();
  await audit(page);
  // a quick-create tile opens the create dialog straight at the title step
  await page.getByRole('link', { name: /^Quiz/ }).click();
  await expect(page.getByRole('dialog', { name: 'New quiz' })).toBeVisible();
});

/** The same checks with the phone or laptop set to dark mode (colour contrast flips with the theme). */
test.describe('dark mode', () => {
  test.use({ colorScheme: 'dark' });

  test('login, student home and join page', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await audit(page);
    await signIn(page, STUDENT, STUDENT_PW);
    await expect(page.getByRole('heading', { name: /Hi,/ })).toBeVisible();
    await audit(page);
    await page.goto('/join');
    await expect(page.getByRole('heading', { name: 'Join an activity' })).toBeVisible();
    await audit(page);
  });

  test('faculty home, library and reports', async ({ page }) => {
    await signIn(page, FACULTY, FACULTY_PW);
    await expect(page.getByRole('heading', { name: 'Recently assigned' })).toBeVisible();
    await audit(page);
    await page.goto('/faculty/library');
    await expect(page.getByRole('heading', { name: 'My library' })).toBeVisible();
    await audit(page);
    await page.goto('/faculty/reports');
    await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible();
    await audit(page);
    // an assignment report and its activity editor, if the demo faculty has one
    const report = page.locator('a[href^="/faculty/reports/"]').first();
    if (await report.count()) {
      await report.click();
      await expect(page.getByRole('tab', { name: 'Overview' }).or(page.getByRole('button', { name: 'Overview' }))).toBeVisible();
      await audit(page);
    }
    await page.goto('/faculty/library');
    const edit = page.getByRole('link', { name: /^Edit/ }).or(page.getByRole('button', { name: /^Edit$/ })).first();
    if (await edit.count()) {
      await edit.click();
      await expect(page.getByRole('button', { name: 'Preview' })).toBeVisible();
      await audit(page);
    }
  });

  test('admin pages', async ({ page }) => {
    await signIn(page, ADMIN, ADMIN_PW);
    await expect(page).not.toHaveURL(/\/login$/);
    for (const [path, name] of [
      ['/admin', 'Admin dashboard'],
      ['/admin/users', 'Users'],
      ['/admin/sections', 'Sections'],
      ['/admin/imports', 'Imports'],
      ['/admin/audit', 'Audit log'],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name, exact: true }).first()).toBeVisible();
      await audit(page);
    }
  });
});
