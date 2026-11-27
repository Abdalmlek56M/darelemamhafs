#!/usr/bin/env bash
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PASS=0
FAIL=0

expect_refusal() {
  label="$1"; shift
  output="$("$@" 2>&1)"
  rc=$?
  if [ "$rc" -eq 2 ] && printf '%s' "$output" | grep -qi 'refus'; then
    PASS=$((PASS + 1)); echo "PASS $label"
  else
    FAIL=$((FAIL + 1)); echo "FAIL $label rc=$rc output=$output"
  fi
}

LOCAL_DB='Host=127.0.0.1;Port=5432;Database=guard_test;Username=guard;Password=guard'
PROD_DB='Host=127.0.0.1;Port=5432;Database=guard_forbidden_db;Username=guard;Password=guard'
PROD_URL='https://prod.example.invalid'
LOCAL_URL='http://127.0.0.1:5099'
PROD_IP_URL='http://198.51.100.10:5099'
export DAR_FORBIDDEN_DB='guard_forbidden_db'
export DAR_FORBIDDEN_HOSTS='prod.example.invalid,198.51.100.10'

# Q-1 shell guard: production database name
expect_refusal "q1_shell_prod_db" env DAR_TEST_DATABASE="$PROD_DB" Q1_LEGACY_URL="$LOCAL_URL" Q1_NEW_URL="$LOCAL_URL" Q1_SETUP_TOKEN="guard" bash "$ROOT/tests/regression/approval-paths/run.sh"
# Q-1 JS guard: production URL
expect_refusal "q1_js_prod_url" env DAR_TEST_DATABASE="$LOCAL_DB" Q1_LEGACY_URL="$PROD_URL" Q1_NEW_URL="$LOCAL_URL" Q1_SETUP_TOKEN="guard" node "$ROOT/tests/regression/approval-paths/run.mjs"
# Q-1 JS guard: production IP URL
expect_refusal "q1_js_prod_ip" env DAR_TEST_DATABASE="$LOCAL_DB" Q1_LEGACY_URL="$LOCAL_URL" Q1_NEW_URL="$PROD_IP_URL" Q1_SETUP_TOKEN="guard" node "$ROOT/tests/regression/approval-paths/run.mjs"

# Q-2 shell guard: production database name
expect_refusal "q2_shell_prod_db" env DAR_TEST_DATABASE="$PROD_DB" Q2_LEGACY_URL="$LOCAL_URL" Q2_NEW_URL="$LOCAL_URL" Q2_SETUP_TOKEN="guard" bash "$ROOT/tests/regression/payroll-lock/run.sh"
# Q-2 JS guard: production URL
expect_refusal "q2_js_prod_url" env DAR_TEST_DATABASE="$LOCAL_DB" Q2_LEGACY_URL="$LOCAL_URL" Q2_NEW_URL="$PROD_URL" Q2_SETUP_TOKEN="guard" node "$ROOT/tests/regression/payroll-lock/run.mjs"

# P1-7 guards
expect_refusal "p17_api_prod_url" env P17_BASE_URL="$PROD_URL" node "$ROOT/tests/regression/finance-permission-matrix/api-matrix.mjs"
expect_refusal "p17_ui_prod_url" env P17_BASE_URL="$PROD_URL" node "$ROOT/tests/regression/finance-permission-matrix/ui-matrix.js"
expect_refusal "p17_supervisor_prod_url" env P17_NEW_BASE_URL="$PROD_URL" node "$ROOT/tests/regression/finance-permission-matrix/supervisor-matrix.mjs"
expect_refusal "p17_api_prod_db" env P17_DAR_TEST_DATABASE="$PROD_DB" P17_BASE_URL="$LOCAL_URL" node "$ROOT/tests/regression/finance-permission-matrix/api-matrix.mjs"

# FINAL 2.16/2.17: a missing DAR_TEST_DATABASE must fail (never silently pass), and the shared
# allow-list guard must refuse a database name that is not on DAR_TEST_DB_ALLOWLIST.
expect_refusal "q1_shell_missing_db" env -u DAR_TEST_DATABASE \
  Q1_LEGACY_URL="$LOCAL_URL" Q1_NEW_URL="$LOCAL_URL" Q1_SETUP_TOKEN="guard" \
  bash "$ROOT/tests/regression/approval-paths/run.sh"
expect_refusal "q1_js_missing_db" env -u DAR_TEST_DATABASE \
  Q1_LEGACY_URL="$LOCAL_URL" Q1_NEW_URL="$LOCAL_URL" Q1_SETUP_TOKEN="guard" \
  node "$ROOT/tests/regression/approval-paths/run.mjs"
expect_refusal "p17_api_allowlist_db" env DAR_TEST_DB_ALLOWLIST='dar_reg_*' P17_DAR_TEST_DATABASE="$PROD_DB" P17_BASE_URL="$LOCAL_URL" node "$ROOT/tests/regression/finance-permission-matrix/api-matrix.mjs"
expect_refusal "p17_supervisor_allowlist_db" env DAR_TEST_DB_ALLOWLIST='dar_reg_*' P17_DAR_TEST_DATABASE="$PROD_DB" P17_NEW_BASE_URL="$LOCAL_URL" node "$ROOT/tests/regression/finance-permission-matrix/supervisor-matrix.mjs"

TOTAL=$((PASS + FAIL))
echo "SAFETY_GUARD tested=$TOTAL passed=$PASS failed=$FAIL"
if [ "$FAIL" -ne 0 ] || [ "$TOTAL" -ne 13 ]; then
  exit 1
fi
echo "SAFETY_GUARD_PASS"
