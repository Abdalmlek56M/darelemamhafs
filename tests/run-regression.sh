#!/usr/bin/env bash
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAMP="$(date +%s)"
APP="/tmp/dar-regression-$STAMP"
UNIT_LOG="$APP/unit.log"
PORT_OLD=6170
PORT_NEW=6171
PASS=RegressionPass123
FAILED=0

cleanup() {
  [ -n "${OLD_PID:-}" ] && kill "$OLD_PID" 2>/dev/null || true
  [ -n "${NEW_PID:-}" ] && kill "$NEW_PID" 2>/dev/null || true
  wait 2>/dev/null || true
  [ -n "${DB:-}" ] && sudo -u postgres psql -c "DROP DATABASE IF EXISTS \"$DB\" WITH (FORCE);" >/dev/null 2>&1 || true
  [ -n "${ROLE:-}" ] && sudo -u postgres psql -c "DROP ROLE IF EXISTS \"$ROLE\";" >/dev/null 2>&1 || true
}
trap cleanup EXIT

build() {
  mkdir -p "$APP/legacy" "$APP/new"
  chown -R deploy:deploy "$APP"
  echo "BUILD $(git -C "$ROOT" rev-parse --short HEAD)"
  sudo -u deploy bash -lc "dotnet test '$ROOT/tests/Dar.UnitTests/Dar.UnitTests.csproj' --nologo > '$UNIT_LOG' 2>&1"
  UNIT_RC=$?
  echo "UNIT=$UNIT_RC $(grep -E 'Passed!|Failed!' "$UNIT_LOG" | tail -1)"
  [ "$UNIT_RC" -ne 0 ] && FAILED=1
  local old_proj="$ROOT/backend/DarEltahfeez.Api/DarEltahfeez.Api.csproj"
  local old_out="$APP/legacy"
  local old_args="dotnet publish '$old_proj' -c Release -o '$old_out'"
  sudo -u deploy bash -lc "$old_args --nologo" > "$APP/build-old.log" 2>&1 || return 1
  local new_proj="$ROOT/src/Host/Dar.Api/Dar.Api.csproj"
  local new_out="$APP/new"
  local new_args="dotnet publish '$new_proj' -c Release -o '$new_out'"
  sudo -u deploy bash -lc "$new_args --nologo" > "$APP/build-new.log" 2>&1 || return 1
  chown -R deploy:deploy "$APP"
}

prepare_db() {
  safe_name=$(echo "$1" | tr '-' '_')
  safe_name=$(echo "$1" | tr '-' '_')
  DB="dar_reg_$safe_name"_"$STAMP"
  ROLE="dar_reg_$safe_name"_role_"$STAMP"
  sudo -u postgres psql -c "DROP DATABASE IF EXISTS \"$DB\" WITH (FORCE);" >/dev/null 2>&1 || true
  sudo -u postgres psql -c "DROP ROLE IF EXISTS \"$ROLE\";" >/dev/null 2>&1 || true
  local role_sql="CREATE ROLE $ROLE LOGIN SUPERUSER PASSWORD '$PASS';"
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "$role_sql" >/dev/null || return 1
  sudo -u postgres createdb -O "$ROLE" "$DB" || return 1
  sudo -u postgres pg_dump -s -O -x dareltahfeez | sudo -u postgres psql -q -v ON_ERROR_STOP=1 -d "$DB" || return 1
  DBENV="Host=127.0.0.1;Port=5432;Database=$DB;Username=$ROLE;Password=$PASS"
  # Apply post-baseline migrations to the disposable schema (production applies them via deploy).
  for migration_file in "$ROOT"/database/03[2-9]_*.sql; do
    [ -e "$migration_file" ] || continue
    sudo -u postgres psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$migration_file" >/dev/null || return 1
  done
}

start_apps() {
  cd "$APP/legacy"
  env ASPNETCORE_ENVIRONMENT=Development ASPNETCORE_URLS="http://127.0.0.1:$PORT_OLD" \
    ConnectionStrings__DarDatabase="$DBENV" Auth__SetupToken="regression-setup" \
    Database__ApplyMigrationsOnStartup=false TZ=UTC \
    dotnet DarEltahfeez.Api.dll > "$APP/$1-old.log" 2>&1 &
  OLD_PID=$!
  cd "$APP/new"
  env ASPNETCORE_ENVIRONMENT=Development ASPNETCORE_URLS="http://127.0.0.1:$PORT_NEW" \
    ConnectionStrings__Default="$DBENV" Database__ApplyMigrationsOnStartup=false TZ=UTC \
    dotnet Dar.Api.dll > "$APP/$1-new.log" 2>&1 &
  NEW_PID=$!
  for _ in $(seq 1 60); do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:$PORT_OLD/health/ready || true)
    [ "$code" = "200" ] && break
    sleep 1
  done
  for _ in $(seq 1 60); do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:$PORT_NEW/api/v1/ping || true)
    [ "$code" = "200" ] && break
    sleep 1
  done
}

stop_apps() {
  [ -n "${OLD_PID:-}" ] && kill "$OLD_PID" 2>/dev/null || true
  [ -n "${NEW_PID:-}" ] && kill "$NEW_PID" 2>/dev/null || true
  wait 2>/dev/null || true
  OLD_PID=""
  NEW_PID=""
  sleep 1
}

run_suite() {
  local name="$1" file="$2" mode="$3" rc=0
  echo "== $name =="
  prepare_db "$name" || { FAILED=1; return; }
  start_apps "$name"
  cd "$ROOT"
  local common="DAR_TEST_DATABASE=$DBENV"
  if [ "$mode" = "q6" ]; then
    sudo -u deploy env "$common" Q6_LEGACY_URL="http://127.0.0.1:$PORT_OLD" \
      Q6_NEW_URL="http://127.0.0.1:$PORT_NEW" Q6_SETUP_TOKEN="regression-setup" \
      Q6_PASSWORD="RegressionStrong!" node "$file" > "$APP/$name.json" 2> "$APP/$name.err"
    rc=$?
  else
    sudo -u deploy env "$common" Q1_LEGACY_URL="http://127.0.0.1:$PORT_OLD" \
      Q1_NEW_URL="http://127.0.0.1:$PORT_NEW" Q1_SETUP_TOKEN="regression-setup" \
      Q1_PASSWORD="RegressionStrong!" Q2_LEGACY_URL="http://127.0.0.1:$PORT_OLD" \
      Q2_NEW_URL="http://127.0.0.1:$PORT_NEW" Q2_SETUP_TOKEN="regression-setup" \
      Q2_PASSWORD="RegressionStrong!" Q3_LEGACY_URL="http://127.0.0.1:$PORT_OLD" \
      Q3_NEW_URL="http://127.0.0.1:$PORT_NEW" Q3_SETUP_TOKEN="regression-setup" \
      Q3_PASSWORD="RegressionStrong!" Q3_REPORT_PATH="$APP/$name-q3.md" \
      Q5_LEGACY_URL="http://127.0.0.1:$PORT_OLD" Q5_NEW_URL="http://127.0.0.1:$PORT_NEW" \
      Q5_SETUP_TOKEN="regression-setup" Q5_PASSWORD="RegressionStrong!" \
      node "$file" > "$APP/$name.json" 2> "$APP/$name.err"
    rc=$?
  fi
  echo "$name EXIT=$rc"
  tail -1 "$APP/$name.json" 2>/dev/null || true
  [ "$rc" -ne 0 ] && FAILED=1
  stop_apps
  cleanup
  ROLE=""
  DB=""
}

echo "STAMP=$STAMP APP=$APP"
build || { echo BUILD_FAILED; exit 1; }
[ "$FAILED" -eq 0 ] || { echo UNIT_FAILED; exit 1; }
cd "$ROOT"
run_suite q1 tests/regression/approval-paths/run.mjs generic
run_suite q2 tests/regression/payroll-lock/run.mjs generic
run_suite q3 tests/regression/parity-q3/run.mjs generic
run_suite q5 tests/regression/scope-enforcement/run.mjs generic
run_suite q6-review tests/regression/request-workflow/review.mjs q6
run_suite q6-admin tests/regression/request-workflow/admin-actions.mjs q6
run_suite q6-teacher tests/regression/request-workflow/teacher-payroll.mjs q6
run_suite supervisor-pagination tests/regression/supervisor-pagination/run.mjs q6
run_suite pagination-stability tests/regression/pagination-stability/run.mjs q6
run_suite pagination-admin tests/regression/pagination-admin/run.mjs q6
run_suite tier0-money tests/regression/tier0-money/run.mjs q6
run_suite tier0-trigger tests/regression/tier0-trigger/run.mjs q6
run_suite tier0-idempotency tests/regression/tier0-idempotency/run.mjs q6
echo "RESULT=$([ "$FAILED" -eq 0 ] && echo PASS || echo FAIL)"
exit "$FAILED"
