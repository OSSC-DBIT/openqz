import { expect, test, type APIRequestContext } from '@playwright/test';

// Needs the dev stack with an admin account. Credentials come from env so CI can seed its own.
const ADMIN = process.env.E2E_ADMIN_EMAIL ?? 'admin@openqz.dev';
const ADMIN_PW = process.env.E2E_ADMIN_PASSWORD ?? 'Admin2026Secure';
const SHOTS = process.env.E2E_SHOTS_DIR;

async function adminToken(request: APIRequestContext): Promise<string> {
  const r = await request.post('/api/v1/auth/login', { data: { email: ADMIN, password: ADMIN_PW } });
  expect(r.ok(), await r.text()).toBeTruthy();
  return (await r.json()).access_token;
}

test('admin signs in and sees the dashboard, users and imports', async ({ page }, info) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(ADMIN);
  await page.getByLabel('Password').fill(ADMIN_PW);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Admin dashboard' })).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${info.project.name}-dashboard.png`, fullPage: true });

  await page.goto('/admin/users');
  await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();
  // the list is paginated (and grows with every test run), so search like an admin would
  await page.getByPlaceholder('Search by name, email or USN').fill('1DB23CS001');
  await expect(page.getByText('1DB23CS001')).toBeVisible();
  await expect(page.getByText('asha@example.com')).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${info.project.name}-users.png`, fullPage: true });

  await page.goto('/admin/imports');
  await expect(page.getByText('Recent imports')).toBeVisible();
  await page.getByText(/students_sample\.csv/).first().click();
  await expect(page.getByText(/Import complete/)).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${info.project.name}-import.png`, fullPage: true });
});

test('student first login forces a password change, then shows their section', async ({ page, request }, info) => {
  const token = await adminToken(request);
  const list = await request.get('/api/v1/users?q=1DB23CS001', { headers: { Authorization: `Bearer ${token}` } });
  const student = (await list.json()).items[0];
  const reset = await request.post(`/api/v1/users/${student.id}/reset-password`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const temp = (await reset.json()).temporary_password as string;

  await page.goto('/login');
  await page.getByLabel('Email').fill('ASHA@example.com'); // case does not matter
  await page.getByLabel('Password').fill(temp);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Set your password' })).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${info.project.name}-set-password.png` });

  const newPw = `Student${Date.now() % 100000}Ok`;
  await page.getByLabel('Current password').fill(temp);
  await page.getByLabel('New password', { exact: true }).fill(newPw);
  await page.getByLabel('Confirm new password').fill(newPw);
  await page.getByRole('button', { name: 'Save password' }).click();

  await expect(page.getByRole('heading', { name: /Hi, Asha/ })).toBeVisible();
  await expect(page.getByText('CSE Sem 5 A')).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${info.project.name}-student.png`, fullPage: true });

  // a student cannot open admin pages
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/student$/);
});

test('wrong password shows a clear error', async ({ page }) => {
  await page.goto('/login');
  // An unknown user: never trips the lockout, and the error must match a real user's.
  await page.getByLabel('Email').fill(`nouser${Date.now() % 100000}@example.com`);
  await page.getByLabel('Password').fill('definitely-wrong');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toHaveText('Incorrect email or password');
});
