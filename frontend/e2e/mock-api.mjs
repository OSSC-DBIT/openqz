// Fake API for design review screenshots without a backend: MOCK=1 node e2e/shots.mjs ...
// Only what the main screens read. Not used by the real browser tests.
const now = Date.now();
const iso = (ms) => new Date(now + ms).toISOString();
const DAY = 86400000;

const me = (role) => ({
  id: `u-${role}`,
  username: role === 'student' ? '1DB23CS001' : role.toUpperCase(),
  full_name: { admin: 'Asha Admin', faculty: 'Dr. Meera Rao', student: 'Arjun Kumar', club: 'Coding Club' }[role],
  email: `${role}@openqz.dev`,
  role,
  department_code: 'CSE',
  must_change_password: false,
  google_linked: false,
});

const options = (texts, right) => texts.map((text, i) => ({ id: 'abcdefgh'[i], text, image_id: null, correct: right.includes(i) }));
const questions = [
  { id: 'q1', position: 0, type: 'mcq', stem: 'Which data structure gives O(1) average lookup by key?', options: options(['Linked list', 'Hash table', 'Binary search tree', 'Stack'], [1]), answer: {}, marks: '1', partial_credit: true, explanation: '', tags: [], time_limit_seconds: 30, rubric: [], stem_image_id: null },
  { id: 'q2', position: 1, type: 'multi_select', stem: 'Pick every sorting algorithm that is stable.', options: options(['Merge sort', 'Quick sort', 'Insertion sort', 'Heap sort'], [0, 2]), answer: {}, marks: '2', partial_credit: true, explanation: '', tags: [], time_limit_seconds: 45, rubric: [], stem_image_id: null },
  { id: 'q3', position: 2, type: 'true_false', stem: 'A binary heap is always a complete binary tree.', options: [{ id: 'true', text: 'True', correct: true }, { id: 'false', text: 'False', correct: false }], answer: { value: true }, marks: '1', partial_credit: true, explanation: '', tags: [], time_limit_seconds: 20, rubric: [], stem_image_id: null },
  { id: 'q4', position: 3, type: 'fill_blank', stem: 'The worst case of quick sort is O(___).', options: [], answer: { blanks: [['n^2', 'n squared']], case_sensitive: false }, marks: '1', partial_credit: true, explanation: '', tags: [], time_limit_seconds: 30, rubric: [], stem_image_id: null },
  { id: 'q5', position: 4, type: 'open_ended', stem: 'Explain when you would choose a B-tree over a hash index.', options: [], answer: {}, marks: '5', partial_credit: true, explanation: '', tags: [], time_limit_seconds: null, rubric: [], stem_image_id: null },
];
const summary = (id, title, kind, status, n) => ({ id, title, description: null, kind, status, subject_id: 1, department_id: 1, section_ids: [1], semesters: [5], class_labels: ['CSE Sem 5 A'], time_limit_seconds: null, question_count: n, total_marks: String(n * 2), assignment_count: 1, created_at: iso(-5 * DAY), updated_at: iso(-DAY) });
const activities = [
  summary('a1', 'Data Structures: Unit 3 quiz', 'quiz', 'published', 5),
  summary('a2', 'DBMS normalisation assignment', 'assignment', 'published', 8),
  summary('a3', 'Which lab slot suits you?', 'poll', 'draft', 3),
  summary('a4', 'OS terms flashcards', 'flashcards', 'draft', 24),
  summary('a5', 'Computer Networks: a very long activity title that has to wrap or truncate nicely on small screens', 'quiz', 'published', 12),
];
const assignment = (id, i, extra = {}) => ({ id, activity_id: activities[i].id, activity_title: activities[i].title, activity_kind: activities[i].kind, start_at: iso(-DAY), due_at: iso(2 * DAY), allow_late: false, max_attempts: 1, shuffle_questions: false, shuffle_options: false, instant_feedback: true, show_answers: 'after_submit', release_mode: 'immediate', released_at: null, time_limit_seconds: 600, max_violations: 3, require_fullscreen: true, notify: true, instructions: null, is_room: false, join_code: null, accepting_joins: false, host_name: 'Dr. Meera Rao', section_ids: [1], student_ids: [], target_labels: ['CSE Sem 5 A'], student_count: 62, submitted_count: 41, created_at: iso(-DAY), ...extra });
const assignments = [assignment('s1', 0), assignment('s2', 1, { submitted_count: 12 }), assignment('s3', 4, { is_room: true, join_code: '482913', accepting_joins: true, target_labels: [], student_count: 18, submitted_count: 18 })];
const mine = (id, i, extra = {}) => ({ assignment_id: id, title: activities[i].title, kind: activities[i].kind, question_count: activities[i].question_count, start_at: iso(-DAY), due_at: iso(2 * DAY), allow_late: false, instructions: null, time_limit_seconds: 600, attempts_used: 0, attempts_left: 1, in_progress_attempt_id: null, can_start: true, window: 'open', best_attempt_id: null, score: null, max_score: null, pending_grading: false, submitted_at: null, ...extra });
const classes = { can_use_sections: true, department: { id: 1, code: 'CSE', name: 'Computer Science' }, branches: [{ id: 1, code: 'CSE', name: 'Computer Science' }, { id: 2, code: 'ECE', name: 'Electronics' }], classes: [{ section_id: 1, department_id: 1, department_code: 'CSE', semester: 5, section: 'A', label: 'CSE Sem 5 A' }, { section_id: 2, department_id: 1, department_code: 'CSE', semester: 5, section: 'B', label: 'CSE Sem 5 B' }, { section_id: 3, department_id: 2, department_code: 'ECE', semester: 3, section: 'A', label: 'ECE Sem 3 A' }], subjects: [] };
const play = (i) => ({ index: i, total: 5, question: { id: questions[i].id, type: questions[i].type, stem: questions[i].stem, stem_image_id: null, options: questions[i].options.map(({ id, text }) => ({ id, text, image_id: null })), marks: questions[i].marks, time_limit_seconds: questions[i].time_limit_seconds, blank_count: 1, select_count: 2 }, response: null, locked: false, question_deadline: iso(25000), server_now: iso(0), feedback: null });

export async function mockApi(page, role) {
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname.replace('/api/v1', '');
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (p === '/auth/refresh') return role === 'none' ? json({ detail: { code: 'invalid_refresh', message: 'Not logged in' } }, 401) : json({ access_token: 't', token_type: 'bearer', expires_in: 900, user: me(role) });
    if (p === '/auth/config') return json({ google_client_id: null, password_login: true, password_reset_email: true });
    if (p === '/me/classes') return json(role === 'club' ? { ...classes, can_use_sections: false, classes: [] } : classes);
    if (p === '/me/sections') return json([{ id: 1, department_id: 1, department_code: 'CSE', semester: 5, name: 'A', academic_year: '2026-27', student_count: 62 }]);
    if (p === '/me/teaching') return json([{ id: 1, faculty_id: 'u-faculty', faculty_name: 'Dr. Meera Rao', faculty_username: 'F001', section_id: 1, section_label: 'CSE Sem 5 A', subject_id: 1, subject_code: 'BCS501', subject_name: 'Data Structures' }, { id: 2, faculty_id: 'u-faculty', faculty_name: 'Dr. Meera Rao', faculty_username: 'F001', section_id: 2, section_label: 'CSE Sem 5 B', subject_id: 2, subject_code: 'BCS502', subject_name: 'Database Management Systems' }]);
    if (p === '/me/activities') return json({ pending: [mine('s1', 0), mine('s2', 1, { window: 'not_started', can_start: false, start_at: iso(DAY) }), mine('s3', 4, { in_progress_attempt_id: 'att1' })], completed: [mine('s4', 2, { can_start: false, attempts_used: 1, attempts_left: 0, best_attempt_id: 'att0', score: '8', max_score: '10', submitted_at: iso(-DAY) })] });
    if (p === '/activity-assignments') return json(assignments);
    if (p === '/live/games') return json([]);
    if (p === '/activities') return json(activities);
    if (/^\/activities\/[^/]+$/.test(p)) return json({ ...activities[0], questions });
    if (p === '/attempts/att1') return json({ attempt_id: 'att1', assignment_id: 's1', activity_title: activities[0].title, activity_kind: 'quiz', status: 'in_progress', submit_reason: null, total: 5, current_index: 0, answered: [], linear: true, instant_feedback: true, started_at: iso(-60000), deadline_at: iso(540000), server_now: iso(0), violations: 0, max_violations: 3, require_fullscreen: false, instructions: null, attempt_no: 1 });
    const m = /^\/attempts\/att1\/questions\/(\d)$/.exec(p);
    if (m) return json(play(Number(m[1])));
    if (p === '/question-import/text') return json({ title: null, questions: [{ ...questions[0], needs_key: false }, { ...questions[1], options: questions[1].options.map((o) => ({ ...o, correct: false })), needs_key: true }, { ...questions[2], needs_key: false }], skipped: [{ title: 'Match the following', reason: 'Grid questions have no match here' }] });
    if (p.endsWith('/violations')) return json({ violations: 0, max: 3, submitted: false, submit_reason: null });
    if (p === '/stats/overview' || p.startsWith('/stats')) return json({});
    return json([]);
  });
}
