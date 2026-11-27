# shellcheck shell=bash
# =============================================================================
# Dar production update - configuration defaults, run state, usage and CLI args
# =============================================================================
# Sourced by deploy/lib/update-functions.sh (through deploy/update.sh only).
# Defines : REPO_DIR (with /opt/dar fallback), host paths, meet-recorder bot
#           paths, post-swap smoke credentials, the mutable run state shared with
#           every other update-*.sh file, usage and parse_args.
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
# Single concurrent deploy: a non-blocking flock on this file. It is group-writable
# for the repository owner so the deploy user can take it without root rights.
LOCK_FILE="${DAR_DEPLOY_LOCK_FILE:-$STATE_DIR/update.lock}"
LOCK_HELD=0
# Meet recorder bot (phase 3, services/meet-recorder). It lives outside APP_ROOT and
# is installed by deploy/setup-host-meet.sh; update.sh only rebuilds/swaps it when
# that install is detected on the host (see detect_meet_bot in update-preflight.sh).
MEET_BOT_DIR="${DAR_MEET_BOT_DIR:-/opt/dar-meet-bot}"
MEET_BOT_NEW="$MEET_BOT_DIR.new"
MEET_BOT_SRC="$REPO_DIR/services/meet-recorder"
MEET_BOT_SERVICE="dar-meet-bot.service"
MEET_BOT_ENABLED=0
MEET_BOT_SWAPPED=0
OLD_MEET_BOT=""
# Post-swap smoke: a real login + one money read. Credentials are opt-in, read from
# an env file (mode 600/640) or the environment, and never printed. Missing
# credentials keep the deploy green (with a warning); wrong permissions are only
# fatal when DAR_SMOKE_STRICT=1.
SMOKE_ENV_FILE="${DAR_SMOKE_ENV_FILE:-$CONFIG_DIR/smoke.env}"
SMOKE_USERNAME=""
SMOKE_PASSWORD=""
SMOKE_ENABLED=0
SMOKE_STRICT="${DAR_SMOKE_STRICT:-0}"
DRY_RUN=0
SKIP_BUILD=0
ALLOW_STOPPED=0
SKIP_QUALITY_GATE=0
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
                 [--skip-quality-gate]

  --dry-run                   Print the deployment plan; change nothing.
  --skip-build                Reuse app/legacy.new + app/api.new (and the staged
                              meet-bot build) from a previous interrupted run and
                              skip npm/dotnet builds.
  --allow-stopped-services    Do not fail when services are not running yet
                              (first deploy only).
  --skip-quality-gate         Skip the CI/quality gate (bash -n, node --check and
                              the deploy contract suites). Only for a documented
                              emergency; the flag is recorded in the deploy state.
  --help                      Show this help.

Environment (optional):
  DAR_DEPLOY_LOCK_FILE        lock file path (default /var/lib/dar/deploy/update.lock)
  DAR_MEET_BOT_DIR            meet recorder bot install dir (default /opt/dar-meet-bot)
  DAR_SMOKE_ENV_FILE          post-swap smoke credentials (default /etc/dar/smoke.env)
  DAR_SMOKE_STRICT=1          treat a rejected smoke login/permission as fatal
  DAR_SMOKE_USERNAME/PASSWORD credentials supplied directly instead of the env file

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
    --skip-quality-gate)
      SKIP_QUALITY_GATE=1
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
