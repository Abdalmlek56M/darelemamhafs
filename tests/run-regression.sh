#!/usr/bin/env bash
# Dar Eltahfeez full regression harness (FINAL 2.16).
#
# Runs on the deploy host as root, against a disposable PostgreSQL database cloned from
# DAR_BASELINE_DB (schema template) and the two published apps (legacy + refactored new API).
# CI runs the DB-only subset in .github/workflows/regression.yml with a postgres service;
# see tests/README-regression.md for the exact provisioning contract.
#
# Usage:
#   DAR_BASELINE_DB=dar_schema_template sudo -E bash tests/run-regression.sh
#   DAR_ONLY_SUITE=q1,b10-cookie-secure sudo -E bash tests/run-regression.sh
#   bash tests/run-regression.sh --list
#
# A missing DAR_BASELINE_DB (or a non-root shell that cannot provision PostgreSQL) fails the
# harness immediately with exit code 2 instead of skipping DB-backed suites silently.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAMP="$(date +%s)"
APP="/tmp/dar-regression-$STAMP"
UNIT_LOG="$APP/unit.log"
PORT_OLD=6170
PORT_NEW=6171
SETUP_TOKEN="regression-setup"
PASS="Reg$(openssl rand -hex 12 2>/dev/null || od -An -N12 -tx1 /dev/urandom | tr -d ' \n')Pass123"
FAILED=0
SUITES_RUN=0
SQL_SUITES_RUN=0
UI_SUITES_NOT_RUN=()

# Explicit, reviewed allow-list for the 5 open Q-3 parity mismatches (see
# tests/regression/parity-q3/parity-report.md). Anything else fails the Q-3 suite.
Q3_ALLOWED_MISMATCHES="${Q3_ALLOWED_MISMATCHES:-absence_locked,cancellation_locked,correction_locked,outside_scope_403,direct_adjust_present_to_30}"

list_suites() {
  cat <<'EOF'
Node suites (in run order):
  test-lib-guard            guard unit + missing-DB contract (no DB)
  repo-secrets              repository secret scan (no DB)
  backup-source             backend backup-source contract (no DB)
  q1                        approval-paths (Q1)
  q2                        payroll-lock (Q2)
  q3                        parity-q3 (Q3; open mismatches allow-listed by Q3_ALLOWED_MISMATCHES)
  q4                        money-rules (Q4)
  q5                        scope-enforcement (Q5)
  q6-review                 request-workflow review parity
  q6-admin                  request-workflow admin actions
  q6-teacher                request-workflow teacher/payroll
  request-notification-close (P1-5)
  finance-permission-matrix-api / -supervisor (P1-7)
  pagination-admin, pagination-stability, supervisor-pagination
  tier0-*, tier1-*, tier2-*, b7-cookie-size, b10-cookie-secure, integrity-sql,
  z1-*, z2-audit-writer, tier2-search, tier2-history
SQL suites (each in its own disposable DB):
  financial_void_verify.sql, schedule_overlap_verify.sql,
  schedule_overlap_hardening_verify.sql, teacher_attendance_rate_snapshot.test.sql,
  enrollment_month_eligibility.test.sql, teacher_schedule_overlap.test.sql
Browser/UI suites (require DAR_UI_SUITES=1 + built SPA + their fixtures):
  ad-expense-edit, api-error-envelope, enrollment-null-reason, error-boundary, lazy-pages,
  lazy-shell, locale-formatting, mobile-nav-single, new-api-errors, payment-void-subscription,
  phone-validation, students-pagination, void-dialog-stack, finance-permission-matrix-ui
EOF
}

if [ "${1:-}" = "--list" ]; then
  list_suites
  exit 0
fi

preflight() {
  if [ -z "${DAR_BASELINE_DB:-}" ]; then
    echo "PREFLIGHT_FAIL DAR_BASELINE_DB is required (name of the disposable schema-template database)." >&2
    echo "  Example: DAR_BASELINE_DB=dar_schema_template sudo -E bash tests/run-regression.sh" >&2
    exit 2
  fi
  if [ "$(id -u)" -ne 0 ]; then
    echo "PREFLIGHT_FAIL tests/run-regression.sh must run as root: it uses 'sudo -u postgres' to create the disposable database and 'sudo -u deploy' to run the apps." >&2
    exit 2
  fi
  for tool in sudo psql createdb node dotnet curl; do
    command -v "$tool" >/dev/null 2>&1 || { echo "PREFLIGHT_FAIL required tool missing from PATH: $tool" >&2; exit 2; }
  done
  if ! sudo -u postgres psql -tAc 'SELECT 1;' >/dev/null 2>&1; then
    echo "PREFLIGHT_FAIL cannot connect to PostgreSQL as the postgres OS user (sudo -u postgres psql)." >&2
    exit 2
  fi
  if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$DAR_BASELINE_DB';" | grep -q 1; then
    echo "PREFLIGHT_FAIL DAR_BASELINE_DB='$DAR_BASELINE_DB' does not exist; create the disposable schema template database first." >&2
    exit 2
  fi
  id deploy >/dev/null 2>&1 || { echo "PREFLIGHT_FAIL the 'deploy' OS user is required to publish/run the apps." >&2; exit 2; }
}

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
  echo "BUILD $(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"
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
  local safe_name
  safe_name=$(echo "$1" | tr '-' '_')
  DB="dar_reg_$safe_name"_"$STAMP"
  ROLE="dar_reg_$safe_name"_role_"$STAMP"
  sudo -u postgres psql -c "DROP DATABASE IF EXISTS \"$DB\" WITH (FORCE);" >/dev/null 2>&1 || true
  sudo -u postgres psql -c "DROP ROLE IF EXISTS \"$ROLE\";" >/dev/null 2>&1 || true
  local role_sql="CREATE ROLE $ROLE LOGIN SUPERUSER PASSWORD '$PASS';"
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "$role_sql" >/dev/null || return 1
  sudo -u postgres createdb -O "$ROLE" "$DB" || return 1
  sudo -u postgres pg_dump -s -O -x "$DAR_BASELINE_DB" | sudo -u postgres psql -q -v ON_ERROR_STOP=1 -d "$DB" || return 1
  DBENV="Host=127.0.0.1;Port=5432;Database=$DB;Username=$ROLE;Password=$PASS"
  # Apply post-baseline migrations to the disposable schema (production applies them via deploy).
  # 03[2-9] = the FINAL hardening migrations; 04[0-9] = Tier-2 additions (pg_trgm search, history...).
  local migration_file
  for migration_file in "$ROOT"/database/03[2-9]*.sql "$ROOT"/database/04[0-9]_*.sql; do
    [ -e "$migration_file" ] || continue
    sudo -u postgres psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$migration_file" >/dev/null || return 1
  done
}

start_apps() {
  cd "$APP/legacy"
  env ASPNETCORE_ENVIRONMENT=Development ASPNETCORE_URLS="http://127.0.0.1:$PORT_OLD" \
    ConnectionStrings__DarDatabase="$DBENV" Auth__SetupToken="$SETUP_TOKEN" Auth__RateLimit__PermitLimit=10000 \
    Media__RootPath="$APP/media" \
    Database__ApplyMigrationsOnStartup=false TZ=UTC \
    dotnet DarEltahfeez.Api.dll > "$APP/$1-old.log" 2>&1 &
  OLD_PID=$!
  cd "$APP/new"
  env ASPNETCORE_ENVIRONMENT=Development ASPNETCORE_URLS="http://127.0.0.1:$PORT_NEW" \
    ConnectionStrings__Default="$DBENV" Database__ApplyMigrationsOnStartup=false TZ=UTC Auth__RateLimit__PermitLimit=10000 Meet__EncryptionKey=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= Meet__InternalToken=regression-internal-token \
    dotnet Dar.Api.dll > "$APP/$1-new.log" 2>&1 &
  NEW_PID=$!
  for _ in $(seq 1 60); do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://127.0.0.1:$PORT_OLD/health/ready" || true)
    [ "$code" = "200" ] && break
    sleep 1
  done
  for _ in $(seq 1 60); do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://127.0.0.1:$PORT_NEW/api/v1/ping" || true)
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

psql_db() {
  sudo -u postgres psql -X -q -v ON_ERROR_STOP=1 -d "$DB" "$@"
}

# Shared environment for every node suite. All historical prefixes point at this run's
# disposable database and the two loopback apps; a suite only reads its own prefix.
suite_env() {
  SUITE_ENV=(
    "DAR_TEST_DATABASE=$DBENV"
    "DAR_TEST_DB_ALLOWLIST=dar_reg_*"
    "DAR_LEGACY_APP_DIR=$APP/legacy"
    "DAR_NEW_APP_DIR=$APP/new"
    "TZ=UTC"
    "Q1_LEGACY_URL=http://127.0.0.1:$PORT_OLD" "Q1_NEW_URL=http://127.0.0.1:$PORT_NEW" "Q1_SETUP_TOKEN=$SETUP_TOKEN" "Q1_PASSWORD=RegressionStrong!"
    "Q2_LEGACY_URL=http://127.0.0.1:$PORT_OLD" "Q2_NEW_URL=http://127.0.0.1:$PORT_NEW" "Q2_SETUP_TOKEN=$SETUP_TOKEN" "Q2_PASSWORD=RegressionStrong!"
    "Q3_LEGACY_URL=http://127.0.0.1:$PORT_OLD" "Q3_NEW_URL=http://127.0.0.1:$PORT_NEW" "Q3_SETUP_TOKEN=$SETUP_TOKEN" "Q3_PASSWORD=RegressionStrong!"
    "Q3_REPORT_PATH=$APP/q3-parity-report.md" "Q3_ALLOWED_MISMATCHES=$Q3_ALLOWED_MISMATCHES" "Q3_COMMIT=$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"
    "Q4_LEGACY_URL=http://127.0.0.1:$PORT_OLD" "Q4_SETUP_TOKEN=$SETUP_TOKEN" "Q4_PASSWORD=RegressionStrong!"
    "Q5_LEGACY_URL=http://127.0.0.1:$PORT_OLD" "Q5_NEW_URL=http://127.0.0.1:$PORT_NEW" "Q5_SETUP_TOKEN=$SETUP_TOKEN" "Q5_PASSWORD=RegressionStrong!"
    "Q6_LEGACY_URL=http://127.0.0.1:$PORT_OLD" "Q6_NEW_URL=http://127.0.0.1:$PORT_NEW" "Q6_SETUP_TOKEN=$SETUP_TOKEN" "Q6_PASSWORD=RegressionStrong!" "Q6_MEET_INTERNAL_TOKEN=regression-internal-token" "Q6_MEDIA_ROOT=$APP/media"
    "P15_LEGACY_URL=http://127.0.0.1:$PORT_OLD" "P15_NEW_URL=http://127.0.0.1:$PORT_NEW" "P15_SETUP_TOKEN=$SETUP_TOKEN" "P15_PASSWORD=RegressionStrong!"
    "P17_BASE_URL=http://127.0.0.1:$PORT_OLD" "P17_NEW_BASE_URL=http://127.0.0.1:$PORT_NEW" "P17_TEST_PASSWORD=P17-StrongPass!" "P17_DAR_TEST_DATABASE=$DBENV"
    "P21_BASE_URL=http://127.0.0.1:$PORT_OLD" "P21_PASSWORD=P21-StrongPass!"
    "P21R_BASE_URL=http://127.0.0.1:$PORT_OLD" "P21R_PASSWORD=P21R-StrongPass!"
    "P23_LEGACY_URL=http://127.0.0.1:$PORT_OLD" "P23_NEW_URL=http://127.0.0.1:$PORT_NEW" "P23_PASSWORD=P23-StrongPass!"
    "P24_BASE_URL=http://127.0.0.1:$PORT_OLD" "P24_PASSWORD=P24-StrongPass!"
    "P25_BASE_URL=http://127.0.0.1:$PORT_OLD" "P25_PASSWORD=P25-StrongPass!"
    "P26_BASE_URL=http://127.0.0.1:$PORT_OLD" "P26_PASSWORD=P26-StrongPass!" "P26_MODE=after" "P26_SHOTS=$APP/p26-shots"
    "P26F_BASE_URL=http://127.0.0.1:$PORT_OLD" "P26F_PASSWORD=P26F-StrongPass!"
    "P27B_BASE_URL=http://127.0.0.1:$PORT_OLD" "P27B_PASSWORD=P27B-StrongPass!"
    "P27C_LEGACY_URL=http://127.0.0.1:$PORT_OLD" "P27C_NEW_URL=http://127.0.0.1:$PORT_NEW" "P27C_PASSWORD=P27C-StrongPass!"
    "P28A_BASE_URL=http://127.0.0.1:$PORT_OLD"
    "P28B_BASE_URL=http://127.0.0.1:$PORT_OLD" "P28B_LEGACY_URL=http://127.0.0.1:$PORT_OLD" "P28B_NEW_URL=http://127.0.0.1:$PORT_NEW" "P28B_SETUP_TOKEN=$SETUP_TOKEN" "P28B_PASSWORD=P28B-StrongPass!"
    "P29_BASE_URL=http://127.0.0.1:$PORT_OLD" "P29_LEGACY_URL=http://127.0.0.1:$PORT_OLD" "P29_NEW_URL=http://127.0.0.1:$PORT_NEW" "P29_SETUP_TOKEN=$SETUP_TOKEN" "P29_PASSWORD=P29-StrongPass!"
  )
}

setup_admin() {
  local username="$1" password="$2"
  curl -s -o "$APP/setup-$username.out" -w '%{http_code}' -X POST \
    "http://127.0.0.1:$PORT_OLD/api/setup/admin" -H 'Content-Type: application/json' \
    -H "X-Setup-Token: $SETUP_TOKEN" \
    -d "{\"username\":\"$username\",\"displayName\":\"$username\",\"password\":\"$password\"}" || true
}

# --- suite-specific fixtures (kept close to the suites they belong to) ----------------------
prep_none() { :; }

prep_legacy_admin() {
  # $1 = username, $2 = password: create the suite's admin through the setup endpoint.
  local code
  code=$(setup_admin "$1" "$2")
  if [ "$code" != "200" ] && [ "$code" != "409" ]; then
    echo "PREP_FAIL setup admin $1 -> HTTP $code"
    return 1
  fi
}

prep_p17() {
  prep_legacy_admin p17_admin 'P17-StrongPass!' || return 1
  sudo -u postgres psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f - < "$ROOT/tests/regression/finance-permission-matrix/seed.sql" >/dev/null || return 1
  local cookie="$APP/p17-admin.cookies" base='"dashboard.read","students.read","teachers.read","circles.read","schedule.read","attendance.read","audit.read","exports.manage","settings.manage"'
  curl -s -c "$cookie" -o /dev/null -X POST "http://127.0.0.1:$PORT_OLD/api/auth/login" \
    -H 'Content-Type: application/json' -d '{"username":"p17_admin","password":"P17-StrongPass!"}' || return 1
  mkuser() {
    local username="$1" extra="$2" perms
    if [ -n "$extra" ]; then perms="[$base,$extra]"; else perms="[$base]"; fi
    curl -s -b "$cookie" -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:$PORT_OLD/api/admin/users" \
      -H 'Content-Type: application/json' \
      -d "{\"username\":\"$username\",\"displayName\":\"$username\",\"password\":\"P17-StrongPass!\",\"permissionCodes\":$perms}" | grep -Eq '^(200|201|409)$' \
      || { echo "PREP_FAIL create user $username"; return 1; }
  }
  mkuser p17_none '' || return 1
  mkuser p17_create '"finance.create"' || return 1
  mkuser p17_read '"finance.read"' || return 1
  mkuser p17_reports '"reports.finance"' || return 1
  mkuser p17_control '"finance.read","reports.finance"' || return 1
  mkuser p17_supervisor_nofin '"supervisor.portal","supervisor.live","supervisor.unpaid","supervisor.students.read"' || return 1
  mkuser p17_supervisor_fin '"supervisor.portal","supervisor.live","supervisor.unpaid","supervisor.students.read","finance.read"' || return 1
}

prep_p21r() {
  prep_legacy_admin p21r_admin 'P21R-StrongPass!' || return 1
  psql_db -c "INSERT INTO students(id,student_code,full_name,status,joined_on) VALUES (gen_random_uuid(),'P21R-STUDENT','P21R Student','active',DATE '2026-01-01');
    INSERT INTO circles(id,circle_code,name,is_active,starts_on) VALUES ('2a000000-0000-4000-8000-000000000001','P21R-C','P21R Circle',TRUE,DATE '2026-01-01');
    INSERT INTO circle_enrollments(id,student_id,circle_id,starts_on,agreed_monthly_fee,status)
      SELECT gen_random_uuid(),id,'2a000000-0000-4000-8000-000000000001',DATE '2026-01-01',0,'active' FROM students WHERE student_code='P21R-STUDENT';" >/dev/null || return 1
}

prep_p27b() { prep_legacy_admin p27b_admin 'P27B-StrongPass!'; }
prep_p27c() { prep_legacy_admin p27c_admin 'P27C-StrongPass!'; }

run_suite() {
  local name="$1" file="$2" mode="${3:-generic}" prep="${4:-prep_none}"
  if [ -n "${DAR_ONLY_SUITE:-}" ]; then case ",${DAR_ONLY_SUITE}," in *",$name,"*) ;; *) return 0 ;; esac; fi
  local rc=0
  echo "== $name =="
  prepare_db "$name" || { FAILED=1; return; }
  start_apps "$name"
  suite_env
  if [ "$prep" != "prep_none" ]; then
    if ! "$prep"; then echo "$name PREP_FAILED"; FAILED=1; stop_apps; cleanup; ROLE=""; DB=""; return; fi
  fi
  cd "$ROOT"
  sudo -u deploy env "${SUITE_ENV[@]}" node "$file" > "$APP/$name.json" 2> "$APP/$name.err"
  rc=$?
  echo "$name EXIT=$rc"
  tail -1 "$APP/$name.json" 2>/dev/null || true
  if [ -s "$APP/$name.err" ] && [ "$rc" -ne 0 ]; then tail -5 "$APP/$name.err" || true; fi
  [ "$rc" -ne 0 ] && FAILED=1
  SUITES_RUN=$((SUITES_RUN + 1))
  stop_apps
  cleanup
  ROLE=""
  DB=""
}

# DB-only suite: one disposable database, one psql -f, no apps. Any FAIL inside the SQL
# raises (the scripts carry their own gate); ON_ERROR_STOP makes psql exit non-zero.
run_sql_suite() {
  local name="$1" file="$2"
  if [ -n "${DAR_ONLY_SUITE:-}" ]; then case ",${DAR_ONLY_SUITE}," in *",$name,"*) ;; *) return 0 ;; esac; fi
  echo "== $name (sql) =="
  prepare_db "$name" || { FAILED=1; return; }
  local log="$APP/$name.sql.log" rc=0
  sudo -u postgres psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f - < "$ROOT/$file" > "$log" 2>&1
  rc=$?
  echo "$name EXIT=$rc"
  grep -E 'PASS|FAIL|ERROR|NOTICE|passed|PASSED' "$log" | tail -4 || true
  if [ "$rc" -ne 0 ]; then FAILED=1; tail -20 "$log" || true; fi
  SQL_SUITES_RUN=$((SQL_SUITES_RUN + 1))
  cleanup
  ROLE=""
  DB=""
}

# Suite with no database/apps requirement: runs on the current host, still must exit non-zero
# on failure (never a silent skip).
run_plain_suite() {
  local name="$1" command="$2" rc=0
  if [ -n "${DAR_ONLY_SUITE:-}" ]; then case ",${DAR_ONLY_SUITE}," in *",$name,"*) ;; *) return 0 ;; esac; fi
  echo "== $name =="
  ( cd "$ROOT" && sudo -u deploy env bash -c "$command" ) > "$APP/$name.log" 2>&1
  rc=$?
  echo "$name EXIT=$rc"
  tail -2 "$APP/$name.log" 2>/dev/null || true
  [ "$rc" -ne 0 ] && FAILED=1
  SUITES_RUN=$((SUITES_RUN + 1))
}

# Browser/UI suite. These need a built SPA served by the legacy publish plus per-suite seeded
# fixtures, so they are opt-in: `DAR_UI_SUITES=1`. When disabled they are reported explicitly
# (never as a green pass) in the final RESULT line.
run_ui_suite() {
  local name="$1" file="$2" prep="${3:-prep_none}"
  if [ "${DAR_UI_SUITES:-0}" != "1" ]; then
    UI_SUITES_NOT_RUN+=("$name")
    echo "UI_SUITE $name NOT_RUN (set DAR_UI_SUITES=1 after building frontend/dist and seeding fixtures)"
    return 0
  fi
  run_suite "$name" "$file" ui "$prep"
}

echo "STAMP=$STAMP APP=$APP"
preflight
mkdir -p "$APP"
chown -R deploy:deploy "$APP"
build || { echo BUILD_FAILED; exit 1; }
[ "$FAILED" -eq 0 ] || { echo UNIT_FAILED; exit 1; }
cd "$ROOT"

# --- guard/contract suites that must never silently pass --------------------------------
run_plain_suite safety-guard-test "bash tests/regression/safety-guard-test.sh"
run_plain_suite test-lib-guard "node tests/regression/test-lib-guard/run.mjs"

# --- original licensed harness suites ---------------------------------------------------
run_suite q1 tests/regression/approval-paths/run.mjs generic
run_suite q2 tests/regression/payroll-lock/run.mjs generic
run_suite q3 tests/regression/parity-q3/run.mjs generic
run_suite q4-money-rules tests/regression/money-rules/run.mjs generic
run_suite q5 tests/regression/scope-enforcement/run.mjs generic
run_suite q6-review tests/regression/request-workflow/review.mjs q6
run_suite q6-admin tests/regression/request-workflow/admin-actions.mjs q6
run_suite q6-teacher tests/regression/request-workflow/teacher-payroll.mjs q6
run_suite request-notification-close tests/regression/request-notification-close/run.mjs q6
run_suite supervisor-pagination tests/regression/supervisor-pagination/run.mjs q6
run_suite pagination-stability tests/regression/pagination-stability/run.mjs q6
run_suite pagination-admin tests/regression/pagination-admin/run.mjs q6
run_suite tier0-money tests/regression/tier0-money/run.mjs q6
run_suite tier0-trigger tests/regression/tier0-trigger/run.mjs q6
run_suite tier0-idempotency tests/regression/tier0-idempotency/run.mjs q6
run_suite tier0-profit tests/regression/tier0-profit/run.mjs q6
run_suite tier0-meet-settings tests/regression/tier0-meet-settings/run.mjs q6
run_suite repo-secrets tests/regression/repo-secrets/run.mjs q6
run_suite tier0-sessions tests/regression/tier0-sessions/run.mjs q6
run_suite z1-auth-characterization tests/regression/z1-auth-characterization/run.mjs q6
run_suite z1-bot-repo-characterization tests/regression/z1-bot-repo-characterization/run.mjs q6
run_suite backup-source tests/regression/backup-source/run.mjs generic
run_suite tier1-permission-catalog tests/regression/tier1-permission-catalog/run.mjs q6
run_suite tier1-trash-purge tests/regression/tier1-trash-purge/run.mjs q6
run_suite tier1-backup-download tests/regression/tier1-backup-download/run.mjs q6
run_suite tier1-attendance-unique tests/regression/tier1-attendance-unique/run.mjs q6
run_suite tier1-student-joined tests/regression/tier1-student-joined/run.mjs q6
run_suite tier1-circle-schedule tests/regression/tier1-circle-schedule/run.mjs q6
run_suite tier1-expense-trashed tests/regression/tier1-expense-trashed/run.mjs q6
run_suite tier1-unique-race tests/regression/tier1-unique-race/run.mjs q6
run_suite tier1-money-audit tests/regression/tier1-money-audit/run.mjs q6
run_suite tier1-profit-server tests/regression/tier1-profit-server/run.mjs q6
run_suite tier1-notification-sync tests/regression/tier1-notification-sync/run.mjs q6
run_suite tier1-teacher-state tests/regression/tier1-teacher-state/run.mjs q6
run_suite tier1-migration-cleanup tests/regression/tier1-migration-cleanup/run.mjs generic
run_suite tier1-migration-034 tests/regression/tier1-migration-034/run.mjs generic
run_suite tier1-oauth-state tests/regression/tier1-oauth-state/run.mjs generic
run_suite tier2-indexes tests/regression/tier2-indexes/run.mjs generic
run_suite tier2-retention tests/regression/tier2-retention/run.mjs q6
run_suite tier2-meet-cap tests/regression/tier2-meet-cap/run.mjs generic
run_suite b7-cookie-size tests/regression/b7-cookie-size/run.mjs q6
run_suite b10-cookie-secure tests/regression/b10-cookie-secure/run.mjs q6
run_suite z2-audit-writer tests/regression/z2-audit-writer/run.mjs q6
run_suite tier2-search tests/regression/tier2-search/run.mjs q6
run_suite tier2-history tests/regression/tier2-history/run.mjs q6
run_suite tier2-queries tests/regression/tier2-queries/run.mjs generic
run_suite tier2-history-fk tests/regression/tier2-history-fk/run.mjs q6
run_suite tier2-blobs tests/regression/tier2-blobs/run.mjs q6
run_suite security-permissions tests/regression/security-permissions/run.mjs q6
run_plain_suite docs-migration-count "node tests/regression/docs-migration-count/run.mjs"
run_plain_suite tier2-deploy "node tests/regression/tier2-deploy/run.mjs"
run_suite integrity-sql tests/regression/integrity-sql/run.mjs generic

# --- P1-7 finance permission matrix (fixtures: seed.sql + 7 accounts) ------------------
run_suite p17-api-matrix tests/regression/finance-permission-matrix/api-matrix.mjs generic prep_p17
run_suite p17-supervisor-matrix tests/regression/finance-permission-matrix/supervisor-matrix.mjs generic prep_p17

# --- SQL verification suites (real objects, internal FAIL gates) -----------------------
run_sql_suite sql-financial-void tests/regression/sql/financial_void_verify.sql
run_sql_suite sql-schedule-overlap tests/regression/sql/schedule_overlap_verify.sql
run_sql_suite sql-schedule-overlap-hardening tests/regression/sql/schedule_overlap_hardening_verify.sql
run_sql_suite sql-teacher-attendance-snapshot tests/regression/sql/teacher_attendance_rate_snapshot.test.sql
run_sql_suite sql-enrollment-eligibility tests/regression/sql/enrollment_month_eligibility.test.sql
run_sql_suite sql-teacher-schedule-overlap tests/regression/sql/teacher_schedule_overlap.test.sql

# --- browser/UI suites (opt-in; explicitly reported when not run) ----------------------
run_ui_suite ui-ad-expense-edit tests/regression/ad-expense-edit/run.js prep_none
run_ui_suite ui-api-error-envelope tests/regression/api-error-envelope/run.js prep_p27b
run_ui_suite ui-enrollment-null-reason tests/regression/enrollment-null-reason/run.js prep_p21r
run_ui_suite ui-error-boundary tests/regression/error-boundary/run.js prep_none
run_ui_suite ui-finance-permission-matrix tests/regression/finance-permission-matrix/ui-matrix.js prep_p17
run_ui_suite ui-lazy-pages tests/regression/lazy-pages/run.js prep_none
run_ui_suite ui-lazy-shell tests/regression/lazy-shell/run.js prep_none
run_ui_suite ui-locale-formatting tests/regression/locale-formatting/run.js prep_none
run_ui_suite ui-mobile-nav-single tests/regression/mobile-nav-single/run.js prep_none
run_ui_suite ui-new-api-errors tests/regression/new-api-errors/run.js prep_p27c
run_ui_suite ui-payment-void-subscription tests/regression/payment-void-subscription/run.js prep_none
run_ui_suite ui-phone-validation tests/regression/phone-validation/run.js prep_none
run_ui_suite ui-students-pagination tests/regression/students-pagination/run.js prep_none
run_ui_suite ui-void-dialog-stack tests/regression/void-dialog-stack/run.js prep_none

UI_NOTE=""
if [ "${#UI_SUITES_NOT_RUN[@]}" -gt 0 ]; then
  UI_NOTE=" UI_SUITES_NOT_RUN=${#UI_SUITES_NOT_RUN[@]}:$(IFS=,; echo "${UI_SUITES_NOT_RUN[*]}")"
fi
echo "NODE_SUITES=$SUITES_RUN SQL_SUITES=$SQL_SUITES_RUN"
echo "RESULT=$([ "$FAILED" -eq 0 ] && echo PASS || echo FAIL)$UI_NOTE"
exit "$FAILED"
