import { expect, test, type Page } from '@playwright/test';
import { ADMIN, ADMIN_PW, login, ok, PW, seedClass } from './helpers';

/**
 * Every screen must fit any display: from a small phone (320 px) to a 4K monitor (2560 px).
 * A page that is wider than the window (sideways scrolling) fails, and the report names the elements that stick out.
 */
const WIDTHS = [320, 375, 768, 1024, 1366, 1920, 2560];

/** `reload: false` loads the page once and only resizes the window (the quiz player counts reloads as warnings). */
async function fits(page: Page, path: string, ready: (p: Page) => Promise<unknown>, { reload = true, tablesFit = false } = {}) {
  const problems: string[] = [];
  for (const [i, width] of WIDTHS.entries()) {
    await page.setViewportSize({ width, height: width < 700 ? 800 : 900 });
    if (reload || i === 0) await page.goto(path);
    await ready(page);
    await page.waitForTimeout(250);
    const r = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const out: string[] = [];
      if (document.documentElement.scrollWidth > vw + 1) {
        for (const el of Array.from(document.querySelectorAll('body *'))) {
          const b = el.getBoundingClientRect();
          if (!b.width || b.right <= vw + 1) continue;
          // fine when it sits inside its own horizontal scroller (wide tables)
          let a = el.parentElement;
          let scrolls = false;
          while (a && a !== document.body) {
            if (/(auto|scroll|hidden)/.test(getComputedStyle(a).overflowX) && a.getBoundingClientRect().right <= vw + 1) {
              scrolls = true;
              break;
            }
            a = a.parentElement;
          }
          if (!scrolls) out.push(`<${el.tagName.toLowerCase()} class="${String(el.getAttribute('class') ?? '').slice(0, 50)}"> right=${Math.round(b.right)}`);
          if (out.length >= 3) break;
        }
        if (!out.length) out.push(`page is ${document.documentElement.scrollWidth}px wide`);
      }
      return out;
    });
    // phone-friendly tables must fit without scrolling inside their own box either
    if (tablesFit) {
      const wide = await page.evaluate(() =>
        Array.from(document.querySelectorAll('table'))
          .map((t) => t.parentElement!)
          .filter((box) => box.scrollWidth > box.clientWidth + 1)
          .map((box) => `table needs ${box.scrollWidth}px in a ${box.clientWidth}px box`),
      );
      r.push(...wide);
    }
    if (r.length) problems.push(`${path} at ${width}px: ${r.join(' | ')}`);
  }
  expect(problems).toEqual([]);
}

const heading = (name: string | RegExp) => (p: Page) => expect(p.getByRole('heading', { name }).first()).toBeVisible();

test.describe('fits every screen size', () => {
  // Widths are set per page, so one browser project is enough.
  test.describe.configure({ timeout: 240_000 });
  // eslint-disable-next-line no-empty-pattern -- Playwright requires a destructured fixtures argument
  test.beforeEach(({}, info) => test.skip(info.project.name !== 'desktop', 'runs once, on the desktop project'));

  test('sign-in pages', async ({ page }) => {
    await fits(page, '/login', heading('Sign in'));
    await fits(page, '/forgot-password', (p) => expect(p.getByRole('button').first()).toBeVisible());
    await fits(page, '/live', heading('Join a live game'));
  });

  test('admin screens', async ({ page }) => {
    await login(page, ADMIN, ADMIN_PW);
    for (const [path, h] of [
      ['/admin', 'Admin dashboard'],
      ['/admin/users', 'Users'],
      ['/admin/sections', 'Sections'],
      ['/admin/subjects', 'Subjects'],
      ['/admin/assignments', /mapping|Who teaches/i],
      ['/admin/imports', 'Imports'],
      ['/admin/integrity', /integrity/i],
      ['/admin/audit', /audit/i],
    ] as const) {
      await fits(page, path, heading(h), { tablesFit: true });
    }
  });

  test('faculty and student screens, including the player', async ({ page, browser, request }) => {
    const c = await seedClass(request);
    const t = await ok<{ access_token: string }>(await request.post('/api/v1/auth/login', { data: { email: c.facEmail, password: PW } }));
    const H = { Authorization: `Bearer ${t.access_token}` };
    const act = await ok<{ id: string }>(await request.post('/api/v1/activities', { headers: H, data: { title: 'Responsive quiz with a fairly long title to test wrapping', kind: 'quiz', section_ids: [c.sectionId] } }));
    await ok(
      await request.post(`/api/v1/activities/${act.id}/questions`, {
        headers: H,
        data: {
          type: 'mcq',
          stem: 'Which of these is a long answer option that should wrap nicely on a small phone screen?',
          marks: 2,
          options: [{ text: 'A deliberately long answer option that wraps over two or three lines', correct: true }, { text: 'Short' }, { text: 'Another option' }, { text: 'Fourth' }],
        },
      }),
    );
    const asg = await ok<{ id: string }>(await request.post(`/api/v1/activities/${act.id}/assign`, { headers: H, data: { section_ids: [c.sectionId], require_fullscreen: false } }));

    await login(page, c.facEmail);
    await fits(page, '/faculty', heading(/Hello/));
    await fits(page, '/faculty/library', heading('My library'));
    await fits(page, '/faculty/reports', heading(/Reports/), { tablesFit: true });
    await fits(page, `/faculty/activities/${act.id}`, (p) => expect(p.getByText(/1 question/).first()).toBeVisible());
    await fits(page, `/faculty/reports/${asg.id}`, heading(/Responsive quiz/));

    const s = await (await browser.newContext()).newPage();
    await login(s, c.stuEmail);
    await fits(s, '/student', heading(/Hi,/));
    await fits(s, '/join', heading('Join an activity'));
    const st = await ok<{ access_token: string }>(await request.post('/api/v1/auth/login', { data: { email: c.stuEmail, password: PW } }));
    const SH = { Authorization: `Bearer ${st.access_token}` };
    const att = await ok<{ attempt_id?: string; id?: string }>(await request.post(`/api/v1/me/assignments/${asg.id}/start`, { headers: SH }));
    const attemptId = att.attempt_id ?? att.id;
    await fits(s, `/play/${attemptId}`, (p) => expect(p.getByRole('heading', { name: /Which of these/ })).toBeVisible(), { reload: false });
    await ok(await request.post(`/api/v1/attempts/${attemptId}/submit`, { headers: SH }));
    await fits(s, `/student/review/${attemptId}`, (p) => expect(p.getByText(/Submitted|marks/i).first()).toBeVisible());
  });
});
