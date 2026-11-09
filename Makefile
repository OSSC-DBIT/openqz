# Shortcuts for Git Bash / WSL / Linux. PowerShell users: see README for the raw commands.
DEV = docker compose -f compose.yaml -f compose.dev.yaml
PROD = docker compose -f compose.yaml -f compose.prod.yaml -p openqz-prod --env-file .env.prod
STAGING = docker compose -f compose.yaml -f compose.prod.yaml -p openqz-staging --env-file .env.staging

.PHONY: up down logs ps migrate revision test lint fmt admin seed e2e docs guides openapi prod-smoke prod-up prod-pull staging-up backup

up:            ## start the dev stack (hot reload)
	$(DEV) up -d --build

down:
	$(DEV) down

logs:
	$(DEV) logs -f --tail 100

ps:
	$(DEV) ps

migrate:
	$(DEV) run --rm migrate alembic upgrade head

revision:      ## make revision m="add quizzes"
	$(DEV) run --rm migrate alembic revision --autogenerate -m "$(m)"

test:          ## backend + frontend unit tests
	$(DEV) run --rm --no-deps migrate pytest --cov=app
	cd frontend && pnpm test

lint:
	$(DEV) run --rm --no-deps migrate sh -c "ruff check . && ruff format --check . && mypy app"
	cd frontend && pnpm lint && pnpm typecheck

fmt:
	$(DEV) run --rm --no-deps migrate sh -c "ruff check --fix . && ruff format ."

admin:         ## create the first admin from ADMIN_* in .env
	$(DEV) exec api python -m app.cli create-admin --from-env

seed:          ## import the sample sheets
	bash scripts/seed_demo.sh http://localhost:$${HTTP_PORT:-8088}

e2e:           ## browser journeys against the running dev stack
	cd frontend && pnpm test:e2e

guides:        ## rebuild /guides/*.html from docs/guides/*.md
	cd frontend && pnpm guides

openapi:       ## regenerate docs/api/openapi.json
	$(DEV) run --rm --no-deps -T migrate python scripts/export_openapi.py > docs/api/openapi.json

docs: guides openapi   ## regenerate every generated doc

prod-pull:
	$(PROD) pull

prod-smoke:    ## production images + compose.prod.yaml on this machine, full browser suite against it
	bash scripts/prod_smoke.sh

prod-up:
	$(PROD) up -d --remove-orphans

staging-up:
	$(STAGING) up -d --remove-orphans

backup:
	deploy/backup/backup.sh openqz-prod /backup/openqz
