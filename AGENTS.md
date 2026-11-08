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
deploy/             nginx, TLS edge, backup scripts
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

# generated docs (CI fails if stale)
docker compose exec -T api python scripts/export_openapi.py > docs/api/openapi.json
cd frontend && pnpm guides
```

## Definition of done for a change

1. Backend: ruff, ruff format, mypy, pytest green; coverage stays at or above 85% (currently about 90%).
2. Frontend: eslint, tsc, vitest, build green.
3. Playwright suite green on **both** projects (desktop and mobile). New screens get an axe check in `e2e/a11y.spec.ts`.
4. Docs updated in the same change:
   - user-visible: the guide in `docs/guides/` and `pnpm guides`;
   - API: regenerate `docs/api/openapi.json`;
   - design / data model: `docs/architecture.md`;
   - tests added: `docs/testing.md` (counts and tables);
   - always: a line in `CHANGELOG.md` under *Unreleased*;
   - new rules or gotchas: this file.

## Conventions

- Python: async SQLAlchemy; never lazy-load relationships in async code (use `selectinload`, `joinedload`, `raiseload`). Business errors: `{"detail": {"code", "message"}}`. Marks are `Decimal` / `NUMERIC`.
- Migrations: hand-write when autogenerate cannot (enum values, data moves). Name constraints. Give NOT NULL columns a `server_default`. Test `upgrade`, `downgrade -1`, `upgrade`.
- TypeScript: strict, no `any`. Server state through TanStack Query. Use the `ui.tsx` components and Tailwind tokens (`bg-card`, `text-muted`, `border-line`, `brand-*`).
- Accessibility: every control has a visible label or `aria-label`; the accessible name must contain the visible text (axe `label-content-name-mismatch`); keep contrast AA (white text on tiles is bold 20px or larger).
- Tests make their own data with unique names (`seedClass()` in e2e); never depend on order or on the size of shared lists (search instead of scrolling paginated lists).

## Gotchas

- **New frontend dependency:** the Vite dev container keeps `node_modules` in a volume. After `pnpm add`, run `docker compose -f compose.yaml -f compose.dev.yaml build vite` and `up -d --force-recreate --renew-anon-volumes vite`, or the page goes blank (500 on the import).
- **`.env` changes** reach containers only when they are recreated: `up -d --force-recreate api worker`.
- **Dev email:** `compose.dev.yaml` sends all mail to Mailpit (http://localhost:8025) and blanks the SMTP login, whatever `.env` says. Real mail needs the Cloudflare tunnel plus `-f compose.mail.yaml` ([docs/email.md](docs/email.md)). Keep `SMTP_HOST=mail.webuildnow.in` (TLS certificate name), and use a `@webuildnow.in` sender: `dbit.co.in` SPF allows only Microsoft 365, so its mail is accepted and then dropped. Run Playwright in Mailpit mode only.
- **Client address:** only `X-Real-IP` (set by our edge) is trusted for rate limits; never read `X-Forwarded-For`.
- **Run Playwright from `frontend/`**, not the repo root (it writes `test-results/` where it runs).
- **Tests and `.env`:** tests that depend on optional settings (Google, SMTP) must set them explicitly with `monkeypatch`, not rely on the developer's `.env`.

## Commits

Commit or push only when the maintainer asks. Commits use the maintainer's own git identity (`git config user.name` / `user.email`). AI agents must not add their own name, email or `Co-Authored-By` lines to commits, and must not put personal emails in package metadata or docs (use "OSSC DBIT" there).
