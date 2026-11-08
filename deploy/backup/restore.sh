#!/usr/bin/env bash
# Restore a backup made by backup.sh into an environment (default: staging, for drills).
# Usage: deploy/backup/restore.sh /backup/openqz/openqz-prod/20261219-013000 openqz-staging
set -euo pipefail

SRC="${1:?backup directory}"
PROJECT="${2:-openqz-staging}"

if [ "$PROJECT" = "openqz-prod" ] && [ "${I_KNOW_THIS_OVERWRITES_PROD:-}" != "yes" ]; then
  echo "Refusing to restore into production without I_KNOW_THIS_OVERWRITES_PROD=yes" >&2
  exit 1
fi

(cd "$SRC" && sha256sum -c SHA256SUMS)

echo "Stopping api/worker of $PROJECT"
docker stop "${PROJECT}-api-1" "${PROJECT}-worker-1" >/dev/null || true

echo "Restoring database"
docker exec -i "${PROJECT}-db-1" sh -c \
  'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner' < "$SRC/db.dump"

echo "Restoring media"
docker run --rm -v "${PROJECT}_media:/data" -v "$SRC:/in:ro" alpine:3.20 \
  sh -c 'rm -rf /data/media && tar -xzf /in/media.tar.gz -C /data'

docker start "${PROJECT}-api-1" "${PROJECT}-worker-1" >/dev/null
echo "Restore complete. Check: curl -fsS https://<host>/api/v1/health"
