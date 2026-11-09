#!/usr/bin/env bash
# Deploy one OpenQZ environment on the OSSC server from the checked-out commit.
#
#   deploy/server/deploy.sh <staging|production> <git-sha>
#
# Run by the self-hosted GitHub Actions runner (.github/workflows/deploy.yml), or by hand
# from a checkout of the commit to deploy. Same pattern as PCMS and DBIT PageCraft:
#   1. reads /etc/openqz/<env>.conf (project, env file, health URL, local mail, backups)
#   2. builds the api and web images tagged <env>-<sha12>, so staging and production never share one
#   3. backs up the database and media first when the stack is running (required for production)
#   4. runs the migrations while the current release keeps serving
#   5. starts the new release, waits for every service to be healthy, and checks that
#      the health URL reports the new tag
#   6. makes sure the first admin exists, records the release, keeps the newest images
# On failure it prints the logs and stops. Guide: docs/deploy-ossc-server.md.
set -euo pipefail

ENVIRONMENT="${1:-}"
SHA="${2:-}"
case "$ENVIRONMENT" in
  staging|production) ;;
  *) echo "usage: $0 <staging|production> <git-sha>" >&2; exit 2 ;;
esac
[[ "$SHA" =~ ^[0-9a-f]{7,40}$ ]] || { echo "error: '$SHA' is not a git commit SHA" >&2; exit 2; }

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONF="${OPENQZ_CONF_DIR:-/etc/openqz}/${ENVIRONMENT}.conf"
STATE_DIR="${OPENQZ_DEPLOY_STATE_DIR:-/var/lib/openqz-deploy}"
KEEP_IMAGES="${OPENQZ_KEEP_IMAGES:-5}"

log() { printf '[deploy %s %s] %s\n' "$ENVIRONMENT" "$(date -u +%H:%M:%S)" "$*"; }
die() { printf '[deploy %s] error: %s\n' "$ENVIRONMENT" "$*" >&2; exit 1; }

# ---------- configuration ----------
# KEY=value lines, never executed. Root-owned, because it decides which env file and project a
# root-equivalent Docker command acts on.
[ -r "$CONF" ] || die "$CONF not found. Run: sudo bash deploy/server/setup-environment.sh $ENVIRONMENT"
if [ "${OPENQZ_DEPLOY_SKIP_OWNER_CHECK:-}" != 1 ]; then
  [ "$(stat -c %u "$CONF")" = 0 ] || die "$CONF must be owned by root"
  perms="$(stat -c %a "$CONF")"
  (( (8#$perms & 8#022) == 0 )) || die "$CONF must not be writable by group or others (chmod 644)"
fi
conf() { grep -E "^$1=" "$CONF" | tail -n1 | cut -d= -f2- | sed -e 's/^["'"'"']//' -e 's/["'"'"']$//' || true; }
PROJECT="$(conf OPENQZ_PROJECT)"
ENV_FILE="$(conf OPENQZ_ENV_FILE)"
HEALTH_URL="$(conf OPENQZ_HEALTH_URL)"
LOCAL_MAIL="$(conf OPENQZ_LOCAL_MAIL)"
BACKUP_DIR="$(conf OPENQZ_BACKUP_DIR)"
[[ "$PROJECT" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || die "OPENQZ_PROJECT in $CONF must be lowercase letters, digits, - or _"
[[ "$ENV_FILE" == /* ]] || die "OPENQZ_ENV_FILE in $CONF must be an absolute path"
[[ "$HEALTH_URL" =~ ^http://(127\.0\.0\.1|localhost):[0-9]+/ ]] || die "OPENQZ_HEALTH_URL must be http://127.0.0.1:<port>/..."
[ -e "$ENV_FILE" ] || die "env file $ENV_FILE does not exist. Run: sudo bash deploy/server/setup-environment.sh $ENVIRONMENT"
# root:openqz 640. A running runner keeps the groups it started with: after setup-environment.sh
# adds gh-runner to openqz, the runner service must be restarted once.
[ -r "$ENV_FILE" ] || die "env file $ENV_FILE is not readable by $(id -un) (groups: $(id -Gn)). sudo usermod -aG openqz $(id -un), restart the runner service, re-run this job"

# The env file must belong to this environment, or production would start on staging's
# port with staging's database password.
envval() { grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2- | tr -d '"'"'" || true; }
[ "$(envval ENVIRONMENT)" = "$ENVIRONMENT" ] || die "$ENV_FILE has ENVIRONMENT=$(envval ENVIRONMENT); it must be $ENVIRONMENT"
HTTP_PORT="$(envval HTTP_PORT)"
health_port="$(printf '%s' "$HEALTH_URL" | sed -nE 's#^http://[^:/]+:([0-9]+)/.*#\1#p')"
[ "$HTTP_PORT" = "$health_port" ] || die "$ENV_FILE has HTTP_PORT=${HTTP_PORT:-unset} but $CONF checks port $health_port"
case "$ENVIRONMENT" in
  staging)    other_project="openqz-prod" ;;
  production) other_project="openqz-staging" ;;
esac
[ "$PROJECT" != "$other_project" ] || die "$CONF names project $PROJECT, which belongs to the other environment"
owner="$(docker ps --filter "publish=$HTTP_PORT" --format '{{.Label "com.docker.compose.project"}}' | sort -u | grep -v "^${PROJECT}$" | head -n1 || true)"
[ -z "$owner" ] || die "host port $HTTP_PORT is held by Compose project '$owner'"

mkdir -p "$STATE_DIR"
exec 9>"$STATE_DIR/${ENVIRONMENT}.lock"
flock -n 9 || die "another deploy of $ENVIRONMENT is running"

TAG="${ENVIRONMENT}-${SHA:0:12}"
export API_IMAGE="openqz-api:${TAG}" WEB_IMAGE="openqz-web:${TAG}" APP_VERSION="$TAG" ENV_FILE
FILES=(-f "$REPO_DIR/compose.yaml" -f "$REPO_DIR/compose.prod.yaml")
# The mail server runs on this machine (port 587): point its name at the host (docs/email.md, section 3).
[ "$LOCAL_MAIL" = 1 ] && FILES+=(-f "$REPO_DIR/compose.mail.yaml")
dc() { docker compose -p "$PROJECT" "${FILES[@]}" --env-file "$ENV_FILE" "$@"; }

cd "$REPO_DIR"
log "commit $SHA, project $PROJECT, release $TAG, local mail: ${LOCAL_MAIL:-0}"
dc config --quiet || die "the compose files with $ENV_FILE are not valid"

# ---------- build ----------
log "building the images"
dc build --pull api nginx

previous="$(cat "$STATE_DIR/${ENVIRONMENT}.current" 2>/dev/null || true)"
fail() {
  log "deploy FAILED: $1"
  dc ps -a || true
  dc logs --tail 80 migrate api worker nginx || true
  [ -n "$previous" ] && log "previous release: $previous. Roll back: sudo openqz $ENVIRONMENT rollback (restore the backup first if the database migrated)"
  exit 1
}

# ---------- backup before migrations ----------
if [ -n "$(dc ps -q db 2>/dev/null)" ]; then
  [ -n "$BACKUP_DIR" ] || die "set OPENQZ_BACKUP_DIR in $CONF"
  log "backing up before the migrations"
  if ! bash "$REPO_DIR/deploy/backup/backup.sh" "$PROJECT" "$BACKUP_DIR"; then
    [ "$ENVIRONMENT" = production ] && die "backup failed; production is not deployed without a backup"
    log "warning: backup failed; continuing because this is staging"
  fi
else
  log "stack not running yet; nothing to back up"
fi

# ---------- migrate, then start ----------
log "starting the database and running migrations (the current release keeps serving)"
dc up -d --wait db redis || fail "the database or redis did not become healthy"
dc run --rm --no-deps migrate || fail "migrations failed; the current release is still running"

log "starting release $TAG"
dc up -d --remove-orphans --wait --wait-timeout 300 || fail "the new release did not become healthy"

dc exec -T api python -m app.cli create-admin --from-env || log "warning: could not check the first admin (sudo openqz $ENVIRONMENT admin)"

body=""
for _ in $(seq 1 12); do
  body="$(curl -fsS --max-time 10 "$HEALTH_URL" || true)"
  case "$body" in *"\"version\":\"${TAG}\""*) break ;; esac
  sleep 5
done
echo "$body"
case "$body" in
  *"\"version\":\"${TAG}\""*) ;;
  *) fail "$HEALTH_URL did not report version $TAG" ;;
esac

# ---------- record and tidy ----------
[ -n "$previous" ] && [ "$previous" != "$TAG" ] && echo "$previous" > "$STATE_DIR/${ENVIRONMENT}.previous"
echo "$TAG" > "$STATE_DIR/${ENVIRONMENT}.current"
printf '%s %s %s\n' "$(date -u +%FT%TZ)" "$TAG" "$SHA" >> "$STATE_DIR/${ENVIRONMENT}.history"

for repo in openqz-api openqz-web; do
  docker image ls "$repo" --format '{{.CreatedAt}}\t{{.Tag}}' \
    | { grep -E $'\t'"${ENVIRONMENT}-" || true; } | sort -r | tail -n +"$((KEEP_IMAGES + 1))" | cut -f2 \
    | while read -r old; do
        [ "$old" = "$TAG" ] || docker image rm "$repo:$old" >/dev/null 2>&1 || true
      done
done
docker image prune -f >/dev/null 2>&1 || true

log "deployed $TAG and healthy"
