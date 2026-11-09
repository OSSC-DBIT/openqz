#!/usr/bin/env bash
# Restore a backup made by backup.sh into an environment (default: staging, for drills).
# Usage: deploy/backup/restore.sh /backup/openqz/openqz-prod/20261219-013000 openqz-staging
set -euo pipefail

SRC="${1:?backup directory}"
PROJECT="${2:-openqz-staging}"

# Where this project's /data/media lives: the host folder (MEDIA_HOST_DIR) or the Docker volume.
media_src() {
  local id dest src=""
  id="$(docker ps -aq --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=api" | head -n1)"
  if [ -n "$id" ]; then
    # The app's media path (MEDIA_DIR in its environment, /data/media by default).
    dest="$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$id" | sed -n 's/^MEDIA_DIR=//p' | tail -n1)"
    src="$(docker inspect -f "{{range .Mounts}}{{if eq .Destination \"${dest:-/data/media}\"}}{{if eq .Type \"bind\"}}{{.Source}}{{else}}{{.Name}}{{end}}{{end}}{{end}}" "$id")"
  fi
  echo "${src:-${PROJECT}_media}"
}

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
# The archive holds media/...; extract it over the folder the api uses (uid 1000 = the app user).
docker run --rm -v "$(media_src):/data/media" -v "$SRC:/in:ro" alpine:3.20 \
  sh -c 'find /data/media -mindepth 1 -delete && tar -xzf /in/media.tar.gz -C /data && chown -R 1000:1000 /data/media'

docker start "${PROJECT}-api-1" "${PROJECT}-worker-1" >/dev/null
echo "Restore complete. Check: curl -fsS https://<host>/api/v1/health"
