#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# Shared production-safety guard (FINAL 2.17): one implementation for every shell wrapper.
. "$SCRIPT_DIR/../../lib/guard.sh"
dar_guard_require_env Q1_FAIL DAR_TEST_DATABASE Q1_LEGACY_URL Q1_NEW_URL Q1_SETUP_TOKEN
dar_guard_targets Q1_FAIL "$DAR_TEST_DATABASE" "$Q1_LEGACY_URL" "$Q1_NEW_URL"
exec node "$SCRIPT_DIR/run.mjs"
