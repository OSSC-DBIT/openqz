import { expect, test, type APIRequestContext } from '@playwright/test';
import { ADMIN, ADMIN_PW, login, ok, PW, seedClass } from './helpers';

/** Security checks against the running app: closed API docs, object access between users (IDOR),
 * role guards on pages, images, stored XSS, the session cookie, account lockout, and (on the
 * production build) the security headers. Rate limits live in nginx and are checked separately
 * (docs/security.md), so a parallel test run never trips them. */

async function token(request: APIRequestContext, email: string, password = PW) {
  const t = await ok<{ access_token: string }>(await request.post('/api/v1/auth/login', { data: { privacy_accepted: true, email, password } }));
  return { Authorization: `Bearer ${t.access_token}` };
}

test('the API reference (Swagger, openapi.json) is not served', async ({ request }) => {
  for (const path of ['/api/docs', '/api/openapi.json', '/api/redoc']) expect((await request.get(path)).status(), path).toBe(404);
});

test("one teacher or student cannot open another's work (IDOR)", async ({ request }) => {
  const a = await seedClass(request);
  const b = await seedClass(request);
  const HA = await token(request, a.facEmail);
  const HB = await token(request, b.facEmail);
  const act = await ok<{ id: string }>(await request.post('/api/v1/activities', { headers: HA, data: { title: `Private ${a.tag}`, kind: 'quiz' } }));
  await ok(
    await request.post(`/api/v1/activities/${act.id}/questions`, {
      headers: HA,
      data: { type: 'mcq', stem: 'Secret question?', marks: 1, options: [{ text: 'no' }, { text: 'yes', correct: true }] },
    }),
  );
  const asg = await ok<{ id: string }>(await request.post(`/api/v1/activities/${act.id}/assign`, { headers: HA, data: { section_ids: [a.sectionId], require_fullscreen: false } }));
  const SA = await token(request, a.stuEmail);
  const st = await ok<{ attempt_id: string }>(await request.post(`/api/v1/me/assignments/${asg.id}/start`, { headers: SA }));

  // teacher B: not the activity, not its report, not the export, not the attempt
  for (const path of [`/api/v1/activities/${act.id}`, `/api/v1/activity-assignments/${asg.id}/results`, `/api/v1/activity-assignments/${asg.id}/results.csv`, `/api/v1/activity-assignments/attempts/${st.attempt_id}`]) {
    expect([403, 404], `teacher B ${path}`).toContain((await request.get(path, { headers: HB })).status());
  }
  expect([403, 404]).toContain((await request.patch(`/api/v1/activities/${act.id}`, { headers: HB, data: { title: 'taken' } })).status());

  // student B: not student A's attempt, and not the class assignment of another class
  const SB = await token(request, b.stuEmail);
  for (const path of [`/api/v1/attempts/${st.attempt_id}`, `/api/v1/attempts/${st.attempt_id}/questions/0`, `/api/v1/attempts/${st.attempt_id}/review`]) {
    expect([403, 404], `student B ${path}`).toContain((await request.get(path, { headers: SB })).status());
  }
  expect([403, 404]).toContain((await request.post(`/api/v1/me/assignments/${asg.id}/start`, { headers: SB })).status());

  // students never reach staff data
  for (const path of ['/api/v1/users', '/api/v1/participants', `/api/v1/sections/${a.sectionId}/students`, '/api/v1/audit']) {
    expect([403, 404], `student ${path}`).toContain((await request.get(path, { headers: SA })).status());
  }
  // the owner still sees it all, unchanged
  expect((await ok<{ title: string }>(await request.get(`/api/v1/activities/${act.id}`, { headers: HA }))).title).toBe(`Private ${a.tag}`);
});

test('pages check the role: a student cannot open staff pages, a visitor is sent to sign in', async ({ page, request }) => {
  await page.goto('/admin/users');
  await expect(page).toHaveURL(/\/login/);
  const c = await seedClass(request);
  await login(page, c.stuEmail);
  for (const path of ['/admin', '/admin/users', '/faculty', '/faculty/reports']) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/student/);
  }
});

test('images need a signed-in user; the internal file path is not reachable', async ({ request }) => {
  const H = await token(request, ADMIN, ADMIN_PW);
  expect((await request.get('/api/v1/media/00000000-0000-0000-0000-000000000000')).status()).toBe(401);
  expect((await request.get('/api/v1/media/00000000-0000-0000-0000-000000000000', { headers: H })).status()).toBe(404);
  expect((await request.get('/_media/images/')).status()).toBe(404);
  // path tricks never reach files outside the media folder (nginx answers 400 to raw ../)
  for (const path of ['/_media/../../etc/passwd', '/_media/..%2f..%2fetc%2fpasswd', '/api/v1/media/..%2f..%2fetc%2fpasswd']) {
    const r = await request.get(path);
    expect(await r.text(), path).not.toContain('root:');
  }
});

test('a question with script or HTML in it shows as text and never runs (stored XSS)', async ({ page, request }) => {
  const c = await seedClass(request);
  const H = await token(request, c.facEmail);
  const evil = `<img src=x onerror="window.__xss=1"><script>window.__xss=2</script> ${c.tag}`;
  const act = await ok<{ id: string }>(await request.post('/api/v1/activities', { headers: H, data: { title: `XSS ${c.tag}`, kind: 'quiz' } }));
  await ok(
    await request.post(`/api/v1/activities/${act.id}/questions`, {
      headers: H,
      data: { type: 'mcq', stem: evil, marks: 1, options: [{ text: '<b onmouseover=alert(1)>bold</b>' }, { text: 'ok', correct: true }] },
    }),
  );
  await ok(await request.post(`/api/v1/activities/${act.id}/assign`, { headers: H, data: { section_ids: [c.sectionId], require_fullscreen: false } }));
  let dialogs = 0;
  page.on('dialog', (d) => {
    dialogs++;
    void d.dismiss();
  });
  await login(page, c.stuEmail);
  await page.locator('article', { has: page.getByRole('heading', { name: `XSS ${c.tag}` }) }).getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByText(`<script>window.__xss=2</script> ${c.tag}`, { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: /<b onmouseover=alert\(1\)>bold<\/b>/ })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  expect(dialogs).toBe(0);
});

test('the session cookie cannot be read by scripts and is not sent to other sites', async ({ page, request }) => {
  const c = await seedClass(request);
  await login(page, c.stuEmail);
  const cookie = (await page.context().cookies()).find((k) => k.name === 'openqz_refresh');
  expect(cookie, 'refresh cookie').toBeTruthy();
  expect(cookie!.httpOnly).toBe(true);
  expect(cookie!.sameSite).toBe('Strict');
  expect(await page.evaluate(() => document.cookie)).not.toContain('openqz_refresh');
  // the access token lives in memory, not in storage that scripts on the page could sweep up
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
  expect(stored).not.toMatch(/eyJ[a-zA-Z0-9_-]{10,}\./);
});

test('guessing a password locks the account', async ({ request }) => {
  const c = await seedClass(request);
  let last = 0;
  for (let i = 0; i < 6; i++) last = (await request.post('/api/v1/auth/login', { data: { privacy_accepted: true, email: c.stuEmail, password: `wrong-${i}-guess` } })).status();
  expect(last).toBe(423);
  // even the right password waits until the lock ends
  expect((await request.post('/api/v1/auth/login', { data: { privacy_accepted: true, email: c.stuEmail, password: PW } })).status()).toBe(423);
});

test('security headers are sent (production build)', async ({ request }) => {
  const r = await request.get('/login');
  test.skip(!r.headers()['content-security-policy'], 'the development server has no production headers; run with scripts/prod_smoke.sh');
  const h = r.headers();
  expect(h['content-security-policy']).toContain("default-src 'self'");
  expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(h['x-frame-options']).toBe('DENY');
  expect(h['x-content-type-options']).toBe('nosniff');
  expect(h['referrer-policy']).toBeTruthy();
  expect(h.server ?? '').not.toMatch(/\d/); // no version number
});

test('signing in needs the privacy policy tick, and the agreement is saved', async ({ page, request }) => {
  const c = await seedClass(request);
  // an admin creates a person who has never agreed (seedClass people agreed when they were set up)
  const H = await token(request, ADMIN, ADMIN_PW);
  const email = `privacy.${c.tag}@openqz.dev`;
  const made = await ok<{ user: { id: string }; temporary_password: string }>(
    await request.post('/api/v1/users', { headers: H, data: { username: `PV${c.tag}`.toUpperCase(), full_name: 'Privacy Check', email, role: 'student' } }),
  );
  // the API refuses a sign-in without agreement, after checking the password
  const no = await request.post('/api/v1/auth/login', { data: { email, password: made.temporary_password } });
  expect(no.status()).toBe(403);
  expect((await no.json()).detail.code).toBe('privacy_required');

  // the sign-in page: the button waits for the tick; the link opens the policy
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(made.temporary_password);
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeDisabled();
  await expect(page.getByRole('link', { name: 'Privacy Policy' }).first()).toHaveAttribute('href', '/privacy');
  await page.getByRole('checkbox', { name: /agree to the privacy policy/i }).check();
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/change-password/);

  // saved on the account: an admin sees when and which version
  const u = await ok<{ privacy_accepted_at: string | null; privacy_version: string | null }>(await request.get(`/api/v1/users/${made.user.id}`, { headers: H }));
  expect(u.privacy_accepted_at).toBeTruthy();
  expect(u.privacy_version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});

test('no page breaks the content security policy (no inline styles or scripts) (production build)', async ({ browser, request }) => {
  test.setTimeout(180_000);
  const probe = await request.get('/login');
  test.skip(!probe.headers()['content-security-policy'], 'the development server sends no CSP; run against a production build');
  expect(probe.headers()['content-security-policy']).not.toContain('unsafe-inline');
  expect(probe.headers()['content-security-policy']).not.toContain('unsafe-eval');

  const c = await seedClass(request);
  const H = await token(request, c.facEmail);
  const act = await ok<{ id: string }>(await request.post('/api/v1/activities', { headers: H, data: { title: `CSP ${c.tag}`, kind: 'quiz' } }));
  await ok(await request.post(`/api/v1/activities/${act.id}/questions`, { headers: H, data: { type: 'mcq', stem: 'Pick one', marks: 1, options: [{ text: 'a' }, { text: 'b', correct: true }] } }));
  const asg = await ok<{ id: string }>(await request.post(`/api/v1/activities/${act.id}/assign`, { headers: H, data: { section_ids: [c.sectionId], require_fullscreen: false } }));

  const violations: string[] = [];
  const watch = async (viewport?: { width: number; height: number }) => {
    const ctx = await browser.newContext(viewport ? { viewport } : {});
    await ctx.addInitScript(() =>
      document.addEventListener('securitypolicyviolation', (e) => console.log(`CSP-VIOLATION ${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber}`)),
    );
    const page = await ctx.newPage();
    page.on('console', (m) => m.text().startsWith('CSP-VIOLATION') && violations.push(`${page.url()} ${m.text()}`));
    return page;
  };
  const visit = async (page: Awaited<ReturnType<typeof watch>>, path: string) => {
    await page.goto(path);
    await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => undefined); // the landing video never goes quiet
    await page.waitForTimeout(400);
  };

  // public pages
  const anon = await watch();
  for (const path of ['/', '/login', '/privacy', '/live', '/guides/student.html', '/guides/faculty.html', '/guides/admin.html']) await visit(anon, path);

  // a teacher: home, library, the editor, the report
  const t = await watch();
  await login(t, c.facEmail);
  for (const path of ['/faculty', '/faculty/library', `/faculty/activities/${act.id}`, `/faculty/reports/${asg.id}`, '/faculty/participants']) await visit(t, path);

  // a student on a phone: home, then the quiz player
  const s = await watch({ width: 390, height: 844 });
  await login(s, c.stuEmail);
  await s.locator('article', { has: s.getByRole('heading', { name: `CSP ${c.tag}` }) }).getByRole('button', { name: 'Start', exact: true }).click();
  await expect(s.getByText('Pick one')).toBeVisible();
  await s.getByRole('button', { name: /Option 2: b/ }).click();
  await s.waitForTimeout(500);

  // the admin screens, with a dialog open
  const a = await watch();
  await login(a, ADMIN, ADMIN_PW);
  for (const path of ['/admin', '/admin/users', '/admin/sections', '/admin/stats', '/admin/imports']) await visit(a, path);
  await a.goto('/admin/users');
  await a.getByRole('button', { name: 'Add user' }).click();
  await expect(a.getByRole('dialog')).toBeVisible();
  await a.waitForTimeout(400);

  // a live game host screen (the big screen)
  const game = await ok<{ id: string }>(await request.post('/api/v1/live/games', { headers: H, data: { activity_id: act.id } }));
  await visit(t, `/live/host/${game.id}`);

  expect(violations).toEqual([]);
});
