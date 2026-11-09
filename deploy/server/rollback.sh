#!/usr/bin/env bash
# Return one OpenQZ environment to an earlier release, without building.
#
#   deploy/server/rollback.sh <staging|production> [tag]
#
# Uses the images kept by deploy.sh (openqz-api:<env>-<sha>, openqz-web:<env>-<sha>). With no tag
# it uses the previous release from /var/lib/openqz-deploy/<env>.previous; `docker image ls
# openqz-api` lists what is available.
#
# The database is NOT rolled back. If the release you leave ran a migration the old code cannot
# work with, restore the backup taken before that deploy first (deploy/backup/restore.sh).
set -euo pipefail

ENVIRONMENT="${1:-}"
case "$ENVIRONMENT" in
  staging|production) ;;
  *) echo "usage: $0 <staging|production> [tag]" >&2; exit 2 ;;
esac
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STATE_DIR="${OPENQZ_DEPLOY_STATE_DIR:-/var/lib/openqz-deploy}"
CONF="${OPENQZ_CONF_DIR:-/etc/openqz}/${ENVIRONMENT}.conf"
[ -r "$CONF" ] || { echo "error: $CONF not found" >&2; exit 1; }
conf() { grep -E "^$1=" "$CONF" | tail -n1 | cut -d= -f2- | sed -e 's/^["'"'"']//' -e 's/["'"'"']$//' || true; }
PROJECT="$(conf OPENQZ_PROJECT)"
ENV_FILE="$(conf OPENQZ_ENV_FILE)"
HEALTH_URL="$(conf OPENQZ_HEALTH_URL)"
LOCAL_MAIL="$(conf OPENQZ_LOCAL_MAIL)"
[[ "$PROJECT" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || { echo "error: bad OPENQZ_PROJECT in $CONF" >&2; exit 1; }

TAG="${2:-$(cat "$STATE_DIR/${ENVIRONMENT}.previous" 2>/dev/null || true)}"
[ -n "$TAG" ] || { echo "error: no previous release recorded; pass a tag" >&2; exit 1; }
[[ "$TAG" == "${ENVIRONMENT}-"* ]] || { echo "error: '$TAG' is not a $ENVIRONMENT release" >&2; exit 1; }
for img in "openqz-api:$TAG" "openqz-web:$TAG"; do
  docker image inspect "$img" >/dev/null 2>&1 || { echo "error: image $img is not on this server" >&2; exit 1; }
done

mkdir -p "$STATE_DIR"
exec 9>"$STATE_DIR/${ENVIRONMENT}.lock"
flock -n 9 || { echo "error: a deploy of $ENVIRONMENT is running" >&2; exit 1; }

export API_IMAGE="openqz-api:$TAG" WEB_IMAGE="openqz-web:$TAG" APP_VERSION="$TAG" ENV_FILE
FILES=(-f "$REPO_DIR/compose.yaml" -f "$REPO_DIR/compose.prod.yaml")
[ "$LOCAL_MAIL" = 1 ] && FILES+=(-f "$REPO_DIR/compose.mail.yaml")
dc() { docker compose -p "$PROJECT" "${FILES[@]}" --env-file "$ENV_FILE" "$@"; }

cd "$REPO_DIR"
echo "[rollback $ENVIRONMENT] starting $TAG"
dc up -d --no-build --remove-orphans --wait --wait-timeout 300
body="$(curl -fsS --max-time 10 "$HEALTH_URL" || true)"
case "$body" in
  *"\"version\":\"${TAG}\""*) ;;
  *) echo "[rollback $ENVIRONMENT] error: $HEALTH_URL does not report $TAG" >&2; dc logs --tail 60 api nginx || true; exit 1 ;;
esac

current="$(cat "$STATE_DIR/${ENVIRONMENT}.current" 2>/dev/null || true)"
[ -n "$current" ] && [ "$current" != "$TAG" ] && echo "$current" > "$STATE_DIR/${ENVIRONMENT}.previous"
echo "$TAG" > "$STATE_DIR/${ENVIRONMENT}.current"
printf '%s %s rollback\n' "$(date -u +%FT%TZ)" "$TAG" >> "$STATE_DIR/${ENVIRONMENT}.history"
echo "[rollback $ENVIRONMENT] running $TAG"
