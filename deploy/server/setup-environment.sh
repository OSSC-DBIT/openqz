#!/usr/bin/env bash
# Prepare one OpenQZ environment on the OSSC server, in one command. Safe to run again.
#
#   sudo bash deploy/server/setup-environment.sh staging    [--domain openqz-staging.webuildnow.in] [--admin-email you@dbit.in]
#   sudo bash deploy/server/setup-environment.sh production [--domain openqz.webuildnow.in]         [--admin-email you@dbit.in]
#
# It never overwrites a secret that is already set. It does:
#   - the `openqz` group, with the GitHub runner user (gh-runner) in it
#   - /srv/server-data/<env>/openqz/ (root:openqz 750) with all its data: db, redis, media, backups
#   - the settings file openqz.env (root:openqz 640): fresh secrets, this environment's port,
#     the mail server on this machine (asks for the mailbox password), or completes an existing one
#   - /etc/openqz/<env>.conf for continuous deployment (no secrets)
#   - /var/lib/openqz-deploy for the runner, the nightly backup (cron) and the `openqz` helper
# Same layout as PCMS and DBIT PageCraft on this server. Guide: docs/deploy-ossc-server.md.
set -euo pipefail

ENVIRONMENT="${1:-}"; shift || true
DOMAIN=""; ADMIN_EMAIL_ARG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="$2"; shift 2 ;;
    --admin-email) ADMIN_EMAIL_ARG="$2"; shift 2 ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done

case "$ENVIRONMENT" in
  staging)
    PROJECT=openqz-staging; [ -n "$DOMAIN" ] || DOMAIN=openqz-staging.webuildnow.in
    HTTP_PORT=8092; WEB_CONCURRENCY=2; API_CPUS=2; API_MEMORY=2g; WORKER_CPUS=1; WORKER_MEMORY=1g
    PG_SHARED_BUFFERS=256MB; PG_EFFECTIVE_CACHE=1GB; BACKUP_HOUR=2 ;;
  production)
    PROJECT=openqz-prod; [ -n "$DOMAIN" ] || DOMAIN=openqz.webuildnow.in
    HTTP_PORT=8093; WEB_CONCURRENCY=8; API_CPUS=8; API_MEMORY=8g; WORKER_CPUS=4; WORKER_MEMORY=4g
    PG_SHARED_BUFFERS=2GB; PG_EFFECTIVE_CACHE=6GB; BACKUP_HOUR=1 ;;
  *) echo "usage: sudo bash $0 <staging|production> [--domain host] [--admin-email you@dbit.in]" >&2; exit 2 ;;
esac
DATA_DIR="/srv/server-data/$ENVIRONMENT/openqz"
ENV_FILE="$DATA_DIR/openqz.env"
BACKUP_DIR="$DATA_DIR/backups"
MEDIA_DIR="$DATA_DIR/media"
DB_DIR="$DATA_DIR/db"
REDIS_DIR="$DATA_DIR/redis"
RUNNER_USER="${RUNNER_USER:-gh-runner}"
RUNNER_CHECKOUT="${RUNNER_CHECKOUT:-/srv/actions-runner-openqz/_work/openqz/openqz}"
SMTP_HOST_DEFAULT="${SMTP_HOST_DEFAULT:-mail.webuildnow.in}"
SMTP_USER_DEFAULT="${SMTP_USER_DEFAULT:-dbit-oscc}"
SMTP_FROM_DEFAULT="${SMTP_FROM_DEFAULT:-OpenQZ <dbit-oscc@webuildnow.in>}"

[ "$(id -u)" = 0 ] || { echo "run with sudo" >&2; exit 1; }
for c in docker openssl flock ss; do command -v "$c" >/dev/null || { echo "$c is not installed" >&2; exit 1; }; done

say() { printf '\n== %s\n' "$*"; }
note() { printf '   %s\n' "$*"; }
STAMP="$(date +%Y%m%d-%H%M%S)"
hex() { openssl rand -hex "$1"; }
random() { openssl rand -base64 "$1" | tr -d '/+=\n' | head -c "$2"; }

get() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -n1 | cut -d= -f2- || true; }
put() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp)"
  grep -vE "^$key=" "$ENV_FILE" > "$tmp" || true
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  cat "$tmp" > "$ENV_FILE"; rm -f "$tmp"
}
put_if_empty() { [ -n "$(get "$1")" ] || { put "$1" "$2"; note "set $1"; }; }

# ---------- group and runner ----------
say "group openqz"
groupadd -f openqz
if id "$RUNNER_USER" >/dev/null 2>&1; then
  if ! id -nG "$RUNNER_USER" | tr ' ' '\n' | grep -qx openqz; then
    usermod -aG openqz "$RUNNER_USER"
    note "added $RUNNER_USER to group openqz"
    # A running process keeps its old groups: restart the runner(s) so deploys can read the settings.
    if systemctl list-units --type=service --all 'actions.runner.*' --no-legend 2>/dev/null | grep -q .; then
      systemctl restart 'actions.runner.*' && note "restarted the GitHub runner service(s)"
    fi
  else
    note "$RUNNER_USER already in group openqz"
  fi
  id -nG "$RUNNER_USER" | tr ' ' '\n' | grep -qx docker || note "WARNING: $RUNNER_USER is not in the docker group (sudo usermod -aG docker $RUNNER_USER)"
else
  note "user $RUNNER_USER does not exist yet; run deploy/server/install-runner.sh first, then this again"
fi

# ---------- folders ----------
say "folders in $DATA_DIR"
install -d -m 755 /srv/server-data "/srv/server-data/$ENVIRONMENT"
install -d -m 750 -o root -g openqz "$DATA_DIR"
# Written by the runner (backup before each deploy) and by root (nightly cron).
install -d -m 2770 -o root -g openqz "$BACKUP_DIR"
# Uploads and import sheets of this environment, written by the app (uid 1000 in the container).
install -d -m 750 -o 1000 -g 1000 "$MEDIA_DIR"
# PostgreSQL data (uid 70 = postgres in postgres:16-alpine) and Redis data (uid 999 = redis).
# Both containers start as root and fix the owner themselves if needed.
install -d -m 700 -o 70 -g 70 "$DB_DIR"
install -d -m 700 -o 999 -g 1000 "$REDIS_DIR"
note "ok"

# ---------- settings file ----------
say "settings file $ENV_FILE"
if [ ! -f "$ENV_FILE" ]; then
  DB_PASSWORD="$(hex 24)"
  ADMIN_PASSWORD="$(random 36 20)Aa1!"
  install -m 640 -o root -g openqz /dev/null "$ENV_FILE"
  cat > "$ENV_FILE" <<EOF
# OpenQZ $ENVIRONMENT settings. Created by deploy/server/setup-environment.sh on $(date -u +%F).
# Mode 640, root:openqz. Every setting is explained in .env.example in the repository.
# API_IMAGE, WEB_IMAGE and APP_VERSION are set by deploy/server/deploy.sh per release; not here.

ENVIRONMENT=$ENVIRONMENT
DEBUG=false
PUBLIC_URL=https://$DOMAIN
ENV_FILE=$ENV_FILE

# nginx listens on 127.0.0.1 only; the Cloudflare tunnel forwards https://$DOMAIN here.
HTTP_PORT=$HTTP_PORT

JWT_SECRET=$(random 96 64)
COOKIE_SECURE=true
CORS_ORIGINS=https://$DOMAIN
# 127.0.0.1 and localhost: the deploy health check on this machine.
ALLOWED_HOSTS=$DOMAIN,127.0.0.1,localhost,api,nginx

GOOGLE_CLIENT_ID=
GOOGLE_ALLOWED_DOMAINS=

# The mail server runs on this machine (port 587); deploys add compose.mail.yaml (docs/email.md).
SMTP_HOST=$SMTP_HOST_DEFAULT
SMTP_PORT=587
SMTP_USER=$SMTP_USER_DEFAULT
SMTP_PASSWORD=
SMTP_FROM=$SMTP_FROM_DEFAULT
SMTP_STARTTLS=true
SMTP_SSL=false

POSTGRES_USER=openqz
POSTGRES_PASSWORD=$DB_PASSWORD
POSTGRES_DB=openqz
DATABASE_URL=postgresql+asyncpg://openqz:$DB_PASSWORD@db:5432/openqz
REDIS_URL=redis://redis:6379/0
# Uploads: /data/media in the containers is this host folder (owner uid 1000).
MEDIA_DIR=/data/media
MEDIA_HOST_DIR=$MEDIA_DIR
# Database and Redis data of this environment (instead of Docker volumes).
DB_HOST_DIR=$DB_DIR
REDIS_HOST_DIR=$REDIS_DIR

# Size of this environment on the server.
WEB_CONCURRENCY=$WEB_CONCURRENCY
API_CPUS=$API_CPUS
API_MEMORY=$API_MEMORY
WORKER_CPUS=$WORKER_CPUS
WORKER_MEMORY=$WORKER_MEMORY
PG_SHARED_BUFFERS=$PG_SHARED_BUFFERS
PG_EFFECTIVE_CACHE=$PG_EFFECTIVE_CACHE

# First admin, created by the first deploy (python -m app.cli create-admin --from-env).
# Sign in, then change the password; this value is not used again once the account exists.
ADMIN_USERNAME=admin
ADMIN_EMAIL=${ADMIN_EMAIL_ARG:-admin@dbit.in}
ADMIN_PASSWORD=$ADMIN_PASSWORD
ADMIN_FULL_NAME=OpenQZ Administrator
EOF
  note "created with a fresh database password, JWT secret and admin password"
  note "first admin: $(get ADMIN_EMAIL) / $ADMIN_PASSWORD   <- store it, change it after the first sign-in"
else
  cp -a "$ENV_FILE" "$ENV_FILE.bak-$STAMP"
  note "exists; backup: $ENV_FILE.bak-$STAMP"
  [ "$(get ENVIRONMENT)" = "$ENVIRONMENT" ] || { put ENVIRONMENT "$ENVIRONMENT"; note "corrected ENVIRONMENT=$ENVIRONMENT"; }
  put_if_empty PUBLIC_URL "https://$DOMAIN"
  put_if_empty ENV_FILE "$ENV_FILE"
  put_if_empty HTTP_PORT "$HTTP_PORT"
  [ "$(get HTTP_PORT)" = "$HTTP_PORT" ] || note "WARNING: HTTP_PORT=$(get HTTP_PORT) differs from this environment's usual $HTTP_PORT"
  put_if_empty COOKIE_SECURE true
  put_if_empty CORS_ORIGINS "https://$DOMAIN"
  put_if_empty ALLOWED_HOSTS "$DOMAIN,127.0.0.1,localhost,api,nginx"
  put_if_empty JWT_SECRET "$(random 96 64)"
  put_if_empty SMTP_HOST "$SMTP_HOST_DEFAULT"
  put_if_empty SMTP_PORT 587
  put_if_empty MEDIA_HOST_DIR "$MEDIA_DIR"
  # Existing data in Docker volumes is NOT moved automatically: see docs/deploy-ossc-server.md.
  if [ -z "$(get DB_HOST_DIR)" ] && docker volume inspect "${PROJECT}_pgdata" >/dev/null 2>&1; then
    note "WARNING: $PROJECT already has its database in the Docker volume ${PROJECT}_pgdata;"
    note "         DB_HOST_DIR not set, so it keeps using it. To move it, see docs/deploy-ossc-server.md"
  else
    put_if_empty DB_HOST_DIR "$DB_DIR"
    put_if_empty REDIS_HOST_DIR "$REDIS_DIR"
  fi
  put_if_empty SMTP_FROM "$SMTP_FROM_DEFAULT"
  for k in WEB_CONCURRENCY API_CPUS API_MEMORY WORKER_CPUS WORKER_MEMORY PG_SHARED_BUFFERS PG_EFFECTIVE_CACHE; do
    put_if_empty "$k" "${!k}"
  done
  sed -i -E '/^(API_IMAGE|WEB_IMAGE|APP_VERSION|COMPOSE_PROJECT_NAME)=/d' "$ENV_FILE"
fi

# The mailbox password: asked for, never passed on the command line (it would land in the shell history).
if [ -z "$(get SMTP_PASSWORD)" ]; then
  if [ -t 0 ]; then
    read -rsp "   password of mailbox $(get SMTP_USER) on $(get SMTP_HOST) (Enter to skip): " smtp_pw; echo
    [ -n "$smtp_pw" ] && { put SMTP_PASSWORD "$smtp_pw"; note "set SMTP_PASSWORD"; }
    unset smtp_pw
  fi
  [ -n "$(get SMTP_PASSWORD)" ] || note "WARNING: SMTP_PASSWORD is empty; emails will fail. Put it in $ENV_FILE, then redeploy"
fi
chown root:openqz "$ENV_FILE"; chmod 640 "$ENV_FILE"
HTTP_PORT="$(get HTTP_PORT)"

# ---------- continuous deployment ----------
say "/etc/openqz/$ENVIRONMENT.conf"
install -d -m 755 /etc/openqz
cat > "/etc/openqz/$ENVIRONMENT.conf" <<EOF
OPENQZ_PROJECT=$PROJECT
OPENQZ_ENV_FILE=$ENV_FILE
OPENQZ_HEALTH_URL=http://127.0.0.1:$HTTP_PORT/api/v1/health
OPENQZ_LOCAL_MAIL=1
OPENQZ_BACKUP_DIR=$BACKUP_DIR
EOF
chown root:root "/etc/openqz/$ENVIRONMENT.conf"; chmod 644 "/etc/openqz/$ENVIRONMENT.conf"
if id "$RUNNER_USER" >/dev/null 2>&1; then
  install -d -o "$RUNNER_USER" -g "$RUNNER_USER" /var/lib/openqz-deploy
else
  install -d /var/lib/openqz-deploy
fi
note "project $PROJECT, health check http://127.0.0.1:$HTTP_PORT/api/v1/health"

# ---------- nightly backup ----------
say "nightly backup (/etc/cron.d/openqz-$ENVIRONMENT)"
cat > "/etc/cron.d/openqz-$ENVIRONMENT" <<EOF
# OpenQZ $ENVIRONMENT: database dump + media, kept 30 days. Made by setup-environment.sh.
30 $BACKUP_HOUR * * * root [ -f $RUNNER_CHECKOUT/deploy/backup/backup.sh ] && bash $RUNNER_CHECKOUT/deploy/backup/backup.sh $PROJECT $BACKUP_DIR >> /var/log/openqz-$ENVIRONMENT-backup.log 2>&1
EOF
chmod 644 "/etc/cron.d/openqz-$ENVIRONMENT"
note "every night at $BACKUP_HOUR:30 into $BACKUP_DIR/$PROJECT"

# ---------- the `openqz` helper ----------
say "helper command: openqz"
cat > /usr/local/bin/openqz <<'HELPER'
#!/usr/bin/env bash
# openqz <staging|production> <command>   Day-to-day commands for an OpenQZ environment.
#   status          release, containers, the health check, last deploys
#   logs [svc]      last 200 lines (api, worker, nginx, db, migrate); follow with -f
#   psql            open the database
#   admin           create the first admin from the settings file (if missing) and show its email
#   backup          back up now (database + media)
#   mailtest        check the mail server: connect, TLS, login (sends nothing)
#   rollback [tag]  go back to the previous release
#   compose ...     any docker compose command for this environment
set -euo pipefail
ENVIRONMENT="${1:-}"; CMD="${2:-status}"; shift 2 2>/dev/null || shift $#
CONF="/etc/openqz/$ENVIRONMENT.conf"
[ -r "$CONF" ] || { echo "usage: openqz <staging|production> <status|logs|psql|admin|backup|mailtest|rollback|compose ...>" >&2; exit 2; }
conf() { grep -E "^$1=" "$CONF" | tail -n1 | cut -d= -f2-; }
PROJECT="$(conf OPENQZ_PROJECT)"; ENV_FILE="$(conf OPENQZ_ENV_FILE)"; HEALTH="$(conf OPENQZ_HEALTH_URL)"
REPO="$(ls -d /srv/actions-runner*/_work/openqz/openqz 2>/dev/null | head -n1 || true)"
[ -n "$REPO" ] && [ -f "$REPO/compose.yaml" ] || { echo "no runner checkout of openqz under /srv/actions-runner*; deploy once first" >&2; exit 1; }
TAG="$(cat "/var/lib/openqz-deploy/$ENVIRONMENT.current" 2>/dev/null || true)"
[ -n "$TAG" ] && export API_IMAGE="openqz-api:$TAG" WEB_IMAGE="openqz-web:$TAG" APP_VERSION="$TAG"
export ENV_FILE
FILES=(-f "$REPO/compose.yaml" -f "$REPO/compose.prod.yaml")
[ "$(conf OPENQZ_LOCAL_MAIL)" = 1 ] && FILES+=(-f "$REPO/compose.mail.yaml")
dc() { docker compose -p "$PROJECT" "${FILES[@]}" --env-file "$ENV_FILE" "$@"; }
case "$CMD" in
  status)
    echo "environment: $ENVIRONMENT   project: $PROJECT   release: ${TAG:-not deployed yet}"
    dc ps --format 'table {{.Service}}\t{{.Status}}'
    printf 'health: '; curl -fsS --max-time 10 "$HEALTH" && echo || echo "NOT OK ($HEALTH)"
    tail -n 5 "/var/lib/openqz-deploy/$ENVIRONMENT.history" 2>/dev/null | sed 's/^/deployed: /' || true ;;
  logs) dc logs --tail 200 "$@" ;;
  psql) dc exec db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' ;;
  admin) dc exec -T api python -m app.cli create-admin --from-env; grep -E '^(ADMIN_EMAIL|PUBLIC_URL)=' "$ENV_FILE" ;;
  backup) bash "$REPO/deploy/backup/backup.sh" "$PROJECT" "$(conf OPENQZ_BACKUP_DIR)" ;;
  mailtest)
    dc exec -T worker python -c "
import smtplib, ssl
from app.core.config import get_settings
s = get_settings()
c = smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=10)
c.starttls(context=ssl.create_default_context())
print('TLS ok for', s.smtp_host, '| login:', c.login(s.smtp_user, s.smtp_password)[0])
c.quit()" ;;
  rollback) bash "$REPO/deploy/server/rollback.sh" "$ENVIRONMENT" "$@" ;;
  compose) dc "$@" ;;
  *) echo "unknown command $CMD" >&2; exit 2 ;;
esac
HELPER
chmod 755 /usr/local/bin/openqz
note "try: sudo openqz $ENVIRONMENT status   (after the first deploy)"

# ---------- checks ----------
say "port $HTTP_PORT"
owner="$(ss -ltnpH "sport = :$HTTP_PORT" 2>/dev/null | head -n1 || true)"
if [ -z "$owner" ]; then note "free"
elif echo "$owner" | grep -q docker; then note "used by Docker (expected if $ENVIRONMENT is already running)"
else note "WARNING: used by: $owner. Pick another port: HTTP_PORT in $ENV_FILE and /etc/openqz/$ENVIRONMENT.conf"; fi

say "mail server on this machine (port 587)"
listen="$(ss -ltnH 'sport = :587' 2>/dev/null || true)"
if [ -z "$listen" ]; then note "WARNING: nothing listens on 587 here"
elif echo "$listen" | grep -qE '127\.0\.0\.1:587|\[::1\]:587' && ! echo "$listen" | grep -qE '(0\.0\.0\.0|\*|\[::\]):587'; then
  note "WARNING: 587 listens on localhost only; containers cannot reach it. Let it listen on all interfaces (Postfix: inet_interfaces = all)"
else note "ok: $(echo "$listen" | awk '{print $4}' | tr '\n' ' ')"; fi
if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw status | grep -qE '^587(/tcp)? .*ALLOW' || ufw status | grep -q '172.16.0.0/12' || \
    note "ufw is on: if mail from the app times out, run: sudo ufw allow from 172.16.0.0/12 to any port 587 proto tcp"
fi

say "summary"
note "settings:    $ENV_FILE"
grep -E '^(ENVIRONMENT|PUBLIC_URL|HTTP_PORT|MEDIA_HOST_DIR|DB_HOST_DIR|REDIS_HOST_DIR|ADMIN_EMAIL|SMTP_HOST|SMTP_FROM)=' "$ENV_FILE" | sed 's/^/             /'
note "Cloudflare:  Zero Trust > Networks > Tunnels > the existing tunnel > Public hostname > Add"
note "             $DOMAIN  ->  type HTTP, URL localhost:$HTTP_PORT"
if [ "$ENVIRONMENT" = production ]; then
  note "next:        merge to main on GitHub; the Deploy workflow deploys production"
else
  note "next:        push to dev on GitHub; the Deploy workflow deploys staging"
fi
