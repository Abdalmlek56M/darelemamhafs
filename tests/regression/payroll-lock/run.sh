#!/usr/bin/env bash
set -euo pipefail
if [ -z "${DAR_TEST_DATABASE:-}" ]; then
  echo "Q2_FAIL DAR_TEST_DATABASE is required" >&2
  exit 2
fi
if [ -z "${Q2_LEGACY_URL:-}" ] || [ -z "${Q2_NEW_URL:-}" ] || [ -z "${Q2_SETUP_TOKEN:-}" ]; then
  echo "Q2_FAIL Q2_LEGACY_URL, Q2_NEW_URL and Q2_SETUP_TOKEN are required" >&2
  exit 2
fi
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec node "$SCRIPT_DIR/run.mjs"
