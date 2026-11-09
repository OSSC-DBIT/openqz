#!/usr/bin/env bash
# Nightly backup of one OpenQZ environment: Postgres dump + media files.
# Usage: deploy/backup/backup.sh openqz-prod /backup/openqz
# Cron:  30 1 * * *  /opt/openqz/deploy/backup/backup.sh openqz-prod /backup/openqz >> /var/log/openqz-backup.log 2>&1
set -euo pipefail

PROJECT="${1:-openqz-prod}"
DEST="${2:-/backup/openqz}"
KEEP_DAYS="${KEEP_DAYS:-30}"
STAMP="$(date +%Y%m%d-%H%M%S)"
# Group-writable: on the OSSC server the folder is shared by the deploy runner and the nightly cron
# (setgid group openqz), so either may add and prune backups.
umask 002
DIR="$DEST/$PROJECT/$STAMP"
mkdir -p "$DIR"

echo "[$(date -Is)] backing up $PROJECT to $DIR"

# Database: custom format, compressed, restorable with pg_restore.
docker exec "${PROJECT}-db-1" sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$DIR/db.dump"

# Media volume (uploads, import sheets).
docker run --rm -v "${PROJECT}_media:/data/media:ro" -v "$DIR:/out" alpine:3.20 \
  tar -czf /out/media.tar.gz -C /data media

# Relative names, so a copy can be checked anywhere: cd <backup> && sha256sum -c SHA256SUMS
(cd "$DIR" && sha256sum db.dump media.tar.gz > SHA256SUMS)
echo "[$(date -Is)] done: $(du -sh "$DIR" | cut -f1)"

# Retention
find "$DEST/$PROJECT" -mindepth 1 -maxdepth 1 -type d -mtime +"$KEEP_DAYS" -exec rm -rf {} + 2>/dev/null || true

# Optional second copy to the external drive.
if [ -n "${EXTERNAL_COPY:-}" ] && [ -d "$EXTERNAL_COPY" ]; then
  rsync -a "$DEST/$PROJECT/" "$EXTERNAL_COPY/$PROJECT/"
fi
