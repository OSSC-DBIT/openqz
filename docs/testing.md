# Testing

OpenQZ is tested at five layers. CI runs all of them on every pull request; a red check blocks the merge.

| Layer | Tool | Where | Count (2026-11-08) |
| --- | --- | --- | --- |
| Backend unit + API | pytest, httpx | `backend/tests/` | 83 tests, 90% line coverage (CI gate: 85%) |
| Frontend unit | Vitest, Testing Library, happy-dom | `frontend/src/test/` | 11 tests |
| Browser journeys | Playwright (desktop Chrome + Pixel 7) | `frontend/e2e/` | 14 tests (9 journeys + 5 axe checks) x 2 devices = 28 runs |
| Accessibility | axe-core in Playwright (WCAG 2.1 AA) | `frontend/e2e/a11y.spec.ts` | login, student home, join page, create dialog with class picker, faculty library |
| Load | k6 | `tests/load/student-exam.js` | see [performance.md](performance.md) |
| Security | OWASP ZAP baseline, pip-audit, pnpm audit | CI + `docs/reports/` | see [security.md](security.md) |

## Running them

```bash
# backend (uses the openqz_test database in the dev stack)
docker compose -f compose.yaml -f compose.dev.yaml run --rm --no-deps migrate pytest --cov=app
docker compose -f compose.yaml -f compose.dev.yaml run --rm --no-deps migrate sh -c "ruff check . && ruff format --check . && mypy app"

# frontend
cd frontend && pnpm lint && pnpm typecheck && pnpm test

# browser journeys: the dev stack must be running and seeded
bash scripts/seed_demo.sh http://localhost:8088
cd frontend && pnpm exec playwright install chromium && pnpm test:e2e
```

Browser journeys read `E2E_BASE_URL` (default `http://localhost:8088`), `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD`, and the test accounts created by the seed script (`faculty@openqz.dev`, `student@openqz.dev`). The password-reset journey reads real emails from Mailpit (`E2E_MAILPIT_URL`, default `http://localhost:8025`) and skips itself when Mailpit is not running.

## What the tests cover

**Backend** (`backend/tests/`)

| File | Covers |
| --- | --- |
| `test_auth.py` | email login (case-insensitive), lockout, refresh rotation and reuse detection, logout, forced password change, RBAC, dev auto sign-in (on in development, off in production) |
| `test_google.py` | Google ID token checks: signature, audience, issuer, expiry, verified email, domain allow-list, unknown email, account linking, temp password cancelled |
| `test_admin.py` | users, password reset, deactivate, departments / sections / subjects / faculty mapping |
| `test_imports.py` | header aliases, row errors (missing, invalid, duplicate USN or email, email owned by someone else), XLSX, manual column mapping, idempotent re-import, credential PDF |
| `test_grading.py` | every question type, partial credit, blank alternatives, case sensitivity, key never leaks |
| `test_activities.py` | editor validation, reorder, apply-to-all, duplicate, permissions, full teach / attempt / grade / review loop, release modes, activity timer, sweeper, question timers and linear mode, violations auto-submit, windows / late / unlimited attempts, shuffle, polls, flashcards, image sniffing |
| `test_extras.py` | rubrics, forgot / reset password, throttling, email notifications, audit log, class context (department locked, sections taught only), Excel export contents |
| `test_integrity.py` | integrity event ingest and listing |
| `test_unblock.py` | unblock reopens only submit-closed answers, gives blocked time back, resets warnings, audit entry, report flags; refused for manual submits, newer attempts, students and other teachers |
| `test_rooms.py` | hosting a room, preview and join by code, wrong / closed / rotated codes, start window, join rate limit (429), club rules (rooms only, no classes), admin creates club accounts |

**Browser** (`frontend/e2e/`)

| Spec | Journey |
| --- | --- |
| `journeys.spec.ts` | admin dashboard / users / imports; student first sign-in with forced password change; wrong password message |
| `quiz-loop.spec.ts` | teacher creates from the type grid and picks a class, builds MCQ + True/False + open question with rubric, assigns (class pre-selected); student on a phone gets a tab-switch warning, answers with tap and keyboard, sees instant feedback, submits; teacher grades by rubric, downloads Excel; student sees marks per criterion |
| `rooms.spec.ts` | faculty hosts a room (code, QR); a student from another class tries a wrong code, joins and finishes on a phone; live joined / finished count; stop new joins turns a late student away; a club organiser creates (no class picker) and hosts a room |
| `fullscreen.spec.ts` | leaving full screen gives a warning and hides the questions until the student presses Enter full screen |
| `unblock.spec.ts` | student hits the warning limit, teacher unblocks with extra minutes from the report, the waiting student continues |
| `password-reset.spec.ts` | forgot password email via Mailpit, reset, sign in, link is single use |
| `a11y.spec.ts` | no serious or critical WCAG 2.1 AA violations |

## Conventions

- Browser specs build their own class, faculty and student with `seedClass()` from `e2e/helpers.ts`.
- Tests create their own data with unique names; never depend on order between test files.
- Backend tests truncate every table after each test.
- Every bug fix comes with a test that fails without the fix.
