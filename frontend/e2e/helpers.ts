import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const ADMIN = process.env.E2E_ADMIN_EMAIL ?? 'admin@openqz.dev';
export const ADMIN_PW = process.env.E2E_ADMIN_PASSWORD ?? 'Admin2026Secure';
export const PW = 'Loop2026Pass';

export async function ok<T>(r: Awaited<ReturnType<APIRequestContext['get']>>): Promise<T> {
  expect(r.ok(), `${r.url()} ${r.status()} ${await r.text()}`).toBeTruthy();
  return (await r.json()) as T;
}

export async function adminHeaders(request: APIRequestContext) {
  const t = await ok<{ access_token: string }>(await request.post('/api/v1/auth/login', { data: { email: ADMIN, password: ADMIN_PW } }));
  return { Authorization: `Bearer ${t.access_token}` };
}

/** Create a user with a known password (temp password changed via the API). */
export async function makeUser(request: APIRequestContext, H: Record<string, string>, role: string, username: string, email: string, name: string) {
  const r = await ok<{ user: { id: string }; temporary_password: string }>(
    await request.post('/api/v1/users', { headers: H, data: { username, full_name: name, email, role } }),
  );
  const t = await ok<{ access_token: string }>(await request.post('/api/v1/auth/login', { data: { email, password: r.temporary_password } }));
  await ok(
    await request.post('/api/v1/auth/change-password', {
      headers: { Authorization: `Bearer ${t.access_token}` },
      data: { current_password: r.temporary_password, new_password: PW },
    }),
  );
  return r.user.id;
}

/** A fresh class (section) taught by a fresh faculty member, with one student in it. */
export async function seedClass(request: APIRequestContext) {
  const tag = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e3).toString(36)}`;
  const H = await adminHeaders(request);
  const depts = await ok<{ id: number; code: string }[]>(await request.get('/api/v1/departments', { headers: H }));
  let dept = depts.find((d) => d.code === 'E2E');
  if (!dept) dept = await ok(await request.post('/api/v1/departments', { headers: H, data: { code: 'E2E', name: 'E2E tests' } }));
  const sectionName = tag.slice(-6).toUpperCase();
  const sec = await ok<{ id: number }>(
    await request.post('/api/v1/sections', { headers: H, data: { department_id: dept!.id, semester: 1, name: sectionName, academic_year: '2026-27' } }),
  );
  const sub = await ok<{ id: number }>(await request.post('/api/v1/subjects', { headers: H, data: { code: `E2E${tag}`.toUpperCase().slice(0, 30), name: 'E2E Subject' } }));
  const facEmail = `fac.${tag}@openqz.dev`;
  const stuEmail = `stu.${tag}@openqz.dev`;
  const facId = await makeUser(request, H, 'faculty', `EF${tag}`.toUpperCase(), facEmail, 'E2E faculty');
  const stuId = await makeUser(request, H, 'student', `ES${tag}`.toUpperCase(), stuEmail, 'E2E student');
  await ok(await request.post('/api/v1/assignments', { headers: H, data: { faculty_id: facId, section_id: sec.id, subject_id: sub.id } }));
  expect((await request.post(`/api/v1/sections/${sec.id}/students`, { headers: H, data: { student_ids: [stuId] } })).status()).toBe(204);
  return { tag, H, facEmail, stuEmail, sectionId: sec.id, sectionName, sectionLabel: `E2E Sem 1 ${sectionName}` };
}

export async function login(page: Page, email: string, password = PW) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('textbox', { name: 'Password' }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/login$/);
}
