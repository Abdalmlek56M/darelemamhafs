# shellcheck shell=bash
# =============================================================================
# Dar production update - implementation library aggregator
# =============================================================================
# Sourced by deploy/update.sh only; do not execute this file directly.
# It sources every deploy/lib/update-*.sh implementation file in a fixed order.
# The implementation files only define functions and initialise configuration
# variables: nothing runs until deploy/update.sh calls main.
# =============================================================================
# shellcheck disable=SC1091
: "${SCRIPT_DIR:?deploy/update.sh must set SCRIPT_DIR before sourcing the update library}"

# shellcheck source=SCRIPTDIR/update-common.sh
. "$SCRIPT_DIR/lib/update-common.sh"
# shellcheck source=SCRIPTDIR/update-config.sh
. "$SCRIPT_DIR/lib/update-config.sh"
# shellcheck source=SCRIPTDIR/update-lock.sh
. "$SCRIPT_DIR/lib/update-lock.sh"
# shellcheck source=SCRIPTDIR/update-credentials.sh
. "$SCRIPT_DIR/lib/update-credentials.sh"
# shellcheck source=SCRIPTDIR/update-preflight.sh
. "$SCRIPT_DIR/lib/update-preflight.sh"
# shellcheck source=SCRIPTDIR/update-database.sh
. "$SCRIPT_DIR/lib/update-database.sh"
# shellcheck source=SCRIPTDIR/update-build.sh
. "$SCRIPT_DIR/lib/update-build.sh"
# shellcheck source=SCRIPTDIR/update-swap.sh
. "$SCRIPT_DIR/lib/update-swap.sh"
# shellcheck source=SCRIPTDIR/update-health.sh
. "$SCRIPT_DIR/lib/update-health.sh"
# shellcheck source=SCRIPTDIR/update-rollback.sh
. "$SCRIPT_DIR/lib/update-rollback.sh"
# shellcheck source=SCRIPTDIR/update-retention.sh
. "$SCRIPT_DIR/lib/update-retention.sh"
# shellcheck source=SCRIPTDIR/update-state.sh
. "$SCRIPT_DIR/lib/update-state.sh"
# shellcheck source=SCRIPTDIR/update-main.sh
. "$SCRIPT_DIR/lib/update-main.sh"
