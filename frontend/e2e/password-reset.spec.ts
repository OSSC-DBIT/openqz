import { expect, test } from '@playwright/test';

/** Forgot password end to end: the real email is read from Mailpit (dev stack). */
const MAILPIT = process.env.E2E_MAILPIT_URL ?? 'http://localhost:8025';
const ADMIN = process.env.E2E_ADMIN_EMAIL ?? 'admin@openqz.dev';
const ADMIN_PW = process.env.E2E_ADMIN_PASSWORD ?? 'Admin2026Secure';

test('forgot password sends a working one-time link', async ({ page, request }) => {
  const box = await request.get(`${MAILPIT}/api/v1/messages`).catch(() => null);
  const cfg = await (await request.get('/api/v1/auth/config')).json();
  // CI always has Mailpit: there a missing inbox is a failure, not a reason to skip.
  if (process.env.CI) {
    expect(box?.ok(), 'Mailpit must be running in CI').toBe(true);
    expect(cfg.password_reset_email, 'email must be configured in CI').toBe(true);
  }
  test.skip(!box?.ok(), 'Mailpit not running');
  test.skip(!cfg.password_reset_email, 'email not configured');

  // a throwaway student created by the admin
  const admin = await (await request.post('/api/v1/auth/login', { data: { email: ADMIN, password: ADMIN_PW } })).json();
  const tag = `${Date.now().toString(36)}${test.info().project.name.slice(0, 1)}`;
  const email = `reset.${tag}@openqz.dev`;
  const created = await request.post('/api/v1/users', {
    headers: { Authorization: `Bearer ${admin.access_token}` },
    data: { username: `RS${tag}`.toUpperCase(), full_name: 'Reset Tester', email, role: 'student' },
  });
  expect(created.ok()).toBeTruthy();

  await page.goto('/login');
  await page.getByRole('link', { name: 'Forgot your password?' }).click();
  // the sign-in page has an Email box too: wait for the new page before typing
  await expect(page.getByRole('heading', { name: 'Forgot your password?' })).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await expect(page.getByLabel('Email')).toHaveValue(email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByRole('status')).toContainText('reset link is on its way');

  let link = '';
  await expect
    .poll(
      async () => {
        const list = await (await request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json();
        if (!list.messages?.length) return '';
        const msg = await (await request.get(`${MAILPIT}/api/v1/message/${list.messages[0].ID}`)).json();
        link = (msg.Text as string).match(/https?:\/\/\S+reset-password\?token=\S+/)?.[0] ?? '';
        return link;
      },
      { timeout: 20_000 },
    )
    .toContain('token=');

  const url = new URL(link);
  await page.goto(`${url.pathname}${url.search}`);
  await page.getByRole('textbox', { name: 'New password', exact: true }).fill('Fresh2026Pass');
  await page.getByRole('textbox', { name: 'Confirm new password', exact: true }).fill('Fresh2026Pass');
  await page.getByRole('button', { name: 'Save password and sign in' }).click();
  await expect(page.getByRole('heading', { name: /Hi, Reset/ })).toBeVisible();

  // the link only works once
  await page.goto(`${url.pathname}${url.search}`);
  await page.getByRole('textbox', { name: 'New password', exact: true }).fill('Again2026Pass');
  await page.getByRole('textbox', { name: 'Confirm new password', exact: true }).fill('Again2026Pass');
  await page.getByRole('button', { name: 'Save password and sign in' }).click();
  await expect(page.getByRole('alert')).toContainText('invalid or has expired');
});
