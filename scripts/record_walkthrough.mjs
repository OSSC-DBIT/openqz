// Screen-record a full OpenQZ walkthrough through the real UI, one clip per scene, with captions.
//
//   node scripts/record_walkthrough.mjs [base_url]      (default http://localhost:8088)
//
// Needs a running stack with the admin account (admin@openqz.dev / Admin2026Secure after
// scripts/seed_demo.sh). Every run creates a fresh class (CSE Sem 5, a new section) with one
// teacher and three students, so it can be repeated. Output: recordings/<date-time>/ with
// 01-admin-imports.webm ... and index.html, which plays the clips in order.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const { chromium } = require('@playwright/test');

const BASE = process.argv[2] ?? 'http://localhost:8088';
const ADMIN = { email: process.env.ADMIN_EMAIL ?? 'admin@openqz.dev', password: process.env.ADMIN_PASSWORD ?? 'Admin2026Secure' };
const NEW_PW = 'Openqz2026';
const tag = Date.now().toString(36).slice(-4).toUpperCase();
const SECTION = `D${tag.slice(-2)}`; // a fresh section each run, e.g. "D7K"
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const OUT = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), 'recordings', stamp);
fs.mkdirSync(OUT, { recursive: true });

const TEACHER = { emp: `EMP${tag}`, name: 'Dr. Ananya Rao', email: `ananya.rao.${tag.toLowerCase()}@example.edu` };
const STUDENTS = [
  { usn: `1DB23CS${tag}1`, name: 'Rahul Shetty', email: `rahul.${tag.toLowerCase()}@example.edu` },
  { usn: `1DB23CS${tag}2`, name: 'Priya Nair', email: `priya.${tag.toLowerCase()}@example.edu` },
  { usn: `1DB23CS${tag}3`, name: 'Kiran Gowda', email: `kiran.${tag.toLowerCase()}@example.edu` },
];
const QUIZ = 'Data Structures: Unit 2 quiz';

// ---------------------------------------------------------------- sample sheets (like the office sends)
const csv = (rows) => rows.map((r) => r.join(',')).join('\n') + '\n';
const files = {
  faculty: path.join(OUT, `faculty_${tag}.csv`),
  students: path.join(OUT, `students_${tag}.csv`),
  mapping: path.join(OUT, `mapping_${tag}.csv`),
};
fs.writeFileSync(files.faculty, csv([['Emp ID', 'Faculty Name', 'Dept', 'Email ID'], [TEACHER.emp, TEACHER.name, 'CSE', TEACHER.email]]));
fs.writeFileSync(files.students, csv([['Roll No', 'Student Name', 'Branch', 'Sem', 'Section', 'Email ID'], ...STUDENTS.map((s) => [s.usn, s.name, 'CSE', '5', SECTION, s.email])]));
fs.writeFileSync(files.mapping, csv([['Employee ID', 'Department', 'Semester', 'Section', 'Subject Code', 'Subject Name'], [TEACHER.emp, 'CSE', '5', SECTION, 'BCS304', 'Data Structures']]));

// ---------------------------------------------------------------- API helpers (setup between scenes, off camera)
async function api(p, token, body, method) {
  const r = await fetch(`${BASE}/api/v1${p}`, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${p} ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}
const token = async (email, password) => (await api('/auth/login', null, { email, password })).access_token;
async function tempPassword(email) {
  const A = await token(ADMIN.email, ADMIN.password);
  const list = await api(`/users?q=${encodeURIComponent(email)}`, A);
  const u = (list.items ?? list).find((x) => x.email === email);
  if (!u) throw new Error(`user ${email} not imported`);
  return (await api(`/users/${u.id}/reset-password`, A, {})).temporary_password;
}

// ---------------------------------------------------------------- recording helpers
const browser = await chromium.launch({ slowMo: 90 });
const clips = [];

/**
 * Full screen in a recording browser shrinks the emulated phone screen in the video. Simulate it
 * instead: the app sees document.fullscreenElement exactly as in a real browser, so the gate,
 * warnings and layout behave the same.
 */
const FAKE_FULLSCREEN = `
  (() => {
    let on = null;
    Object.defineProperty(Document.prototype, 'fullscreenElement', { configurable: true, get: () => on });
    Object.defineProperty(Document.prototype, 'fullscreenEnabled', { configurable: true, get: () => true });
    // like real browsers, the change event arrives a moment later
    const fire = () => setTimeout(() => document.dispatchEvent(new Event('fullscreenchange')), 60);
    Element.prototype.requestFullscreen = function () { on = this; fire(); return Promise.resolve(); };
    Document.prototype.exitFullscreen = function () { on = null; fire(); return Promise.resolve(); };
  })();
`;

/** Fake mouse pointer and click ripple (headless videos have no cursor). */
const CURSOR = `
  addEventListener('DOMContentLoaded', () => {
    const c = document.createElement('div');
    c.id = '__rec_cursor';
    c.style.cssText = 'position:fixed;left:-40px;top:-40px;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgba(255,196,0,.55);border:2px solid rgba(255,255,255,.95);box-shadow:0 0 0 2px rgba(0,0,0,.35);z-index:2147483647;pointer-events:none;transition:transform .12s';
    document.documentElement.appendChild(c);
    addEventListener('mousemove', (e) => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
    addEventListener('mousedown', () => { c.style.transform = 'scale(.6)'; }, true);
    addEventListener('mouseup', () => { c.style.transform = 'scale(1)'; }, true);
  });
`;

async function recorder(file, title, viewport) {
  const mobile = viewport.width < 700;
  const ctx = await browser.newContext({
    viewport,
    isMobile: mobile,
    hasTouch: mobile,
    deviceScaleFactor: 1,
    acceptDownloads: true,
    recordVideo: { dir: OUT, size: viewport },
  });
  await ctx.addInitScript(FAKE_FULLSCREEN);
  await ctx.addInitScript(CURSOR);
  const page = await ctx.newPage();
  page.on('dialog', (d) => void d.accept());
  const say = async (text, ms = 1800) => {
    await page
      .evaluate(([t, sub]) => {
        let b = document.getElementById('__rec_caption');
        if (!b) {
          b = document.createElement('div');
          b.id = '__rec_caption';
          b.style.cssText = (innerWidth < 700 ? 'position:fixed;left:50%;top:10px;' : 'position:fixed;left:50%;bottom:18px;') + 'transform:translateX(-50%);max-width:92vw;padding:10px 18px;border-radius:14px;background:rgba(17,12,40,.88);color:#fff;font:600 15px/1.35 system-ui,Segoe UI,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.35);z-index:2147483646;pointer-events:none;text-align:center';
          document.documentElement.appendChild(b);
        }
        b.innerHTML = `<div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#c9b8ff;margin-bottom:2px">${sub}</div>${t}`;
      }, [text, title])
      .catch(() => {});
    await page.waitForTimeout(ms);
  };
  const type = async (locator, text) => {
    await locator.click();
    await locator.pressSequentially(text, { delay: 35 });
  };
  console.log(`== ${file}: ${title}`);
  const finish = async () => {
    await page.waitForTimeout(1200);
    const video = page.video();
    await ctx.close();
    if (video) {
      fs.renameSync(await video.path(), path.join(OUT, `${file}.webm`));
      clips.push({ file: `${file}.webm`, title });
    }
  };
  return { page, say, type, finish };
}

async function scene(file, title, viewport, fn) {
  const r = await recorder(file, title, viewport);
  try {
    await fn(r);
  } finally {
    await r.finish();
  }
}

async function signIn(page, say, type, email, password, who) {
  await page.goto(`${BASE}/login`);
  await say(`${who} opens OpenQZ and signs in with their college email`, 1500);
  await type(page.getByLabel('Email'), email);
  await type(page.getByLabel('Password'), password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.endsWith('/login'));
}

async function firstSignIn(page, say, type, email, temp, who) {
  await signIn(page, say, type, email, temp, who);
  await page.getByLabel('Current password').waitFor();
  await say('First sign-in with the temporary password from the credential slip: OpenQZ asks for a new password', 2200);
  await type(page.getByLabel('Current password'), temp);
  await type(page.getByLabel('New password', { exact: true }), NEW_PW);
  await type(page.getByLabel('Confirm new password'), NEW_PW);
  await page.getByRole('button', { name: 'Save password' }).click();
  await page.waitForURL((u) => !u.pathname.includes('password'));
}

async function importSheet(page, say, kindLabel, file, what) {
  await page.goto(`${BASE}/admin/imports`);
  await say(`Import ${what}: pick the type, the academic year and the sheet from the office`, 2000);
  await page.getByLabel('What are you importing?').selectOption({ label: kindLabel });
  await page.locator('input[type=file]').setInputFiles(file);
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: /Upload and preview/ }).click();
  await page.getByRole('button', { name: /^Import \d+ valid rows?/ }).waitFor({ timeout: 30_000 });
  await say('OpenQZ matches the columns and checks every row before anything is saved', 2600);
  await page.mouse.wheel(0, 500);
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: /^Import \d+ valid rows?/ }).click();
  await page.getByText('Import complete').waitFor({ timeout: 30_000 });
  await page.mouse.wheel(0, -800);
  await say(`${what[0].toUpperCase()}${what.slice(1)} imported`, 1600);
}

// ================================================================ 1. admin brings everyone in
await scene('01-admin-imports', 'Admin: import faculty, students and who teaches what', { width: 1440, height: 900 }, async ({ page, say, type }) => {
  await signIn(page, say, type, ADMIN.email, ADMIN.password, 'The OSSC admin');
  await say('Admin dashboard: students, faculty, sections and teaching assignments for this year', 2400);

  await importSheet(page, say, 'Faculty', files.faculty, 'the faculty sheet');
  await page.getByRole('button', { name: /Credential slips/ }).click();
  await say('Credential slips (PDF): one slip per new account with the email and temporary password, to print and hand out', 2800);
  await page.getByRole('button', { name: /Delete PDF from server/ }).first().click();
  await say('After printing, the PDF is deleted from the server', 1800);

  await importSheet(page, say, 'Students', files.students, 'the student sheet');
  await importSheet(page, say, 'Faculty-section-subject mapping', files.mapping, 'the teaching mapping (who teaches which section and subject)');

  await page.goto(`${BASE}/admin/users`);
  await say('Users: search, reset a password, unlock, change an email or disable an account', 2000);
  await type(page.getByPlaceholder(/Search by name, email, phone or USN/), tag.toLowerCase());
  await say(`The new teacher and students of CSE Sem 5 ${SECTION} are ready`, 2600);

  await page.goto(`${BASE}/admin/assignments`);
  await say('Faculty mapping: Dr. Ananya Rao now teaches Data Structures to this class', 2600);
});

// ================================================================ 2. teacher builds and assigns a quiz
const teacherTemp = await tempPassword(TEACHER.email);
let assignmentUrl = '';
await scene('02-faculty-create-assign', 'Faculty: build a quiz and assign it', { width: 1440, height: 900 }, async ({ page, say, type }) => {
  await firstSignIn(page, say, type, TEACHER.email, teacherTemp, 'Dr. Ananya Rao (faculty)');
  await say('Faculty home: create in one tap, numbers at a glance, recent assignments and classes', 2600);

  await page.getByRole('link', { name: /^Quiz/ }).click();
  await say('New quiz: a title, then the branch and the sections this teacher teaches', 1800);
  await type(page.getByPlaceholder(/e\.g\. Unit 2/), QUIZ);
  await page.getByRole('group', { name: 'Branch' }).getByRole('button', { name: /^CSE/ }).click();
  await page.getByRole('button', { name: `CSE ${SECTION}`, exact: true }).click();
  await page.waitForTimeout(700);
  await page.getByRole('dialog').getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('button', { name: 'Add question' }).first().waitFor();
  await say('The editor: questions on the right, the class and bulk settings on the left', 2000);

  // Q1 multiple choice
  await page.getByRole('button', { name: 'Add question' }).first().click();
  await say('Six question types. First, multiple choice', 1500);
  await page.getByRole('button', { name: /^Multiple choice/ }).click();
  await type(page.getByLabel('Question', { exact: true }), 'Which data structure gives O(1) average lookup by key?');
  await type(page.getByLabel('Option 1', { exact: true }), 'Linked list');
  await type(page.getByLabel('Option 2', { exact: true }), 'Hash table');
  await type(page.getByLabel('Option 3', { exact: true }), 'Binary heap');
  await type(page.getByLabel('Option 4', { exact: true }), 'Stack');
  await page.getByLabel('Mark option 2 correct').click();
  await say('Tick the correct answer, set the timer and marks at the top', 1600);
  await page.getByRole('button', { name: 'Save question' }).click();
  await page.getByText('Q1.').waitFor();

  // Q2 true / false
  await page.getByRole('button', { name: 'Add question' }).first().click();
  await page.getByRole('button', { name: /^True \/ False/ }).click();
  await type(page.getByLabel('Question', { exact: true }), 'A queue removes items in first in, first out order.');
  await page.getByRole('button', { name: 'True', exact: true }).click();
  await page.getByRole('button', { name: 'Save question' }).click();
  await page.getByText('Q2.').waitFor();

  // Q3 open ended with a rubric
  await page.getByRole('button', { name: 'Add question' }).first().click();
  await page.getByRole('button', { name: /^Open ended/ }).click();
  await type(page.getByLabel('Question', { exact: true }), 'When would you choose a linked list over an array? Give one reason.');
  await page.getByLabel('Marks', { exact: true }).selectOption('3');
  await say('Written answers can have a rubric: marks per criterion', 1600);
  await page.getByRole('button', { name: 'Add criterion' }).click();
  await type(page.getByLabel('Criterion 1', { exact: true }), 'Correct reason');
  await page.getByLabel('Criterion 1 marks').fill('2');
  await page.getByRole('button', { name: 'Add criterion' }).click();
  await type(page.getByLabel('Criterion 2', { exact: true }), 'Clear explanation');
  await page.getByLabel('Criterion 2 marks').fill('1');
  await page.getByRole('button', { name: 'Save question' }).click();
  await page.getByText('Q3.').waitFor();
  await say('3 questions, 5 marks. Preview shows it exactly as students see it', 2200);

  // assign
  await page.getByRole('button', { name: 'Assign or host' }).click();
  await say('Assign: the class is already selected. Set a deadline, the timer, shuffling and full screen', 2600);
  await page.getByLabel('Show marks').selectOption('manual');
  await say('Marks stay hidden until the teacher releases them (written answers need marking first)', 2400);
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(800);
  await page.getByRole('dialog').getByRole('button', { name: 'Assign', exact: true }).click();
  await page.waitForTimeout(1500);
  const T = await token(TEACHER.email, NEW_PW);
  const mine = await api('/activity-assignments', T);
  assignmentUrl = `${BASE}/faculty/reports/${mine.find((x) => x.activity_title === QUIZ).id}`;
  await page.goto(assignmentUrl);
  await page.getByText(QUIZ).first().waitFor();
  await say('Assigned. Its report fills in live as students submit', 2400);
});

// ================================================================ 3. a student takes it on a phone
const stu = STUDENTS[0];
const stuTemp = await tempPassword(stu.email);
await scene('03-student-takes-quiz', 'Student (phone): take the quiz', { width: 390, height: 844 }, async ({ page, say, type }) => {
  await firstSignIn(page, say, type, stu.email, stuTemp, 'Rahul (student, on his phone)');
  await say('Student home: pending quizzes and assignments, and a box for join codes', 2200);
  await page.getByText(QUIZ).waitFor();
  await page.getByRole('button', { name: 'Start' }).click();
  await page.getByRole('heading', { name: /Which data structure/ }).waitFor();
  await say('Full screen, one question at a time, timers kept by the server', 2200);

  await page.getByRole('button', { name: /Option 2: Hash table/ }).click();
  await say('Instant feedback, when the teacher allows it', 1800);
  await page.getByRole('button', { name: /Next/ }).click();

  await page.getByRole('heading', { name: /A queue removes/ }).waitFor();
  // leaving the quiz is caught
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });
  await say('Switching apps or tabs is noticed: a warning, counted for the teacher; too many and the quiz is submitted', 2800);
  await page.getByRole('button', { name: 'Return to the quiz' }).click();
  await page.getByRole('button', { name: 'Return to the quiz' }).waitFor({ state: 'hidden' }).catch(() => {});
  const fsGate = page.getByRole('button', { name: 'Enter full screen' });
  if (await fsGate.isVisible().catch(() => false)) await fsGate.click();
  await page.getByRole('button', { name: /Option 1: True/ }).click();
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: /Next/ }).click();

  await page.getByRole('heading', { name: /linked list over an array/ }).waitFor();
  await type(page.getByPlaceholder('Type your answer'), 'Linked lists insert and delete in the middle in O(1) without shifting elements.');
  await say('Written answers are saved as the student types', 1500);
  await page.getByRole('button', { name: /Finish/ }).click();
  await say('Submit asks for confirmation', 1200);
  await page.getByRole('alertdialog').getByRole('button', { name: 'Submit' }).click();
  await page.getByRole('heading', { name: 'Submitted' }).waitFor();
  await say('Submitted. Marks appear once the teacher marks the written answer and releases them', 2800);
});

// the other two students submit off camera, so the report has a class to show
for (const [i, s] of STUDENTS.slice(1).entries()) {
  const temp = await tempPassword(s.email);
  let t = await token(s.email, temp);
  t = (await api('/auth/change-password', t, { current_password: temp, new_password: NEW_PW })).access_token ?? t;
  const mine = await api('/me/activities', t);
  const a = mine.pending.find((x) => x.title === QUIZ);
  const st = await api(`/me/assignments/${a.assignment_id}/start`, t, {});
  for (let n = 0; n < st.total; n++) {
    const q = await api(`/attempts/${st.attempt_id}/questions/${n}`, t);
    const qq = q.question ?? q;
    let response = null;
    if (qq.type === 'mcq') response = { choice: qq.options[i === 0 ? 1 : 0].id };
    if (qq.type === 'true_false') response = { choice: qq.options[i === 0 ? 0 : 1].id };
    if (qq.type === 'open_ended') response = { text: i === 0 ? 'Fast inserts in the middle.' : 'When the size changes often, a linked list grows without copying.' };
    if (response) await api(`/attempts/${st.attempt_id}/answers/${qq.id}`, t, { response, final: false }, 'PUT');
  }
  await api(`/attempts/${st.attempt_id}/submit`, t, {});
}

// ================================================================ 4. teacher marks, releases, exports
await scene('04-faculty-report-grade', 'Faculty: report, marking and releasing marks', { width: 1440, height: 900 }, async ({ page, say, type }) => {
  await signIn(page, say, type, TEACHER.email, NEW_PW, 'Dr. Ananya Rao');
  await page.goto(assignmentUrl);
  await page.getByText(QUIZ).first().waitFor();
  await say('Report: completion, average and highest / lowest marks, and a student x question grid', 3000);
  await page.getByRole('button', { name: /Grading \(/ }).click();
  await say('Grading: each written answer with its rubric', 2000);
  await page.getByLabel('Correct reason marks').first().fill('2');
  await page.getByLabel('Clear explanation marks').first().fill('1');
  await type(page.getByLabel('Feedback').first(), 'Well explained.');
  await page.getByRole('button', { name: 'Save' }).first().click();
  await page.waitForTimeout(1200);
  for (let i = 0; i < 4; i++) {
    const next = page.getByLabel('Correct reason marks').first();
    if (!(await next.isVisible().catch(() => false))) break;
    await next.fill('1');
    await page.getByLabel('Clear explanation marks').first().fill('1');
    await page.getByRole('button', { name: 'Save' }).first().click();
    await page.waitForTimeout(1200);
  }
  await page.getByRole('button', { name: 'Overview' }).click();
  await say('Every answer marked: the grid shows correct, partly correct and wrong per question', 2600);
  await page.getByRole('button', { name: 'Participants' }).click();
  await say('Participants: marks obtained, accuracy and warnings for each student', 2400);
  await page.getByRole('button', { name: /Release marks/ }).click();
  await say('Release marks: students can now see them (and get an email, if email is set up)', 2600);
  await page.getByRole('button', { name: 'Excel' }).click();
  await say('Export to Excel or CSV for the department records', 2200);
});

// ================================================================ 5. student sees the marks
await scene('05-student-sees-marks', 'Student (phone): marks and review', { width: 390, height: 844 }, async ({ page, say, type }) => {
  await signIn(page, say, type, stu.email, NEW_PW, 'Rahul');
  await page.getByRole('button', { name: /completed/i }).click();
  await say('Completed: marks obtained, now that the teacher released them', 2000);
  await page.getByText(QUIZ).first().click().catch(() => {});
  await page.getByRole('link', { name: /Review|View/ }).first().click().catch(() => {});
  await page.waitForTimeout(1500);
  await say('Review: accuracy, marks obtained, each answer and the teacher feedback', 2600);
  await page.mouse.wheel(0, 700);
  await page.waitForTimeout(1500);
  await page.mouse.wheel(0, 900);
  await page.waitForTimeout(1500);
});

// ================================================================ 6. a room with a join code (live)
{
  const T = await token(TEACHER.email, NEW_PW);
  const room = await api('/activities', T, { title: 'Tech Fest: quick round', kind: 'quiz' });
  for (const q of [
    { type: 'mcq', stem: 'Which language runs in every web browser?', marks: 1, options: [{ text: 'Python' }, { text: 'JavaScript', correct: true }, { text: 'C++' }, { text: 'Rust' }] },
    { type: 'mcq', stem: 'What does HTTP stand for?', marks: 1, options: [{ text: 'HyperText Transfer Protocol', correct: true }, { text: 'High Transfer Text Process' }] },
  ])
    await api(`/activities/${room.id}/questions`, T, q);

  const host = await recorder('06a-room-host', 'Faculty: host a room with a join code', { width: 1440, height: 900 });
  let player = null;
  try {
    const h = host.page;
    await signIn(h, host.say, host.type, TEACHER.email, NEW_PW, 'Dr. Ananya Rao');
    await h.goto(`${BASE}/faculty/activities/${room.id}`);
    await host.say('Rooms: for events, labs or any student, not tied to a class. Open an activity, then Assign or host', 2400);
    await h.getByRole('button', { name: 'Assign or host' }).click();
    await h.getByRole('radio', { name: /Host a room/ }).click();
    await host.say('Host a room: OpenQZ makes a 6-digit join code and a QR code', 2000);
    await h.getByRole('dialog').getByRole('button', { name: 'Host room' }).click();
    const codeEl = h.getByLabel(/^Join code /);
    await codeEl.waitFor();
    const code = ((await codeEl.textContent()) ?? '').replace(/\D/g, '');
    await h.getByRole('button', { name: 'Present' }).click();
    await host.say('Present: the lobby for the projector, players appear as they join', 2400);

    player = await recorder('06b-room-join', 'Student (phone): join a room with the code', { width: 390, height: 844 });
    const p2 = player.page;
    const priya = STUDENTS[1];
    await signIn(p2, player.say, player.type, priya.email, NEW_PW, 'Priya (student, on her phone)');
    await p2.goto(`${BASE}/join`);
    await player.say('Join with the code from the screen (or scan the QR code)', 1600);
    await player.type(p2.getByLabel('Join code'), code);
    await p2.getByRole('button', { name: 'Join', exact: true }).click();
    await p2.getByRole('button', { name: 'Join and start' }).waitFor();
    await player.say('A preview: who is hosting, how many questions, the timer', 2000);
    await p2.getByRole('button', { name: 'Join and start' }).click();
    await host.say('Priya joined: the lobby updates live', 2200);
    await p2.getByRole('heading', { name: /Which language/ }).waitFor();
    await p2.getByRole('button', { name: /Option 2: JavaScript/ }).click();
    await p2.waitForTimeout(900);
    await p2.getByRole('button', { name: /Next/ }).click();
    await p2.getByRole('heading', { name: /HTTP/ }).waitFor();
    await p2.getByRole('button', { name: /Option 1: HyperText/ }).click();
    await p2.waitForTimeout(900);
    await p2.getByRole('button', { name: /Finish/ }).click();
    await p2.getByRole('alertdialog').getByRole('button', { name: 'Submit' }).click();
    await p2.getByRole('heading', { name: 'Submitted' }).waitFor();
    await player.say('Done: 2 out of 2', 2000);

    await h.getByRole('dialog', { name: 'Room lobby' }).getByRole('button', { name: 'Close' }).click();
    await h.getByText(/1 joined \| 1 finished/).waitFor({ timeout: 15_000 });
    await host.say('The host sees who joined and finished, and can stop new joins or change the code', 2400);
    await h.getByRole('button', { name: 'Stop new joins' }).click();
    await host.say('Stopped: students who joined keep access, nobody new can join', 2200);
  } finally {
    await host.finish();
    if (player) await player.finish();
  }
}

// ================================================================ 7. admin oversight
await scene('07-admin-logs', 'Admin: integrity and audit logs', { width: 1440, height: 900 }, async ({ page, say, type }) => {
  await signIn(page, say, type, ADMIN.email, ADMIN.password, 'The OSSC admin');
  await page.goto(`${BASE}/admin/integrity`);
  await say('Integrity log: every tab switch, Back press, reload or full-screen exit during quizzes', 2800);
  await page.goto(`${BASE}/admin/audit`);
  await say('Audit log: sign-ins, imports, password resets, assignments and marks releases', 2800);
  await page.goto(`${BASE}/admin`);
  await say('That is the whole cycle: import, create, assign, attempt, mark, release, review', 3000);
});

await browser.close();

// ---------------------------------------------------------------- a simple player for the clips
const items = clips.map((c, i) => `<li><button data-i="${i}">${i + 1}. ${c.title}</button></li>`).join('\n');
fs.writeFileSync(
  path.join(OUT, 'index.html'),
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OpenQZ walkthrough</title>
<style>body{margin:0;font:15px system-ui,Segoe UI,sans-serif;background:#12111a;color:#ecebf5;display:grid;grid-template-columns:minmax(0,1fr) 320px;min-height:100vh}
main{display:grid;place-items:center;padding:16px}video{max-width:100%;max-height:92vh;border-radius:12px;background:#000}
aside{padding:16px;border-left:1px solid #2c2a3a}h1{font-size:18px;margin:0 0 12px}ol{list-style:none;padding:0;margin:0}
button{width:100%;text-align:left;margin:0 0 6px;padding:10px 12px;border-radius:10px;border:1px solid #2c2a3a;background:#1c1a27;color:inherit;font:inherit;cursor:pointer}
button.on{border-color:#b9a8ff;background:#2d2457}@media(max-width:800px){body{grid-template-columns:1fr}aside{border:0}}</style></head>
<body><main><video id="v" controls autoplay></video></main><aside><h1>OpenQZ walkthrough</h1><ol>${items}</ol>
<p style="color:#a29fb8;font-size:13px">Recorded ${new Date().toLocaleString()} against ${BASE}. Plays in order; pick a chapter to jump.</p></aside>
<script>const clips=${JSON.stringify(clips)};const v=document.getElementById('v');const bs=[...document.querySelectorAll('button')];let i=0;
function play(n){i=n;v.src=clips[n].file;v.play();bs.forEach((b,k)=>b.classList.toggle('on',k===n));}
bs.forEach((b)=>b.onclick=()=>play(+b.dataset.i));v.onended=()=>{if(i+1<clips.length)play(i+1)};play(0);</script></body></html>`,
);
console.log(`\nSaved ${clips.length} clips and index.html in ${OUT}`);
