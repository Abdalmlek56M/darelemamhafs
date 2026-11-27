#!/usr/bin/env bash
# =============================================================================
# Dar database roles - create/refresh dar_migrator, dar_app and dar_read_only
# =============================================================================
# Purpose : apply deploy/sql/db-roles.sql with the passwords kept in the untracked
#           deploy/.env. Additive: the running app keeps using dar_app; no
#           connection string changes and no database restart happen here.
# Requires: root (or passwordless sudo), host PostgreSQL 17, deploy/.env.
# Usage   : sudo bash deploy/setup-host-db-roles.sh                 # plan only
#           sudo bash deploy/setup-host-db-roles.sh --confirm       # apply
#           sudo bash deploy/setup-host-db-roles.sh --confirm --transfer-ownership
# Safety:
#   * Every change needs --confirm; without it the plan is printed and exit is 2.
#   * Passwords are never printed and never appear on a command line: the psql
#     prelude is written into a 0600 temp file and piped on stdin.
#   * Missing migrator/read-only passwords are generated with openssl and appended
#     to the untracked, git-ignored deploy/.env (mode 600).
#   * --transfer-ownership moves the database + public schema owner to dar_migrator
#     so future migrations (run as dar_migrator) own their objects. Optional and
#     explicit: the runtime dar_app role keeps working either way.
# Docs    : docs/runbooks/db-roles-and-tuning.md
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${DAR_REPO_DIR:-$(cd -- "$SCRIPT_DIR/.." && pwd)}"
if [ ! -f "$REPO_DIR/deploy/.env" ] && [ -f /opt/dar/deploy/.env ]; then
  REPO_DIR=/opt/dar
fi
ENV_FILE="$REPO_DIR/deploy/.env"
ROLES_SQL="$SCRIPT_DIR/sql/db-roles.sql"
DB_NAME=""
CONFIRM=0
DRY_RUN=0
TRANSFER_OWNERSHIP=0
TMP_SQL=""
CMD_LOG=""

usage() {
  cat <<'USAGE'
Usage: setup-host-db-roles.sh [--database NAME] [--confirm] [--dry-run]
                              [--transfer-ownership]

  --database NAME       Target database (default POSTGRES_DB from deploy/.env).
  --confirm             Required to change anything.
  --dry-run             Print the plan; change nothing (same as no --confirm).
  --transfer-ownership  Also make dar_migrator the owner of the database and the
                        public schema (future migrations own their objects).
  --help                Show this help.

Passwords come from deploy/.env:
  DB_APP_PASSWORD       (default: POSTGRES_PASSWORD - keeps the running app working)
  DB_MIGRATOR_PASSWORD  (generated + appended to deploy/.env when missing)
  DB_READ_ONLY_PASSWORD (generated + appended to deploy/.env when missing)
Nothing is printed from these values.
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
  --database)
    [ "$#" -ge 2 ] || { echo "--database requires a value" >&2; exit 2; }
    DB_NAME="$2"
    shift 2
    ;;
  --confirm) CONFIRM=1; shift ;;
  --dry-run) DRY_RUN=1; shift ;;
  --transfer-ownership) TRANSFER_OWNERSHIP=1; shift ;;
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
    echo "Run as root or as a user with passwordless sudo." >&2
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
  unset MIGRATOR_PASSWORD APP_PASSWORD READ_ONLY_PASSWORD 2>/dev/null || true
  if [ -n "$TMP_SQL" ] && [ -f "$TMP_SQL" ]; then
    rm -f -- "$TMP_SQL" 2>/dev/null || true
  fi
  if [ -n "$CMD_LOG" ] && [ -f "$CMD_LOG" ]; then
    rm -f -- "$CMD_LOG" 2>/dev/null || true
  fi
}
trap cleanup EXIT

env_value() { # env_value <KEY>
  sed -n "s/^$1=//p" "$ENV_FILE" 2>/dev/null | head -n 1
}

persist_generated_secret() { # persist_generated_secret <KEY> <VALUE>
  if grep -q "^$1=" "$ENV_FILE" 2>/dev/null; then
    $SUDO sed -i "s|^$1=.*|$1=$2|" "$ENV_FILE"
  else
    printf '\n%s=%s\n' "$1" "$2" | $SUDO tee -a "$ENV_FILE" >/dev/null
  fi
  $SUDO chmod 0600 "$ENV_FILE"
}

[ -r "$ENV_FILE" ] || {
  echo "Environment file not found: $ENV_FILE (copy deploy/.env.example to deploy/.env)." >&2
  exit 1
}
[ -r "$ROLES_SQL" ] || {
  echo "Roles SQL not found: $ROLES_SQL" >&2
  exit 1
}
command -v psql >/dev/null 2>&1 || { echo "psql is required." >&2; exit 1; }
command -v openssl >/dev/null 2>&1 || { echo "openssl is required to generate passwords." >&2; exit 1; }

[ -n "$DB_NAME" ] || DB_NAME="$(env_value POSTGRES_DB)"
[ -n "$DB_NAME" ] || {
  echo "POSTGRES_DB is missing from $ENV_FILE; pass --database NAME." >&2
  exit 1
}
printf '%s' "$DB_NAME" | grep -Eq '^[a-z][a-z0-9_]{0,62}$' || {
  echo "Invalid database name: '$DB_NAME' (expected lowercase letters, digits, underscore)." >&2
  exit 2
}
APPLICATION_USER="$(env_value POSTGRES_USER)"
APPLICATION_USER="${APPLICATION_USER:-dar_app}"
APP_PASSWORD="$(env_value DB_APP_PASSWORD)"
[ -n "$APP_PASSWORD" ] || APP_PASSWORD="$(env_value POSTGRES_PASSWORD)"
if [ -z "$APP_PASSWORD" ] || [ "$APP_PASSWORD" = "change-me-hex" ]; then
  echo "DB_APP_PASSWORD / POSTGRES_PASSWORD is missing or still the example value in $ENV_FILE." >&2
  exit 1
fi
MIGRATOR_PASSWORD="$(env_value DB_MIGRATOR_PASSWORD)"
READ_ONLY_PASSWORD="$(env_value DB_READ_ONLY_PASSWORD)"
GENERATE_MIGRATOR=0
GENERATE_READ_ONLY=0
[ -n "$MIGRATOR_PASSWORD" ] || GENERATE_MIGRATOR=1
[ -n "$READ_ONLY_PASSWORD" ] || GENERATE_READ_ONLY=1

if [ "$APPLICATION_USER" != "dar_app" ]; then
  echo "WARN: POSTGRES_USER=$APPLICATION_USER in $ENV_FILE but this script manages the dar_app role." >&2
fi

db_exists="$(as_postgres psql -X -q -tAc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" 2>/dev/null || true)"
[ "$db_exists" = "1" ] || {
  echo "Database '$DB_NAME' does not exist; run deploy/setup-host-db.sh first." >&2
  exit 1
}

echo "======================================================================"
echo " Dar database roles"
echo " database     : $DB_NAME"
echo " roles        : dar_migrator (DDL), dar_app (DML), dar_read_only (SELECT-only)"
echo " app password : from DB_APP_PASSWORD / POSTGRES_PASSWORD in $ENV_FILE (not printed)"
if [ "$GENERATE_MIGRATOR" -eq 1 ]; then
  echo " migrator pwd : will be generated and appended to $ENV_FILE"
else
  echo " migrator pwd : DB_MIGRATOR_PASSWORD from $ENV_FILE"
fi
if [ "$GENERATE_READ_ONLY" -eq 1 ]; then
  echo " read-only pwd: will be generated and appended to $ENV_FILE"
else
  echo " read-only pwd: DB_READ_ONLY_PASSWORD from $ENV_FILE"
fi
echo " ownership    : $([ "$TRANSFER_OWNERSHIP" -eq 1 ] && echo "transfer DB+public schema to dar_migrator (explicit flag)" || echo "unchanged (additive grants only)")"
echo "======================================================================"

if [ "$DRY_RUN" -eq 1 ] || [ "$CONFIRM" -ne 1 ]; then
  echo "Would run deploy/sql/db-roles.sql via psql on $DB_NAME and re-apply grants."
  if [ "$TRANSFER_OWNERSHIP" -eq 1 ]; then
    echo "Then: ALTER DATABASE $DB_NAME OWNER TO dar_migrator; ALTER SCHEMA public OWNER TO dar_migrator;"
  fi
  echo "Nothing was changed."
  echo "REFUSING: re-run with --confirm to execute."
  exit 2
fi

if [ "$GENERATE_MIGRATOR" -eq 1 ]; then
  MIGRATOR_PASSWORD="$(openssl rand -hex 24)"
fi
if [ "$GENERATE_READ_ONLY" -eq 1 ]; then
  READ_ONLY_PASSWORD="$(openssl rand -hex 24)"
fi

# Secrets never reach argv: they are written as psql \set lines into a 0600 file
# whose content is piped to `psql -f -`.
TMP_SQL="$(mktemp)"
chmod 0600 "$TMP_SQL"
{
  printf "\\set migrator_password '%s'\n" "$MIGRATOR_PASSWORD"
  printf "\\set app_password '%s'\n" "$APP_PASSWORD"
  printf "\\set read_only_password '%s'\n" "$READ_ONLY_PASSWORD"
  printf "\\set db_name '%s'\n" "$DB_NAME"
  cat "$ROLES_SQL"
} >"$TMP_SQL"

echo ""
echo "==> Apply roles + grants"
if ! as_postgres psql -X -q -v ON_ERROR_STOP=1 -f - <"$TMP_SQL"; then
  echo "ERROR: applying db-roles.sql failed; no partial commit was kept (single transaction)." >&2
  exit 1
fi
rm -f -- "$TMP_SQL"
TMP_SQL=""
unset APP_PASSWORD

if [ "$GENERATE_MIGRATOR" -eq 1 ]; then
  persist_generated_secret DB_MIGRATOR_PASSWORD "$MIGRATOR_PASSWORD"
  echo "    generated DB_MIGRATOR_PASSWORD and appended it to $ENV_FILE (mode 600, git-ignored)"
fi
if [ "$GENERATE_READ_ONLY" -eq 1 ]; then
  persist_generated_secret DB_READ_ONLY_PASSWORD "$READ_ONLY_PASSWORD"
  echo "    generated DB_READ_ONLY_PASSWORD and appended it to $ENV_FILE (mode 600, git-ignored)"
fi
if [ "$TRANSFER_OWNERSHIP" -eq 1 ]; then
  echo ""
  echo "==> Transfer database/public schema ownership to dar_migrator"
  CMD_LOG="$(mktemp)"
  chmod 0600 "$CMD_LOG"
  if ! as_postgres psql -X -q -v ON_ERROR_STOP=1 -c "ALTER DATABASE \"$DB_NAME\" OWNER TO dar_migrator;" >"$CMD_LOG" 2>&1; then
    cat "$CMD_LOG" >&2
    echo "ERROR: database ownership transfer failed; run without --transfer-ownership to keep the additive setup." >&2
    exit 1
  fi
  if ! as_postgres psql -X -q -v ON_ERROR_STOP=1 -d "$DB_NAME" -c "ALTER SCHEMA public OWNER TO dar_migrator;" >>"$CMD_LOG" 2>&1; then
    cat "$CMD_LOG" >&2
    echo "ERROR: schema ownership transfer failed; the roles and grants above are already applied." >&2
    exit 1
  fi
  rm -f -- "$CMD_LOG"
  CMD_LOG=""
  echo "    database + public schema are now owned by dar_migrator"
fi
unset MIGRATOR_PASSWORD READ_ONLY_PASSWORD

echo ""
echo "==> Verify"
roles="$(as_postgres psql -X -q -tAc "SELECT string_agg(rolname, ',' ORDER BY rolname) FROM pg_roles WHERE rolname IN ('dar_migrator','dar_app','dar_read_only');")"
echo "    roles present: $roles"
[ "$roles" = "dar_app,dar_migrator,dar_read_only" ] || {
  echo "ERROR: expected exactly dar_app,dar_migrator,dar_read_only (got '$roles')." >&2
  exit 1
}
echo ""
echo "DB_ROLES_OK database=$DB_NAME"
echo "  note: connection strings are unchanged (runtime keeps using dar_app);"
echo "        apply migrations with dar_migrator when ready, then update the env files."
echo "  docs: docs/runbooks/db-roles-and-tuning.md"
