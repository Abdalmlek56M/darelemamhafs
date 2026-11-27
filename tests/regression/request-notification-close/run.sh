#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPT_DIR/../../lib/guard.sh"
dar_guard_require_env P15_FAIL DAR_TEST_DATABASE P15_LEGACY_URL P15_NEW_URL P15_SETUP_TOKEN
dar_guard_targets P15_FAIL "$DAR_TEST_DATABASE" "$P15_LEGACY_URL" "$P15_NEW_URL"
exec node "$SCRIPT_DIR/run.mjs"
