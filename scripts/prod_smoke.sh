#!/usr/bin/env bash
# Run the PRODUCTION setup (compose.prod.yaml: built images, gunicorn workers, restart policies,
# resource limits) on this machine and point the whole browser test suite at it.
#
#   scripts/prod_smoke.sh            build images, start, seed, run Playwright, stop
#   KEEP=1 scripts/prod_smoke.sh     leave the stack running afterwards (http://localhost:8088)
#   KEEP=1 SKIP_E2E=1 scripts/prod_smoke.sh   just start it (for Lighthouse or a manual look)
#
# It uses its own Compose project (openqz-prodtest) and throw-away volumes, so dev data is safe.
# Stop the dev stack first: both serve on port 8088 and Mailpit on 8025.
# Plain http on localhost, so COOKIE_SECURE=false here only; real servers sit behind the TLS edge.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ENVF=.env.prodtest
P=openqz-prodtest
export ENV_FILE=$ENVF API_IMAGE=openqz-api:prodtest WEB_IMAGE=openqz-web:prodtest
export WEB_CONCURRENCY=${WEB_CONCURRENCY:-4} API_CPUS=${API_CPUS:-4} API_MEMORY=${API_MEMORY:-4g}
DC="docker compose -f compose.yaml -f compose.prod.yaml -f deploy/ci/compose.mailpit.yaml -p $P --env-file $ENVF"

if [ ! -f "$ENVF" ]; then
  sed -e "s/^ENVIRONMENT=.*/ENVIRONMENT=production/" \
      -e "s/^DEBUG=.*/DEBUG=false/" \
      -e "s/^JWT_SECRET=.*/JWT_SECRET=$(openssl rand -hex 32)/" \
      -e "s/^HTTP_PORT=.*/HTTP_PORT=8088/" \
      -e "s#^PUBLIC_URL=.*#PUBLIC_URL=http://localhost:8088#" \
      -e "s#^CORS_ORIGINS=.*#CORS_ORIGINS=http://localhost:8088#" \
      -e "s/^SMTP_HOST=.*/SMTP_HOST=mailpit/" \
      -e "s/^SMTP_PORT=.*/SMTP_PORT=1025/" \
      -e "s/^SMTP_STARTTLS=.*/SMTP_STARTTLS=false/" \
      -e "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=prodtest-db-password/" \
      -e "s#^DATABASE_URL=.*#DATABASE_URL=postgresql+asyncpg://openqz:prodtest-db-password@db:5432/openqz#" \
      .env.example > "$ENVF"
  echo "wrote $ENVF"
fi

echo "== building production images"
docker build -q --target runtime -t "$API_IMAGE" backend
docker build -q --target web -t "$WEB_IMAGE" frontend

cleanup() {
  if [ "${KEEP:-0}" != "1" ]; then
    echo "== stopping (volumes removed)"
    (cd "$ROOT" && $DC down -v --remove-orphans >/dev/null 2>&1) || echo "could not stop $P; run: $DC down -v"
  fi
}
trap cleanup EXIT

echo "== starting $P"
$DC up -d --wait --no-build
$DC exec -T api python -m app.cli create-admin --from-env
bash scripts/seed_demo.sh http://localhost:8088 >/dev/null
curl -fsS http://localhost:8088/api/v1/health && echo

echo "== security headers"
curl -fsSI http://localhost:8088/login | grep -iE "content-security-policy|x-content-type-options|referrer-policy|x-frame-options" || true

if [ "${SKIP_E2E:-0}" = "1" ]; then echo "== running at http://localhost:8088 (browser tests skipped)"; exit 0; fi

echo "== browser tests against production"
cd "$ROOT/frontend"
E2E_BASE_URL=http://localhost:8088 npx playwright test "$@"
