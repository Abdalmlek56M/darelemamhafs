#!/usr/bin/env bash
# Dar operational health check.
#
# Checks: systemd services, legacy/new API readiness, /api/v1/ping, disk free space,
# age + status of the latest backup manifest, last dar-backup.service result, TLS
# certificate expiry and nginx config.
#
# Usage: dar-healthcheck [--json]
# Exit codes: 0 = ok/warning, 1 = critical (or warning when HEALTHCHECK_STRICT=1),
#             2 = usage error.
#
# Run (manual):  sudo bash deploy/scripts/dar-healthcheck.sh [--json]
# Installed as:  /usr/local/bin/dar-healthcheck (systemd units dar-healthcheck.service + dar-healthcheck.timer)
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
#   HEALTHCHECK_CERT_DOMAIN           default dar-elemam-hafs.rigxhardware.com
#   HEALTHCHECK_CERT_MIN_DAYS         default 14
#   HEALTHCHECK_STRICT                1 = treat warnings as failures (default 0)

set -uo pipefail

usage() {
  printf 'Usage: %s [--json]\n' "${0##*/}"
  printf '  --json   machine-readable output (single JSON object)\n'
  printf 'Exit codes: 0 ok/warning, 1 critical, 2 usage error\n'
}

JSON_MODE=0
for arg in "$@"; do
  case "$arg" in
    --json|-j) JSON_MODE=1 ;;
    --help|-h) usage; exit 0 ;;
    *) printf 'unknown argument: %s\n' "$arg" >&2; usage >&2; exit 2 ;;
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
CERT_DOMAIN="${HEALTHCHECK_CERT_DOMAIN:-dar-elemam-hafs.rigxhardware.com}"
CERT_MIN_DAYS="${HEALTHCHECK_CERT_MIN_DAYS:-14}"
STRICT="${HEALTHCHECK_STRICT:-0}"
HOST_NAME="$(hostname 2>/dev/null || printf 'unknown')"
NOW_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

for value_name in TIMEOUT DISK_MIN_FREE_PCT BACKUP_MAX_AGE_HOURS CERT_MIN_DAYS; do
  value="${!value_name}"
  case "$value" in
    ''|*[!0-9]*) printf 'invalid numeric value for %s: %s\n' "$value_name" "$value" >&2; exit 2 ;;
  esac
done

CHECK_NAMES=()
CHECK_STATUSES=()
CHECK_DETAILS=()

json_escape() {
  local value="${1-}"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/\\r}"
  value="${value//$'\t'/\\t}"
  printf '%s' "$value"
}

record() {
  CHECK_NAMES+=("$1")
  CHECK_STATUSES+=("$2")
  CHECK_DETAILS+=("$3")
}

check_services() {
  if ! command -v systemctl >/dev/null 2>&1; then
    record "services" "warning" "systemctl not available; skipped: $SERVICES"
    return
  fi
  local service state
  for service in $SERVICES; do
    if systemctl is-active --quiet "$service" 2>/dev/null; then
      state="$(systemctl is-active "$service" 2>/dev/null || true)"
      record "service:$service" "ok" "state=${state:-active}"
    else
      state="$(systemctl is-active "$service" 2>/dev/null || true)"
      record "service:$service" "critical" "state=${state:-unknown} (expected active)"
    fi
  done
}

check_http() {
  local name="$1" url="$2" code
  if ! command -v curl >/dev/null 2>&1; then
    record "$name" "warning" "curl not available; skipped $url"
    return
  fi
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time "$TIMEOUT" "$url" 2>/dev/null || true)"
  if [ "$code" = "200" ]; then
    record "$name" "ok" "$url -> HTTP $code"
  else
    record "$name" "critical" "$url -> HTTP ${code:-000} (expected 200)"
  fi
}

check_disk() {
  local used free
  if ! command -v df >/dev/null 2>&1; then
    record "disk" "warning" "df not available; skipped"
    return
  fi
  if [ ! -d "$DISK_PATH" ]; then
    record "disk" "warning" "path not found: $DISK_PATH"
    return
  fi
  used="$(df -P "$DISK_PATH" 2>/dev/null | awk 'NR==2 {gsub(/%/, "", $5); print $5}')"
  case "$used" in
    ''|*[!0-9]*) record "disk" "warning" "cannot read df output for $DISK_PATH"; return ;;
  esac
  free=$((100 - used))
  if [ "$free" -lt "$DISK_MIN_FREE_PCT" ]; then
    record "disk" "critical" "free ${free}% < ${DISK_MIN_FREE_PCT}% on $DISK_PATH"
  else
    record "disk" "ok" "free ${free}% on $DISK_PATH"
  fi
}

check_backup() {
  local newest mtime now age_hours status manifest_file detail severity
  if [ ! -d "$BACKUP_DIR" ]; then
    record "backup" "critical" "backup directory missing: $BACKUP_DIR"
    return
  fi
  newest="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'dar-*.manifest.json' -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -n 1 | cut -d' ' -f2-)"
  if [ -z "$newest" ]; then
    record "backup" "critical" "no backup manifest in $BACKUP_DIR (dar-backup.service has not succeeded?)"
    return
  fi
  mtime="$(stat -c %Y "$newest" 2>/dev/null || printf '0')"
  case "$mtime" in
    ''|*[!0-9]*) record "backup" "warning" "cannot read manifest mtime: $newest"; return ;;
  esac
  if [ "$mtime" -le 0 ]; then
    record "backup" "warning" "cannot read manifest mtime: $newest"
    return
  fi
  now="$(date +%s)"
  age_hours=$(( (now - mtime) / 3600 ))
  status="$(sed -n 's/.*"status":[[:space:]]*"\([^"]*\)".*/\1/p' "$newest" 2>/dev/null | head -n 1)"
  manifest_file="$(sed -n 's/.*"file":[[:space:]]*"\([^"]*\)".*/\1/p' "$newest" 2>/dev/null | head -n 1)"

  severity="ok"
  detail="age=${age_hours}h status=${status:-unknown} file=$(basename "$newest")"
  if [ -n "$manifest_file" ] && [ ! -f "$BACKUP_DIR/$manifest_file" ]; then
    severity="critical"
    detail="${detail} dump_missing=$manifest_file"
  fi
  if [ "$status" != "success" ]; then
    severity="critical"
    detail="${detail} (latest backup did not report success)"
  fi
  if [ "$age_hours" -gt "$BACKUP_MAX_AGE_HOURS" ]; then
    severity="critical"
    detail="${detail} (older than ${BACKUP_MAX_AGE_HOURS}h)"
  fi
  record "backup" "$severity" "$detail"
}

check_cert() {
  local days="" source="" out="" enddate="" expiry=""
  if command -v certbot >/dev/null 2>&1; then
    out="$(certbot certificates 2>/dev/null | grep -A 6 "Certificate Name: $CERT_DOMAIN" || true)"
    if [ -n "$out" ]; then
      days="$(printf '%s\n' "$out" | sed -n 's/.*(VALID:[[:space:]]*\([0-9][0-9]*\)[[:space:]]*days).*/\1/p' | head -n 1)"
      if [ -z "$days" ]; then
        days="$(printf '%s\n' "$out" | sed -n 's/.*(INVALID:[[:space:]]*\([0-9][0-9]*\)[[:space:]]*days).*/\1/p' | head -n 1)"
        if [ -n "$days" ]; then
          days=$((0 - days))
        fi
      fi
      if [ -n "$days" ]; then
        source="certbot"
      fi
    fi
  fi
  if [ -z "$days" ] && command -v openssl >/dev/null 2>&1; then
    enddate="$( (printf '' | openssl s_client -servername "$CERT_DOMAIN" -connect "${CERT_DOMAIN}:443" 2>/dev/null) | openssl x509 -noout -enddate 2>/dev/null | sed -n 's/^notAfter=//p')"
    if [ -n "$enddate" ] && expiry="$(date -d "$enddate" +%s 2>/dev/null)"; then
      days=$(( (expiry - $(date +%s)) / 86400 ))
      source="tls"
    fi
  fi
  case "$days" in
    ''|*[!0-9-]*) record "certificate" "warning" "could not determine certificate expiry for $CERT_DOMAIN"; return ;;
  esac
  if [ "$days" -le 0 ]; then
    record "certificate" "critical" "certificate for $CERT_DOMAIN is expired (${source:-source unknown})"
  elif [ "$days" -lt "$CERT_MIN_DAYS" ]; then
    record "certificate" "critical" "certificate for $CERT_DOMAIN expires in ${days}d (< ${CERT_MIN_DAYS}d, ${source:-source unknown})"
  else
    record "certificate" "ok" "certificate for $CERT_DOMAIN valid for ${days}d (${source:-source unknown})"
  fi
}

check_backup_unit() {
  local result loadstate
  if ! command -v systemctl >/dev/null 2>&1; then
    return
  fi
  loadstate="$(systemctl show -p LoadState --value dar-backup.service 2>/dev/null || true)"
  result="$(systemctl show -p Result --value dar-backup.service 2>/dev/null || true)"
  if [ "$loadstate" != "loaded" ]; then
    record "backup:unit" "warning" "dar-backup.service is not loaded (state=${loadstate:-unknown})"
    return
  fi
  if [ "$result" = "success" ] || [ -z "$result" ]; then
    record "backup:unit" "ok" "last dar-backup.service result=${result:-success}"
  else
    record "backup:unit" "critical" "last dar-backup.service result=$result"
  fi
}

check_nginx() {
  local out
  if ! command -v nginx >/dev/null 2>&1; then
    record "nginx" "warning" "nginx binary not found; skipped"
    return
  fi
  if out="$(nginx -t 2>&1)"; then
    record "nginx" "ok" "configuration test passed"
  else
    record "nginx" "critical" "nginx -t failed: ${out//$'\n'/ | }"
  fi
}

check_services
check_http "legacy:ready" "${LEGACY_URL%/}/health/ready"
check_http "new:ready" "${API_URL%/}/health/ready"
check_http "api:ping" "${API_URL%/}/api/v1/ping"
check_disk
check_backup
check_backup_unit
check_cert
check_nginx

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
  printf '{\n'
  printf '  "schema_version": 1,\n'
  printf '  "time": "%s",\n' "$(json_escape "$NOW_ISO")"
  printf '  "hostname": "%s",\n' "$(json_escape "$HOST_NAME")"
  printf '  "result": "%s",\n' "$RESULT"
  printf '  "exit_code": %s,\n' "$EXIT_CODE"
  printf '  "counts": {"ok": %s, "warning": %s, "critical": %s},\n' "$OK_COUNT" "$WARNING_COUNT" "$CRITICAL_COUNT"
  printf '  "thresholds": {"disk_min_free_percent": %s, "backup_max_age_hours": %s, "cert_min_days": %s},\n' "$DISK_MIN_FREE_PCT" "$BACKUP_MAX_AGE_HOURS" "$CERT_MIN_DAYS"
  printf '  "checks": [\n'
  index=0
  for name in "${CHECK_NAMES[@]}"; do
    if [ "$index" -gt 0 ]; then
      printf ',\n'
    fi
    printf '    {"name": "%s", "status": "%s", "detail": "%s"}' \
      "$(json_escape "$name")" "$(json_escape "${CHECK_STATUSES[$index]}")" "$(json_escape "${CHECK_DETAILS[$index]}")"
    index=$((index + 1))
  done
  printf '\n  ]\n'
  printf '}\n'
else
  printf 'Dar healthcheck — %s — %s\n' "$NOW_ISO" "$HOST_NAME"
  printf '\n'
  index=0
  for name in "${CHECK_NAMES[@]}"; do
    printf '[%-8s] %s: %s\n' "$(printf '%s' "${CHECK_STATUSES[$index]}" | tr '[:lower:]' '[:upper:]')" "$name" "${CHECK_DETAILS[$index]}"
    index=$((index + 1))
  done
  printf '\nRESULT: %s (ok=%s warning=%s critical=%s)\n' "$(printf '%s' "$RESULT" | tr '[:lower:]' '[:upper:]')" "$OK_COUNT" "$WARNING_COUNT" "$CRITICAL_COUNT"
fi

exit "$EXIT_CODE"
