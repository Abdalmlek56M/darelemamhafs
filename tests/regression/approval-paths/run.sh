#!/usr/bin/env bash
set -euo pipefail
if [ -z "${DAR_TEST_DATABASE:-}" ]; then
  echo "Q1_FAIL DAR_TEST_DATABASE is required" >&2
  exit 2
fi
if [ -z "${Q1_LEGACY_URL:-}" ] || [ -z "${Q1_NEW_URL:-}" ] || [ -z "${Q1_SETUP_TOKEN:-}" ]; then
  echo "Q1_FAIL Q1_LEGACY_URL, Q1_NEW_URL and Q1_SETUP_TOKEN are required" >&2
  exit 2
fi
if printf '%s' "$DAR_TEST_DATABASE" | grep -qi 'database=dareltahfeez'; then
  echo "Q1_FAIL refusing production database name" >&2
  exit 2
fi
case "${Q1_LEGACY_URL} ${Q1_NEW_URL}" in
  *dar-elemam-hafs.rigxhardware.com*|*31.220.76.171*) echo "Q1_FAIL refusing production URL" >&2; exit 2 ;;
esac
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec node "$SCRIPT_DIR/run.mjs"