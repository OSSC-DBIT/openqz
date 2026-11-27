# Changelog

All notable changes to OpenQZ. Format: [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Changed
- **Clubs count in points**: a club organiser's activities say **points** instead of marks everywhere (editor, reports, exports, the student's player, review and home, live screens). Each question's points come from a list up to 100, or **Custom...** for any value from 0 to 1000 (on each question and in **Timer / points for all**); teachers keep at most 100 marks. Migration `0017` switches what clubs made before.
- **Club live games count the points set per question**, with or without speed: "Points per question" (`P x C`) or "faster answers keep more" (`P x C x (1 - 0.5 x t / T)`). The share dialog and the results page explain the chosen formula with an example.
- **Names and team names**: joining a club's room or a club's live game with a code asks for a name or team name (it starts with your own name, must be free and friendly); the leaderboard, the players list and the exports show it.
- **Instructions and rules for rooms and live games**: hosts add or edit them from the room banner (**Add instructions**) and in the live game lobby; players read them on the join card, while they wait, and on the projector lobby. Live games get `instructions` (migration `0017`).
- **A club's room report is a leaderboard**: Overview and Participants list the students by points (most first) with their place (#), name or team, and the time taken from start to submit; equal points rank the quicker one higher. The CSV and Excel follow the same order. Teachers' reports stay in name order.
- **Live games: the answer shows 2 seconds after the last player answers** (it used to show at once), so the room sees that every answer is in. The server works out the moment (`reveal_at` in the host view).
- **The live game points formula is on screen**: the share dialog explains the ranking choice you pick, and the results page has **How the ranking works**, both with `points = 1000 x C x (1 - 0.5 x t / T)` and a worked example. The faculty guide explains it too.

### Fixed
- On phones the bottom tab bar covered the buttons of every dialog (Add user, delete confirmations, the room lobby): dialogs now render on top of the page through a portal.

### Changed
- **No inline styles anywhere: the CSP drops `'unsafe-inline'`** (`style-src 'self'`). Google's sign-in button moved into its own frame page (`/google-signin.html`, the only page allowed inline styles; it passes the credential to the sign-in page by `postMessage`, same origin only); the guides' flow diagrams are drawn beforehand as light and dark SVG pictures (`pnpm guides:diagrams`) and their styles are a file. A new e2e check tours the app on a production build and fails on any CSP violation.
- **OWASP ZAP baseline re-run** on the production build (2026-11-22): 0 failures, 65 rules passed, 3 accepted warnings, the CSP `unsafe-inline` warning fixed (`docs/reports/zap-baseline-2026-11-22.html`); pip-audit and pnpm audit clean.
- **Privacy Policy** page (`/privacy`, contact osscdbit@gmail.com), linked from sign-in, the landing footer and the live-game join screen. Signing in (email or Google) needs the **I agree** tick; the date and policy version are saved on the account (migration `0016`) and in the audit log, shown to admins in the user dialog, and a new policy version asks everyone again.
- **Security hardening**: emails, phone numbers and uploaded people sheets are **encrypted in the database** (AES-256-GCM, `DATA_KEY`; migration `0015` encrypts existing rows; search by email or phone now needs the whole value); nginx **limits every API call** per user, per guest and per address, with slow-request timeouts; **Swagger and openapi.json are closed** unless `API_DOCS=true` in development; failed sign-ins are logged with a masked email. New checks: an **IDOR matrix** over all 66 id routes (`test_idor.py`), encryption tests, an **e2e security suite** (`e2e/security.spec.ts`) and `scripts/security/rate_limit_check.py`.
- **Images load much faster on the hard-disk server**: uploads are shrunk to WebP (at most 1600 px; a 3 to 5 MB phone photo becomes a few hundred KB), turned upright and stripped of hidden photo data such as GPS; nginx sends image files after the API checks the request (`X-Accel-Redirect`, the OS keeps popular images in memory); browsers keep each image for a year; the app no longer downloads an image again after every save. Upload limit 10 MB. `python -m app.cli optimize-media` shrinks images stored before.
- **Hosts manage players**: in a room, **Players** lists who joined (not started, answering, finished) with **Remove** (the code no longer lets them in; an attempt in progress is submitted) and **Let back in**. In a live game, **Players** works during the game too, not only in the lobby, and can stop or allow new joins. Migration `0014` adds `room_removals` and the submit reason `removed`.
- **Narrated demo video** of the whole flow (`scripts/demo/`): super admin setup, a teacher on a laptop, a student on a phone, marking and releasing, a club's live game on the big screen with phones, and a self-paced room. Recorded on the real app, with step cards, captions before every action, an Indian English neural voice and music under it (about 10 minutes).
- **Installable app done properly**: an **Install OpenQZ** card (one tap on Android and desktop Chrome or Edge, the Share steps on iPhone; never during a quiz, a live game or in the editor; "Not now" hides it for two weeks), new pink app icons (normal and maskable) drawn by `frontend/scripts/make-icons.mjs`, a plum splash screen, home-screen shortcuts, screenshots for the browser's install dialog, and no portrait lock (the live host screen works on landscape tablets and projectors). The installed app opens on `/login`.
- The landing video's **sound button** hides while nothing happens and comes back on touch, mouse movement or scroll, like a video player's controls; it is smaller on phones.
- **New look, themed after Wayground**: deep plum, cream and hot pink, the DM Sans typeface (served from the site), flat cards with small corners. The staff rail and the student top bar are plum; pages are cream. The coloured answer tiles in the question editor and the quiz player are unchanged. Dark mode follows the device as before. Components are built on shadcn/ui (`frontend/src/components/shadcn`).
- **New landing page** in the Wayground layout: plum hero with the headline and a **intro video** that plays by itself (99 seconds of motion graphics at 120 BPM covering every part of OpenQZ, set to "Gaslight" by Dante Ross (CC0); made as a single HTML film in `video/film/` and rendered at 60 fps; it starts silent and a button turns the sound on), a **join box** right under it ("Have a code?" jumps there with the cursor in the box), the numbers, how it works, fair-exam rules, guides and the **contributors**. The footer carries the DBIT Bangalore and OSSC logos.
- **Loading screens are skeletons** in the shape of the content instead of a spinner.
- **Phones and tablets get a tab bar** at the bottom of the staff screens (Home, Library, Reports, More); wide screens keep the left rail. Screens fit from 240 px wide (a watch browser, split view) to 2560 px.
- Dates read as "23 Nov, 10:58 am" instead of a full timestamp with seconds (the audit and integrity logs keep the exact time). The teacher greeting uses the first name, not the title ("Hello, Meera", not "Hello, Dr.").
- Questions the browser used to ask in its own grey box (end a live game, remove a player, new room code, reset a password) now use OpenQZ dialogs.
- Live game setup says **How players are ranked** instead of "Scoring".
- **Browser tests no longer run on pull requests in GitHub Actions**; they are run locally before a pull request and can be started by hand (Actions, CI, Run workflow).

### Fixed
- **Buttons could be pressed twice while saving** (Assign, Host room, Create, import commit, Release marks, Delete for good): a second click made a second assignment or room.
- **Shared computers**: after one person signed out, the next person on the same tab could see the previous person's activities and marks for up to 30 seconds. Cached data is now emptied whenever the signed-in user changes.
- **Deleting an activity that was played as a live game deleted the game results.** It is now archived, like an activity with student attempts.
- **Fill in the blanks**: accepted answers with a space ("New York") could not be typed, only pasted.
- **Results downloads failed for titles in Kannada, Hindi or other non-Latin scripts** (CSV and Excel).
- **Two teachers marking the same attempt at once** could store a wrong total; marking, unblocking, opening a question and the deadline sweep now all wait their turn on the attempt.
- A student is no longer signed out in the middle of a quiz when the server is restarting or busy for a moment.
- A user typed in by hand in lower case (`1db23cs001`) no longer makes an import of the same USN fail.
- The room lobby on the projector no longer drops out of full screen each time a student joins.
- Changing a question's timer and then its marks straight away no longer undoes the timer.
- The student home page and the live games list read their data in one query each instead of one per row.
- The report says "1 warning", not "1 violations".
- Lists refresh after every save (a newly assigned activity shows on the home page at once, a started one leaves "pending").
- Adding a student to a section moves them out of their other section of the same year instead of leaving them in two.
- Requests with a time without a zone, an unknown subject or section, or an answer in the wrong shape are refused with a message instead of an error page.
- Marking messages say **marks**, not "score". The answer preview and the blank boxes are readable in dark mode. Several fields and icon buttons gained names for screen readers, and every dialog closes with Escape.
- **Users and Statistics tables on Linux**: with wider system fonts the Users table was a few pixels too wide for its box, and wide tables could not be reached with the keyboard to scroll them.

### Added
- **Contributors on the landing page**: names and pictures from the GitHub repository (`GITHUB_REPO`), fetched by the worker twice a day and kept in the database (pictures included, so visitors never contact GitHub). Bots and AI assistants are left out. An empty or old list refills itself on the next visit.
- **Super admin and admin**: every admin so far becomes a **super admin**. A plain admin runs the day-to-day (people, classes, imports, statistics, library and reports) but cannot create or change admin accounts, read the audit log or delete anything for good. A super admin promotes or demotes admins from **Users**.
- **Participants** (staff menu): everyone who attempted your activities across all of them, with attempts, marks obtained, warnings and last activity; pick a person to see each attempt and jump to its report. Teachers and club organisers see their own activities, admins see all.
- **Club organisers get the integrity log** of their own rooms and games.
- **Import questions** (activity editor, **Import**): from a **Google Form** link (the form must be open to anyone with the link), a **spreadsheet** (.csv or .xlsx, one question per row, sample sheet to download) or **pasted text**. A review screen shows every question with its coloured tiles; tap the correct answers (Google never shares a form's answer key), untick what you do not want, then add them all at once. No AI is involved.
- **Admin deletes departments, sections and subjects** (bin icon on *Sections* and *Subjects*). Before deleting, OpenQZ shows what goes with it. A department goes only when it has no sections and no people; a section is refused while work assigned to it has student attempts; a subject takes its teacher mappings with it. Every delete is in the audit log.
- **Every delete asks twice**: what will go, then "Are you sure?" with the buttons the other way round. This covers departments, sections, subjects, faculty mappings, the credential PDF, activities and questions. (Deletes for good already ask for the name and the admin's password.)
- **Admin statistics** (`/admin/stats`, *Statistics* in the admin menu): totals for the college, a table per department (students, faculty, sections, class assignments, completion, average marks) and a table per teacher and club organiser (activities, class assignments, rooms, live games, completion, average marks, answers waiting for grading). Filter by day range and department; export as Excel (3 sheets) or CSV.
- **More details when adding a user by hand**: phone, designation (or club and position), a student's section, and **several departments for one faculty member** (the first is the main one). The pencil icon in **Users** edits all of them; the list can be filtered by department and searched by phone.
- **Instructions** (optional) when assigning or hosting a room: faculty and club organisers write a note that students read before they start (also in the join preview and the email).
- **Scheduled start**: an activity with a later start time shows on the student's home page as **not started** with its opening time, and opens by itself. Students get an email when it is assigned (with the opening time) and another when it opens.
- **Join code on the sign-in page**: type the 6-digit code or **scan the QR code** with the camera. A live game opens at once (guests need no account); a room code takes the student to the room after signing in.
- **Admin: delete for good.** A person (**Users**, bin icon: first shows what goes with them), an activity with all its results (activity editor, *Delete for good*), or the results of one assignment (report, *Delete results*). Each needs the name typed out and the admin's own password again; 5 wrong passwords lock deleting for 10 minutes; every delete and every refused try is in the audit log. An admin cannot delete their own account or the last admin.
- **Supported browsers**: the sign-in page opens only in Chrome, Safari and Microsoft Edge (computer, Android, iPhone). Other browsers and in-app browsers see a note asking them to switch, with the address to copy. The report's Questions tab shows the correct answer of each question (ticked option, or the accepted words of a blank), also before anyone has answered. In the question editor the correct-answer tick is now a labelled "Correct" button on each option. Android browsers that send Chrome's user agent unchanged (Eruda, Kiwi, web views) are told apart by the browser's brand list.
- `robots.txt`, `sitemap.xml` and `/.well-known/security.txt` (RFC 9116), served by the web server with the site's own address.

### Security
- **One attempt, one screen**: when the same attempt is worked on from a second tab or device within two minutes, the server counts a warning (*second_device* in the integrity log), at most one a minute. Changing device after a longer pause (a dead battery) is not flagged.
- A teacher can assign work directly only to students of the sections mapped to them (other students still join with a room code).
- Results downloads (CSV and Excel, also for live games) can no longer carry a spreadsheet formula in a name, title or answer.
- Integrity events can name only the sender's own attempts.
- The Google Form import fetches only `https://docs.google.com/forms/...` and `https://forms.gle/...`, follows redirects only between those two, reads at most 3 MB and is limited to 12 a minute per person.
- **Password reset is rate limited**: using a reset link (`/auth/reset`) had no limit; it and "forgot password" now allow 20 requests per client address per minute, in the API and in nginx. Reset emails to one address are limited to one a minute, 3 an hour and 6 a day (before: 3 per clock hour, so 6 could go out within minutes around the hour).
- **API reference closed on staging and production**: `/api/docs` and `/api/openapi.json` answer 404 there (still open in development).
- A teacher sees only the integrity events from attempts at **their own** activities; before, any faculty member could list every student's events.
- A student auto-submitted for too many warnings no longer sees marks, right / wrong or the answer key while the teacher can still unblock them (they could read the key, be let back in and fill it in).
- Stricter cross-origin rules: API answers carry `X-Frame-Options: DENY`, `Cross-Origin-Resource-Policy: same-origin` and `Content-Security-Policy: default-src 'none'`; the app sets `object-src 'none'`, `worker-src`, `manifest-src` and `media-src`, sends HSTS over https, and never serves dot files. On staging and production the API refuses to start with `CORS_ORIGINS=*`, an `http://` origin or `ALLOWED_HOSTS=*`.
- Camera permission is limited to the site itself (QR scan); microphone and location stay off.
- Rate limits now apply per real client address. Before, the web proxy limited sign-ins for the whole site at once, and the per-address limit could be dodged with a fake `X-Forwarded-For` header.

### Changed
- **Question timer**: the separate "Custom s" box is gone. The timer list has a **Custom...** choice that opens a clock (minutes : seconds, 5 seconds to 60 minutes), also in the question list and in "Timer / marks for all".
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
- Quiz player in dark mode: text typed into the answer box (open-ended, justify, fill in the blank) and the flashcard text were white on white. Those boxes now keep dark text, show a border when focused, and the answer box can be resized.
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
