# Changelog

All notable changes to OpenQZ. Format: [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added
- **Admin statistics** (`/admin/stats`, *Statistics* in the admin menu): totals for the college, a table per department (students, faculty, sections, class assignments, completion, average marks) and a table per teacher and club organiser (activities, class assignments, rooms, live games, completion, average marks, answers waiting for grading). Filter by day range and department; export as Excel (3 sheets) or CSV.
- **More details when adding a user by hand**: phone, designation (or club and position), a student's section, and **several departments for one faculty member** (the first is the main one). The pencil icon in **Users** edits all of them; the list can be filtered by department and searched by phone.
- **Instructions** (optional) when assigning or hosting a room: faculty and club organisers write a note that students read before they start (also in the join preview and the email).
- **Scheduled start**: an activity with a later start time shows on the student's home page as **not started** with its opening time, and opens by itself. Students get an email when it is assigned (with the opening time) and another when it opens.
- **Join code on the sign-in page**: type the 6-digit code or **scan the QR code** with the camera. A live game opens at once (guests need no account); a room code takes the student to the room after signing in.
- `robots.txt`, `sitemap.xml` and `/.well-known/security.txt` (RFC 9116), served by the web server with the site's own address.

### Security
- **Password reset is rate limited**: using a reset link (`/auth/reset`) had no limit; it and "forgot password" now allow 20 requests per client address per minute, in the API and in nginx. Reset emails to one address are limited to one a minute, 3 an hour and 6 a day (before: 3 per clock hour, so 6 could go out within minutes around the hour).
- **API reference closed on staging and production**: `/api/docs` and `/api/openapi.json` answer 404 there (still open in development).
- A teacher sees only the integrity events from attempts at **their own** activities; before, any faculty member could list every student's events.
- A student auto-submitted for too many warnings no longer sees marks, right / wrong or the answer key while the teacher can still unblock them (they could read the key, be let back in and fill it in).
- Stricter cross-origin rules: API answers carry `X-Frame-Options: DENY`, `Cross-Origin-Resource-Policy: same-origin` and `Content-Security-Policy: default-src 'none'`; the app sets `object-src 'none'`, `worker-src`, `manifest-src` and `media-src`, sends HSTS over https, and never serves dot files. On staging and production the API refuses to start with `CORS_ORIGINS=*`, an `http://` origin or `ALLOWED_HOSTS=*`.
- Camera permission is limited to the site itself (QR scan); microphone and location stay off.
- Rate limits now apply per real client address. Before, the web proxy limited sign-ins for the whole site at once, and the per-address limit could be dodged with a fake `X-Forwarded-For` header.

### Changed
- **Questions lock once a student has started**: adding, editing, deleting questions or "apply to all" answers 409 (`has_attempts`); duplicate the activity to change it. Before, later students got a different paper and the report mixed two versions.
- Sign-in limit per client address raised from 60 to 300 a minute (`LOGIN_RATE_PER_MINUTE`): a whole college behind one campus address signs in together before an exam. Password guessing is still stopped by the per-account lockout. Guests of a live game (counted per address) get 15 times the per-person limit.
- CI: GitHub Actions moved to their current major versions (Node 24), uv cache keyed on `backend/pyproject.toml`, runners pinned to `ubuntu-24.04`.
- Dev stack ignores the `.env` SMTP login when sending to Mailpit (a login made Mailpit refuse every message).
- Google sign-in turned on in development (`GOOGLE_CLIENT_ID` set; containers must be recreated after editing `.env`).
- **One attempt per student**: the Attempts setting and the student's *Try again* button are gone; the API refuses a second start (`already_taken`). Use Unblock to reopen an attempt that was auto-submitted by mistake.
- UI says **marks** everywhere (not points).
- Database pool size is configurable (`DB_POOL_SIZE`, `DB_MAX_OVERFLOW`, default 5 + 5) after load tests exhausted Postgres connections.
- nginx re-resolves the API container so redeploys do not cause 502 errors.
- Lighter queries on the student home page and answer saves.

### Fixed
- Changing the **deadline** or "allow late" now reaches attempts already in progress: an extended deadline gives those students the extra time, and a new deadline on an open-ended activity closes them.
- At the deadline every open player asked the server 4 times a second until the auto-submit; it now asks once, then every 3 seconds, spread over the class.
- The **question timer** did not move on by itself when time ran out; the student had to press Next.
- An answer tapped just before **Submit** could be graded as the previous answer; requests for one attempt now run one after the other and the player waits for the save.
- Two tabs starting the same activity at once gave one of them an error (500); the second now resumes the attempt.
- A student in the middle of an attempt could not **Resume** after the teacher unpublished the activity, while their timer kept running.
- Two signed-in students with the same name could not both join a live game (500).
- One failed request on a phone during a live game showed an error screen for good; it now keeps the game on screen and retries.
- Club organisers could not upload question images (403).
- Live games skip questions whose options are pictures without text (they were blank tiles).
- A refresh whose answer was lost on weak Wi-Fi (or two tabs refreshing together) signed the student out; the same refresh token is accepted again for 20 seconds after a normal rotation.
- First start of a new database: the health check now connects over TCP, so migrations no longer start while Postgres is still initialising ("connection refused" on a fresh server).
- Production: the media folder is mounted at `MEDIA_DIR`, so setting `MEDIA_DIR` to the host path no longer stops the API from starting.
- `restore.sh` put restored uploads one folder too deep (`media/media`); it now restores into the folder the app reads.
- A warning that reached the server just after a student pressed Submit (for example leaving full screen as the quiz closes) made the review page say "You left the quiz too many times" although the student submitted normally. The violations reply now carries `submit_reason`, and the player uses it.
- Dark mode: purple link and label text was too dark to read on dark backgrounds (failed WCAG AA contrast). A theme colour `brand-ink` now switches to a lighter purple in dark mode. The join page cards were fixed white with light text in dark mode; they follow the theme now.
- Screen-reader names for unlabelled controls: the users role filter, the question type, the faculty mapping pickers and the add-section and add-subject fields.
- Admin tables on phones: Users, Sections, Subjects, Faculty mapping, Imports, Integrity and Audit log (and the faculty Reports list) no longer scroll sideways. Less important columns hide on small screens and their details move under the main cell; user actions sit in a 2 x 2 grid. Icon buttons have screen-reader names.
- Quiz player on large screens: the question card stops at about half the screen height (a long question scrolls inside it) instead of stretching to fill the window, and question and answer text get bigger on very wide displays.
- Join-code boxes: the "123 456" hint is faded so it no longer looks like an entered code, and the home page code box keeps dark text in dark mode (it was nearly invisible on its white background).
- The web server now gzips the app files: the first visit downloads 149 kB instead of 488 kB, and the login page paints in 2.2 s instead of 3.3 s on slow 4G. API responses stay uncompressed (BREACH). The guide pages' Mermaid copy is cached for a week instead of re-downloaded each visit.
- Assigning an activity to sections now records them as the activity's classes (editor showed "No class chosen"; library class filters missed it). Migration 0010 back-fills existing activities.
- The password-reset browser test fails in CI instead of skipping when Mailpit is missing.
- Start and "Join and start" ask for full screen at the moment of the click. Before, the request came after the server replied, and on a slow server the browser refused it (students then had to press Enter full screen).
- An activity assigned "now" opens even if the server clock steps back a little (NTP, Docker Desktop): activities count as open up to 5 seconds before their start time.
- Backend tests no longer read SMTP and Google settings from the developer's `.env` (a real mail server made the suite take 14 minutes instead of 3, and broke two tests).
- A page that fails to load after an update now reloads itself once and otherwise shows a clear "OpenQZ was updated" screen, instead of the raw router error.
- The offline cache no longer keeps failed downloads (which could break a page in that browser for good).
- Audit log subtitle says "marks releases", not "score releases".
- Admin Sections page and report tabs no longer scroll sideways on phones (cards with wide tables now shrink to the screen; tab bars scroll).

### Added
- Public landing page at "/": space-themed hero with interactive feature overview, "How to Use" sequence, role cards linking to user guides, and assessment integrity highlights; signed-in users and standalone PWAs bypass it directly to their dashboard or login.
- CI: browser tests run on pull requests and by hand only; deploys after a merge run the backend and frontend checks (the pull request already passed the browser tests).
- Production data can live in host folders per environment (`DB_HOST_DIR`, `REDIS_HOST_DIR`, `MEDIA_HOST_DIR`); on the OSSC server everything is under `/srv/server-data/<env>/openqz/` (db, redis, media, backups). Backup and restore follow it.
- Continuous deployment to the OSSC server, the same way as PCMS and PageCraft: push `dev` deploys staging (`openqz-staging.webuildnow.in`, port 8092), push `main` deploys production (`openqz.webuildnow.in`, port 8093) through a self-hosted runner and the Cloudflare tunnel. `deploy/server/` (deploy with backup, migrations and health check; rollback; one-command environment setup with secrets, nightly backup cron and the `openqz` helper; runner install), `.github/workflows/deploy.yml`, guide `docs/deploy-ossc-server.md`. The health check reports the release (`version`); nginx takes the visitor address from Cloudflare's `CF-Connecting-IP`.
- Production with the mail server on the same machine (for example Postfix on port 587): `make prod-up LOCAL_MAIL=1` adds `compose.mail.yaml`, which points the mail server's name at the host; setup, firewall and a test command in `docs/email.md`.
- **Live games (Kahoot-style)** for faculty and clubs: the projector shows each question, phones show only the coloured answers, the host moves everyone on; automatic reveal with answer counts, leaderboard, podium, results page and CSV. Host-chosen scoring (marks + speed bonus, marks only, just for fun) and optional guests with a filtered nickname; the host can remove players and stop joins. Students can type a live code in the normal join box. Migration 0011, backend and three-browser e2e tests.
- Show/hide eye buttons on every password field (sign-in, change password and password reset). Fields start hidden.
- One narrated walkthrough video: `scripts/walkthrough_voice_online.py` (free Microsoft Edge neural voice) and `scripts/make_walkthrough_video.mjs` (title cards, phone frame, voice-over, generated background music, 1920x1080 MP4 with H.264 and AAC, WebM only where the browser engine cannot write MP4).
- `scripts/record_walkthrough.mjs`: screen-records the whole flow through the real UI with captions (admin imports, faculty builds and assigns, student takes it on a phone, marking and release, student review, a live join-code room, admin logs) into `recordings/` with a player page.
- Dark-mode accessibility checks (axe, WCAG 2.1 AA) for the student, faculty and admin screens.
- `scripts/web_vitals.mjs`: Lighthouse-style page-speed and installability check on a throttled phone, results in `docs/performance.md`. `prod_smoke.sh` gained `SKIP_E2E=1` to just start the production setup.
- New faculty home: create tiles for each activity type (open the create dialog at the title step via `?create=1&kind=`), numbers (classes, assigned, open now, submissions), recently assigned with deadline, join code and a submitted bar, and My classes. Axe and screen-size checked.
- `scripts/prod_smoke.sh` (`make prod-smoke`): runs the production setup locally (production images, gunicorn, limits) and the full browser suite against it. First run: all 31 browser tests passed, health OK, security headers present.
- Guide test (`e2e/guides.spec.ts`): guides open, diagrams draw under the CSP, no sideways scrolling.
- Release flow diagram in the runbook.
- Screen-size test (`e2e/responsive.spec.ts`): 17 screens must fit every width from 320 px phones to 2560 px monitors.
- Mermaid diagrams: architecture (components, data model, sign-in, attempt states and flow, rooms, email, environments), user flows in the three guides and the README. The in-app guide pages draw them with a same-origin copy of Mermaid (no CDN, CSP unchanged).
- `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1) and `SECURITY.md` (private reporting through GitHub, response times, scope), linked from the README and the contributor guide.
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
