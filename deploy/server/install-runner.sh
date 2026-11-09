#!/usr/bin/env bash
# Install the self-hosted GitHub Actions runner for this repository on the OSSC server.
#
#   sudo bash deploy/server/install-runner.sh <registration-token>
#
# The token comes from GitHub: the repository > Settings > Actions > Runners >
# New self-hosted runner > Linux (the value after --token, valid for one hour).
#
# One runner per repository, as for PCMS: this one lives in /srv/actions-runner-openqz,
# runs as the existing `gh-runner` user (created if missing), carries the label `openqz`
# and is installed as a systemd service. Safe to run again: an installed runner is left alone.
set -euo pipefail

TOKEN="${1:-}"
[ -n "$TOKEN" ] || { echo "usage: sudo bash $0 <registration-token>" >&2; exit 2; }
[ "$(id -u)" = 0 ] || { echo "run with sudo" >&2; exit 1; }

REPO_URL="${REPO_URL:-https://github.com/OSSC-DBIT/openqz}"
RUNNER_DIR="${RUNNER_DIR:-/srv/actions-runner-openqz}"
RUNNER_USER="${RUNNER_USER:-gh-runner}"
RUNNER_NAME="${RUNNER_NAME:-ossc-server-openqz}"
LABELS="${LABELS:-openqz}"

say() { printf '\n== %s\n' "$*"; }
note() { printf '   %s\n' "$*"; }

say "user $RUNNER_USER"
if ! id "$RUNNER_USER" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "/home/$RUNNER_USER" --shell /bin/bash "$RUNNER_USER"
  note "created"
fi
usermod -aG docker "$RUNNER_USER"
groupadd -f openqz && usermod -aG openqz "$RUNNER_USER"
note "in groups: $(id -nG "$RUNNER_USER")"

say "runner in $RUNNER_DIR"
if [ -f "$RUNNER_DIR/.runner" ]; then
  note "already configured; nothing to do. Status: systemctl status 'actions.runner.*'"
  exit 0
fi
install -d -o "$RUNNER_USER" -g "$RUNNER_USER" "$RUNNER_DIR"

# Reuse the runner files already on this server (the PCMS or PageCraft runner, or a plain download)
# instead of downloading again. Registration files and the work folder are not copied.
SOURCE_DIR="${SOURCE_DIR:-}"
if [ -z "$SOURCE_DIR" ]; then
  for d in /srv/actions-runner /home/*/actions-runner /opt/actions-runner; do
    [ -x "$d/config.sh" ] && [ "$d" != "$RUNNER_DIR" ] && { SOURCE_DIR="$d"; break; }
  done
fi
if [ -n "$SOURCE_DIR" ]; then
  note "copying runner files from $SOURCE_DIR"
  tar -C "$SOURCE_DIR" --exclude=./_work --exclude=./_diag -cf - . | tar -C "$RUNNER_DIR" -xf -
  # The source runner's registration must not come along, or config.sh refuses to run.
  # (.runner_migrated and .credentials_migrated count as "configured" too.)
  rm -rf "$RUNNER_DIR"/.runner* "$RUNNER_DIR"/.credentials* "$RUNNER_DIR/.service" "$RUNNER_DIR/.path" "$RUNNER_DIR/.env" "$RUNNER_DIR/_work" "$RUNNER_DIR/_diag"
else
  version="$(curl -fsSL https://api.github.com/repos/actions/runner/releases/latest | grep -oE '"tag_name": *"v[0-9.]+"' | grep -oE '[0-9.]+')"
  [ -n "$version" ] || { echo "could not determine the latest runner version" >&2; exit 1; }
  tarball="actions-runner-linux-x64-${version}.tar.gz"
  note "downloading runner $version"
  curl -fsSL -o "/tmp/$tarball" "https://github.com/actions/runner/releases/download/v${version}/${tarball}"
  tar -xzf "/tmp/$tarball" -C "$RUNNER_DIR"
  rm -f "/tmp/$tarball"
fi
chown -R "$RUNNER_USER":"$RUNNER_USER" "$RUNNER_DIR"

note "registering with $REPO_URL as $RUNNER_NAME (labels: $LABELS)"
sudo -u "$RUNNER_USER" bash -c "cd '$RUNNER_DIR' && ./config.sh --unattended --url '$REPO_URL' --token '$TOKEN' --name '$RUNNER_NAME' --labels '$LABELS' --work _work --replace"

say "service"
cd "$RUNNER_DIR"
./svc.sh install "$RUNNER_USER"
./svc.sh start
install -d -o "$RUNNER_USER" -g "$RUNNER_USER" /var/lib/openqz-deploy
note "installed. GitHub > Settings > Actions > Runners should now list $RUNNER_NAME as Idle."
note "next: sudo bash deploy/server/setup-environment.sh staging  (and production)"
