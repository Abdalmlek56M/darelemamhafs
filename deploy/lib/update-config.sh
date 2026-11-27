# shellcheck shell=bash
# =============================================================================
# Dar production update - configuration defaults, run state, usage and CLI args
# =============================================================================
# Sourced by deploy/lib/update-functions.sh (through deploy/update.sh only).
# Defines : REPO_DIR (with /opt/dar fallback), host paths, the mutable run
#           state shared with every other update-*.sh file, usage and parse_args.
# =============================================================================
# shellcheck disable=SC2034

# Repository/host paths. SCRIPT_DIR is set by deploy/update.sh before sourcing.
REPO_DIR="${DAR_REPO_DIR:-$(cd -- "$SCRIPT_DIR/.." && pwd)}"
if [ ! -f "$REPO_DIR/deploy/.env" ] && [ -f /opt/dar/deploy/.env ]; then
  REPO_DIR=/opt/dar
fi
ENV_FILE="$REPO_DIR/deploy/.env"
CONFIG_DIR="${DAR_CONFIG_DIR:-/etc/dar}"
APP_ROOT="${DAR_APP_ROOT:-/opt/dar/app}"
BACKUP_DB_DIR="${DAR_BACKUP_DB_DIR:-/var/lib/dar/backups/db}"
LOG_DIR="${DAR_LOG_DIR:-/var/log/dar}"
STATE_DIR="${DAR_STATE_DIR:-/var/lib/dar/deploy}"
SERVICES="dar-legacy dar-api"
DRY_RUN=0
SKIP_BUILD=0
ALLOW_STOPPED=0
STAMP="$(date +%Y%m%d-%H%M%S)"
LOG_FILE="$LOG_DIR/update-$STAMP.log"
BEFORE_COMMIT=""
AFTER_COMMIT=""
DUMP_FILE=""
DUMP_SHA=""
DUMP_TOC=0
MIGRATIONS_COUNT=""
OLD_LEGACY=""
OLD_API=""
SWAPPED=0
SERVICES_STOPPED=0

usage() {
  cat <<'USAGE'
Usage: update.sh [--dry-run] [--skip-build] [--allow-stopped-services]

  --dry-run                   Print the deployment plan; change nothing.
  --skip-build                Reuse app/legacy.new + app/api.new from a
                              previous interrupted run and skip npm/dotnet builds.
  --allow-stopped-services    Do not fail when services are not running yet
                              (first deploy only).
  --help                      Show this help.

Exit codes: 0 success or up-to-date, 1 failure (binaries rolled back when the
swap had already happened), 2 usage error.
USAGE
}

parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --skip-build)
      SKIP_BUILD=1
      shift
      ;;
    --allow-stopped-services)
      ALLOW_STOPPED=1
      shift
      ;;
    --help | -h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
    esac
  done
}
