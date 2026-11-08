# Architecture

## Components

```
browser / PWA
   |  HTTPS
edge nginx (TLS, HSTS)                      deploy/edge
   |
web nginx (SPA + /api proxy, CSP)           frontend/nginx.conf
   |                    \
FastAPI (gunicorn)       static React build
   |        \
Postgres 16  Redis 7 <---- ARQ worker (imports, emails, auto-submit sweeper)
                                \--> SMTP (optional)
```

| Component | Role |
| --- | --- |
| `frontend/` | React 19 + TypeScript SPA, installable PWA. Built into the `web` image, which also proxies `/api`. |
| `backend/app/api/v1` | FastAPI routers: `auth`, `users` (+ `audit`), `org`, `imports`, `activities`, `results`, `play`, `media`, `integrity`, `health`. |
| `backend/app/services` | Business logic: auth, Google token check, import parse / commit, credential PDF, grading, attempts, email, audit. |
| `backend/app/worker` | ARQ worker: import jobs, emails (reset, assigned, released), and a cron job that auto-submits expired attempts every minute. |
| `migrate` | One-shot `alembic upgrade head` before the API starts. |
| Postgres | All data. Redis: job queue and rate-limit counters. |

## Data model

```
departments 1--* sections 1--* student_sections *--1 users (student)
departments 1--* subjects
users (faculty) 1--* faculty_assignments *--1 sections, *--1 subjects
users 1--* refresh_tokens, password_reset_tokens, audit_log (actor)
import_jobs (kind, status, header_map, preview_rows, error_rows, credential_pdf_path)

activities (owner, kind, status, department, subject, timer)
   1--* activity_sections *--1 sections   (the classes it is for, any semesters)
   1--* questions (type, stem, options, answer key, marks, explanation, tags, timer, rubric)
media (uploaded images)
activities 1--* activity_assignments (window, attempts, shuffle, feedback, review, release, notify, violations,
                                       join_code, accepting_joins)
   1--* assignment_targets (section | student; room joiners are added as students)
   1--* attempts (student, snapshot, deadline_at, linear, late, violations, score, needs_manual)
           1--* attempt_answers (response, timers, locked, auto / manual score, rubric_scores, feedback)
integrity_events (user, attempt, session, kind, client time, meta)
```

- `users.email` is the login id: lower-case, unique (functional index on `lower(email)`). `users.username` is the USN or employee ID, unique case-insensitively, shown in lists and reports. `users.google_sub` pins the linked Google account.
- Sections belong to an academic year (`2026-27`); a student has one section per year.
- An activity records the classes it is for (`activity_sections`, any number of sections across semesters and branches). Faculty may pick only sections they teach, in any branch (checked in `activities.resolve_classes`); `/me/classes` returns those classes plus `branches`. `activities.department_id` is the branch of its sections, or null when they mix branches. Admins may pick any sections. Club organisers pick none. The library filters by `department_id`, `semester` and `section_id`.
- Marks are `NUMERIC`, never floats.

## Authentication

- **Email + password:** Argon2id. Five failures lock the account for 15 minutes. Rate limits per IP (Redis and nginx) and identical errors and timing for unknown emails.
- **Google:** Google Identity Services gives the browser an ID token; `/auth/google` verifies signature (Google JWKS), audience, issuer, expiry and `email_verified`, then signs in the existing user with that email. First use stores `google_sub`; later logins must match. An unused temporary password is cancelled.
- **Tokens:** 15-minute access JWT in memory; rotating refresh token in an `httpOnly`, `SameSite=Strict` cookie, stored hashed; reuse revokes the family.
- **Forgot password:** single-use 30-minute token emailed by the worker; stored hashed; using it burns all outstanding tokens and revokes sessions.
- **Forced change:** temporary passwords block every route except `/auth/*` with `403 password_change_required`.
- **Roles:** `admin`, `faculty`, `student`, `club`. `CreatorUser` (admin, faculty, club) may build activities and host rooms; `StaffUser` (admin, faculty) may assign to classes and read class lists.
- **RBAC:** `require_roles(...)` per route; ownership checks for faculty and club data; students reach only their own attempts.

## Attempts, timers and integrity

- On start the questions are **frozen into `attempts.snapshot`** (shuffled per student when enabled). The answer key and rubric never leave the server (`grading.strip_key`). Later edits to the activity do not affect existing attempts.
- **Server-side timers:** `deadline_at` = start + activity timer, capped by the deadline unless late work is allowed. A question timer starts when the question is first opened. Saves after a timer (plus 5 s grace) are rejected and the question locks. Any request after `deadline_at` auto-submits; the worker's cron sweeps abandoned attempts every minute.
- **Linear mode:** if any question has a timer, questions are answered in order with no going back.
- **Instant feedback:** an answer confirmed with `final: true` is graded at once and locked.
- **Unblock:** `POST /activity-assignments/attempts/{id}/unblock` reopens an attempt whose `submit_reason` is `violations` (and only if no newer attempt exists). `attempt_answers.submit_locked` marks answers closed only by the submit, so those reopen while timer and instant-feedback locks stay; the deadline and open question timers shift by the blocked time plus `extra_minutes`; violations reset; `attempts.unblocked_count` and the audit log record it.
- **Full screen:** `activity_assignments.require_fullscreen` (default true) makes the player hide the questions behind a gate until `document.fullscreenElement` is set, wherever the Fullscreen API exists (not on iPhone). Exits are reported as `fullscreen_exit` violations.
- **Integrity:** the player reports tab or app switch, focus loss (over 1.5 s), Back, reload and fullscreen exit to `POST /attempts/{id}/violations`. The server counts them and auto-submits at the assignment's limit.

## Rooms (join with a code)

- An assignment created with `room: true` gets a unique 6-digit `join_code` (from `secrets`, retried on collision). It may have no class targets: it is reached only by code.
- `GET /join/{code}` returns a preview (title, host, question count, timer, deadline, open or not). `POST /join` adds the student as an `assignment_targets` row, after which everything (start, timers, violations, review, reports) is the normal assignment path.
- The host can stop new joins (`accepting_joins = false`) or rotate the code (`POST /activity-assignments/{id}/new-code`); students already joined keep access.
- Joining is rate-limited to 20 tries per minute per user, so codes cannot be guessed by brute force (10^6 codes).
- Club organisers can only host rooms; they never see class lists.

## Grading and reports

- `services/grading.py` (pure functions): MCQ / True-False exact; multi-select partial credit (right minus wrong, floor 0) or all-or-nothing; fill-in-the-blank per blank with alternatives, case and trailing-dot tolerant; justify and open answers wait for a teacher (empty answers score 0). Polls and flashcards are never scored.
- Manual grading takes one score or, with a rubric, marks per criterion (summed, each capped at its maximum).
- **One attempt per student**: `start` refuses a second attempt (`already_taken`); the Attempts setting was removed from the API. `max_attempts` stays in the table only so the load-test seed can allow unlimited starts. Reports use the submitted attempt. Exports: CSV and Excel (Summary, Students, Marks by question, Questions).
- Reports show **marks obtained** per student (overview grid of student x question cells: correct, partial, wrong, pending, blank), average and highest / lowest marks. Marks visibility: immediately, after the deadline, or when released. Review visibility: after submit, after the deadline, or never.

## Email

Optional (`SMTP_HOST`). Sent only by the worker, never inside a request. Messages: password reset, "new activity assigned", "marks released". Development and CI use Mailpit.

## Performance-relevant choices

- Hot student endpoints load only what they need (`raiseload` / `defer` on attempt listings and answer saves).
- The DB pool per process is configurable; keep total connections below Postgres `max_connections`.
- nginx re-resolves container names every 10 s, so a redeployed API is picked up without 502s.

## Environments

See [runbook.md](runbook.md). Development uses `compose.dev.yaml` (bind mounts, reload, Mailpit). Staging and production use `compose.prod.yaml` with pinned GHCR images on one server, separated by Compose project name, behind the shared TLS edge.
