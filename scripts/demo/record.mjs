// Record the OpenQZ demo through the real app: super admin, faculty (desktop), student (phone),
// club with a live game and a room. Every page's screen is captured as timed frames (Chrome's
// screencast: sharper than Playwright's video), and every narration line is logged with the time
// it starts, so scripts/demo/edit.mjs can build one edited, narrated video.
//
//   python scripts/demo/voice.py                      (narration first: the recording waits for it)
//   node scripts/demo/record.mjs [base_url]           (default http://localhost:8088)
//   node scripts/demo/edit.mjs recordings/demo-<time>
//
// Needs the dev stack running with the super admin account (admin@openqz.dev). Every run makes new
// people (emails carry a run tag); the class is CSE semester DEMO_SEM (3) section DEMO_SEC (A).
// UNTIL=<scene> stops after that scene (for trying changes).
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../../frontend/package.json', import.meta.url));
const { chromium } = require('@playwright/test');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const BASE = process.argv[2] ?? 'http://localhost:8088';
const ADMIN = { email: process.env.ADMIN_EMAIL ?? 'admin@openqz.dev', password: process.env.ADMIN_PASSWORD ?? 'Admin2026Secure' };
const SEM = process.env.DEMO_SEM ?? '3';
const SEC = process.env.DEMO_SEC ?? 'A';
const SUBJECT = process.env.DEMO_SUBJECT ?? 'BCS304';
const UNTIL = process.env.UNTIL ?? '';
const PW = 'Dbit2026Demo';

const tag = Date.now().toString(36).slice(-4);
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const OUT = path.join(ROOT, 'recordings', `demo-${stamp}`);
fs.mkdirSync(OUT, { recursive: true });
const VOICE = path.join(ROOT, 'recordings', 'demo-voice');
const DUR = JSON.parse(fs.readFileSync(path.join(VOICE, 'durations.json'), 'utf8'));

const P = {
  faculty: { id: `EMP${tag}`.toUpperCase(), name: 'Dr. Ananya Rao', email: `ananya.rao.${tag}@example.edu` },
  club: { id: `CLUB${tag}`.toUpperCase(), name: 'Tech Club, DBIT', email: `techclub.${tag}@example.edu` },
  rahul: { id: `1DB24CS${tag}01`.toUpperCase(), name: 'Rahul Shetty', email: `rahul.${tag}@example.edu` },
  priya: { id: `1DB24CS${tag}02`.toUpperCase(), name: 'Priya Nair', email: `priya.${tag}@example.edu` },
  kiran: { id: `1DB24CS${tag}03`.toUpperCase(), name: 'Kiran Gowda', email: `kiran.${tag}@example.edu` },
  sneha: { id: `1DB24CS${tag}04`.toUpperCase(), name: 'Sneha Patil', email: `sneha.${tag}@example.edu` },
};
const QUIZ = 'Data Structures: Unit 2 quiz';
const FEST = 'Tech Fest: quick round';

// ---------------------------------------------------------------- API (setup off camera)
async function api(p, token, body, method) {
  const r = await fetch(`${BASE}/api/v1${p}`, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${p} ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}
const login = async (email, password) => (await api('/auth/login', null, { email, password })).access_token;
const A = await login(ADMIN.email, ADMIN.password);
const cse = (await api('/departments', A)).find((d) => d.code === 'CSE');
if ((await api('/sections', A)).some((s) => s.department_code === 'CSE' && String(s.semester) === SEM && s.name === SEC))
  throw new Error(`CSE Sem ${SEM} ${SEC} already exists: run with DEMO_SEM / DEMO_SEC set to a free class`);
if ((await api('/subjects', A)).some((s) => s.code === SUBJECT)) throw new Error(`subject ${SUBJECT} already exists: set DEMO_SUBJECT`);

/** Make an account with a known password (for the people who never appear on camera). */
async function makeUser(p, role, extra = {}) {
  const r = await api('/users', A, { username: p.id, full_name: p.name, email: p.email, role, ...extra });
  const t = await login(p.email, r.temporary_password);
  await api('/auth/change-password', t, { current_password: r.temporary_password, new_password: PW });
  return r.user.id;
}
async function findUser(email) {
  const list = await api(`/users?q=${encodeURIComponent(email)}`, A);
  return (list.items ?? list).find((u) => u.email === email);
}

// ---------------------------------------------------------------- timeline: narration and scenes
const events = [];
const now = () => Date.now() / 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let voiceEnd = 0;
/** Wait for the narrator to finish the current line. */
async function hush(extra = 0.15) {
  const w = voiceEnd + extra - now();
  if (w > 0) await sleep(w * 1000);
}
/** Start a narration line (after the previous one ends); actions follow after `lead` of it. */
async function say(id, lead = 0.45) {
  if (!(id in DUR)) throw new Error(`no voice for ${id}: run scripts/demo/voice.py`);
  await hush();
  events.push({ t: now(), type: 'line', id });
  voiceEnd = now() + DUR[id] + 0.35;
  console.log(`  > ${id}`);
  await sleep(Math.min(DUR[id] * lead, lead >= 1 ? 999 : 3.2) * 1000);
}
async function scene(name, layout, pages, chapter, fn) {
  console.log(`== ${name}`);
  await hush(0.1);
  events.push({ t: now(), type: 'scene', name, layout, pages, chapter });
  await fn();
  await hush(0.6);
  events.push({ t: now(), type: 'end', name });
  save();
  if (UNTIL === name) {
    await finish();
    process.exit(0);
  }
}
function save() {
  fs.writeFileSync(path.join(OUT, 'timeline.json'), JSON.stringify({ base: BASE, tag, sem: SEM, sec: SEC, events, pages: Object.fromEntries(Object.entries(pages).map(([k, v]) => [k, v.meta])) }, null, 1));
}

// ---------------------------------------------------------------- browsers that are filmed
const browser = await chromium.launch();

// Full screen in a filmed browser would resize the page; the app sees it exactly as in a real one.
const FAKE_FULLSCREEN = `(() => {
  let on = null;
  Object.defineProperty(Document.prototype, 'fullscreenElement', { configurable: true, get: () => on });
  Object.defineProperty(Document.prototype, 'fullscreenEnabled', { configurable: true, get: () => true });
  const fire = () => setTimeout(() => document.dispatchEvent(new Event('fullscreenchange')), 60);
  Element.prototype.requestFullscreen = function () { on = this; fire(); return Promise.resolve(); };
  Document.prototype.exitFullscreen = function () { on = null; fire(); return Promise.resolve(); };
})();`;
// A real-looking pointer on desktops, a ripple where a finger taps on phones.
const POINTER = (phone) => `addEventListener('DOMContentLoaded', () => {
  const root = document.documentElement;
  if (${phone}) {
    addEventListener('pointerdown', (e) => {
      const d = document.createElement('div');
      d.style.cssText = 'position:fixed;left:' + e.clientX + 'px;top:' + e.clientY + 'px;width:56px;height:56px;margin:-28px 0 0 -28px;border-radius:50%;background:rgba(214,23,127,.35);border:3px solid rgba(214,23,127,.9);z-index:2147483647;pointer-events:none;transform:scale(.4);opacity:1;transition:transform .45s ease-out,opacity .6s ease-out';
      root.appendChild(d);
      requestAnimationFrame(() => { d.style.transform = 'scale(1.3)'; d.style.opacity = '0'; });
      setTimeout(() => d.remove(), 700);
    }, true);
    return;
  }
  const c = document.createElement('div');
  c.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24"><path d="M4 2.5l15 11.2-6.6.9 3.7 7.3-3 1.5-3.7-7.4-5.4 4.6z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  c.style.cssText = 'position:fixed;left:-60px;top:-60px;width:28px;height:28px;z-index:2147483647;pointer-events:none;transform-origin:4px 3px;transition:transform .1s';
  root.appendChild(c);
  addEventListener('mousemove', (e) => { c.style.left = e.clientX - 4 + 'px'; c.style.top = e.clientY - 3 + 'px'; }, true);
  addEventListener('mousedown', () => { c.style.transform = 'scale(.82)'; }, true);
  addEventListener('mouseup', () => { c.style.transform = ''; }, true);
});`;

const pages = {};
/** A filmed page: desktop 1536x864 at 1.25x (1920x1080 frames) or a phone 390x844 at 2x. */
async function openPage(name, kind) {
  const phone = kind === 'phone';
  const viewport = phone ? { width: 390, height: 844 } : { width: 1536, height: 864 };
  const dsf = phone ? 2 : 1.25;
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: dsf, isMobile: phone, hasTouch: phone, acceptDownloads: true, locale: 'en-IN', timezoneId: 'Asia/Kolkata' });
  await ctx.addInitScript(FAKE_FULLSCREEN);
  await ctx.addInitScript(POINTER(phone));
  const page = await ctx.newPage();
  page.on('dialog', (d) => void d.accept());
  const dir = path.join(OUT, 'frames', name);
  fs.mkdirSync(dir, { recursive: true });
  const meta = { kind, width: viewport.width * dsf, height: viewport.height * dsf, frames: [] };
  const cdp = await ctx.newCDPSession(page);
  let n = 0;
  cdp.on('Page.screencastFrame', (f) => {
    const file = `${String(n++).padStart(6, '0')}.jpg`;
    fs.writeFileSync(path.join(dir, file), Buffer.from(f.data, 'base64'));
    meta.frames.push([file, f.metadata.timestamp ?? now()]);
    void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: meta.width, maxHeight: meta.height, everyNthFrame: 1 });
  // a blank first frame so the timeline starts covered
  await page.goto(`${BASE}/`);
  pages[name] = { page, ctx, cdp, meta, phone };
  return page;
}
async function finish() {
  for (const p of Object.values(pages)) {
    await p.cdp.send('Page.stopScreencast').catch(() => {});
    await p.ctx.close().catch(() => {});
  }
  save();
  await browser.close();
  console.log(`\nRecorded ${events.filter((e) => e.type === 'scene').length} scenes in ${OUT}`);
}

// ---------------------------------------------------------------- acting: move, click, type like a person
const phoneOf = (page) => Object.values(pages).find((p) => p.page === page)?.phone;
async function click(page, loc, opts = {}) {
  await loc.waitFor({ state: 'visible', timeout: opts.timeout ?? 30_000 });
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  if (!phoneOf(page)) {
    const b = await loc.boundingBox();
    if (b) await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 22 });
    await sleep(140);
  } else await sleep(220);
  await loc.click({ timeout: opts.timeout ?? 30_000 });
  await sleep(opts.after ?? 350);
}
async function type(page, loc, text, delay = 42) {
  await click(page, loc, { after: 120 });
  await loc.pressSequentially(text, { delay });
  await sleep(200);
}
async function pick(page, loc, value) {
  await click(page, loc, { after: 150 });
  await loc.selectOption(value);
  await sleep(400);
}
async function signIn(page, email, password) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel('Email').waitFor();
  await sleep(500);
  await type(page, page.getByLabel('Email'), email, 30);
  await type(page, page.getByRole('textbox', { name: 'Password', exact: true }), password, 45);
  await click(page, page.getByRole('button', { name: 'Sign in' }));
  await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 30_000 });
}
async function newPassword(page, temp) {
  const box = (name) => page.getByRole('textbox', { name, exact: true });
  await box('Current password').waitFor();
  await type(page, box('Current password'), temp, 30);
  await type(page, box('New password'), PW, 40);
  await type(page, box('Confirm new password'), PW, 40);
  await click(page, page.getByRole('button', { name: 'Save password' }));
  await page.waitForURL((u) => !u.pathname.includes('password'), { timeout: 30_000 });
}
async function tempFromDialog(page) {
  const box = page.getByRole('dialog', { name: 'Temporary password' });
  await box.waitFor();
  const t = await box.innerText();
  const m = t.match(/Password:\s*(\S+)/);
  if (!m) throw new Error('no temporary password in the dialog');
  return m[1];
}

// ================================================================ the film
const temps = {};
const ids = {};

const admin = await openPage('admin', 'desktop');

await scene('intro', 'title', [], null, async () => {
  await say('intro', 1);
});

await scene('admin', 'desktop', ['admin'], 'admin', async () => {
  const p = admin;
  await say('admin.chapter', 1);
  await say('admin.signin', 0.3);
  await signIn(p, ADMIN.email, ADMIN.password);
  await say('admin.dashboard', 0.9);

  // a section
  await p.goto(`${BASE}/admin/sections`);
  await p.getByRole('heading', { name: 'Sections', exact: true }).first().waitFor();
  await say('admin.section', 0.35);
  await pick(p, p.getByRole('combobox', { name: 'Department' }), { label: 'CSE' });
  await pick(p, p.getByRole('combobox', { name: 'Semester' }), SEM);
  await type(p, p.getByLabel('Section name'), SEC, 120);
  await click(p, p.getByRole('button', { name: 'Add section' }), { after: 900 });

  // a subject
  await p.goto(`${BASE}/admin/subjects`);
  await say('admin.subject', 0.3);
  await type(p, p.getByLabel('Subject code'), SUBJECT, 70);
  await type(p, p.getByLabel('Subject name'), 'Data Structures', 45);
  await pick(p, p.getByRole('combobox', { name: 'Department' }), { label: 'CSE' }).catch(() => {});
  await pick(p, p.getByRole('combobox', { name: 'Semester' }), SEM).catch(() => {});
  await click(p, p.getByRole('button', { name: /^Add/ }).last(), { after: 900 });

  // the teacher
  await p.goto(`${BASE}/admin/users`);
  await say('admin.faculty', 0.3);
  await click(p, p.getByRole('button', { name: 'Add user' }));
  let dlg = p.getByRole('dialog');
  await type(p, dlg.getByLabel('Username (USN / employee ID)'), P.faculty.id, 40);
  await pick(p, dlg.getByLabel('Role'), 'faculty');
  await type(p, dlg.getByLabel('Full name'), P.faculty.name, 40);
  await type(p, dlg.getByLabel('Email (used to sign in)'), P.faculty.email, 25);
  await type(p, dlg.getByLabel('Designation (optional)'), 'Assistant Professor', 30);
  await click(p, dlg.getByRole('button', { name: 'CSE', exact: true }));
  await click(p, dlg.getByRole('button', { name: 'Create' }));
  temps.faculty = await tempFromDialog(p);
  await say('admin.temp', 0.85);
  await click(p, p.getByRole('button', { name: 'Done' }));

  // the club organiser
  await say('admin.club', 0.3);
  await click(p, p.getByRole('button', { name: 'Add user' }));
  dlg = p.getByRole('dialog');
  await type(p, dlg.getByLabel('Username (USN / employee ID)'), P.club.id, 40);
  await pick(p, dlg.getByLabel('Role'), 'club');
  await type(p, dlg.getByLabel('Full name'), P.club.name, 40);
  await type(p, dlg.getByLabel('Email (used to sign in)'), P.club.email, 25);
  await click(p, dlg.getByRole('button', { name: 'Create' }));
  temps.club = await tempFromDialog(p);
  await sleep(1200);
  await click(p, p.getByRole('button', { name: 'Done' }));

  // a student, in the new section
  await say('admin.student', 0.3);
  await click(p, p.getByRole('button', { name: 'Add user' }));
  dlg = p.getByRole('dialog');
  await type(p, dlg.getByLabel('Username (USN / employee ID)'), P.rahul.id, 40);
  await pick(p, dlg.getByLabel('Role'), 'student');
  await type(p, dlg.getByLabel('Full name'), P.rahul.name, 40);
  await type(p, dlg.getByLabel('Email (used to sign in)'), P.rahul.email, 25);
  await pick(p, dlg.getByLabel('Department'), { label: 'CSE' });
  const section = (await api('/sections', A)).find((s) => s.department_code === 'CSE' && String(s.semester) === SEM && s.name === SEC);
  ids.section = section.id;
  await pick(p, dlg.getByLabel('Section'), String(section.id));
  await click(p, dlg.getByRole('button', { name: 'Create' }));
  temps.rahul = await tempFromDialog(p);
  await sleep(900);
  await click(p, p.getByRole('button', { name: 'Done' }));

  // the rest of the class, off camera, then the list
  for (const k of ['priya', 'kiran', 'sneha']) ids[k] = await makeUser(P[k], 'student', { department_ids: [cse.id], section_id: section.id });
  await say('admin.more', 0.4);
  await type(p, p.getByRole('textbox', { name: 'Search by name, email, phone or USN' }), tag, 90);
  await sleep(1500);

  // who teaches what
  await p.goto(`${BASE}/admin/assignments`);
  await say('admin.map', 0.3);
  const fac = await findUser(P.faculty.email);
  await pick(p, p.getByRole('combobox', { name: 'Faculty' }), fac.id);
  await pick(p, p.getByRole('combobox', { name: 'Section' }), String(section.id));
  const sub = (await api('/subjects', A)).find((s) => s.code === SUBJECT);
  await pick(p, p.getByRole('combobox', { name: 'Subject' }), String(sub.id));
  await click(p, p.getByRole('button', { name: /^(Assign|Add|Map)/ }).first(), { after: 1200 });
  await say('admin.done', 1);
});

const fac = await openPage('faculty', 'desktop');
let reportUrl = '';
await scene('faculty', 'desktop', ['faculty'], 'faculty', async () => {
  const p = fac;
  await say('faculty.chapter', 1);
  await say('faculty.first', 0.3);
  await signIn(p, P.faculty.email, temps.faculty);
  await newPassword(p, temps.faculty);
  await say('faculty.home', 0.7);
  await click(p, p.getByRole('link', { name: /^Quiz/ }).first());
  await say('faculty.create', 0.3);
  await type(p, p.getByPlaceholder(/e\.g\. Unit 2/), QUIZ, 40);
  const branch = p.getByRole('group', { name: 'Branch' }).getByRole('button', { name: /^CSE/ });
  if (await branch.count()) await click(p, branch.first());
  const sem = p.getByRole('button', { name: new RegExp(`^Sem ${SEM}$`) });
  if (await sem.count()) await click(p, sem.first());
  await click(p, p.getByRole('dialog').getByRole('button', { name: new RegExp(`(^| )${SEC}$`) }).first());
  await click(p, p.getByRole('dialog').getByRole('button', { name: 'Create', exact: true }), { after: 800 });
  await p.getByRole('button', { name: 'Add question' }).first().waitFor();

  await say('faculty.editor', 0.6);
  await click(p, p.getByRole('button', { name: 'Add question' }).first());
  await sleep(900);
  await say('faculty.mcq', 0.25);
  await click(p, p.getByRole('button', { name: /^Multiple choice/ }));
  await type(p, p.getByLabel('Question', { exact: true }), 'Which data structure gives O(1) average lookup by key?', 32);
  await type(p, p.getByLabel('Option 1', { exact: true }), 'Linked list', 40);
  await type(p, p.getByLabel('Option 2', { exact: true }), 'Hash table', 40);
  await type(p, p.getByLabel('Option 3', { exact: true }), 'Binary heap', 40);
  await type(p, p.getByLabel('Option 4', { exact: true }), 'Stack', 40);
  await click(p, p.getByLabel('Mark option 2 correct'));
  await click(p, p.getByRole('button', { name: 'Save question' }));
  await p.getByText('Q1.').waitFor();

  await say('faculty.tf', 0.25);
  await click(p, p.getByRole('button', { name: 'Add question' }).first());
  await click(p, p.getByRole('button', { name: /^True \/ False/ }));
  await type(p, p.getByLabel('Question', { exact: true }), 'A queue removes items in first in, first out order.', 32);
  await click(p, p.getByRole('button', { name: 'True', exact: true }));
  await click(p, p.getByRole('button', { name: 'Save question' }));
  await p.getByText('Q2.').waitFor();

  await say('faculty.open', 0.25);
  await click(p, p.getByRole('button', { name: 'Add question' }).first());
  await click(p, p.getByRole('button', { name: /^Open ended/ }));
  await type(p, p.getByLabel('Question', { exact: true }), 'When would you choose a linked list over an array? Give one reason.', 30);
  await pick(p, p.getByLabel('Marks', { exact: true }), '3');
  await click(p, p.getByRole('button', { name: 'Add criterion' }));
  await type(p, p.getByLabel('Criterion 1', { exact: true }), 'Correct reason', 40);
  await p.getByLabel('Criterion 1 marks').fill('2');
  await click(p, p.getByRole('button', { name: 'Add criterion' }));
  await type(p, p.getByLabel('Criterion 2', { exact: true }), 'Clear explanation', 40);
  await p.getByLabel('Criterion 2 marks').fill('1');
  await click(p, p.getByRole('button', { name: 'Save question' }));
  await p.getByText('Q3.').waitFor();
  await hush();

  await click(p, p.getByRole('button', { name: 'Assign or host' }));
  await say('faculty.assign', 0.6);
  const dl = p.getByRole('dialog');
  await dl.evaluate((d) => d.querySelector('.overflow-y-auto')?.scrollBy({ top: 500, behavior: 'smooth' })).catch(() => {});
  await sleep(1200);
  await pick(p, dl.getByLabel('Show marks'), 'manual');
  await sleep(600);
  await click(p, dl.getByRole('button', { name: 'Assign', exact: true }), { after: 1500 });
  await p.getByRole('heading', { name: QUIZ }).waitFor();
  reportUrl = p.url();
  await say('faculty.report', 1);
});

const rahul = await openPage('rahul', 'phone');
await scene('student', 'phone', ['rahul'], 'student', async () => {
  const p = rahul;
  await say('student.chapter', 1);
  await say('student.first', 0.3);
  await signIn(p, P.rahul.email, temps.rahul);
  await newPassword(p, temps.rahul);
  await say('student.home', 0.6);
  const card = p.locator('article', { has: p.getByRole('heading', { name: QUIZ }) });
  await click(p, card.getByRole('button', { name: 'Start', exact: true }));
  const startNow = p.getByRole('button', { name: 'Start now' });
  if (await startNow.isVisible().catch(() => false)) await click(p, startNow);
  const fsGate = p.getByRole('button', { name: 'Enter full screen' });
  if (await fsGate.isVisible().catch(() => false)) await click(p, fsGate);
  await p.getByText('Which data structure gives').waitFor();
  await say('student.q1', 0.75);
  await click(p, p.getByRole('button', { name: /Option 2: Hash table/ }));
  await say('student.feedback', 0.8);
  await click(p, p.getByRole('button', { name: /Next/ }));
  await p.getByText('A queue removes').waitFor();
  await sleep(600);
  await p.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });
  await say('student.warn', 0.85);
  await click(p, p.getByRole('button', { name: 'Return to the quiz' }));
  if (await fsGate.isVisible().catch(() => false)) await click(p, fsGate);
  await click(p, p.getByRole('button', { name: /Option 1: True/ }));
  await sleep(900);
  await click(p, p.getByRole('button', { name: /Next/ }));
  await p.getByText('linked list over an array').waitFor();
  await say('student.open', 0.2);
  await type(p, p.getByPlaceholder('Type your answer'), 'A linked list inserts and deletes in the middle in O(1), without shifting the other elements.', 38);
  await hush();
  await click(p, p.getByRole('button', { name: /Finish/ }));
  await say('student.submit', 0.3);
  await click(p, p.getByRole('alertdialog').getByRole('button', { name: 'Submit' }));
  await p.getByRole('heading', { name: 'Submitted' }).waitFor();
});

// the rest of the class answers off camera, so the report has a class to show
{
  const answers = { priya: [1, 0, 'Inserting in the middle is fast, no shifting needed.'], kiran: [0, 0, 'When the size keeps changing.'], sneha: [1, 1, 'A linked list grows without copying, good when we do not know the size.'] };
  for (const [k, [mcq, tf, text]] of Object.entries(answers)) {
    const t = await login(P[k].email, PW);
    const mine = await api('/me/activities', t);
    const a = mine.pending.find((x) => x.title === QUIZ);
    const st = await api(`/me/assignments/${a.assignment_id}/start`, t, {});
    for (let n = 0; n < st.total; n++) {
      const q = await api(`/attempts/${st.attempt_id}/questions/${n}`, t);
      const qq = q.question ?? q;
      let response = null;
      if (qq.type === 'mcq') response = { choice: qq.options[mcq === 1 ? 1 : 0].id };
      if (qq.type === 'true_false') response = { choice: qq.options[tf].id };
      if (qq.type === 'open_ended') response = { text };
      if (response) await api(`/attempts/${st.attempt_id}/answers/${qq.id}`, t, { response, final: false }, 'PUT');
    }
    await api(`/attempts/${st.attempt_id}/submit`, t, {});
  }
}

await scene('marks', 'desktop+phone', ['faculty', 'rahul'], 'marks', async () => {
  const p = fac;
  await say('marks.chapter', 1);
  await p.goto(reportUrl);
  await p.getByRole('heading', { name: QUIZ }).waitFor();
  await say('marks.report', 0.9);
  await click(p, p.getByRole('button', { name: /Grading \(/ }));
  await say('marks.grade', 0.35);
  const notes = ['Good reason, well explained.', 'Right idea, add an example.', 'Clear and correct.', 'Good.'];
  for (let i = 0; i < 4; i++) {
    const field = p.getByLabel('Correct reason marks').first();
    if (!(await field.isVisible().catch(() => false))) break;
    await type(p, field, i === 1 ? '1' : '2', 60);
    await type(p, p.getByLabel('Clear explanation marks').first(), '1', 60);
    if (i < 2) await type(p, p.getByLabel('Feedback').first(), notes[i], 28);
    await click(p, p.getByRole('button', { name: 'Save' }).first(), { after: 1200 });
  }
  await hush();
  await click(p, p.getByRole('button', { name: 'Participants' }));
  await say('marks.participants', 0.85);
  await say('marks.release', 0.25);
  await click(p, p.getByRole('button', { name: /Release marks/ }), { after: 1200 });
  const confirmRelease = p.getByRole('alertdialog').getByRole('button', { name: /Release/ });
  if (await confirmRelease.isVisible().catch(() => false)) await click(p, confirmRelease, { after: 1200 });
  await click(p, p.getByRole('button', { name: 'Excel' }), { after: 1500 });
  await hush();

  const s = rahul;
  await s.goto(`${BASE}/student`);
  await say('marks.student', 0.25);
  const done = s.getByRole('button', { name: /completed/i }).or(s.getByRole('tab', { name: /completed/i }));
  await click(s, done.first());
  const card = s.locator('article', { has: s.getByRole('heading', { name: QUIZ }) });
  const review = card.getByRole('link', { name: /Review|View/ }).or(card.getByRole('button', { name: /Review|View/ }));
  await click(s, review.first());
  await sleep(1500);
  await s.mouse.wheel(0, 500);
  await sleep(1400);
  await s.mouse.wheel(0, 700);
  await sleep(1400);
});

// ---------------------------------------------------------------- the club
const club = await openPage('club', 'desktop');
const priya = await openPage('priya', 'phone');
const guest = await openPage('guest', 'phone');
let festId = '';
await scene('live', 'desktop', ['club'], 'live', async () => {
  const p = club;
  await say('live.chapter', 1);
  await say('live.first', 0.3);
  await signIn(p, P.club.email, temps.club);
  await newPassword(p, temps.club);
  await p.goto(`${BASE}/faculty/library?create=1`);
  await click(p, p.getByRole('button', { name: /^Quiz/ }).first());
  await say('live.create', 0.4);
  await type(p, p.getByPlaceholder(/e\.g\. Unit 2/), FEST, 40);
  await click(p, p.getByRole('dialog').getByRole('button', { name: 'Create', exact: true }), { after: 800 });
  await p.getByRole('button', { name: 'Add question' }).first().waitFor();
  festId = p.url().split('/').pop();

  await say('live.questions', 0.2);
  await click(p, p.getByRole('button', { name: 'Add question' }).first());
  await click(p, p.getByRole('button', { name: /^Multiple choice/ }));
  await type(p, p.getByLabel('Question', { exact: true }), 'Which language runs in every web browser?', 32);
  await type(p, p.getByLabel('Option 1', { exact: true }), 'Python', 45);
  await type(p, p.getByLabel('Option 2', { exact: true }), 'JavaScript', 45);
  await type(p, p.getByLabel('Option 3', { exact: true }), 'C++', 45);
  await type(p, p.getByLabel('Option 4', { exact: true }), 'Rust', 45);
  await click(p, p.getByLabel('Mark option 2 correct'));
  await click(p, p.getByRole('button', { name: 'Save question' }));
  await p.getByText('Q1.').waitFor();
  // two more, added off camera (the editor shows them as they arrive)
  const C = await login(P.club.email, PW);
  for (const q of [
    { type: 'mcq', stem: 'What does CPU stand for?', marks: 1, time_limit_seconds: 20, options: [{ text: 'Central Processing Unit', correct: true }, { text: 'Computer Power Unit' }, { text: 'Core Program Utility' }, { text: 'Central Print Unit' }] },
    { type: 'mcq', stem: 'Which company makes Android?', marks: 1, time_limit_seconds: 20, options: [{ text: 'Apple' }, { text: 'Microsoft' }, { text: 'Google', correct: true }, { text: 'Samsung' }] },
  ])
    await api(`/activities/${festId}/questions`, C, q);
  await p.reload();
  await p.getByText('Q3.').waitFor();
  await hush();

  await click(p, p.getByRole('button', { name: 'Assign or host' }));
  await click(p, p.getByRole('radio', { name: /Live game/ }));
  await say('live.share', 0.35);
  await pick(p, p.getByLabel('How players are ranked'), 'marks_speed');
  await click(p, p.getByLabel(/Let guests join/));
  // the phones wait on their start pages, off camera until the lobby opens
  await priya.goto(`${BASE}/login`);
  await guest.goto(`${BASE}/live`);
  await click(p, p.getByRole('button', { name: 'Start live game' }));
  await p.getByLabel(/^Join code /).waitFor();
});

// the big screen and the phones, side by side
await scene('live2', 'desktop+2phones', ['club', 'priya', 'guest'], 'live', async () => {
  const p = club;
  const code = ((await p.getByLabel(/^Join code /).textContent()) ?? '').replace(/\D/g, '');
  await say('live.lobby', 0.8);

  await say('live.join', 0.15);
  await priya.getByLabel('Email').waitFor();
  await type(priya, priya.getByLabel('Email'), P.priya.email, 26);
  await type(priya, priya.getByRole('textbox', { name: 'Password', exact: true }), PW, 40);
  await click(priya, priya.getByRole('button', { name: 'Sign in' }));
  await priya.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 30_000 });
  await priya.goto(`${BASE}/join`);
  await type(priya, priya.getByLabel('Join code'), code, 110);
  await click(priya, priya.getByRole('button', { name: 'Join', exact: true }));
  await priya.getByText(/Joining as/).waitFor().catch(() => {});
  await click(priya, priya.getByRole('button', { name: 'Join', exact: true }));
  await priya.getByRole('heading', { name: "You're in!" }).waitFor();
  await guest.goto(`${BASE}/live`);
  await type(guest, guest.getByLabel('Game code'), code, 110);
  await click(guest, guest.getByRole('button', { name: 'Enter' }));
  await type(guest, guest.getByLabel('Your nickname'), 'Arjun', 90);
  await click(guest, guest.getByRole('button', { name: 'Join', exact: true }));
  await guest.getByRole('heading', { name: "You're in!" }).waitFor();
  await hush();

  const rounds = [
    ['Which language runs', 'Answer 2: JavaScript', 'Answer 1: Python'],
    ['What does CPU stand for', 'Answer 1: Central Processing Unit', 'Answer 1: Central Processing Unit'],
    ['Which company makes Android', 'Answer 3: Google', 'Answer 3: Google'],
  ];
  for (const [i, [stem, a1, a2]] of rounds.entries()) {
    if (i === 0) await click(p, p.getByRole('button', { name: 'Start' }));
    else await click(p, p.getByRole('button', { name: 'Next question' }));
    await p.getByRole('heading', { name: new RegExp(stem) }).waitFor();
    if (i === 0) await say('live.question', 0.6);
    else if (i === 1) await say('live.next', 0.4);
    await sleep(i === 0 ? 1200 : 1800);
    await click(priya, priya.getByRole('button', { name: a1 }), { timeout: 20_000 });
    await sleep(1400);
    await click(guest, guest.getByRole('button', { name: a2 }), { timeout: 20_000 });
    const after = i < rounds.length - 1 ? p.getByRole('button', { name: 'Leaderboard' }) : p.getByRole('button', { name: /Finish/ });
    await after.waitFor({ timeout: 25_000 });
    if (i === 0) await say('live.reveal', 0.85);
    else await sleep(2500);
    if (i < rounds.length - 1) {
      await click(p, p.getByRole('button', { name: 'Leaderboard' }));
      if (i === 0) await say('live.board', 0.9);
      else await sleep(2500);
    } else {
      await click(p, p.getByRole('button', { name: /Finish/ }));
      await p.getByRole('heading', { name: 'Final results' }).waitFor();
      await say('live.podium', 1);
    }
  }
});

await priya.goto(`${BASE}/student`);
await scene('room', 'desktop+phone', ['club', 'priya'], 'room', async () => {
  const p = club;
  await say('room.chapter', 1);
  await p.goto(`${BASE}/faculty/activities/${festId}`);
  await click(p, p.getByRole('button', { name: 'Assign or host' }));
  const hostChoice = p.getByRole('radio', { name: /Host a room/ });
  if (await hostChoice.count()) await click(p, hostChoice);
  await say('room.host', 0.4);
  await click(p, p.getByRole('dialog').getByRole('button', { name: 'Host room' }));
  const codeEl = p.getByLabel(/^Join code /);
  await codeEl.waitFor();
  const code = ((await codeEl.textContent()) ?? '').replace(/\D/g, '');
  await hush();

  const s = priya;
  await say('room.join', 0.2);
  await s.goto(`${BASE}/join`);
  await type(s, s.getByLabel('Join code'), code, 110);
  await click(s, s.getByRole('button', { name: 'Join', exact: true }));
  await click(s, s.getByRole('button', { name: 'Join and start' }));
  const fsGate = s.getByRole('button', { name: 'Enter full screen' });
  if (await fsGate.isVisible().catch(() => false)) await click(s, fsGate);
  for (const [stem, ans] of [['Which language runs', /Option 2: JavaScript/], ['What does CPU', /Option 1: Central/], ['Which company makes Android', /Option 3: Google/]]) {
    await s.getByText(new RegExp(stem)).waitFor();
    await sleep(700);
    await click(s, s.getByRole('button', { name: ans }));
    await sleep(900);
    const next = s.getByRole('button', { name: /Next/ });
    if (await next.isVisible().catch(() => false)) await click(s, next);
  }
  await click(s, s.getByRole('button', { name: /Finish/ }));
  await click(s, s.getByRole('alertdialog').getByRole('button', { name: 'Submit' }));
  await s.getByRole('heading', { name: 'Submitted' }).waitFor();
  await hush();
  await p.getByText(/1 joined \| 1 finished/).waitFor({ timeout: 20_000 }).catch(() => {});
  await say('room.track', 0.6);
  await click(p, p.getByRole('button', { name: 'Stop new joins' }));
});

await scene('outro', 'title', [], null, async () => {
  await say('outro', 1);
});

await finish();
