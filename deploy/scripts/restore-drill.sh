#!/usr/bin/env bash
# S-9 restore drill. NEVER targets the production database.
# Restores into disposable databases on the same PostgreSQL cluster, validates
# counts/sums/hashes, runs a minimal app health check, then drops everything.
set -euo pipefail
umask 077

PREFIX="dar_restore_s9_"
PROD_DB="${RESTORE_DRILL_PROD_DB:?RESTORE_DRILL_PROD_DB must name the production database to refuse}"
BACKUP_DIR="${RESTORE_DRILL_BACKUP_DIR:-/var/lib/dar/backups/db}"
REMOTE_PATH="${RESTORE_DRILL_REMOTE_PATH:-}"
RCLONE_CONFIG="${RCLONE_CONFIG:-/var/lib/dar/rclone/rclone.conf}"
SAFE_STAMP="$(date +%Y%m%d%H%M%S)"
DAILY_DB="dar_restore_s9_daily_$SAFE_STAMP"
FRESH_DB="dar_restore_s9_fresh_$SAFE_STAMP"
APP_ROLE="dar_restore_s9_app_$SAFE_STAMP"
TMP_DIR="$(mktemp -d /tmp/s9-drill.XXXXXXXX)"
APP_PID=""
DAILY_DB_CREATED=0
FRESH_DB_CREATED=0
ROLE_CREATED=0
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
METRICS_SQL="$SCRIPT_DIR/restore-drill-metrics.sql"
BACKUP=""

log() { printf 'S9 %s\n' "$*"; }

safe_db() {
  case "$1" in
    dar_restore_s9_*) return 0 ;;
    *) log "REFUSING unsafe database name: $1"; return 1 ;;
  esac
}

cleanup() {
  if [ -n "$APP_PID" ]; then
    log "stopping temporary app PID=$APP_PID"
    kill "$APP_PID" 2>/dev/null || true
    wait "$APP_PID" 2>/dev/null || true
    APP_PID=""
  fi
  if [ "$DAILY_DB_CREATED" -eq 1 ] && safe_db "$DAILY_DB"; then sudo -u postgres dropdb --if-exists "$DAILY_DB" >/dev/null 2>&1 || true; fi
  if [ "$FRESH_DB_CREATED" -eq 1 ] && safe_db "$FRESH_DB"; then sudo -u postgres dropdb --if-exists "$FRESH_DB" >/dev/null 2>&1 || true; fi
  if [ "$ROLE_CREATED" -eq 1 ]; then sudo -u postgres psql -X -q -v ON_ERROR_STOP=1 -c "DROP ROLE IF EXISTS \"$APP_ROLE\";" >/dev/null 2>&1 || true; fi
  rm -rf "$TMP_DIR" 2>/dev/null || true
}
trap cleanup EXIT

[ -r "$METRICS_SQL" ] || { log "FAIL missing metrics SQL: $METRICS_SQL"; exit 1; }
if [ "$#" -gt 0 ]; then BACKUP="$1"; fi
if [ -z "$BACKUP" ]; then
  BACKUP="$(sudo find "$BACKUP_DIR" -maxdepth 1 -type f -name 'dar-*.dump' -printf '%T@ %p\n' | sort -n | tail -1 | awk '{print $2}')"
fi
[ -n "$BACKUP" ] && [ -r "$BACKUP" ] || { log "FAIL backup not readable"; exit 1; }
log "DAILY_BACKUP=$BACKUP"
log "TEMP_DAILY_DB=$DAILY_DB"
log "TEMP_FRESH_DB=$FRESH_DB"

chmod 711 "$TMP_DIR"
PG_TMP="$TMP_DIR/pg"
mkdir -p "$PG_TMP"
chown postgres:postgres "$PG_TMP"
chmod 700 "$PG_TMP"
cp "$BACKUP" "$PG_TMP/daily.dump"
chown postgres:postgres "$PG_TMP/daily.dump"
chmod 600 "$PG_TMP/daily.dump"

sha256sum "$BACKUP" | awk '{print "S9 SHA256=" $1}'
sudo -u postgres pg_restore --list "$PG_TMP/daily.dump" > "$TMP_DIR/daily.toc" 2> "$TMP_DIR/daily.toc.err" || { log "FAIL pg_restore --list rejected daily backup"; exit 1; }
TOC_COUNT="$(grep -cv '^;' "$TMP_DIR/daily.toc" || true)"
log "DAILY_TOC_ENTRIES=$TOC_COUNT"

OFFSITE_STATUS="unverified"
if [ -r "$RCLONE_CONFIG" ]; then
  BASE_NAME="$(basename "$BACKUP")"
  mkdir -p "$TMP_DIR/offsite"
  chown dar:dar "$TMP_DIR/offsite"
  chmod 700 "$TMP_DIR/offsite"
  if sudo -u dar env HOME=/var/lib/dar rclone --config "$RCLONE_CONFIG" copyto "$REMOTE_PATH/$BASE_NAME" "$TMP_DIR/offsite/offsite.dump" > "$TMP_DIR/rclone.log" 2>&1; then
    chmod 600 "$TMP_DIR/offsite/offsite.dump"
    LOCAL_SHA="$(sha256sum "$BACKUP" | awk '{print $1}')"
    REMOTE_SHA="$(sha256sum "$TMP_DIR/offsite/offsite.dump" | awk '{print $1}')"
    if [ "$LOCAL_SHA" = "$REMOTE_SHA" ]; then OFFSITE_STATUS="match"; else OFFSITE_STATUS="MISMATCH"; fi
    rm -f "$TMP_DIR/offsite/offsite.dump"
  else
    OFFSITE_STATUS="unavailable"
  fi
fi
log "OFFSITE_STATUS=$OFFSITE_STATUS"

APP_DIR="/opt/dar/app/legacy"
app_smoke() {
  local db="$1" label="$2" ok=0 code
  if [ ! -f "$APP_DIR/DarEltahfeez.Api.dll" ]; then log "APP_SMOKE_$label=SKIPPED (published legacy app not found)"; return 0; fi
  if [ "$ROLE_CREATED" -eq 0 ]; then
    APP_PASS="$(openssl rand -hex 16)"
    sudo -u postgres psql -X -q -v ON_ERROR_STOP=1 -c "CREATE ROLE \"$APP_ROLE\" LOGIN PASSWORD '$APP_PASS';" >/dev/null
    ROLE_CREATED=1
  fi
  sudo -u postgres psql -X -q -v ON_ERROR_STOP=1 -d "$db" -c "GRANT CONNECT ON DATABASE \"$db\" TO \"$APP_ROLE\"; GRANT USAGE ON SCHEMA public TO \"$APP_ROLE\"; GRANT SELECT ON ALL TABLES IN SCHEMA public TO \"$APP_ROLE\"; GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO \"$APP_ROLE\";" >/dev/null
  cd "$APP_DIR"
  env ASPNETCORE_ENVIRONMENT=Development ASPNETCORE_URLS=http://127.0.0.1:5101 \
      ConnectionStrings__DarDatabase="Host=127.0.0.1;Port=5432;Database=$db;Username=$APP_ROLE;Password=$APP_PASS" \
      Auth__SetupToken="$(openssl rand -hex 16)" Database__ApplyMigrationsOnStartup=false TZ=UTC \
      nohup dotnet DarEltahfeez.Api.dll > "$TMP_DIR/app-$label.log" 2>&1 &
  APP_PID=$!
  for _ in $(seq 1 60); do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://127.0.0.1:${RESTORE_DRILL_APP_PORT:-5101}/health/ready" 2>/dev/null || true)
    if [ "$code" = "200" ]; then ok=1; break; fi
    sleep 1
  done
  if [ "$ok" -eq 1 ]; then log "APP_SMOKE_$label=OK (health/ready 200, temp DB, no production env files)"; else log "APP_SMOKE_$label=FAIL"; fi
  kill "$APP_PID" 2>/dev/null || true
  wait "$APP_PID" 2>/dev/null || true
  APP_PID=""
}

run_metrics() {
  local db="$1" out="$2"
  sudo -u postgres psql -X -q -t -A -F '|' -v ON_ERROR_STOP=1 -f "$METRICS_SQL" -d "$db" \
    | grep -E '^(schema|table|sum|hash|orphan|negative)\|' > "$out" || true
}

# ---- existing daily backup ----
safe_db "$DAILY_DB" || exit 1
sudo -u postgres createdb "$DAILY_DB"
DAILY_DB_CREATED=1
sudo -u postgres pg_restore --no-owner --no-privileges --exit-on-error -d "$DAILY_DB" "$PG_TMP/daily.dump" > "$TMP_DIR/daily.restore.log" 2>&1 || { log "FAIL daily restore"; exit 1; }
log "DAILY_RESTORE=OK"
run_metrics "$DAILY_DB" "$TMP_DIR/daily.metrics"
run_metrics "$PROD_DB" "$TMP_DIR/source-current.metrics"
diff -u "$TMP_DIR/source-current.metrics" "$TMP_DIR/daily.metrics" > "$TMP_DIR/daily.diff" 2>&1 || true
DAILY_DIFF_LINES="$(grep -cE '^[+-][^+-]' "$TMP_DIR/daily.diff" 2>/dev/null || true)"
log "DAILY_VS_CURRENT_DIFF_LINES=$DAILY_DIFF_LINES (expected: daily backup predates later production changes)"
grep -E '^[-+]schema\|' "$TMP_DIR/daily.diff" > "$TMP_DIR/daily.schema.diff" 2>/dev/null || true
if [ -s "$TMP_DIR/daily.schema.diff" ]; then
  log "DAILY_SCHEMA_DIFF=YES"
  sed -n '1,20p' "$TMP_DIR/daily.schema.diff" | while IFS= read -r line; do log "SCHEMA_DIFF $line"; done
else
  log "DAILY_SCHEMA_DIFF=NO"
fi
app_smoke "$DAILY_DB" "DAILY"

# ---- fresh read-only snapshot for exact source parity ----
run_metrics "$PROD_DB" "$TMP_DIR/source-before.metrics"
sudo -u postgres pg_dump -Fc --no-owner -f "$PG_TMP/fresh.dump" "$PROD_DB"
chmod 600 "$PG_TMP/fresh.dump"
log "FRESH_SNAPSHOT=OK"
run_metrics "$PROD_DB" "$TMP_DIR/source-after.metrics"
if cmp -s "$TMP_DIR/source-before.metrics" "$TMP_DIR/source-after.metrics"; then
  log "SOURCE_STABLE_DURING_DUMP=YES"
else
  log "SOURCE_STABLE_DURING_DUMP=NO"
fi

safe_db "$FRESH_DB" || exit 1
sudo -u postgres createdb "$FRESH_DB"
FRESH_DB_CREATED=1
sudo -u postgres pg_restore --no-owner --no-privileges --exit-on-error -d "$FRESH_DB" "$PG_TMP/fresh.dump" > "$TMP_DIR/fresh.restore.log" 2>&1 || { log "FAIL fresh restore"; exit 1; }
log "FRESH_RESTORE=OK"
run_metrics "$FRESH_DB" "$TMP_DIR/fresh.metrics"
if diff -u "$TMP_DIR/source-after.metrics" "$TMP_DIR/fresh.metrics" > "$TMP_DIR/fresh.diff" 2>&1; then
  log "FRESH_VS_SOURCE=EXACT_MATCH"
else
  log "FRESH_VS_SOURCE=DIFF"
  grep -E '^[+-][^+-]' "$TMP_DIR/fresh.diff" | head -20 || true
fi
rm -f "$PG_TMP/fresh.dump"

app_smoke "$FRESH_DB" "FRESH"

log "DONE (temp DBs/role/files will be removed by cleanup)"
log "SUMMARY daily_restore=OK fresh_restore=OK offsite=$OFFSITE_STATUS"
