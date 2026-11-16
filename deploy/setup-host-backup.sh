#!/usr/bin/env bash
set -euo pipefail
cd /opt/dar

PASS="$(sed -n 's/^POSTGRES_PASSWORD=//p' deploy/.env)"

sudo install -m 0750 -o root -g dar deploy/scripts/dar-backup.sh /usr/local/bin/dar-backup
sudo install -d -m 0700 -o dar -g dar /var/lib/dar/rclone

sudo tee /etc/dar/backup.env >/dev/null <<EOF
PGHOST=127.0.0.1
PGPORT=5432
PGDATABASE=dareltahfeez
PGUSER=dar_app
PGPASSWORD=$PASS
RCLONE_CONFIG=/var/lib/dar/rclone/rclone.conf
RCLONE_REMOTE=gdrive:dar-backups
EOF
sudo chown dar:dar /etc/dar/backup.env
sudo chmod 600 /etc/dar/backup.env

sudo install -m 0644 deploy/systemd/dar-backup.service /etc/systemd/system/dar-backup.service
sudo install -m 0644 deploy/systemd/dar-backup.timer /etc/systemd/system/dar-backup.timer
sudo systemctl daemon-reload
sudo systemctl enable --now dar-backup.timer
sudo systemctl start dar-backup.service
sleep 2
sudo systemctl --no-pager --full status dar-backup.service | sed -n '1,12p' || true
ls -lh /var/lib/dar/backups/db | tail -3
