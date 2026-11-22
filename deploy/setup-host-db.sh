#!/usr/bin/env bash
# =============================================================================
# Dar host database - safe restore of the production database (idempotent role)
# =============================================================================
# Purpose : create/refresh the dar_app role and restore the initial database
#           dump into the dareltahfeez database without risking live data.
# Requires: root, or the deploy user with passwordless sudo; PostgreSQL 17
#           running on 127.0.0.1:5432; a verified .dump file.
# Usage   : sudo bash deploy/setup-host-db.sh [--dump PATH] [--confirm-restore] [--force]
#
# Safety model:
#   * If dareltahfeez does not exist (or has no public tables) the dump is
#     restored directly into it. This is the fresh-host path.
#   * If dareltahfeez already has tables, the script takes a verified pg_dump
#     snapshot first (pg_restore --list + sha256) and refuses to continue
#     without --confirm-restore.
#   * With --confirm-restore but without --force it stops after the backup and
#     prints the exact command to run.
#   * With both flags it stops the Dar services, restores the dump into a new
#     dareltahfeez_restore_<stamp> database, compares per-table row counts with
#     the live database, then swaps the two databases by name and restarts the
#     services. The previous live database is kept as
#     dareltahfeez_pre_restore_<stamp> for a manual rollback.
#   * Secrets are read from deploy/.env and never echoed to the console.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${DAR_REPO_DIR:-$(cd -- "$SCRIPT_DIR/.." && pwd)}"
if [ ! -f "$REPO_DIR/deploy/.env" ] && [ -f /opt/dar/deploy/.env ]; then
  REPO_DIR=/opt/dar
fi
ENV_FILE="$REPO_DIR/deploy/.env"
BACKUP_DIR="${DAR_BACKUP_DB_DIR:-/var/lib/dar/backups/db}"
LIVE_DB="dareltahfeez"
RESTORE_PREFIX="dareltahfeez_restore"
PG_HOST="127.0.0.1"
PG_PORT="5432"
PG_USER="dar_app"
DUMP=""
CONFIRM_RESTORE=0
FORCE=0
STAMP="$(date +%Y%m%d-%H%M%S)"
STOPPED_SERVICES=""

usage() {
  cat <<'USAGE'
Usage: setup-host-db.sh [--dump PATH] [--confirm-restore] [--force]

  --dump PATH        Dump to restore (default: newest *.dump in
                     backups/pre-host-migration/).
  --confirm-restore  Required when dareltahfeez already has tables.
  --force            Required to actually restore over a non-empty database
                     (a verified snapshot is always taken first).
  --help             Show this help.

Restore always goes through a new dareltahfeez_restore_<stamp> database and a
verified row-count comparison before the names are swapped.
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
  --dump)
    [ "$#" -ge 2 ] || {
      echo "--dump requires a value" >&2
      exit 2
    }
    DUMP="$2"
    shift 2
    ;;
  --confirm-restore)
    CONFIRM_RESTORE=1
    shift
    ;;
  --force)
    FORCE=1
    shift
    ;;
  --help | -h)
    usage
    exit 0
    ;;
  *)
    echo "Unknown argument: $1" >&2
    usage >&2
    exit 2
    ;;
  esac
done

if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
else
  if ! sudo -n true 2>/dev/null; then
    echo "Run as root or as a user with passwordless sudo." >&2
    exit 1
  fi
  SUDO="sudo"
fi

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

as_postgres() {
  if [ -n "$SUDO" ]; then
    $SUDO -u postgres -- "$@"
  else
    runuser -u postgres -- "$@"
  fi
}

psql_super() {
  as_postgres psql -v ON_ERROR_STOP=1 -tAc "$1"
}

psql_super_db() {
  local database="$1"
  local sql="$2"
  as_postgres psql -v ON_ERROR_STOP=1 -d "$database" -tAc "$sql"
}

psql_app() {
  local database="$1"
  local sql="$2"
  run_pg psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$database" \
    -v ON_ERROR_STOP=1 -tAc "$sql"
}

stop_services() {
  local service
  for service in dar-legacy dar-api; do
    if $SUDO systemctl is-active --quiet "$service" 2>/dev/null; then
      echo "    stopping $service"
      $SUDO systemctl stop "$service"
      STOPPED_SERVICES="$STOPPED_SERVICES $service"
    fi
  done
}

start_services() {
  if [ -z "$STOPPED_SERVICES" ]; then
    return 0
  fi
  echo "==> Restarting services:$STOPPED_SERVICES"
  # shellcheck disable=SC2086
  $SUDO systemctl start $STOPPED_SERVICES
  STOPPED_SERVICES=""
}

on_exit() {
  if [ -n "$STOPPED_SERVICES" ]; then
    echo "Restoring service state after failure:$STOPPED_SERVICES" >&2
    # shellcheck disable=SC2086
    $SUDO systemctl start $STOPPED_SERVICES >/dev/null 2>&1 || true
  fi
}
trap on_exit EXIT

table_counts() {
  local database="$1"
  local table count
  while IFS= read -r table; do
    [ -n "$table" ] || continue
    count="$(psql_app "$database" "SELECT count(*) FROM \"$table\";")"
    printf '%s=%s\n' "$table" "$count"
  done < <(psql_app "$database" "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;")
}

verify_dump() {
  local file="$1"
  [ -f "$file" ] || fail "Dump file not found: $file"
  run_pg pg_restore --list "$file" >/dev/null 2>&1 || fail "Dump is not a readable pg_dump archive: $file"
}

echo "==> Environment"
[ -r "$ENV_FILE" ] || fail "Environment file not found: $ENV_FILE (copy deploy/.env.example to deploy/.env)."
PASS="$(sed -n 's/^POSTGRES_PASSWORD=//p' "$ENV_FILE" | head -n 1)"
[ -n "$PASS" ] || fail "POSTGRES_PASSWORD is missing from $ENV_FILE."
if [ "$PASS" = "change-me-hex" ]; then
  fail "POSTGRES_PASSWORD is still the example value in $ENV_FILE."
fi
case "$PASS" in
*"'"*) fail "POSTGRES_PASSWORD contains a single quote, which this script does not support." ;;
esac

run_pg() {
  $SUDO env PGPASSWORD="$PASS" "$@"
}

echo "==> PostgreSQL reachability"
pg_isready -h "$PG_HOST" -p "$PG_PORT" >/dev/null 2>&1 || fail "PostgreSQL is not accepting connections on $PG_HOST:$PG_PORT."

if [ -z "$DUMP" ]; then
  for candidate_dir in "$REPO_DIR/backups/pre-host-migration" /opt/dar/backups/pre-host-migration; do
    [ -d "$candidate_dir" ] || continue
    DUMP="$(ls -1t "$candidate_dir"/*.dump 2>/dev/null | head -n 1 || true)"
    [ -n "$DUMP" ] && break
  done
fi
[ -n "$DUMP" ] || fail "No dump found. Pass --dump PATH or put a .dump file in backups/pre-host-migration/."
verify_dump "$DUMP"
TOC_COUNT="$(run_pg pg_restore --list "$DUMP" | grep -c '^' || true)"
[ "$TOC_COUNT" -gt 0 ] || fail "Dump archive is empty: $DUMP"
echo "    dump : $DUMP"
echo "    toc  : $TOC_COUNT entries"

echo "==> dar_app role"
if [ "$(psql_super "SELECT 1 FROM pg_roles WHERE rolname = '$PG_USER'")" = "1" ]; then
  as_postgres psql -v ON_ERROR_STOP=1 <<SQL
ALTER ROLE $PG_USER WITH LOGIN PASSWORD '$PASS';
SQL
  echo "    role updated"
else
  as_postgres psql -v ON_ERROR_STOP=1 <<SQL
CREATE ROLE $PG_USER LOGIN PASSWORD '$PASS';
SQL
  echo "    role created"
fi

DB_EXISTS="$(psql_super "SELECT 1 FROM pg_database WHERE datname = '$LIVE_DB'")"
TABLE_COUNT=0
if [ "$DB_EXISTS" = "1" ]; then
  TABLE_COUNT="$(psql_super_db "$LIVE_DB" "SELECT count(*) FROM pg_tables WHERE schemaname = 'public';")"
fi

BACKUP_FILE=""
BACKUP_SHA=""
BACKUP_TOC=0
take_backup() {
  $SUDO install -d -m 0750 -o dar -g dar "$BACKUP_DIR"
  BACKUP_FILE="$BACKUP_DIR/dar-pre-restore-$STAMP.dump"
  echo "==> Mandatory pre-restore backup: $BACKUP_FILE"
  run_pg pg_dump -Fc -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" \
    -d "$LIVE_DB" -f "$BACKUP_FILE"
  $SUDO chown dar:dar "$BACKUP_FILE"
  $SUDO chmod 0640 "$BACKUP_FILE"
  run_pg pg_restore --list "$BACKUP_FILE" >/dev/null 2>&1 || fail "Pre-restore backup is not readable."
  BACKUP_TOC="$(run_pg pg_restore --list "$BACKUP_FILE" | grep -c '^' || true)"
  [ "$BACKUP_TOC" -gt 0 ] || fail "Pre-restore backup archive is empty."
  BACKUP_SHA="$($SUDO sha256sum "$BACKUP_FILE" | awk '{print $1}')"
  printf '%s  %s\n' "$BACKUP_SHA" "$(basename "$BACKUP_FILE")" | $SUDO tee "$BACKUP_FILE.sha256" >/dev/null
  $SUDO chown dar:dar "$BACKUP_FILE.sha256"
  $SUDO chmod 0640 "$BACKUP_FILE.sha256"
  echo "    backup sha256: $BACKUP_SHA"
  echo "    backup toc   : $BACKUP_TOC entries"
}

restore_into_new_database() {
  RESTORE_DB="${RESTORE_PREFIX}_$STAMP"
  echo "==> Restore copy: $RESTORE_DB"
  as_postgres dropdb --if-exists "$RESTORE_DB"
  as_postgres createdb -O "$PG_USER" "$RESTORE_DB"
  if ! run_pg pg_restore -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" \
    -d "$RESTORE_DB" --no-owner --no-privileges --exit-on-error "$DUMP"; then
    fail "Restore into $RESTORE_DB failed. Live database was not modified; restore copy kept for diagnosis."
  fi
  echo "    restored archive: $(basename "$DUMP")"
}

verify_restore_equals_live() {
  echo "==> Verify restored data against the live database"
  local restored_tables
  restored_tables="$(psql_app "$RESTORE_DB" "SELECT count(*) FROM pg_tables WHERE schemaname = 'public';")"
  [ "$restored_tables" = "$TABLE_COUNT" ] || fail "Table count mismatch: live=$TABLE_COUNT restored=$restored_tables."
  local users
  users="$(psql_app "$RESTORE_DB" "SELECT count(*) FROM app_users;" || true)"
  if [ -z "$users" ] || [ "$users" -le 0 ]; then
    fail "Restored database has no readable app_users table/rows; refusing to swap."
  fi
  if command -v diff >/dev/null 2>&1; then
    if ! diff <(table_counts "$LIVE_DB") <(table_counts "$RESTORE_DB") >/tmp/dar-restore-counts.diff 2>&1; then
      echo "Row-count differences found (live vs restored):" >&2
      sed -n '1,40p' /tmp/dar-restore-counts.diff >&2 || true
      fail "Row counts do not match; refusing to swap. Live database was not modified."
    fi
    rm -f /tmp/dar-restore-counts.diff
  else
    echo "    diff not available; compared table count and app_users only."
  fi
  echo "    app_users rows: $users"
}

swap_databases() {
  echo "==> Swap databases"
  PREV_DB="${LIVE_DB}_pre_restore_$STAMP"
  psql_super "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ('$LIVE_DB', '$RESTORE_DB') AND pid <> pg_backend_pid();" >/dev/null
  as_postgres psql -v ON_ERROR_STOP=1 -c "ALTER DATABASE $LIVE_DB RENAME TO $PREV_DB;"
  as_postgres psql -v ON_ERROR_STOP=1 -c "ALTER DATABASE $RESTORE_DB RENAME TO $LIVE_DB;"
  echo "    previous live database kept as: $PREV_DB"
}

if [ "$TABLE_COUNT" -gt 0 ]; then
  echo "==> Live database '$LIVE_DB' already contains $TABLE_COUNT public tables."
  if [ "$CONFIRM_RESTORE" -eq 1 ] && [ "$FORCE" -eq 1 ]; then
    stop_services
    take_backup
  else
    take_backup
    echo ""
    echo "Refusing to overwrite a non-empty live database without explicit flags."
    echo "A verified backup was written to:"
    echo "  $BACKUP_FILE"
    echo "  $BACKUP_FILE.sha256"
    echo ""
    echo "To continue, re-run with:"
    echo "  sudo bash deploy/setup-host-db.sh --dump \"$DUMP\" --confirm-restore --force"
    exit 3
  fi
  restore_into_new_database
  verify_restore_equals_live
  swap_databases
  start_services
  echo "==> Final smoke"
  if curl -fsS --max-time 10 http://127.0.0.1:5080/health/ready >/dev/null 2>&1; then
    echo "    dar-legacy /health/ready: OK"
  else
    echo "    WARN: dar-legacy /health/ready not OK (services may not be configured yet)." >&2
  fi
  if curl -fsS --max-time 10 http://127.0.0.1:5081/health/ready >/dev/null 2>&1; then
    echo "    dar-api /health/ready: OK"
  else
    echo "    WARN: dar-api /health/ready not OK (services may not be configured yet)." >&2
  fi
  echo ""
  echo "Rollback (manual, no data loss):"
  echo "  sudo -u postgres psql -d postgres -c \"ALTER DATABASE $LIVE_DB RENAME TO ${LIVE_DB}_restored_$STAMP;\""
  echo "  sudo -u postgres psql -d postgres -c \"ALTER DATABASE $PREV_DB RENAME TO $LIVE_DB;\""
else
  echo "==> Fresh database path (no public tables in '$LIVE_DB')."
  if [ "$DB_EXISTS" != "1" ]; then
    as_postgres createdb -O "$PG_USER" "$LIVE_DB"
    echo "    created database $LIVE_DB owned by $PG_USER"
  fi
  if ! run_pg pg_restore -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" \
    -d "$LIVE_DB" --no-owner --no-privileges --exit-on-error "$DUMP"; then
    fail "Restore into $LIVE_DB failed. Inspect the database before retrying."
  fi
  TABLE_COUNT="$(psql_app "$LIVE_DB" "SELECT count(*) FROM pg_tables WHERE schemaname = 'public';")"
  [ "$TABLE_COUNT" -gt 0 ] || fail "Restore finished but no public tables were created."
  USERS="$(psql_app "$LIVE_DB" "SELECT count(*) FROM app_users;" || true)"
  MIGRATIONS="$(psql_app "$LIVE_DB" "SELECT count(*) FROM web_schema_migrations;" 2>/dev/null || echo "n/a")"
  echo "    tables      : $TABLE_COUNT"
  echo "    app_users   : $USERS"
  echo "    migrations  : $MIGRATIONS"
fi

echo ""
echo "DB_RESTORE_OK stamp=$STAMP"
echo "  dump      : $DUMP"
echo "  toc       : $TOC_COUNT"
if [ -n "$BACKUP_FILE" ]; then
  echo "  pre-backup: $BACKUP_FILE"
  echo "  sha256    : $BACKUP_SHA"
fi
