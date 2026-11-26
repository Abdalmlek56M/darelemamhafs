#!/usr/bin/env bash
set -euo pipefail
for name in DAR_TEST_DATABASE Q3_LEGACY_URL Q3_NEW_URL Q3_SETUP_TOKEN; do
  if [ -z "${!name:-}" ]; then echo "Q3_FAIL $name is required" >&2; exit 2; fi
done
if printf '%s' "$DAR_TEST_DATABASE" | grep -qi "database=${DAR_FORBIDDEN_DB:-__forbidden_db__}"; then
  echo "Q3_FAIL refusing production database" >&2; exit 2
fi
case "${Q3_LEGACY_URL} ${Q3_NEW_URL}" in
  http://127.0.0.1:*|http://localhost:*) ;;
  *) echo "Q3_FAIL refusing non-loopback test URL" >&2; exit 2 ;;
esac
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec node "$SCRIPT_DIR/run.mjs"
