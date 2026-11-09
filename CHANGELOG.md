# Changelog

All notable changes to OpenQZ. Format: [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Security
- Rate limits now apply per real client address. Before, the web proxy limited sign-ins for the whole site at once, and the per-address limit could be dodged with a fake `X-Forwarded-For` header.

### Changed
- Dev stack ignores the `.env` SMTP login when sending to Mailpit (a login made Mailpit refuse every message).
- Google sign-in turned on in development (`GOOGLE_CLIENT_ID` set; containers must be recreated after editing `.env`).
- **One attempt per student**: the Attempts setting and the student's *Try again* button are gone; the API refuses a second start (`already_taken`). Use Unblock to reopen an attempt that was auto-submitted by mistake.
- UI says **marks** everywhere (not points).
- Database pool size is configurable (`DB_POOL_SIZE`, `DB_MAX_OVERFLOW`, default 5 + 5) after load tests exhausted Postgres connections.
- nginx re-resolves the API container so redeploys do not cause 502 errors.
- Lighter queries on the student home page and answer saves.

### Added
- **Dev auto sign-in** (development only): set `DEV_AUTO_LOGIN_EMAIL` to an existing account and the browser signs in as that account on page load. Ignored unless `ENVIRONMENT=development`; blank keeps the normal sign-in page.
- `compose.mail.yaml` and `docs/email.md`: send real email from a local dev stack through the Cloudflare tunnel (`smtp-tunnel.webuildnow.in`), with setup, tests and troubleshooting. Mailpit stays the default.
- **Full screen required** (per assignment, on by default): the player hides the questions until the student is in full screen; leaving it is a warning. Skipped on iPhone, which has no full screen for web pages.
- **Branch** step in the class picker: teachers pick the branch, then semesters and sections they teach, and can mix branches in one activity. Library filter by branch.
- Reports say **marks obtained**: overview column, participants table, average and highest / lowest marks tiles, attempt view, CSV / Excel headers, the student summary and the "Marks released" email.
- `AGENTS.md`: product rules, commands and gotchas for AI coding agents and contributors.
- **Unblock**: teachers can reopen an attempt that was auto-submitted for too many warnings. Answers are kept, warnings reset, blocked time is given back (plus optional extra minutes); the waiting student gets a Continue button. Audited.
- **Rooms**: faculty and club organisers can **host a room** for any activity. Students join with a 6-digit code, link or QR code from the home page or `/join`, even outside their class. The host sees a big code banner, live joined / finished counts, can stop new joins or make a new code. Joins are rate-limited.
- **Club organiser** role: builds activities and hosts rooms only; no class lists. Admins create club accounts from Users.
- **Multiple classes per activity**: pick any number of sections across semesters (grouped by semester, select a whole semester at once). Library filters, reports and Assign use the full list.
- Wayground-style redesign, second pass: dark game player (timer bar, chunky colour tiles, green / red feedback bar, streak counter) and an end summary with an accuracy ring; full-screen editor with a top bar, summary panel, timer and marks editable on each question card, bulk update; question editor with the toolbar in the top bar and tall answer tiles; library with sections (All, Published, Drafts, Previously used, Archived), type filter, sort and list rows with Edit / Assign / Duplicate; student top bar with an Enter code box and account menu; report **Overview** grid (every student x every question); projector **lobby** for rooms.
- The library's Archived section now lists archived activities (the list API leaves them out unless asked).
- Answer taps are saved immediately (typing is still debounced), so an auto-submit right after a tap keeps the answer.
- Wayground-style UI: prominent **Create** button on every page, activity type grid with covers, editor with question cards and a full-screen question editor, **Assign or host** drawer, join bar on the student home, colourful activity cards.
- **Class context**: activities are created for sections the teacher teaches; department is locked to the teacher's own. Library filters by semester / section; Assign pre-selects the class.
- **Excel export** of results (Summary, Students, Marks by question, Questions) next to CSV.
- **Rubrics** for open-ended and justify questions; marking per criterion; students see marks per criterion.
- **Email** (optional SMTP): forgot / reset password with single-use links, emails when work is assigned and when scores are released. Mailpit in development.
- **Audit log** screen for admins.
- Editor: drag-and-drop reordering and **Preview as student**.
- Player accessibility: keyboard shortcuts (1 to 8, Enter), screen-reader labels and announcements, reduced-motion support; automated axe checks.
- User guides for students, faculty and admins, served at `/guides/*.html` and linked from the sign-in page.
- Load test (k6), OWASP ZAP baseline, blocking dependency audits, API spec and guides checked in CI.
- **Activities** (quiz, assignment, poll, flashcards) in a library; editor with question list, type / timer / marks per question, coloured answer tiles, images, explanations, tags, reorder, duplicate, "timer / marks for all". Question types: multiple choice, true/false, multi-select (partial credit), fill-in-the-blanks (alternatives, case option), justify-your-answer, open ended.
- **Assign** to sections and/or students: start, deadline, allow late, attempts 1/2/3/unlimited, shuffle questions / options, show answer after each question, review policy, score release (immediate / after deadline / manual), timer override, violation limit.
- **Player**: one question per screen, server-enforced activity and question timers (timed questions cannot be revisited), autosave, resume, instant feedback, flashcard mode, auto-submit on timer / deadline / violations; integrity checks for tab or app switch, focus loss, Back, reload and leaving fullscreen. A worker job auto-submits abandoned attempts.
- **Grading and reports**: auto-grading, manual grading queue with feedback, per-student attempt view, completion / accuracy / high-low tiles, per-question accuracy and poll distribution, CSV export, student review screen.
- Sign in with **email** (instead of USN) and **Continue with Google** for imported users (Gmail or college accounts). Email is required for every user and unique; the importer and credential slips use it.
- Docker Compose stack for development (hot reload), staging and production; shared TLS edge proxy with Let's Encrypt.
- Accounts with roles (admin, faculty, student), JWT access tokens with rotating refresh cookies, Argon2 hashing, forced password change, lockout after 5 failed logins, per-IP login rate limit. Usernames are case-insensitive.
- Departments, sections (per academic year), subjects and faculty-section-subject mapping.
- CSV/XLSX importer for students, faculty and mapping: tolerant column matching, manual column mapping, row-level errors, preview, background commit, printable credential slips (PDF) that can be deleted after printing.
- Admin UI: dashboard, users (create, reset password, unlock, disable), sections, subjects, faculty mapping, imports, integrity log. Faculty and student home pages.
- Installable PWA (manifest, icons, service worker for the app shell).
- Integrity events API for the upcoming quiz player.
- Nightly backup and restore scripts; GitHub Actions CI (lint, types, tests, e2e, images to GHCR).
