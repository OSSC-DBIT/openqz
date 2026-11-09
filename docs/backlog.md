# Backlog (from the Implementation Plan v1.0)

Use these as GitHub issue titles on the project board. [x] = done in this repository.

## Phase 0: Kick-off and server setup (9 to 11 Nov)
- [x] GitHub org `OSSC-DBIT` and repo `openqz` (MIT, private for now); [ ] branch protection, project board
- [x] Repository skeleton, licence, contributor guide, issue and PR templates
- [x] Docker Compose stack (dev, staging, prod) and TLS edge config
- [ ] Install Ubuntu 24.04 + Docker on the CSE workstation; storage layout; fixed IP; sub-domain; TLS (see runbook)
- [ ] Identify pilot faculty (2) and sections (4)

## Phase 1: Requirements and design (12 to 16 Nov)
- [ ] Confirm feature list with 3 to 4 CSE faculty
- [x] CSV/XLSX import template (docs/import-template.md); [ ] confirm with the office using an anonymised sheet
- [ ] Figma: faculty dashboard, activity editor, assign drawer, student player, results
- [x] DB schema for Sprint 1, OpenAPI (auto at /api/docs), compose skeleton
- [ ] SRS sign-off (M1)

## Sprint 1: Foundation, users and import (17 to 23 Nov)
- [x] FastAPI app factory, Postgres + Redis containers, Alembic baseline
- [x] CI: lint, types, tests, e2e, image build to GHCR
- [x] JWT login/refresh/logout, Argon2, forced password change, lockout
- [x] React scaffold with role-based shells (admin, faculty, student); installable PWA
- [x] Sections and faculty-section-subject mapping
- [x] CSV/XLSX importer (ARQ) with validation, preview, column mapping, commit, row errors
- [x] Credential sheet PDF; admin password reset
- [ ] Office sample sheet imports on staging; all three roles log in on staging

## Sprint 2: Activity and question editor (24 to 30 Nov)
- [x] Activity CRUD (quiz, assignment, poll, flashcards), publish, duplicate, library grid
- [x] Question editor: MCQ, True/False, Fill-in-the-blanks, Multi-select, Justify-your-answer, Open-ended; reorder (up/down)
- [x] Editor: drag-and-drop reorder, student-view preview
- [x] Image upload endpoint; image slots on stem and options; marks, explanation, tags
- [x] Question timer presets (20 s to 10 min), custom seconds, "apply to all"; activity-level timer
- [ ] M2 editor demo on staging

## Sprint 3: Assignment and student player (1 to 7 Dec)
- [x] Assign drawer: sections and/or students, start/due, attempts, shuffle, show-answers policy, timer override
- [x] Student pending/completed views; server-timed attempts; one-question-per-screen player with countdown, auto-advance, autosave, resume, submit, auto-submit
- [x] Exam integrity in the player: tab/app switch, Back, reload and close detection, warning dialog, auto-submit after N violations (per-activity setting), events to `/integrity/events`
- [x] Mobile layout and accessibility pass on the player (keyboard, screen reader, axe checks)

## Sprint 4: Grading and analytics (8 to 14 Dec)
- [x] Auto-grading for objective types incl. partial credit and FIB alternatives
- [x] Manual grading queue with score and feedback; score release per policy
- [x] Rubric criteria for open answers
- [x] Results: summary tiles, question-wise table, per-student history, CSV export; student review screen
- [x] SMTP notifications (optional): password reset, assigned, scores released

## Added after the plan (user requests)
- [x] Rooms: host with a join code / link / QR, any signed-in student joins, stop joins, new code, live counts
- [x] Club organiser role (rooms only)
- [x] Activities for several semesters and sections at once
- [x] Wayground-style layout (Create button, type grid, question cards, assign-or-host drawer, join bar)

## Hardening (15 to 19 Dec)
- [x] Playwright golden journeys green (12 tests incl. axe, desktop and phone)
- [x] k6 load test written and run on a laptop (p95 95 ms at 100 users; see docs/performance.md)
- [ ] Confirm p95 < 300 ms at 300 users on the CSE server
- [x] OWASP ZAP baseline (0 failures), pip-audit / pnpm audit blocking, rate limits review
- [x] Backup + restore drill (scripts verified on 2026-11-08)
- [ ] Repeat the drill on the 10 TB pool of the CSE server
- [x] Audit log screen; user guides (student, faculty, admin)
- [x] UI redesign, first pass (Wayground-style layout)
- [x] Code-split the frontend bundle by route (staff screens load on demand; first visit 149 kB gzipped, see performance.md)
- [ ] M3 code freeze

## Pilot, release, rollout
- [ ] Pilot with 2 faculty x 2 sections; daily triage; feedback form
- [ ] Fix pilot defects; tag v1.0.0; deploy production (M4, 31 Dec)
- [ ] Import all departments; 45-minute training per department; support channel (M5, 16 Jan)
