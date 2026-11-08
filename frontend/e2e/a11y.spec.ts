import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

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
  await page.getByLabel('Password').fill(pw);
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
