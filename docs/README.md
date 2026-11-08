# OpenQZ documentation

Every feature lands with its docs (see [CONTRIBUTING](../CONTRIBUTING.md#definition-of-done)). Start here.

## For people using OpenQZ

| Guide | Audience | Also served at |
| --- | --- | --- |
| [Student guide](guides/student.md) | Students | `/guides/student.html` (linked on the sign-in page) |
| [Faculty guide](guides/faculty.md) | Faculty | `/guides/faculty.html` |
| [Admin guide](guides/admin.md) | OpenQZ admins (office / HoD) | `/guides/admin.html` |
| [Import sheet formats](import-template.md) | Admins, the college office | |

## For people running OpenQZ

| Document | Covers |
| --- | --- |
| [Runbook](runbook.md) | Server setup, environments, TLS, Google sign-in, email, deploy, rollback, backups, monitoring, go-live checklist |
| [Email](email.md) | Local email: Mailpit (default) or the real server through the Cloudflare tunnel; sender domain and SPF; troubleshooting |
| [Security](security.md) | Threat model, controls, latest scan results, how to report a problem |
| [Performance](performance.md) | Load-test method, measured capacity, sizing for the CSE server |

## For people building OpenQZ

| Document | Covers |
| --- | --- |
| [Architecture](architecture.md) | Components, data model, auth, attempts and timers, grading, email, jobs |
| [API reference](api/README.md) | OpenAPI spec (`api/openapi.json`, checked in CI) and live docs at `/api/docs` |
| [Testing](testing.md) | Test layers, how to run each, what CI enforces |
| [Backlog](backlog.md) | Every item from the Implementation Plan and its status |
| [Changelog](../CHANGELOG.md) | What changed, release by release |
| [Contributing](../CONTRIBUTING.md) | Workflow, Definition of Done, code style |
| [AGENTS.md](../AGENTS.md) | Product rules (marks, one attempt, classes, full screen), commands and gotchas for AI coding agents and new contributors |

## Keeping docs current

- Changed an endpoint? Regenerate `docs/api/openapi.json` (CI fails otherwise):
  `docker compose -f compose.yaml -f compose.dev.yaml run --rm --no-deps -T migrate python scripts/export_openapi.py > docs/api/openapi.json`
- Changed a guide in `docs/guides/`? Rebuild the served pages: `cd frontend && pnpm guides` (CI fails otherwise).
- User-visible change? Add a line to `CHANGELOG.md` under *Unreleased*.
- New product rule or a trap you fell into? Add it to `AGENTS.md`.
