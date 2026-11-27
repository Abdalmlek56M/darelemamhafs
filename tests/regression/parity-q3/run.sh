#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPT_DIR/../../lib/guard.sh"
dar_guard_require_env Q3_FAIL DAR_TEST_DATABASE Q3_LEGACY_URL Q3_NEW_URL Q3_SETUP_TOKEN
dar_guard_targets Q3_FAIL "$DAR_TEST_DATABASE" "$Q3_LEGACY_URL" "$Q3_NEW_URL"
exec node "$SCRIPT_DIR/run.mjs"
