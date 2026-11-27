#!/usr/bin/env bash
# =============================================================================
# Dar database rollback - restore the pre-deploy backup into a FRESH database
# =============================================================================
# Purpose : when a deploy shipped a non-backward-compatible schema change (or a
#           data problem no forward fix can undo quickly), point the application
#           back at the data captured by the pre-deploy backup - WITHOUT ever
#           restoring over the live database.
#
# What it does (all steps are explicit, nothing runs automatically):
#   1. picks a pre-deploy backup: --backup PATH, else BACKUP_FILE from
#      /var/lib/dar/deploy/last-deploy.env, else the newest
#      /var/lib/dar/backups/db/dar-pre-deploy-*.dump.
#   2. verifies the archive (sha256 sidecar when present + pg_restore --list).
#   3. creates a NEW database `dar_rollback_<stamp>` owned by the application
#      role, restores the dump into it and verifies core tables/rows.
#   4. points /etc/dar/legacy.env, /etc/dar/api.env and /etc/dar/backup.env at
#      the new database (originals are copied to /var/backups/dar-config/).
#   5. restarts dar-legacy + dar-api (and dar-meet-bot when installed), waits for
#      /health/ready and records /var/lib/dar/deploy/last-rollback-db.env.
#   On a restart failure the env files are restored automatically; the restored
#   database is kept for diagnosis and the previous database is never dropped.
#
# Usage:
#   sudo bash deploy/rollback-db.sh --list
#   sudo bash deploy/rollback-db.sh                          # print the plan only
#   sudo bash deploy/rollback-db.sh --backup PATH --confirm  # execute
#   sudo bash deploy/rollback-db.sh --revert                 # back to the old DB
#
# Safety:
#   * NEVER touches/renames/drops the live database. The old database stays
#     intact and `--revert` only switches the env files back.
#   * --confirm is mandatory for every change; without it the script prints the
#     plan and exits 2.
#   * The target name must start with `dar_rollback_`; an existing non-empty
#     database with that name is refused.
#   * No secret is printed: credentials stay inside the existing env files.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${DAR_REPO_DIR:-$(cd -- "$SCRIPT_DIR/.." && pwd)}"
if [ ! -f "$REPO_DIR/deploy/.env" ] && [ -f /opt/dar/deploy/.env ]; then
  REPO_DIR=/opt/dar
fi
CONFIG_DIR="${DAR_CONFIG_DIR:-/etc/dar}"
BACKUP_DB_DIR="${DAR_BACKUP_DB_DIR:-/var/lib/dar/backups/db}"
STATE_DIR="${DAR_STATE_DIR:-/var/lib/dar/deploy}"
LOG_DIR="${DAR_LOG_DIR:-/var/log/dar}"
ENV_LEGACY="$CONFIG_DIR/legacy.env"
ENV_API="$CONFIG_DIR/api.env"
ENV_BACKUP="$CONFIG_DIR/backup.env"
STATE_FILE="$STATE_DIR/last-rollback-db.env"
STAMP="$(date +%Y%m%d-%H%M%S)"
TARGET_DB="dar_rollback_$STAMP"
BACKUP=""
CONFIRM=0
DRY_RUN=0
REVERT=0
LIST_ONLY=0
CURRENT_DB=""
APP_ROLE="dar_app"
TMP_DIR=""
CONFIG_BACKUP_DIR=""
ENV_REWRITTEN=0
SUCCESS=0
TMP_DUMP=""
LOG_FILE=""

usage() {
  cat <<'USAGE'
Usage: rollback-db.sh --list
       rollback-db.sh [--backup PATH] [--db-name dar_rollback_<name>] [--confirm] [--dry-run]
       rollback-db.sh --revert [--confirm]

  --list         List pre-deploy backups available for a DB rollback.
  --backup PATH  Dump to restore (default: last-deploy.env BACKUP_FILE, else newest
                 dar-pre-deploy-*.dump under /var/lib/dar/backups/db).
  --db-name NAME Fresh database name; must start with dar_rollback_ (default
                 dar_rollback_<stamp>).
  --confirm      Required to change anything. Without it the plan is printed and
                 the script exits 2.
  --dry-run      Print the plan; change nothing (same as no --confirm).
  --revert       Point the env files back at the database recorded by the last
                 successful rollback (never drops or restores anything).
  --help         Show this help.

The live database is never restored over, renamed or dropped.
USAGE
}

step() { printf '\n==> %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }
warn() { printf '    WARN: %s\n' "$*" >&2; }
fail() {
  printf '\nERROR: %s\n' "$*" >&2
  [ -n "$LOG_FILE" ] && printf 'Log: %s\n' "$LOG_FILE" >&2
  exit 1
}

while [ "$#" -gt 0 ]; do
  case "$1" in
  --list) LIST_ONLY=1; shift ;;
  --confirm) CONFIRM=1; shift ;;
  --dry-run) DRY_RUN=1; shift ;;
  --revert) REVERT=1; shift ;;
  --backup)
    [ "$#" -ge 2 ] || { echo "--backup requires a path" >&2; exit 2; }
    BACKUP="$2"; shift 2 ;;
  --db-name)
    [ "$#" -ge 2 ] || { echo "--db-name requires a value" >&2; exit 2; }
    TARGET_DB="$2"; shift 2 ;;
  --help | -h) usage; exit 0 ;;
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
    echo "rollback-db.sh must run as root or as a user with passwordless sudo." >&2
    exit 1
  fi
  SUDO="sudo"
fi

as_postgres() {
  if [ "$(id -u)" -eq 0 ]; then
    runuser -u postgres -- "$@"
  else
    sudo -n -u postgres -- "$@"
  fi
}

cleanup() {
  if [ -n "$TMP_DIR" ] && [ -d "$TMP_DIR" ]; then
    $SUDO rm -rf -- "$TMP_DIR" 2>/dev/null || true
  fi
  if [ "$ENV_REWRITTEN" -eq 1 ] && [ "$SUCCESS" -ne 1 ] && [ -n "$CONFIG_BACKUP_DIR" ]; then
    warn "restoring the original env files after the failed DB rollback"
    restore_env_files || true
    restart_services || true
  fi
}
trap cleanup EXIT

# Helper functions (backup selection/verification, fresh-DB restore checks, env
# rewriting, service restart, state file). Kept in deploy/lib to respect the file
# size budget; sourced here only.
LIB_DIR="$SCRIPT_DIR/lib"
[ -r "$LIB_DIR/rollback-db-helpers.sh" ] || {
  echo "Missing rollback helper library: $LIB_DIR/rollback-db-helpers.sh" >&2
  exit 1
}
# shellcheck source=SCRIPTDIR/lib/rollback-db-helpers.sh
. "$LIB_DIR/rollback-db-helpers.sh"
revert_mode() {
  $SUDO test -r "$STATE_FILE" || fail "no previous DB rollback recorded in $STATE_FILE"
  local previous config_backup
  previous="$($SUDO sed -n 's/^PREVIOUS_DATABASE=//p' "$STATE_FILE" | head -n 1)"
  config_backup="$($SUDO sed -n 's/^CONFIG_BACKUP_DIR=//p' "$STATE_FILE" | head -n 1)"
  if [ -z "$config_backup" ] || ! $SUDO test -d "$config_backup"; then
    fail "env backup from the last rollback is missing: ${config_backup:-unknown}"
  fi
  if [ "$CONFIRM" -ne 1 ]; then
    echo "DRY RUN - would restore the env files from $config_backup"
    echo "  current database : $($SUDO sed -n 's/.*Database=\([^;]*\).*/\1/p' "$ENV_LEGACY" 2>/dev/null | head -n 1)"
    echo "  previous database: ${previous:-unknown}"
    echo "  then restart dar-legacy + dar-api and wait for /health/ready"
    echo "REFUSING: pass --confirm to execute"
    exit 2
  fi
  CONFIG_BACKUP_DIR="$config_backup"
  step "Reverting env files"
  restore_env_files || fail "could not restore the env files from $config_backup"
  restart_services || fail "services did not become ready after --revert; inspect journalctl"
  SUCCESS=1
  echo "ROLLBACK_DB_REVERT_OK"
  echo "  database now: ${previous:-unknown} (the rollback database is kept for diagnosis)"
  exit 0
}

current_db_name
if [ "$LIST_ONLY" -eq 1 ]; then
  list_backups
  echo ""
  echo "Live database: $CURRENT_DB"
  exit 0
fi
if [ "$REVERT" -eq 1 ]; then
  revert_mode
fi
pick_backup
validate_target

if [ "$DRY_RUN" -eq 1 ] || [ "$CONFIRM" -ne 1 ]; then
  echo "======================================================================"
  echo " Dar DATABASE rollback (restore into a fresh database)"
  echo " live database : $CURRENT_DB  (never touched, never dropped)"
  echo " backup        : $BACKUP"
  echo " fresh database: $TARGET_DB  (owner $APP_ROLE)"
  echo " env files     : $ENV_LEGACY, $ENV_API, $ENV_BACKUP"
  echo " services      : dar-legacy + dar-api (+ dar-meet-bot when installed)"
  echo "======================================================================"
  echo "Steps that would run: verify archive -> createdb $TARGET_DB -> pg_restore ->"
  echo "verify core tables -> rewrite the env Database/PGDATABASE values -> restart"
  echo "services -> wait for /health/ready -> write $STATE_FILE."
  echo ""
  echo "REFUSING: this is a manual recovery step. Re-run with --confirm to execute."
  echo "  undo later with: sudo bash deploy/rollback-db.sh --revert --confirm"
  exit 2
fi

$SUDO install -d -m 0755 -o root -g root "$LOG_DIR"
LOG_FILE="$LOG_DIR/rollback-db-$STAMP.log"
if [ -n "$SUDO" ]; then
  exec > >($SUDO tee -a "$LOG_FILE") 2>&1
else
  exec > >(tee -a "$LOG_FILE") 2>&1
fi

step "Verify backup"
verify_backup
TMP_DIR="$(mktemp -d /tmp/dar-rollback-db.XXXXXXXX)"
# 711 so the postgres user can traverse to the 0600 dump it restores.
chmod 711 "$TMP_DIR"
TMP_DUMP="$TMP_DIR/pre-deploy.dump"
$SUDO cp -- "$BACKUP" "$TMP_DUMP"
$SUDO chmod 600 "$TMP_DUMP"
CONFIG_BACKUP_DIR="/var/backups/dar-config/rollback-db-$STAMP"

step "Create fresh database"
existing="$(as_postgres psql -X -q -tAc "SELECT 1 FROM pg_database WHERE datname = '$TARGET_DB'" 2>/dev/null || true)"
if [ "$existing" = "1" ]; then
  tables="$(as_postgres psql -X -q -tAc -d "$TARGET_DB" "SELECT count(*) FROM pg_tables WHERE schemaname = 'public';" 2>/dev/null || echo 1)"
  [ "$tables" = "0" ] || fail "database $TARGET_DB already exists with $tables public table(s); refusing to reuse it"
  info "existing empty database $TARGET_DB will be reused"
else
  as_postgres createdb -O "$APP_ROLE" "$TARGET_DB"
  info "created database $TARGET_DB owned by $APP_ROLE"
fi

step "Restore archive into $TARGET_DB"
$SUDO chown postgres:postgres "$TMP_DUMP"
if ! as_postgres pg_restore --no-owner --no-privileges --exit-on-error -d "$TARGET_DB" "$TMP_DUMP"; then
  fail "pg_restore failed; the live database was not modified and $TARGET_DB is kept for diagnosis"
fi
$SUDO rm -f -- "$TMP_DUMP"

step "Verify restored data"
migrations="$(as_postgres psql -X -q -tAc -d "$TARGET_DB" "SELECT count(*) FROM web_schema_migrations;" 2>/dev/null || echo 0)"
users="$(as_postgres psql -X -q -tAc -d "$TARGET_DB" "SELECT count(*) FROM app_users;" 2>/dev/null || echo 0)"
tables="$(as_postgres psql -X -q -tAc -d "$TARGET_DB" "SELECT count(*) FROM pg_tables WHERE schemaname = 'public';" 2>/dev/null || echo 0)"
info "tables=$tables web_schema_migrations=$migrations app_users=$users"
[ "$tables" -gt 0 ] || fail "restored database has no public tables; keeping the live database untouched"
[ "$migrations" -gt 0 ] || fail "restored database has an empty migration ledger"
[ "$users" -gt 0 ] || fail "restored database has no app_users rows"

step "Point the application at $TARGET_DB"
rewrite_env_files

step "Restart services"
if ! restart_services; then
  warn "services did not become ready on $TARGET_DB"
  restore_env_files
  restart_services || true
  fail "DB rollback failed the readiness check; env files restored to $CURRENT_DB, restored DB kept"
fi
SUCCESS=1
write_state "$CURRENT_DB"

echo ""
echo "ROLLBACK_DB_OK"
echo "  previous database : $CURRENT_DB (kept, never dropped)"
echo "  rollback database : $TARGET_DB"
echo "  backup            : $BACKUP"
echo "  env backup        : $CONFIG_BACKUP_DIR"
echo "  log               : $LOG_FILE"
echo "  revert (point back): sudo bash deploy/rollback-db.sh --revert --confirm"
echo "  after resolving   : verify, then retire $TARGET_DB manually when safe"
