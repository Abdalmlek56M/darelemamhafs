#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPT_DIR/../../lib/guard.sh"
dar_guard_require_env Q2_FAIL DAR_TEST_DATABASE Q2_LEGACY_URL Q2_NEW_URL Q2_SETUP_TOKEN
dar_guard_targets Q2_FAIL "$DAR_TEST_DATABASE" "$Q2_LEGACY_URL" "$Q2_NEW_URL"
exec node "$SCRIPT_DIR/run.mjs"
