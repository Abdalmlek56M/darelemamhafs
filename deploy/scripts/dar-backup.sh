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
  rclone copy "$FILE" "${RCLONE_REMOTE}/dar/db/" --include "$(basename "$FILE")"
fi

# Keep 14 days locally; offsite retention is managed by the bucket lifecycle policy.
find "$DIR" -type f -name 'dar-*.dump' -mtime +14 -delete
