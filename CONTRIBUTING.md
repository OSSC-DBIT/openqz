# Contributing to OpenQZ

Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md). Report security problems privately as described in [SECURITY.md](SECURITY.md), never in a public issue.

## Workflow

1. Pick an issue from the project board (Backlog -> Ready -> In progress -> Review -> Done) and assign yourself.
2. Branch from `main`: `feat/<issue>-short-name`, `fix/<issue>-short-name`.
3. Keep PRs small (one story). Link the issue with `Closes #123`.
4. CI must be green. A maintainer **other than the author** reviews and merges.

## Definition of Done

- Code reviewed and merged by someone other than the author.
- Unit/API tests added and passing; coverage not reduced (backend gate: 85%).
- `ruff`, `mypy`, `eslint`, `tsc` all pass.
- Works in the Docker Compose stack on staging, not only on a laptop.
- **Documentation updated in the same pull request** (reviewers reject PRs without it):
  - user-visible change: the matching guide in `docs/guides/` and `cd frontend && pnpm guides`;
  - API change: `docs/api/openapi.json` regenerated (see `docs/api/README.md`); CI checks it;
  - ops / config change: `docs/runbook.md` and `.env.example`;
  - design change: `docs/architecture.md`;
  - every user-visible change: a line in `CHANGELOG.md` under *Unreleased*.
- Accessibility: new screens pass the axe check in `frontend/e2e/a11y.spec.ts`.
- Demoed at sprint review and accepted by the project lead.

## Local checks

```bash
make lint test        # or the raw commands in README.md
make e2e              # with the dev stack running and seeded
```

## Frontend dependencies

The dev Vite container keeps `node_modules` in its own volume. After `pnpm add <package>`, rebuild it, or the page goes blank with a 500 for the missing import:

```bash
docker compose -f compose.yaml -f compose.dev.yaml build vite
docker compose -f compose.yaml -f compose.dev.yaml up -d --force-recreate --renew-anon-volumes vite
```

## Database changes

Hand-written migrations are fine when autogenerate cannot express the change (enum values, data copies); 0006 `rooms_club_multiclass` is an example. Always test `upgrade`, `downgrade -1` and `upgrade` again.


Change the SQLAlchemy models, then generate a migration and **read it** before committing:

```bash
make revision m="add quizzes table"
```

Never edit a migration that has already reached `main`. Add a new one instead.

## Code style

- Python: ruff (lint + format), type hints everywhere, async SQLAlchemy.
- TypeScript: strict mode, no `any`, React function components, TanStack Query for server state.
- No secrets in code or commits. Use `.env` (never committed).
