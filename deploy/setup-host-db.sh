#!/usr/bin/env bash
set -euo pipefail
cd /opt/dar

PASS="$(sed -n 's/^POSTGRES_PASSWORD=//p' deploy/.env)"
DUMP="$(ls -t backups/pre-host-migration/*.dump | head -1)"

if sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='dar_app'" | grep -q 1; then
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "ALTER ROLE dar_app WITH LOGIN PASSWORD '$PASS';"
else
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE ROLE dar_app LOGIN PASSWORD '$PASS';"
fi

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='dareltahfeez'" | grep -q 1; then
  sudo -u postgres createdb -O dar_app dareltahfeez
fi

PGPASSWORD="$PASS" pg_restore -h 127.0.0.1 -U dar_app -d dareltahfeez --no-owner --no-privileges "$DUMP"

echo "DUMP=$DUMP"
PGPASSWORD="$PASS" psql -h 127.0.0.1 -U dar_app -d dareltahfeez -tAc \
  "SELECT (SELECT count(*) FROM app_users) AS users, (SELECT count(*) FROM web_schema_migrations) AS web_migrations, (SELECT count(*) FROM students) AS students;"
