#!/usr/bin/env bash
set -euo pipefail
cd /opt/dar

PASS="$(sed -n 's/^POSTGRES_PASSWORD=//p' deploy/.env)"
DB_NAME="$(sed -n 's/^POSTGRES_DB=//p' deploy/.env | head -n 1)"
[ -n "$DB_NAME" ] || { echo 'POSTGRES_DB must be set in deploy/.env.' >&2; exit 1; }

sudo install -m 0750 -o root -g dar deploy/scripts/dar-backup.sh /usr/local/bin/dar-backup
sudo install -d -m 0700 -o dar -g dar /var/lib/dar/rclone

sudo tee /etc/dar/backup.env >/dev/null <<EOF
PGHOST=127.0.0.1
PGPORT=5432
PGDATABASE=$DB_NAME
PGUSER=dar_app
PGPASSWORD=$PASS
RCLONE_CONFIG=/var/lib/dar/rclone/rclone.conf
RCLONE_REMOTE=gdrive:dar-backups
EOF
sudo chown dar:dar /etc/dar/backup.env
sudo chmod 600 /etc/dar/backup.env

sudo install -m 0644 deploy/systemd/dar-backup.service /etc/systemd/system/dar-backup.service
sudo install -m 0644 deploy/systemd/dar-backup.timer /etc/systemd/system/dar-backup.timer

# Shared read-only business-integrity SQL (ported from the retired Windows tools).
sudo install -d -m 0755 -o root -g root /usr/local/share/dar
sudo install -m 0644 -o root -g root deploy/sql/integrity-checks.sql /usr/local/share/dar/integrity-checks.sql

# Operational healthcheck (services + health endpoints + postgres + disk + backup age
# + off-site freshness + TLS + nginx + meet-bot/livekit + integrity); JSON with jq.
sudo install -m 0755 -o root -g root deploy/scripts/dar-healthcheck.sh /usr/local/bin/dar-healthcheck
sudo install -d -m 0755 -o root -g root /usr/local/lib/dar/healthcheck
sudo install -m 0644 -o root -g root deploy/scripts/lib/healthcheck-*.sh /usr/local/lib/dar/healthcheck/
if ! command -v jq >/dev/null 2>&1; then
  echo 'WARN: jq is missing; dar-healthcheck --json and the off-site/integrity checks need jq (apt-get install -y jq).' >&2
fi
sudo install -m 0644 deploy/systemd/dar-healthcheck.service /etc/systemd/system/dar-healthcheck.service
sudo install -m 0644 deploy/systemd/dar-healthcheck.timer /etc/systemd/system/dar-healthcheck.timer

# Scheduled restore drill (disposable databases only; env file carries no hardcoded names).
sudo install -m 0755 -o root -g root deploy/scripts/restore-drill.sh /usr/local/bin/dar-restore-drill
sudo install -m 0644 deploy/systemd/dar-restore-drill.service /etc/systemd/system/dar-restore-drill.service
sudo install -m 0644 deploy/systemd/dar-restore-drill.timer /etc/systemd/system/dar-restore-drill.timer
if [ ! -f /etc/dar/restore-drill.env ]; then
  sudo install -m 0600 -o root -g root deploy/restore-drill.env.example /etc/dar/restore-drill.env
  echo 'WARN: edit /etc/dar/restore-drill.env before the first scheduled restore drill.' >&2
fi

sudo systemctl daemon-reload
sudo systemctl enable --now dar-backup.timer
sudo systemctl enable --now dar-healthcheck.timer
sudo systemctl enable --now dar-restore-drill.timer
sudo systemctl start dar-backup.service
sleep 2
sudo systemctl --no-pager --full status dar-backup.service | sed -n '1,12p' || true
# shellcheck disable=SC2012
ls -lh /var/lib/dar/backups/db | tail -3
