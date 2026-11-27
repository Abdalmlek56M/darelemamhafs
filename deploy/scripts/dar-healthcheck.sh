#!/usr/bin/env bash
# shellcheck disable=SC2034,SC2317
# Dar operational health check.
#
# Checks: systemd services, legacy/new API readiness, /api/v1/ping, direct PostgreSQL
# connectivity + schema ledger, business-integrity SQL, disk free space, age + status
# of the latest backup manifest, last dar-backup.service result, off-site (rclone)
# freshness from the manifest, TLS certificate expiry, nginx config, the optional meet
# recorder bot unit and the opt-in LiveKit M0 spike endpoint.
#
# Usage: dar-healthcheck [--json]
# Exit codes: 0 = ok/warning, 1 = critical (or warning when HEALTHCHECK_STRICT=1),
#             2 = usage error.
#
# Run (manual):  sudo bash deploy/scripts/dar-healthcheck.sh [--json]
# Installed as:  /usr/local/bin/dar-healthcheck (systemd units dar-healthcheck.service + dar-healthcheck.timer)
# Implementation: the check functions live in the libs installed to
# /usr/local/lib/dar/healthcheck (repo: deploy/scripts/lib/healthcheck-*.sh).
#
# Optional environment (defaults match the live host):
#   HEALTHCHECK_ENV_FILE              optional env file (default /etc/dar/healthcheck.env)
#   HEALTHCHECK_SERVICES              systemd units (default "dar-legacy dar-api nginx postgresql")
#   HEALTHCHECK_LEGACY_URL            default http://127.0.0.1:5080
#   HEALTHCHECK_API_URL               default http://127.0.0.1:5081
#   HEALTHCHECK_TIMEOUT_SECONDS       curl timeout (default 10)
#   HEALTHCHECK_DISK_PATH             default /var/lib/dar
#   HEALTHCHECK_DISK_MIN_FREE_PERCENT default 15
#   HEALTHCHECK_BACKUP_DIR            default /var/lib/dar/backups/db
#   HEALTHCHECK_BACKUP_MAX_AGE_HOURS  default 26
#   HEALTHCHECK_OFFSITE_MAX_AGE_HOURS default 26
#   HEALTHCHECK_PG_ENV_FILE           app DB credentials for the direct check (default /etc/dar/backup.env)
#   HEALTHCHECK_MEET_BOT_SERVICE      optional meet recorder unit (default dar-meet-bot.service)
#   HEALTHCHECK_LIVEKIT_ENABLED       auto|0|1 (default auto = check only when the unit is installed)
#   HEALTHCHECK_LIVEKIT_URL           LiveKit M0 HTTP endpoint (default http://127.0.0.1:7880)
#   HEALTHCHECK_CERT_DOMAIN           required to enable the certificate check
#   HEALTHCHECK_CERT_MIN_DAYS         default 14
#   HEALTHCHECK_INTEGRITY_SQL         default /usr/local/share/dar/integrity-checks.sql
#   HEALTHCHECK_DEAD_TUPLE_WARN_PERCENT default 20
#   HEALTHCHECK_STRICT                1 = treat warnings as failures (default 0)
#   HEALTHCHECK_TELEGRAM_BOT_TOKEN    opt-in: Telegram bot token (never printed/logged)
#   HEALTHCHECK_TELEGRAM_CHAT_ID      opt-in: Telegram chat id
#   HEALTHCHECK_TELEGRAM_ENABLED      auto|0|1 (default auto = on when token+chat are set)
#   HEALTHCHECK_TELEGRAM_NOTIFY_ALWAYS 1 = also send an alert for an ok result (default 0)
#   HEALTHCHECK_LIB_DIR               override the installed lib directory

set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
HEALTHCHECK_LIB_DIR="${HEALTHCHECK_LIB_DIR:-/usr/local/lib/dar/healthcheck}"
if [ ! -r "$HEALTHCHECK_LIB_DIR/healthcheck-checks.sh" ] && [ -r "$SCRIPT_DIR/lib/healthcheck-checks.sh" ]; then
  HEALTHCHECK_LIB_DIR="$SCRIPT_DIR/lib"
fi
if [ ! -r "$HEALTHCHECK_LIB_DIR/healthcheck-checks.sh" ] || [ ! -r "$HEALTHCHECK_LIB_DIR/healthcheck-checks-ops.sh" ] || [ ! -r "$HEALTHCHECK_LIB_DIR/healthcheck-report.sh" ]; then
  printf 'dar-healthcheck: missing check/report libraries (looked in %s and %s/lib)\n' \
    "${HEALTHCHECK_LIB_DIR:-}" "$SCRIPT_DIR" >&2
  exit 2
fi
# shellcheck source=/dev/null
. "$HEALTHCHECK_LIB_DIR/healthcheck-checks.sh"
# shellcheck source=/dev/null
. "$HEALTHCHECK_LIB_DIR/healthcheck-checks-ops.sh"
# shellcheck source=/dev/null
. "$HEALTHCHECK_LIB_DIR/healthcheck-report.sh"

usage() {
  printf 'Usage: %s [--json]\n' "${0##*/}"
  printf '  --json   machine-readable output (single JSON object, built with jq)\n'
  printf 'Exit codes: 0 ok/warning, 1 critical, 2 usage error\n'
}

JSON_MODE=0
for arg in "$@"; do
  case "$arg" in
  --json | -j) JSON_MODE=1 ;;
  --help | -h)
    usage
    exit 0
    ;;
  *)
    printf 'unknown argument: %s\n' "$arg" >&2
    usage >&2
    exit 2
    ;;
  esac
done

ENV_FILE="${HEALTHCHECK_ENV_FILE:-/etc/dar/healthcheck.env}"
if [ -r "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

SERVICES="${HEALTHCHECK_SERVICES:-dar-legacy dar-api nginx postgresql}"
LEGACY_URL="${HEALTHCHECK_LEGACY_URL:-http://127.0.0.1:5080}"
API_URL="${HEALTHCHECK_API_URL:-http://127.0.0.1:5081}"
TIMEOUT="${HEALTHCHECK_TIMEOUT_SECONDS:-10}"
DISK_PATH="${HEALTHCHECK_DISK_PATH:-/var/lib/dar}"
DISK_MIN_FREE_PCT="${HEALTHCHECK_DISK_MIN_FREE_PERCENT:-15}"
BACKUP_DIR="${HEALTHCHECK_BACKUP_DIR:-${BACKUP_DIR:-/var/lib/dar/backups/db}}"
BACKUP_MAX_AGE_HOURS="${HEALTHCHECK_BACKUP_MAX_AGE_HOURS:-26}"
OFFSITE_MAX_AGE_HOURS="${HEALTHCHECK_OFFSITE_MAX_AGE_HOURS:-$BACKUP_MAX_AGE_HOURS}"
PG_ENV_FILE="${HEALTHCHECK_PG_ENV_FILE:-/etc/dar/backup.env}"
MEET_BOT_SERVICE="${HEALTHCHECK_MEET_BOT_SERVICE:-dar-meet-bot.service}"
LIVEKIT_ENABLED="${HEALTHCHECK_LIVEKIT_ENABLED:-auto}"
LIVEKIT_URL="${HEALTHCHECK_LIVEKIT_URL:-http://127.0.0.1:7880}"
LIVEKIT_SERVICE="${HEALTHCHECK_LIVEKIT_SERVICE:-dar-livekit.service}"
CERT_DOMAIN="${HEALTHCHECK_CERT_DOMAIN:-}"
CERT_MIN_DAYS="${HEALTHCHECK_CERT_MIN_DAYS:-14}"
STRICT="${HEALTHCHECK_STRICT:-0}"
INTEGRITY_SQL="${HEALTHCHECK_INTEGRITY_SQL:-/usr/local/share/dar/integrity-checks.sql}"
DEAD_TUPLE_WARN_PERCENT="${HEALTHCHECK_DEAD_TUPLE_WARN_PERCENT:-20}"
TELEGRAM_TOKEN="${HEALTHCHECK_TELEGRAM_BOT_TOKEN:-}"
TELEGRAM_CHAT_ID="${HEALTHCHECK_TELEGRAM_CHAT_ID:-}"
TELEGRAM_ENABLED="${HEALTHCHECK_TELEGRAM_ENABLED:-auto}"
TELEGRAM_NOTIFY_ALWAYS="${HEALTHCHECK_TELEGRAM_NOTIFY_ALWAYS:-0}"
HOST_NAME="$(hostname 2>/dev/null || printf 'unknown')"
NOW_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

for value_name in TIMEOUT DISK_MIN_FREE_PCT BACKUP_MAX_AGE_HOURS OFFSITE_MAX_AGE_HOURS CERT_MIN_DAYS; do
  value="${!value_name}"
  case "$value" in
  '' | *[!0-9]*)
    printf 'invalid numeric value for %s: %s\n' "$value_name" "$value" >&2
    exit 2
    ;;
  esac
done
case "$LIVEKIT_ENABLED" in
auto | 0 | 1) ;;
*)
  printf 'invalid HEALTHCHECK_LIVEKIT_ENABLED: %s (expected auto|0|1)\n' "$LIVEKIT_ENABLED" >&2
  exit 2
  ;;
esac
case "$TELEGRAM_ENABLED" in
auto | 0 | 1) ;;
*)
  printf 'invalid HEALTHCHECK_TELEGRAM_ENABLED: %s (expected auto|0|1)\n' "$TELEGRAM_ENABLED" >&2
  exit 2
  ;;
esac

CHECK_NAMES=()
CHECK_STATUSES=()
CHECK_DETAILS=()

record() {
  local detail="$3"
  detail="${detail//$'\t'/ }"
  detail="${detail//$'\n'/ | }"
  CHECK_NAMES+=("$1")
  CHECK_STATUSES+=("$2")
  CHECK_DETAILS+=("$detail")
}

check_services
check_http "legacy:ready" "${LEGACY_URL%/}/health/ready"
check_http "new:ready" "${API_URL%/}/health/ready"
check_http "api:ping" "${API_URL%/}/api/v1/ping"
check_postgres
check_integrity
check_disk
check_backup
check_backup_unit
check_backup_offsite
check_cert
check_nginx
check_meet_bot
check_livekit

OK_COUNT=0
WARNING_COUNT=0
CRITICAL_COUNT=0
for status in "${CHECK_STATUSES[@]}"; do
  case "$status" in
  ok) OK_COUNT=$((OK_COUNT + 1)) ;;
  warning) WARNING_COUNT=$((WARNING_COUNT + 1)) ;;
  critical) CRITICAL_COUNT=$((CRITICAL_COUNT + 1)) ;;
  esac
done

RESULT="ok"
EXIT_CODE=0
if [ "$CRITICAL_COUNT" -gt 0 ]; then
  RESULT="critical"
  EXIT_CODE=1
elif [ "$WARNING_COUNT" -gt 0 ]; then
  RESULT="warning"
  if [ "$STRICT" = "1" ]; then
    EXIT_CODE=1
  fi
fi

if [ "$JSON_MODE" = "1" ]; then
  if ! command -v jq >/dev/null 2>&1; then
    printf 'jq is required for --json output (apt-get install -y jq)\n' >&2
    exit 2
  fi
  render_json
else
  render_text
fi

notify_telegram

exit "$EXIT_CODE"
