#!/usr/bin/env bash
set -euo pipefail
if [ -z "${DAR_TEST_DATABASE:-}" ]; then
  echo "P15_FAIL DAR_TEST_DATABASE is required" >&2
  exit 2
fi
if [ -z "${P15_LEGACY_URL:-}" ] || [ -z "${P15_NEW_URL:-}" ] || [ -z "${P15_SETUP_TOKEN:-}" ]; then
  echo "P15_FAIL P15_LEGACY_URL, P15_NEW_URL and P15_SETUP_TOKEN are required" >&2
  exit 2
fi
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec node "$SCRIPT_DIR/run.mjs"
