# shellcheck shell=bash
# =============================================================================
# Dar healthcheck - individual checks
# =============================================================================
# Sourced by deploy/scripts/dar-healthcheck.sh (installed to /usr/local/lib/dar/healthcheck).
# Every check only calls record "<name>" "<ok|warning|critical>" "<detail>" and must
# never print a secret. Configuration variables are initialised by the entry point.
# =============================================================================
# shellcheck disable=SC2154

pg_env_value() { # pg_env_value <file> <KEY>
  sed -n "s/^$2=//p" "$1" 2>/dev/null | head -n 1
}

load_pg_env() {
  PG_HOST_L="127.0.0.1"
  PG_PORT_L="5432"
  PG_USER_L=""
  PG_DB_L=""
  PG_PASS_L=""
  [ -r "$PG_ENV_FILE" ] || return 1
  PG_HOST_L="$(pg_env_value "$PG_ENV_FILE" PGHOST)"
  PG_PORT_L="$(pg_env_value "$PG_ENV_FILE" PGPORT)"
  PG_USER_L="$(pg_env_value "$PG_ENV_FILE" PGUSER)"
  PG_DB_L="$(pg_env_value "$PG_ENV_FILE" PGDATABASE)"
  PG_PASS_L="$(pg_env_value "$PG_ENV_FILE" PGPASSWORD)"
  PG_HOST_L="${PG_HOST_L:-127.0.0.1}"
  PG_PORT_L="${PG_PORT_L:-5432}"
  [ -n "$PG_USER_L" ] && [ -n "$PG_PASS_L" ]
}

app_psql() {
  load_pg_env || return 1
  PGPASSWORD="$PG_PASS_L" psql -h "$PG_HOST_L" -p "$PG_PORT_L" -U "$PG_USER_L" \
    -d "${PG_DB_L:-postgres}" -X -q "$@"
}

newest_manifest() {
  find "$BACKUP_DIR" -maxdepth 1 -type f -name 'dar-*.manifest.json' -printf '%T@ %p\n' 2>/dev/null \
    | sort -nr | head -n 1 | cut -d' ' -f2-
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
  local name="$1"
  local url="$2"
  local code
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

# Direct PostgreSQL check: connect with the application credentials from
# /etc/dar/backup.env (preferred) or peer-auth as the postgres OS user, then read
# the migration ledger so a reachable-but-empty/wrong database is caught too.
check_postgres() {
  local host="127.0.0.1" port="5432" user="" db="" pass="" out="" ledger="" label=""
  if ! command -v psql >/dev/null 2>&1; then
    record "postgres" "warning" "psql not available; direct database check skipped"
    return
  fi
  if [ -r "$PG_ENV_FILE" ]; then
    host="$(pg_env_value "$PG_ENV_FILE" PGHOST)"
    port="$(pg_env_value "$PG_ENV_FILE" PGPORT)"
    user="$(pg_env_value "$PG_ENV_FILE" PGUSER)"
    db="$(pg_env_value "$PG_ENV_FILE" PGDATABASE)"
    pass="$(pg_env_value "$PG_ENV_FILE" PGPASSWORD)"
  fi
  host="${host:-127.0.0.1}"
  port="${port:-5432}"
  if [ -n "$user" ] && [ -n "$pass" ]; then
    out="$(PGPASSWORD="$pass" psql -h "$host" -p "$port" -U "$user" -d "${db:-postgres}" \
      -X -q -tAc 'SELECT 1' 2>/dev/null || true)"
    label="user=$user db=${db:-postgres}"
  elif [ "$(id -u)" -eq 0 ] && command -v runuser >/dev/null 2>&1; then
    out="$(runuser -u postgres -- psql -X -q -tAc 'SELECT 1' 2>/dev/null || true)"
    label="peer auth as postgres"
  else
    if pg_isready -h "$host" -p "$port" >/dev/null 2>&1; then
      record "postgres" "ok" "pg_isready ok on $host:$port (no app credentials for a query)"
    else
      record "postgres" "critical" "not accepting connections on $host:$port"
    fi
    return
  fi
  if [ "$out" != "1" ]; then
    record "postgres" "critical" "SELECT 1 failed on $host:$port ($label)"
    return
  fi
  if [ -n "$user" ] && [ -n "$db" ]; then
    ledger="$(PGPASSWORD="$pass" psql -h "$host" -p "$port" -U "$user" -d "$db" \
      -X -q -tAc 'SELECT count(*) FROM web_schema_migrations' 2>/dev/null || true)"
  else
    ledger="$(runuser -u postgres -- psql -X -q -tAc 'SELECT count(*) FROM web_schema_migrations' 2>/dev/null || true)"
  fi
  case "$ledger" in
  '' | *[!0-9]*) record "postgres" "ok" "SELECT 1 ok on $host:$port ($label); ledger not readable" ;;
  *) record "postgres" "ok" "SELECT 1 ok on $host:$port ($label); web_schema_migrations=$ledger" ;;
  esac
}

check_integrity() {
  if ! command -v psql >/dev/null 2>&1; then
    record "integrity" "warning" "psql not available; business-integrity report skipped"
    return
  fi
  if [ ! -r "$INTEGRITY_SQL" ]; then
    record "integrity" "warning" "business-integrity SQL not installed at $INTEGRITY_SQL"
    return
  fi
  local report
  if ! report="$(app_psql -t -A -v ON_ERROR_STOP=1 -f "$INTEGRITY_SQL" 2>/dev/null | tail -n 1)"; then
    record "integrity" "warning" "business-integrity SQL could not run (no app DB credentials?)"
    return
  fi
  if [ -z "$report" ]; then
    record "integrity" "warning" "business-integrity SQL returned no report row"
    return
  fi
  if ! command -v jq >/dev/null 2>&1; then
    record "integrity" "warning" "jq not available; business-integrity report not parsed"
    return
  fi
  local issues
  issues="$(printf '%s' "$report" | jq -r '[.schema.missing_tables, .schema.missing_indexes, (.schema.unvalidated_constraints|select(.>0)|"unvalidated_constraints"), (.schema.invalid_indexes|select(.>0)|"invalid_indexes"), (.integrity|to_entries[]|select(.value>0)|.key), ((.autovacuum.max_dead_tuple_percent // 0)|select(.> '"$DEAD_TUPLE_WARN_PERCENT"')|"dead_tuple_percent:"+(tostring))] | map(select(. != null and . != "")) | join(",")' 2>/dev/null || true)"
  if [ -z "$issues" ]; then
    record "integrity" "ok" "business-integrity rules passed; WAL=$(printf '%s' "$report" | jq -r '.wal.size_bytes' 2>/dev/null)"
  else
    record "integrity" "warning" "integrity anomalies: $issues"
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
  '' | *[!0-9]*)
    record "disk" "warning" "cannot read df output for $DISK_PATH"
    return
    ;;
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
  newest="$(newest_manifest)"
  if [ -z "$newest" ]; then
    record "backup" "critical" "no backup manifest in $BACKUP_DIR (dar-backup.service has not succeeded?)"
    return
  fi
  mtime="$(stat -c %Y "$newest" 2>/dev/null || printf '0')"
  case "$mtime" in
  '' | *[!0-9]*)
    record "backup" "warning" "cannot read manifest mtime: $newest"
    return
    ;;
  esac
  if [ "$mtime" -le 0 ]; then
    record "backup" "warning" "cannot read manifest mtime: $newest"
    return
  fi
  now="$(date +%s)"
  age_hours=$(((now - mtime) / 3600))
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

# Off-site freshness: read the offsite{} block of the newest manifest. An off-site
# copy that silently stopped uploading is worse than a loud failure, so "failed"
# and stale-but-reported-verified are critical.
check_backup_offsite() {
  local newest status verified encrypted error finished epoch now age_hours detail severity
  newest="$(newest_manifest)"
  if [ -z "$newest" ]; then
    record "backup:offsite" "critical" "no backup manifest to read the off-site status from"
    return
  fi
  if command -v jq >/dev/null 2>&1; then
    status="$(jq -r '.offsite.status // "unknown"' "$newest" 2>/dev/null || printf 'unknown')"
    verified="$(jq -r '.offsite.verified // "none"' "$newest" 2>/dev/null || printf 'none')"
    encrypted="$(jq -r '.offsite.encrypted // "not-checked"' "$newest" 2>/dev/null || printf 'not-checked')"
    error="$(jq -r '.offsite.error // ""' "$newest" 2>/dev/null || true)"
    finished="$(jq -r '.finished_at // ""' "$newest" 2>/dev/null || true)"
  else
    record "backup:offsite" "warning" "jq not available; off-site status not parsed (install jq)"
    return
  fi
  epoch=0
  if [ -n "$finished" ]; then
    epoch="$(date -d "$finished" +%s 2>/dev/null || printf '0')"
  fi
  case "$epoch" in
  '' | *[!0-9]*) epoch=0 ;;
  esac
  if [ "$epoch" -le 0 ]; then
    epoch="$(stat -c %Y "$newest" 2>/dev/null || printf '0')"
  fi
  now="$(date +%s)"
  age_hours=0
  if [ "$epoch" -gt 0 ]; then
    age_hours=$(((now - epoch) / 3600))
  fi
  detail="status=$status verified=$verified encrypted=$encrypted age=${age_hours}h file=$(basename "$newest")"
  case "$status" in
  verified)
    if [ "$age_hours" -gt "$OFFSITE_MAX_AGE_HOURS" ]; then
      record "backup:offsite" "critical" "off-site copy is stale: $detail (limit ${OFFSITE_MAX_AGE_HOURS}h)"
    else
      record "backup:offsite" "ok" "$detail"
    fi
    ;;
  disabled)
    record "backup:offsite" "ok" "$detail (off-site disabled: RCLONE_REMOTE is empty)"
    ;;
  failed)
    severity="critical"
    detail="${detail}${error:+ error=$error}"
    record "backup:offsite" "$severity" "$detail"
    ;;
  *)
    record "backup:offsite" "warning" "$detail"
    ;;
  esac
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
      days=$(((expiry - $(date +%s)) / 86400))
      source="tls"
    fi
  fi
  case "$days" in
  '' | *[!0-9-]*)
    record "certificate" "warning" "could not determine certificate expiry for $CERT_DOMAIN"
    return
    ;;
  esac
  if [ "$days" -le 0 ]; then
    record "certificate" "critical" "certificate for $CERT_DOMAIN is expired (${source:-source unknown})"
  elif [ "$days" -lt "$CERT_MIN_DAYS" ]; then
    record "certificate" "critical" "certificate for $CERT_DOMAIN expires in ${days}d (< ${CERT_MIN_DAYS}d, ${source:-source unknown})"
  else
    record "certificate" "ok" "certificate for $CERT_DOMAIN valid for ${days}d (${source:-source unknown})"
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
