#!/usr/bin/env bash
# =============================================================================
# Dar production update - backup, pull, build, migrate, swap, smoke, roll back
# =============================================================================
# Purpose : one safe command to deploy the current origin/main commit to the
#           production host (Ubuntu 24.04 + Nginx + systemd + PostgreSQL 17).
# Requires: root, or the deploy user with passwordless sudo.
#           A git checkout at /opt/dar tracking origin/main.
#           deploy/.env, /etc/dar/api.env, published backup timer.
# Usage   : sudo bash deploy/update.sh [--dry-run] [--skip-build] [--allow-stopped-services]
#
# Order of operations (never reordered):
#   1. preflight (deploy/preflight.sh) - read-only checks, abort on blockers.
#   2. mandatory database backup: pg_dump -Fc + pg_restore --list + sha256.
#   3. git pull --ff-only (aborts on dirty tree or diverged history).
#   4. build: npm ci + npm run build, dotnet publish legacy + api.
#   5. migrations: dotnet run --project src/Host/Dar.Api -- --migrate.
#   6. verify web_schema_migrations count equals database/*.sql count.
#   7. stop services, swap binaries, start services.
#   8. smoke: /health/ready (5080 + 5081), /, /management, /teacher,
#      /supervisor, /api/v1/ping. On failure: automatic binary rollback.
#   9. retention: keep the last 5 app copies and 30 days of pre-deploy dumps.
#  10. succinct summary + log path + rollback command.
#
# Safety:
#   * The database is never rolled back automatically. Migrations are additive;
#     a failed binary swap is undone with the previous binaries while the schema
#     stays forward-compatible.
#   * No secret is ever printed. Database credentials are read from
#     /etc/dar/backup.env (preferred) or /etc/dar/api.env.
#   * --dry-run prints the plan and changes nothing.
#   * --skip-build reuses app/legacy.new + app/api.new from a previous interrupted run.
#   * --allow-stopped-services is only for the very first deploy.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${DAR_REPO_DIR:-$(cd -- "$SCRIPT_DIR/.." && pwd)}"
if [ ! -f "$REPO_DIR/deploy/.env" ] && [ -f /opt/dar/deploy/.env ]; then
  REPO_DIR=/opt/dar
fi
ENV_FILE="$REPO_DIR/deploy/.env"
CONFIG_DIR="${DAR_CONFIG_DIR:-/etc/dar}"
APP_ROOT="${DAR_APP_ROOT:-/opt/dar/app}"
BACKUP_DB_DIR="${DAR_BACKUP_DB_DIR:-/var/lib/dar/backups/db}"
LOG_DIR="${DAR_LOG_DIR:-/var/log/dar}"
STATE_DIR="${DAR_STATE_DIR:-/var/lib/dar/deploy}"
SERVICES="dar-legacy dar-api"
DRY_RUN=0
SKIP_BUILD=0
ALLOW_STOPPED=0
STAMP="$(date +%Y%m%d-%H%M%S)"
LOG_FILE="$LOG_DIR/update-$STAMP.log"
BEFORE_COMMIT=""
AFTER_COMMIT=""
DUMP_FILE=""
DUMP_SHA=""
DUMP_TOC=0
MIGRATIONS_COUNT=""
OLD_LEGACY=""
OLD_API=""
SWAPPED=0
SERVICES_STOPPED=0

usage() {
  cat <<'USAGE'
Usage: update.sh [--dry-run] [--skip-build] [--allow-stopped-services]

  --dry-run                   Print the deployment plan; change nothing.
  --skip-build                Reuse app/legacy.new + app/api.new from a
                              previous interrupted run and skip npm/dotnet builds.
  --allow-stopped-services    Do not fail when services are not running yet
                              (first deploy only).
  --help                      Show this help.

Exit codes: 0 success or up-to-date, 1 failure (binaries rolled back when the
swap had already happened), 2 usage error.
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
  --dry-run)
    DRY_RUN=1
    shift
    ;;
  --skip-build)
    SKIP_BUILD=1
    shift
    ;;
  --allow-stopped-services)
    ALLOW_STOPPED=1
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
    echo "update.sh must run as root or as a user with passwordless sudo." >&2
    exit 1
  fi
  SUDO="sudo"
fi

REPO_OWNER="$(stat -c '%U' "$REPO_DIR" 2>/dev/null || echo root)"
REPO_OWNER_HOME="$(getent passwd "$REPO_OWNER" 2>/dev/null | cut -d: -f6 || true)"
[ -n "$REPO_OWNER_HOME" ] || REPO_OWNER_HOME="/home/$REPO_OWNER"
run_as_owner() {
  if [ "$(id -u)" -eq 0 ] && [ "$REPO_OWNER" != "root" ]; then
    runuser -u "$REPO_OWNER" -- env HOME="$REPO_OWNER_HOME" USER="$REPO_OWNER" LOGNAME="$REPO_OWNER" "$@"
  else
    "$@"
  fi
}

if [ "$DRY_RUN" -eq 0 ]; then
  $SUDO install -d -m 0755 -o root -g root "$LOG_DIR"
  if [ -n "$SUDO" ]; then
    exec > >($SUDO tee -a "$LOG_FILE") 2>&1
  else
    exec > >(tee -a "$LOG_FILE") 2>&1
  fi
fi

step() {
  printf '\n==> %s\n' "$*"
}

info() {
  printf '    %s\n' "$*"
}

warn() {
  printf '    WARN: %s\n' "$*" >&2
}

fail() {
  printf '\nERROR: %s\n' "$*" >&2
  printf 'Log: %s\n' "$LOG_FILE" >&2
  exit 1
}

on_exit() {
  if [ "$SWAPPED" -eq 1 ]; then
    printf '\nWARN: update exited while new binaries were live. Run deploy/rollback.sh %s to revert binaries.\n' "$STAMP" >&2
  elif [ "$SERVICES_STOPPED" -eq 1 ]; then
    printf '\nWARN: update exited with the services stopped; restarting them with the previous binaries.\n' >&2
    $SUDO systemctl start dar-legacy.service dar-api.service >/dev/null 2>&1 || true
    SERVICES_STOPPED=0
  fi
}
trap on_exit EXIT

# -----------------------------------------------------------------------------
# Credentials (never printed)
# -----------------------------------------------------------------------------
PGHOST="127.0.0.1"
PGPORT="5432"
PGDATABASE="dareltahfeez"
PGUSER="dar_app"
PGPASSWORD=""
CONNECTION_STRING=""

load_db_credentials() {
  step "Database credentials"
  if [ -f "$CONFIG_DIR/backup.env" ]; then
    backup_env_content="$($SUDO cat "$CONFIG_DIR/backup.env" 2>/dev/null || true)"
    while IFS= read -r line; do
      case "$line" in
      "" | \#*) continue ;;
      esac
      key="${line%%=*}"
      value="${line#*=}"
      case "$key" in
      PGHOST) PGHOST="$value" ;;
      PGPORT) PGPORT="$value" ;;
      PGDATABASE) PGDATABASE="$value" ;;
      PGUSER) PGUSER="$value" ;;
      PGPASSWORD) PGPASSWORD="$value" ;;
      esac
    done <<<"$backup_env_content"
  fi
  if [ -z "$PGPASSWORD" ] && [ -f "$CONFIG_DIR/api.env" ]; then
    connection="$($SUDO sed -n 's/^ConnectionStrings__Default=//p' "$CONFIG_DIR/api.env" | head -n 1)"
    if [ -n "$connection" ]; then
      local_ifs="$IFS"
      IFS=';'
      for part in $connection; do
        key="${part%%=*}"
        value="${part#*=}"
        case "$key" in
        Host | host) PGHOST="$value" ;;
        Port | port) PGPORT="$value" ;;
        Database | database) PGDATABASE="$value" ;;
        Username | username | User | user) PGUSER="$value" ;;
        Password | password) PGPASSWORD="$value" ;;
        esac
      done
      IFS="$local_ifs"
    fi
  fi
  if [ -z "$PGPASSWORD" ]; then
    warn "could not read the database password from $CONFIG_DIR/backup.env or $CONFIG_DIR/api.env"
    return 1
  fi
  case "$PGPASSWORD" in
  *"'"*) fail "database password contains a single quote; unsupported by this script." ;;
  esac
  CONNECTION_STRING="Host=$PGHOST;Port=$PGPORT;Database=$PGDATABASE;Username=$PGUSER;Password=$PGPASSWORD"
  info "database: $PGDATABASE@$PGHOST:$PGPORT (user $PGUSER)"
  return 0
}

run_pg() {
  $SUDO env PGPASSWORD="$PGPASSWORD" "$@"
}

psql_value() {
  local database="$1"
  local sql="$2"
  run_pg psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$database" -v ON_ERROR_STOP=1 -tAc "$sql"
}

# -----------------------------------------------------------------------------
# Preflight
# -----------------------------------------------------------------------------
run_preflight() {
  step "Preflight"
  [ -d "$REPO_DIR/.git" ] || fail "not a git checkout: $REPO_DIR"
  [ -f "$ENV_FILE" ] || fail "deploy/.env is missing (copy deploy/.env.example)."
  branch="$(git -C "$REPO_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
  [ "$branch" = "main" ] || fail "current branch is '$branch', expected main"
  if [ -n "$(git -C "$REPO_DIR" status --porcelain --untracked-files=no 2>/dev/null || true)" ]; then
    fail "working tree has uncommitted tracked changes; commit or discard them first"
  fi
  preflight_args=()
  if [ "$ALLOW_STOPPED" -eq 1 ]; then
    preflight_args+=(--allow-inactive)
  fi
  if [ -f "$SCRIPT_DIR/preflight.sh" ]; then
    if ! bash "$SCRIPT_DIR/preflight.sh" "${preflight_args[@]}"; then
      if [ "$DRY_RUN" -eq 1 ]; then
        warn "preflight reported blockers; dry run continues with the plan only"
      else
        fail "preflight reported blockers, deployment aborted before any change"
      fi
    fi
  else
    warn "deploy/preflight.sh not found; continuing with basic checks only"
  fi
}

# -----------------------------------------------------------------------------
# Database backup
# -----------------------------------------------------------------------------
take_db_backup() {
  step "Mandatory database backup"
  $SUDO install -d -m 0750 -o dar -g dar "$BACKUP_DB_DIR"
  DUMP_FILE="$BACKUP_DB_DIR/dar-pre-deploy-$STAMP.dump"
  run_pg pg_dump -Fc -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -f "$DUMP_FILE"
  $SUDO chown dar:dar "$DUMP_FILE"
  $SUDO chmod 0640 "$DUMP_FILE"
  run_pg pg_restore --list "$DUMP_FILE" >/dev/null 2>&1 || fail "backup archive is not readable: $DUMP_FILE"
  DUMP_TOC="$(run_pg pg_restore --list "$DUMP_FILE" | grep -c '^' || true)"
  [ "$DUMP_TOC" -gt 0 ] || fail "backup archive is empty: $DUMP_FILE"
  DUMP_SHA="$($SUDO sha256sum "$DUMP_FILE" | awk '{print $1}')"
  printf '%s  %s\n' "$DUMP_SHA" "$(basename "$DUMP_FILE")" | $SUDO tee "$DUMP_FILE.sha256" >/dev/null
  $SUDO chown dar:dar "$DUMP_FILE.sha256"
  $SUDO chmod 0640 "$DUMP_FILE.sha256"
  info "dump : $DUMP_FILE"
  info "size : $($SUDO du -h "$DUMP_FILE" | cut -f1)"
  info "toc  : $DUMP_TOC entries"
  info "sha  : $DUMP_SHA"
}

# -----------------------------------------------------------------------------
# Git update
# -----------------------------------------------------------------------------
git_update() {
  step "Git pull --ff-only"
  BEFORE_COMMIT="$(git -C "$REPO_DIR" rev-parse HEAD)"
  info "before: $(git -C "$REPO_DIR" log -1 --oneline)"
  run_as_owner git -C "$REPO_DIR" pull --ff-only
  AFTER_COMMIT="$(git -C "$REPO_DIR" rev-parse HEAD)"
  info "after : $(git -C "$REPO_DIR" log -1 --oneline)"
  if [ "$BEFORE_COMMIT" = "$AFTER_COMMIT" ]; then
    info "origin/main is already deployed; nothing to build."
    info "the mandatory backup was still refreshed: $DUMP_FILE"
    echo "UPDATE_NO_CHANGES commit=$AFTER_COMMIT"
    echo "  backup: $DUMP_FILE"
    echo "  log   : $LOG_FILE"
    exit 0
  fi
}

# -----------------------------------------------------------------------------
# Build + staging
# -----------------------------------------------------------------------------
build_and_stage() {
  step "Build and stage binaries"
  LEGACY_NEW="$APP_ROOT/legacy.new"
  API_NEW="$APP_ROOT/api.new"
  if [ "$SKIP_BUILD" -eq 1 ]; then
    [ -d "$LEGACY_NEW" ] || fail "--skip-build: $LEGACY_NEW does not exist; run once without --skip-build"
    [ -d "$API_NEW" ] || fail "--skip-build: $API_NEW does not exist; run once without --skip-build"
    info "reusing prepared artifacts: $LEGACY_NEW and $API_NEW"
  else
    $SUDO install -d -m 0755 -o "$REPO_OWNER" -g "$REPO_OWNER" "$APP_ROOT"
    if [ -e "$LEGACY_NEW" ] || [ -e "$API_NEW" ]; then
      fail "stale $LEGACY_NEW or $API_NEW exists; remove it or rerun with --skip-build"
    fi
    $SUDO install -d -m 0755 -o "$REPO_OWNER" -g "$REPO_OWNER" "$LEGACY_NEW"
    $SUDO install -d -m 0755 -o "$REPO_OWNER" -g "$REPO_OWNER" "$API_NEW"
    info "frontend: npm ci + npm run build"
    run_as_owner npm ci --prefix "$REPO_DIR/frontend" --no-audit --no-fund
    run_as_owner npm run build --prefix "$REPO_DIR/frontend"
    info "backend: dotnet publish legacy -> $LEGACY_NEW"
    run_as_owner dotnet publish "$REPO_DIR/backend/DarEltahfeez.Api/DarEltahfeez.Api.csproj" \
      -c Release -o "$LEGACY_NEW" --nologo
    info "backend: dotnet publish api -> $API_NEW"
    run_as_owner dotnet publish "$REPO_DIR/src/Host/Dar.Api/Dar.Api.csproj" \
      -c Release -o "$API_NEW" --nologo
    info "frontend: copy dist into legacy wwwroot"
    run_as_owner mkdir -p "$LEGACY_NEW/wwwroot"
    run_as_owner cp -a "$REPO_DIR/frontend/dist/." "$LEGACY_NEW/wwwroot/"
    run_as_owner tee "$LEGACY_NEW/.deploy-meta" >/dev/null <<EOF
DEPLOY_STAMP=$STAMP
DEPLOY_COMMIT=$AFTER_COMMIT
DEPLOY_AT=$(date -Is)
DEPLOY_BACKUP=$DUMP_FILE
EOF
    run_as_owner cp "$LEGACY_NEW/.deploy-meta" "$API_NEW/.deploy-meta"
  fi
  [ -f "$LEGACY_NEW/DarEltahfeez.Api.dll" ] || fail "legacy publish output is missing DarEltahfeez.Api.dll"
  [ -f "$API_NEW/Dar.Api.dll" ] || fail "api publish output is missing Dar.Api.dll"
  [ -f "$LEGACY_NEW/wwwroot/index.html" ] || fail "frontend build output is missing index.html"
  if [ -d "$API_NEW/database" ]; then
    info "migration files staged with the api"
  else
    warn "api publish output has no database/ folder; --migrate will fail"
  fi
}

# -----------------------------------------------------------------------------
# Migrations
# -----------------------------------------------------------------------------
apply_migrations() {
  step "Database migrations"
  files_count="$(find "$REPO_DIR/database" -maxdepth 1 -type f -name '*.sql' | wc -l | tr -d ' ')"
  info "migration files in repository: $files_count"
  run_as_owner env ASPNETCORE_ENVIRONMENT=Production \
    ConnectionStrings__Default="$CONNECTION_STRING" \
    DOTNET_CLI_TELEMETRY_OPTOUT=1 \
    dotnet run -c Release --project "$REPO_DIR/src/Host/Dar.Api/Dar.Api.csproj" \
    --no-launch-profile -- --migrate
  applied_count="$(psql_value "$PGDATABASE" "SELECT count(*) FROM web_schema_migrations;")"
  info "web_schema_migrations rows: $applied_count"
  if [ "$applied_count" != "$files_count" ]; then
    fail "migration ledger mismatch (ledger=$applied_count files=$files_count); aborted before swapping binaries"
  fi
  MIGRATIONS_COUNT="$applied_count"
}

# -----------------------------------------------------------------------------
# Swap / rollback / smoke
# -----------------------------------------------------------------------------
stop_services() {
  SERVICES_STOPPED=1
  $SUDO systemctl stop dar-legacy.service dar-api.service || true
}

start_services() {
  $SUDO systemctl start dar-legacy.service dar-api.service || true
  if $SUDO systemctl is-active --quiet dar-legacy.service && $SUDO systemctl is-active --quiet dar-api.service; then
    SERVICES_STOPPED=0
  fi
}

wait_ready() {
  local url="$1"
  local deadline=$((SECONDS + 90))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if curl -fsS --max-time 5 "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  return 1
}

swap_binaries() {
  step "Swap binaries"
  $SUDO install -d -m 0755 -o dar -g dar "$APP_ROOT"
  if [ -d "$APP_ROOT/legacy" ]; then
    OLD_LEGACY="$APP_ROOT/legacy.old.$STAMP"
    $SUDO mv "$APP_ROOT/legacy" "$OLD_LEGACY"
    info "previous legacy kept at $OLD_LEGACY"
  fi
  if [ -d "$APP_ROOT/api" ]; then
    OLD_API="$APP_ROOT/api.old.$STAMP"
    $SUDO mv "$APP_ROOT/api" "$OLD_API"
    info "previous api kept at $OLD_API"
  fi
  if ! $SUDO mv "$APP_ROOT/legacy.new" "$APP_ROOT/legacy"; then
    if [ -n "$OLD_LEGACY" ] && [ -d "$OLD_LEGACY" ]; then
      $SUDO mv "$OLD_LEGACY" "$APP_ROOT/legacy" || true
    fi
    fail "could not move the new legacy binaries into place"
  fi
  if ! $SUDO mv "$APP_ROOT/api.new" "$APP_ROOT/api"; then
    $SUDO mv "$APP_ROOT/legacy" "$APP_ROOT/legacy.failed.$STAMP" || true
    if [ -n "$OLD_LEGACY" ] && [ -d "$OLD_LEGACY" ]; then
      $SUDO mv "$OLD_LEGACY" "$APP_ROOT/legacy" || true
    fi
    if [ -n "$OLD_API" ] && [ -d "$OLD_API" ]; then
      $SUDO mv "$OLD_API" "$APP_ROOT/api" || true
    fi
    fail "could not move the new api binaries into place"
  fi
  $SUDO chown -R dar:dar "$APP_ROOT/legacy" "$APP_ROOT/api"
  SWAPPED=1
}

rollback_binaries() {
  step "Rollback binaries (database is not touched)"
  $SUDO systemctl stop dar-legacy.service dar-api.service || true
  if [ -d "$APP_ROOT/legacy" ]; then
    $SUDO mv "$APP_ROOT/legacy" "$APP_ROOT/legacy.failed.$STAMP" || true
  fi
  if [ -n "$OLD_LEGACY" ] && [ -d "$OLD_LEGACY" ]; then
    $SUDO mv "$OLD_LEGACY" "$APP_ROOT/legacy"
  fi
  if [ -d "$APP_ROOT/api" ]; then
    $SUDO mv "$APP_ROOT/api" "$APP_ROOT/api.failed.$STAMP" || true
  fi
  if [ -n "$OLD_API" ] && [ -d "$OLD_API" ]; then
    $SUDO mv "$OLD_API" "$APP_ROOT/api"
  fi
  $SUDO systemctl start dar-legacy.service dar-api.service || true
  SERVICES_STOPPED=0
  if wait_ready "http://127.0.0.1:5080/health/ready" && wait_ready "http://127.0.0.1:5081/health/ready"; then
    info "previous binaries restarted and healthy"
  else
    warn "previous binaries restarted but /health/ready is not OK; inspect journalctl"
  fi
  SWAPPED=0
}

check_http() {
  local label="$1"
  local url="$2"
  local code
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$url" 2>/dev/null || true)"
  if [ "$code" = "200" ]; then
    info "smoke OK   $label ($code)"
    return 0
  fi
  printf '    smoke FAIL %s (HTTP %s)\n' "$label" "${code:-none}" >&2
  return 1
}

smoke_all() {
  local failures=0
  local label
  local url
  while IFS='|' read -r label url; do
    [ -n "$label" ] || continue
    if ! check_http "$label" "$url"; then
      failures=$((failures + 1))
    fi
  done <<'SMOKE'
legacy health|http://127.0.0.1:5080/health/ready
api health|http://127.0.0.1:5081/health/ready
home page|http://127.0.0.1:5080/
management page|http://127.0.0.1:5080/management
teacher portal|http://127.0.0.1:5080/teacher
supervisor portal|http://127.0.0.1:5080/supervisor
api ping|http://127.0.0.1:5081/api/v1/ping
SMOKE
  [ "$failures" -eq 0 ]
}

restart_and_smoke() {
  step "Restart services and smoke"
  start_services
  if ! wait_ready "http://127.0.0.1:5080/health/ready" || ! wait_ready "http://127.0.0.1:5081/health/ready"; then
    warn "services did not become ready after the swap"
    rollback_binaries
    fail "new binaries failed the readiness check; binaries rolled back automatically"
  fi
  if ! smoke_all; then
    rollback_binaries
    fail "new binaries failed the smoke checks; binaries rolled back automatically"
  fi
}

# -----------------------------------------------------------------------------
# Retention + state
# -----------------------------------------------------------------------------
cleanup_retention() {
  step "Retention"
  local component
  local count
  local path
  for component in legacy api; do
    count=0
    while IFS= read -r path; do
      [ -n "$path" ] || continue
      count=$((count + 1))
      if [ "$count" -gt 5 ]; then
        $SUDO rm -rf -- "$path"
        info "removed old app copy: $path"
      fi
    done < <(find "$APP_ROOT" -maxdepth 1 -type d -name "$component.old.*" -printf '%T@ %p\n' 2>/dev/null | sort -rn | cut -d' ' -f2-)
    count=0
    while IFS= read -r path; do
      [ -n "$path" ] || continue
      count=$((count + 1))
      if [ "$count" -gt 3 ]; then
        $SUDO rm -rf -- "$path"
        info "removed failed app copy: $path"
      fi
    done < <(find "$APP_ROOT" -maxdepth 1 -type d -name "$component.failed.*" -printf '%T@ %p\n' 2>/dev/null | sort -rn | cut -d' ' -f2-)
  done
  $SUDO find "$BACKUP_DB_DIR" -maxdepth 1 -type f -name 'dar-pre-deploy-*' -mtime +30 -delete 2>/dev/null || true
  info "pre-deploy dumps older than 30 days removed"
}

write_state() {
  $SUDO install -d -m 0755 -o root -g root "$STATE_DIR"
  $SUDO tee "$STATE_DIR/last-deploy.env" >/dev/null <<EOF
DEPLOY_STAMP=$STAMP
DEPLOY_AT=$(date -Is)
PREVIOUS_COMMIT=$BEFORE_COMMIT
DEPLOY_COMMIT=$AFTER_COMMIT
BACKUP_FILE=$DUMP_FILE
BACKUP_SHA256=$DUMP_SHA
MIGRATIONS_APPLIED=$MIGRATIONS_COUNT
LOG_FILE=$LOG_FILE
EOF
  info "state written to $STATE_DIR/last-deploy.env"
}

print_plan() {
  echo "DRY RUN - no changes will be made."
  echo "  repo          : $REPO_DIR"
  echo "  branch        : $(git -C "$REPO_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
  echo "  current commit: $(git -C "$REPO_DIR" log -1 --oneline 2>/dev/null || echo unknown)"
  echo "  app root      : $APP_ROOT"
  echo "  services      : $SERVICES"
  echo "  migrations    : $(find "$REPO_DIR/database" -maxdepth 1 -type f -name '*.sql' | wc -l | tr -d ' ') files in repository"
  echo "  planned steps :"
  echo "    1. preflight (deploy/preflight.sh)"
  echo "    2. database backup -> $BACKUP_DB_DIR/dar-pre-deploy-$STAMP.dump (+sha256)"
  echo "    3. git pull --ff-only"
  echo "    4. build: npm ci + npm run build + dotnet publish -> app/legacy.new + app/api.new"
  echo "       (--skip-build reuses existing app/legacy.new + app/api.new)"
  echo "    5. dotnet run --project src/Host/Dar.Api -- --migrate"
  echo "    6. verify web_schema_migrations count == database/*.sql count"
  echo "    7. stop services, swap app dirs to *.old.$STAMP, start services"
  echo "    8. smoke: /health/ready 5080+5081, /, /management, /teacher, /supervisor, /api/v1/ping"
  echo "       on failure -> automatic binary rollback (database untouched)"
  echo "    9. retention: last 5 app copies + 30 days pre-deploy dumps"
  echo "   10. write $STATE_DIR/last-deploy.env and the log file"
  echo "  log file      : $LOG_FILE"
}

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------
echo "======================================================================"
echo " Dar production update"
echo " stamp : $STAMP"
echo " repo  : $REPO_DIR"
echo " log   : $LOG_FILE"
echo " mode  : dry-run=$DRY_RUN skip-build=$SKIP_BUILD allow-stopped=$ALLOW_STOPPED"
echo "======================================================================"
if ! load_db_credentials; then
  if [ "$DRY_RUN" -eq 1 ]; then
    warn "dry run continues without database credentials"
  else
    fail "database credentials are required for a real deployment"
  fi
fi
run_preflight
if [ "$DRY_RUN" -eq 1 ]; then
  print_plan
  echo "DRY_RUN_OK"
  exit 0
fi
take_db_backup
git_update
build_and_stage
apply_migrations
step "Stop services"
stop_services
swap_binaries
restart_and_smoke
cleanup_retention
write_state
echo ""
echo "UPDATE_OK"
echo "  stamp      : $STAMP"
echo "  commit     : $AFTER_COMMIT"
echo "  previous   : $BEFORE_COMMIT"
echo "  migrations : $MIGRATIONS_COUNT"
echo "  backup     : $DUMP_FILE"
echo "  backup sha : $DUMP_SHA"
echo "  log        : $LOG_FILE"
echo "  rollback   : sudo bash $SCRIPT_DIR/rollback.sh $STAMP"
