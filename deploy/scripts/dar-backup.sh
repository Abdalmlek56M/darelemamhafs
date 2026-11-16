#!/usr/bin/env bash
# Daily PostgreSQL backup with optional rclone offsite copy.
set -euo pipefail

set -a
# shellcheck disable=SC1091
. /etc/dar/backup.env
set +a

STAMP="$(date +%Y%m%d-%H%M%S)"
DIR="/var/lib/dar/backups/db"
mkdir -p "$DIR"
FILE="$DIR/dar-$STAMP.dump"

pg_dump -Fc -f "$FILE"

if [ -n "${RCLONE_REMOTE:-}" ]; then
  CONFIG="${RCLONE_CONFIG:-/etc/dar/rclone.conf}"
  if [ -f "$CONFIG" ]; then
    rclone --config "$CONFIG" copy "$FILE" "${RCLONE_REMOTE}/dar/db/" --include "$(basename "$FILE")"
    # Keep the last 30 days offsite.
    rclone --config "$CONFIG" delete "${RCLONE_REMOTE}/dar/db/" --min-age 30d --include 'dar-*.dump' || \
      logger -t dar-backup "offsite retention cleanup failed"
  else
    logger -t dar-backup "offsite skipped: rclone config not found at $CONFIG"
  fi
fi

# Keep 30 days locally as well.
find "$DIR" -type f -name 'dar-*.dump' -mtime +30 -delete
