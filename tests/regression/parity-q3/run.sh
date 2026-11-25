#!/usr/bin/env bash
set -euo pipefail
for name in DAR_TEST_DATABASE Q3_LEGACY_URL Q3_NEW_URL Q3_SETUP_TOKEN; do
  if [ -z "${!name:-}" ]; then echo "Q3_FAIL $name is required" >&2; exit 2; fi
done
if printf '%s' "$DAR_TEST_DATABASE" | grep -qi 'database=dareltahfeez'; then
  echo "Q3_FAIL refusing production database" >&2; exit 2
fi
if printf '%s' "$DAR_TEST_DATABASE" | grep -Eqi 'host=(31\.220\.76\.171|dar-elemam-hafs\.rigxhardware\.com)'; then
  echo "Q3_FAIL refusing production database host" >&2; exit 2
fi
case "${Q3_LEGACY_URL} ${Q3_NEW_URL}" in
  *dar-elemam-hafs.rigxhardware.com*|*31.220.76.171*) echo "Q3_FAIL refusing production URL" >&2; exit 2 ;;
esac
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec node "$SCRIPT_DIR/run.mjs"
