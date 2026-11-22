#!/usr/bin/env bash
# =============================================================================
# Dar binary rollback - switch back to a previous app copy (never touches the DB)
# =============================================================================
# Purpose : revert the deployed binaries to a previous release without touching
#           the database. Most updates create the pair
#             /opt/dar/app/legacy.old.<stamp>  and  /opt/dar/app/api.old.<stamp>
#           which this script swaps back into place, restarts the services and
#           runs the same local smoke checks as update.sh.
# Requires: root, or the deploy user with passwordless sudo.
# Usage   : sudo bash deploy/rollback.sh --list
#           sudo bash deploy/rollback.sh <stamp> [--dry-run]
# Safety  : the database is never modified. If a migration was applied by the
#           newer release it stays in place; migrations are additive and the
#           older binaries ignore unknown tables/columns. If the rollback smoke
#           fails, the new binaries are restored automatically.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${DAR_REPO_DIR:-$(cd -- "$SCRIPT_DIR/.." && pwd)}"
APP_ROOT="${DAR_APP_ROOT:-/opt/dar/app}"
LOG_DIR="${DAR_LOG_DIR:-/var/log/dar}"
STATE_DIR="${DAR_STATE_DIR:-/var/lib/dar/deploy}"
SERVICES="dar-legacy dar-api"
ROLLBACK_STAMP="$(date +%Y%m%d-%H%M%S)"
LOG_FILE=""
TARGET_STAMP=""
DRY_RUN=0
SERVICES_STOPPED=0

usage() {
  cat <<'USAGE'
Usage: rollback.sh --list
       rollback.sh <stamp> [--dry-run]

  --list        List rollback stamps that have both legacy and api copies.
  --dry-run     Show what would be swapped; change nothing.
  --help        Show this help.

Rollback only swaps binaries under /opt/dar/app and restarts the services.
The database is never touched; newer additive migrations are kept.
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
  --list)
    LIST_ONLY=1
    shift
    ;;
  --dry-run)
    DRY_RUN=1
    shift
    ;;
  --help | -h)
    usage
    exit 0
    ;;
  -*)
    echo "Unknown option: $1" >&2
    usage >&2
    exit 2
    ;;
  *)
    [ -z "$TARGET_STAMP" ] || {
      echo "Only one stamp may be given." >&2
      exit 2
    }
    TARGET_STAMP="$1"
    shift
    ;;
  esac
done

LIST_ONLY="${LIST_ONLY:-0}"

if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
else
  if ! sudo -n true 2>/dev/null; then
    echo "rollback.sh must run as root or as a user with passwordless sudo." >&2
    exit 1
  fi
  SUDO="sudo"
fi

if [ ! -d "$APP_ROOT" ]; then
  echo "App root does not exist: $APP_ROOT" >&2
  exit 1
fi

list_stamps() {
  local legacy_dir
  local stamp
  echo "Available rollback stamps under $APP_ROOT:"
  for legacy_dir in "$APP_ROOT"/legacy.old.*; do
    [ -d "$legacy_dir" ] || continue
    stamp="${legacy_dir##*/legacy.old.}"
    if [ -d "$APP_ROOT/api.old.$stamp" ]; then
      commit="unknown"
      meta="$APP_ROOT/legacy.old.$stamp/.deploy-meta"
      if [ -f "$meta" ]; then
        commit="$(sed -n 's/^DEPLOY_COMMIT=//p' "$meta" | head -n 1)"
      fi
      printf '  %-20s legacy=yes api=yes commit=%s\n' "$stamp" "${commit:-unknown}"
    else
      printf '  %-20s legacy=yes api=MISSING (not rollback-able)\n' "$stamp"
    fi
  done
}

if [ "$LIST_ONLY" -eq 1 ]; then
  list_stamps
  exit 0
fi

if [ -z "$TARGET_STAMP" ]; then
  usage >&2
  echo "" >&2
  list_stamps >&2
  exit 2
fi

LEGACY_OLD="$APP_ROOT/legacy.old.$TARGET_STAMP"
API_OLD="$APP_ROOT/api.old.$TARGET_STAMP"
if [ ! -d "$LEGACY_OLD" ] || [ ! -d "$API_OLD" ]; then
  echo "Rollback copies for stamp '$TARGET_STAMP' are incomplete or missing:" >&2
  [ -d "$LEGACY_OLD" ] || echo "  missing: $LEGACY_OLD" >&2
  [ -d "$API_OLD" ] || echo "  missing: $API_OLD" >&2
  echo "" >&2
  list_stamps >&2
  exit 1
fi
if [ ! -f "$LEGACY_OLD/DarEltahfeez.Api.dll" ] || [ ! -f "$API_OLD/Dar.Api.dll" ]; then
  echo "Rollback copies do not contain the expected .NET binaries." >&2
  exit 1
fi

$SUDO install -d -m 0755 -o root -g root "$LOG_DIR"
LOG_FILE="$LOG_DIR/rollback-$TARGET_STAMP-$ROLLBACK_STAMP.log"
if [ -n "$SUDO" ]; then
  exec > >($SUDO tee -a "$LOG_FILE") 2>&1
else
  exec > >(tee -a "$LOG_FILE") 2>&1
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
  if [ "$SERVICES_STOPPED" -eq 1 ]; then
    printf '\nWARN: rollback exited with the services stopped; restarting them.\n' >&2
    $SUDO systemctl start dar-legacy.service dar-api.service >/dev/null 2>&1 || true
    SERVICES_STOPPED=0
  fi
}
trap on_exit EXIT

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

target_commit="unknown"
if [ -f "$LEGACY_OLD/.deploy-meta" ]; then
  target_commit="$(sed -n 's/^DEPLOY_COMMIT=//p' "$LEGACY_OLD/.deploy-meta" | head -n 1)"
fi

echo "======================================================================"
echo " Dar binary rollback"
echo " target stamp : $TARGET_STAMP"
echo " target commit: $target_commit"
echo " app root     : $APP_ROOT"
echo " log          : $LOG_FILE"
echo " mode         : dry-run=$DRY_RUN"
echo "======================================================================"
warn "The database is NOT rolled back. Additive migrations stay applied; older binaries ignore them."

if [ "$DRY_RUN" -eq 1 ]; then
  echo "DRY RUN - no changes will be made."
  echo "  would stop : $SERVICES"
  echo "  would move : $APP_ROOT/legacy -> $APP_ROOT/legacy.rolledback.$ROLLBACK_STAMP"
  echo "  would move : $LEGACY_OLD -> $APP_ROOT/legacy"
  echo "  would move : $APP_ROOT/api -> $APP_ROOT/api.rolledback.$ROLLBACK_STAMP"
  echo "  would move : $API_OLD -> $APP_ROOT/api"
  echo "  would start: $SERVICES"
  echo "  smoke      : /health/ready 5080 + 5081, /, /management, /teacher, /supervisor, /api/v1/ping"
  echo "DRY_RUN_OK"
  exit 0
fi

CURRENT_LEGACY_BACKUP=""
CURRENT_API_BACKUP=""

restore_current() {
  step "Restoring the binaries that were live before this rollback"
  $SUDO systemctl stop dar-legacy.service dar-api.service || true
  if [ -d "$APP_ROOT/legacy" ]; then
    $SUDO mv "$APP_ROOT/legacy" "$APP_ROOT/legacy.rollback-failed.$ROLLBACK_STAMP" || true
  fi
  if [ -n "$CURRENT_LEGACY_BACKUP" ] && [ -d "$CURRENT_LEGACY_BACKUP" ]; then
    $SUDO mv "$CURRENT_LEGACY_BACKUP" "$APP_ROOT/legacy"
  fi
  if [ -d "$APP_ROOT/api" ]; then
    $SUDO mv "$APP_ROOT/api" "$APP_ROOT/api.rollback-failed.$ROLLBACK_STAMP" || true
  fi
  if [ -n "$CURRENT_API_BACKUP" ] && [ -d "$CURRENT_API_BACKUP" ]; then
    $SUDO mv "$CURRENT_API_BACKUP" "$APP_ROOT/api"
  fi
  $SUDO systemctl start dar-legacy.service dar-api.service || true
  SERVICES_STOPPED=0
}

step "Stop services"
SERVICES_STOPPED=1
$SUDO systemctl stop dar-legacy.service dar-api.service || true

step "Swap back to $TARGET_STAMP"
if [ -d "$APP_ROOT/legacy" ]; then
  CURRENT_LEGACY_BACKUP="$APP_ROOT/legacy.rolledback.$ROLLBACK_STAMP"
  $SUDO mv "$APP_ROOT/legacy" "$CURRENT_LEGACY_BACKUP"
  info "current legacy kept at $CURRENT_LEGACY_BACKUP"
fi
if [ -d "$APP_ROOT/api" ]; then
  CURRENT_API_BACKUP="$APP_ROOT/api.rolledback.$ROLLBACK_STAMP"
  $SUDO mv "$APP_ROOT/api" "$CURRENT_API_BACKUP"
  info "current api kept at $CURRENT_API_BACKUP"
fi
if ! $SUDO mv "$LEGACY_OLD" "$APP_ROOT/legacy"; then
  restore_current
  fail "could not move the legacy rollback copy into place"
fi
if ! $SUDO mv "$API_OLD" "$APP_ROOT/api"; then
  restore_current
  fail "could not move the api rollback copy into place"
fi
$SUDO chown -R dar:dar "$APP_ROOT/legacy" "$APP_ROOT/api"

step "Start services"
$SUDO systemctl start dar-legacy.service dar-api.service || true

step "Readiness"
if ! wait_ready "http://127.0.0.1:5080/health/ready" || ! wait_ready "http://127.0.0.1:5081/health/ready"; then
  warn "rolled-back binaries did not become ready"
  restore_current
  fail "rollback failed the readiness check; previous binaries restored"
fi
SERVICES_STOPPED=0

step "Smoke"
failures=0
check_http "legacy health" "http://127.0.0.1:5080/health/ready" || failures=$((failures + 1))
check_http "api health" "http://127.0.0.1:5081/health/ready" || failures=$((failures + 1))
check_http "home page" "http://127.0.0.1:5080/" || failures=$((failures + 1))
check_http "management page" "http://127.0.0.1:5080/management" || failures=$((failures + 1))
check_http "teacher portal" "http://127.0.0.1:5080/teacher" || failures=$((failures + 1))
check_http "supervisor portal" "http://127.0.0.1:5080/supervisor" || failures=$((failures + 1))
check_http "api ping" "http://127.0.0.1:5081/api/v1/ping" || failures=$((failures + 1))
if [ "$failures" -ne 0 ]; then
  warn "rolled-back binaries failed $failures smoke check(s)"
  restore_current
  fail "rollback smoke failed; previous binaries restored"
fi

step "Retention"
count=0
while IFS= read -r path; do
  [ -n "$path" ] || continue
  count=$((count + 1))
  if [ "$count" -gt 3 ]; then
    $SUDO rm -rf -- "$path"
    info "removed old rolledback copy: $path"
  fi
done < <(find "$APP_ROOT" -maxdepth 1 -type d -name 'legacy.rolledback.*' -printf '%T@ %p\n' 2>/dev/null | sort -rn | cut -d' ' -f2-)
count=0
while IFS= read -r path; do
  [ -n "$path" ] || continue
  count=$((count + 1))
  if [ "$count" -gt 3 ]; then
    $SUDO rm -rf -- "$path"
    info "removed old rolledback copy: $path"
  fi
done < <(find "$APP_ROOT" -maxdepth 1 -type d -name 'api.rolledback.*' -printf '%T@ %p\n' 2>/dev/null | sort -rn | cut -d' ' -f2-)

step "State"
$SUDO install -d -m 0755 -o root -g root "$STATE_DIR"
$SUDO tee "$STATE_DIR/last-rollback.env" >/dev/null <<EOF
ROLLBACK_STAMP=$ROLLBACK_STAMP
ROLLBACK_TARGET=$TARGET_STAMP
ROLLBACK_TARGET_COMMIT=$target_commit
ROLLBACK_AT=$(date -Is)
PREVIOUS_LEGACY=$CURRENT_LEGACY_BACKUP
PREVIOUS_API=$CURRENT_API_BACKUP
LOG_FILE=$LOG_FILE
EOF

echo ""
echo "ROLLBACK_OK"
echo "  target stamp : $TARGET_STAMP"
echo "  target commit: $target_commit"
echo "  previous dirs: $CURRENT_LEGACY_BACKUP"
echo "                 $CURRENT_API_BACKUP"
echo "  database     : untouched"
echo "  log          : $LOG_FILE"
echo ""
list_stamps
