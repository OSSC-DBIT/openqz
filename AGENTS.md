# AGENTS.md

Instructions for AI coding agents (and new contributors) working on OpenQZ. Read this before changing code. Humans: [CONTRIBUTING.md](CONTRIBUTING.md) has the workflow; this file has the rules and the commands.

## What OpenQZ is

A quiz and assignment platform for Don Bosco Institute of Technology (OSSC). Product direction: follow **Wayground's** pages, flows and settings (formerly Quizizz), with OpenQZ's own branding and **no AI features**. It is a **PWA only** (no native app).

Roles: `admin`, `faculty`, `student`, `club` (club organisers host rooms only).

## Product rules (do not break these)

| Rule | Detail |
| --- | --- |
| Marks, not points | Every user-facing text says **marks** / **marks obtained**. Never "points" or "score" in the UI, emails, exports or docs. (`score` is fine as an internal field name.) |
| One attempt per student | No retakes and no "Try again". `start` refuses a second attempt (`already_taken`). A teacher reopens a violations auto-submit with **Unblock**. `max_attempts` exists only for the load-test seed. |
| Live games | Host-paced: the host screen shows the question, phones only the options (`/live`, `/live/play/:id`, `/live/host/:id`). Never send the question text or the key to phones before the reveal. Host chooses scoring (`marks_speed`, `marks`, `fun`) and `allow_guests`; guests use the `X-Live-Player` token, never an account. |
| Classes | Teachers pick **Branch, then semesters and sections**, only from sections mapped to them (`faculty_assignments`). Picks may span branches. Clubs pick no classes. |
| Full screen | Assignments have `require_fullscreen` (default on). The player hides questions until full screen, except where the browser has no full screen (iPhone). Leaving full screen is a warning. |
| Integrity | Tab or app switch, Back, reload and full-screen exit are counted on the server; auto-submit at the assignment's limit. Browsers cannot block screenshots; do not add watermark or "screenshot blocking" code (decided against). |
| Sign-in | Email + password, and Google for imported users only (`GOOGLE_CLIENT_ID`). |
| Answer keys | Never send keys or rubrics to students before review rules allow it (`grading.strip_key`). |
| Writing style | No en dash or em dash characters anywhere (code, UI, docs). Use a hyphen, "to", a comma or "|". Keep emojis out. |

## Repository map

```
backend/            FastAPI app (Python 3.12)
  app/api/v1/       routers: auth, users(+audit), org, imports, activities, results, play, media, integrity, health
  app/services/     business logic (attempt_service, grading, auth_service, import_*, email, assignment_view)
  app/models/       SQLAlchemy 2 models
  app/worker/       ARQ jobs (imports, emails, sweep_attempts cron)
  alembic/versions/ migrations 0001..NNNN (revision ids are the number: "0009")
  tests/            pytest (one test DB, truncated after each test)
frontend/           React 19 + TypeScript + Vite + Tailwind 4 + TanStack Query + React Router 7
  src/pages/        admin/, faculty/, student/ screens
  src/student/      PlayerPage (quiz player), JoinPage, ReviewPage, useIntegrity
  src/layouts/      AppShell (staff sidebar), StudentShell (student top bar)
  src/components/   ui.tsx (Button, Modal, ...), pieces.tsx (ClassPicker, KindCover, TypePicker), quiz.tsx
  e2e/              Playwright specs + helpers.ts (seedClass, login)
docs/               guides/, api/openapi.json, architecture, runbook, security, testing, performance, backlog
deploy/             nginx, TLS edge, backup scripts; server/ = OSSC server deploy (deploy.sh, setup-environment.sh, install-runner.sh, rollback.sh)
```

Staff screens are lazy-loaded routes in `src/main.tsx`; the activity editor is a full-screen route outside the sidebar shell.

## Commands

The dev stack runs in Docker. `HTTP_PORT` in `.env` decides the port (8088 on the reference machine).

```bash
# start / stop
docker compose -f compose.yaml -f compose.dev.yaml up -d --build
docker compose -f compose.yaml -f compose.dev.yaml down

# backend checks (all must pass)
docker compose -f compose.yaml -f compose.dev.yaml run --rm --no-deps -T migrate sh -c \
  "ruff check . && ruff format --check . && mypy app && pytest -q --cov=app"

# migrations
docker compose -f compose.yaml -f compose.dev.yaml run --rm --no-deps -T migrate alembic upgrade head

# frontend checks (from frontend/)
pnpm lint && pnpm typecheck && pnpm test && pnpm build

# browser tests (from frontend/, stack running and seeded with scripts/seed_demo.sh)
npx playwright test                      # desktop + mobile
E2E_SHOTS_DIR=/some/dir npx playwright test e2e/quiz-loop.spec.ts   # with screenshots

# production setup on this machine + full browser suite (stop the dev stack first)
bash scripts/prod_smoke.sh            # or: make prod-smoke; KEEP=1 to leave it running

# screen recordings of the whole flow (stack running, admin seeded): recordings/<date-time>/index.html
node scripts/record_walkthrough.mjs
python scripts/walkthrough_voice_online.py recordings/<date-time>   # needs: pip install edge-tts
node scripts/make_walkthrough_video.mjs recordings/<date-time>      # one narrated video

# generated docs (CI fails if stale)
docker compose exec -T api python scripts/export_openapi.py > docs/api/openapi.json
cd frontend && pnpm guides
```

## Definition of done for a change

1. Backend: ruff, ruff format, mypy, pytest green; coverage stays at or above 85% (currently about 90%).
2. Frontend: eslint, tsc, vitest, build green.
3. Playwright suite green on **both** projects (desktop and mobile). New screens get an axe check in `e2e/a11y.spec.ts` and a line in `e2e/responsive.spec.ts` (must fit 320 to 2560 px wide).
4. Docs updated in the same change:
   - user-visible: the guide in `docs/guides/` and `pnpm guides`;
   - API: regenerate `docs/api/openapi.json`;
   - design / data model: `docs/architecture.md`;
   - tests added: `docs/testing.md` (counts and tables);
   - always: a line in `CHANGELOG.md` under *Unreleased*;
   - new rules or gotchas: this file;
   - flows changed: the Mermaid diagrams in `docs/architecture.md`, the guides and README (check they render: GitHub preview, or `/guides/*.html` after `pnpm guides`).

## Conventions

- Python: async SQLAlchemy; never lazy-load relationships in async code (use `selectinload`, `joinedload`, `raiseload`). Business errors: `{"detail": {"code", "message"}}`. Marks are `Decimal` / `NUMERIC`.
- Migrations: hand-write when autogenerate cannot (enum values, data moves). Name constraints. Give NOT NULL columns a `server_default`. Test `upgrade`, `downgrade -1`, `upgrade`.
- TypeScript: strict, no `any`. Server state through TanStack Query. Use the `ui.tsx` components and Tailwind tokens (`bg-card`, `text-muted`, `border-line`, `brand-*`).
- Accessibility: every control has a visible label or `aria-label`; the accessible name must contain the visible text (axe `label-content-name-mismatch`); keep contrast AA (white text on tiles is bold 20px or larger).
- Tests make their own data with unique names (`seedClass()` in e2e); never depend on order or on the size of shared lists (search instead of scrolling paginated lists).

## Gotchas

- **New frontend dependency:** the Vite dev container keeps `node_modules` in a volume. After `pnpm add`, run `docker compose -f compose.yaml -f compose.dev.yaml build vite` and `up -d --force-recreate --renew-anon-volumes vite`, or the page goes blank (500 on the import).
- **Full screen needs a fresh click.** Call `enterFullscreen()` (`src/student/fullscreen.ts`) synchronously in the click handler, before any `await` or API call; browsers refuse it a few seconds after the click.
- **No Prettier.** The code uses long lines (ESLint only). Running Prettier with defaults rewrites whole files; do not.
- **Backend tests start with SMTP and Google off** (`tests/conftest.py` blanks them). Turn them on per test with `monkeypatch`.
- **E2E tests that are not about full screen** assign with `require_fullscreen: false`, so the gate cannot get in the way.
- **Measure speed on the production build**, never the dev server (unbundled, about 4 MB): `KEEP=1 SKIP_E2E=1 scripts/prod_smoke.sh`, then `node scripts/web_vitals.mjs`.
- **Brand-coloured text uses `text-brand-ink`**, never `text-brand-600`: `brand-600` is too dark on dark backgrounds (the dark-mode axe test fails). `bg-brand-600` with white text is fine.
- **Fixed-colour surfaces need fixed text colours.** The quiz player is always dark and some boxes are always white; theme tokens like `text-ink` flip in dark mode and vanish there. Use explicit colours on those surfaces.
- **Do not leave test data on the demo accounts.** Scripts that create activities for `faculty@` / `student@openqz.dev` must delete them afterwards; e2e tests use `seedClass()` instead.
- **Never gzip `/api`** in nginx (tokens in responses; BREACH). Static files only.
- **GitHub Actions tags:** most actions publish a major tag (`actions/checkout@v7`), but `astral-sh/setup-uv` only has exact tags: pin it like `@v10.3.3`. Check with `gh api repos/<owner>/<action>/git/ref/tags/<tag>` before bumping.
- **pnpm skips `pre*` / `post*` scripts.** Put setup steps inside the script itself (`dev` and `build` run `scripts/copy-mermaid.mjs` first).
- **Layout:** a `Card` (or any grid or flex child) holding a wide table needs `min-w-0`, or the whole page grows sideways on phones. `Card` has it built in; wide tables scroll inside `Table`.
- **Tables on phones:** list tables use `<Table cols={[...]} compact>` with `hidden sm:table-cell` (and the same class on the `<Td>`) to drop secondary columns, and repeat that detail under the main cell with `sm:hidden`. `e2e/responsive.spec.ts` (`tablesFit`) fails if such a table scrolls. Only true data grids (import preview, report participants) may scroll inside their box.
- **`.env` changes** reach containers only when they are recreated: `up -d --force-recreate api worker`.
- **Dev email:** `compose.dev.yaml` sends all mail to Mailpit (http://localhost:8025) and blanks the SMTP login, whatever `.env` says. Real mail needs the Cloudflare tunnel plus `-f compose.mail.yaml` ([docs/email.md](docs/email.md)). Keep `SMTP_HOST=mail.webuildnow.in` (TLS certificate name), and use a `@webuildnow.in` sender: `dbit.co.in` SPF allows only Microsoft 365, so its mail is accepted and then dropped. Run Playwright in Mailpit mode only.
- **Mail server on the production machine:** start with `make prod-up LOCAL_MAIL=1` (adds `compose.mail.yaml`, `SMTP_PORT=587`); without it containers use the public IP, which often times out (no hairpin NAT). [docs/email.md](docs/email.md) section 3.
- **Client address:** the web nginx (`frontend/nginx.conf`) takes it from `CF-Connecting-IP` (Cloudflare tunnel), else `X-Real-IP` (our edge, which clears `CF-Connecting-IP`), and passes it to the API as `X-Real-IP`; the API trusts only that. Never read `X-Forwarded-For`.
- **Data on the server** lives in `/srv/server-data/<env>/openqz/` (`db/` = `DB_HOST_DIR`, `redis/` = `REDIS_HOST_DIR`, `media/` = `MEDIA_HOST_DIR` owner uid 1000), not Docker volumes; `backup.sh` / `restore.sh` find the right place from the api container's mount.
- **Deploys (OSSC server):** push `dev` = staging (`127.0.0.1:8092`), `main` = production (`127.0.0.1:8093`), through `.github/workflows/deploy.yml` and the self-hosted runner (label `openqz`). Never deploy by hand. `/api/v1/health` must report `version` (= `APP_VERSION`): the deploy checks it. Guide: [docs/deploy-ossc-server.md](docs/deploy-ossc-server.md).
- **Run Playwright from `frontend/`**, not the repo root (it writes `test-results/` where it runs).

## Commits

Commit or push only when the maintainer asks. Commits use the maintainer's own git identity (`git config user.name` / `user.email`). AI agents must not add their own name, email or `Co-Authored-By` lines to commits, and must not put personal emails in package metadata or docs (use "OSSC DBIT" there).
