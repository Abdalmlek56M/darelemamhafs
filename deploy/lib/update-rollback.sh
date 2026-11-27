# shellcheck shell=bash
# =============================================================================
# Dar production update - automatic binary rollback (the database is untouched)
# =============================================================================
# Sourced by deploy/lib/update-functions.sh (through deploy/update.sh only).
# Defines : rollback_binaries (put the legacy.old.<stamp>/api.old.<stamp> copies
#           and the meet-bot.old.<stamp> copy back, restart and wait for
#           /health/ready).
# =============================================================================
# shellcheck disable=SC2034,SC2154

rollback_binaries() {
  step "Rollback binaries (database is not touched)"
  $SUDO systemctl stop dar-legacy.service dar-api.service || true
  if [ "$MEET_BOT_ENABLED" -eq 1 ]; then
    $SUDO systemctl stop "$MEET_BOT_SERVICE" || true
  fi
  if [ -d "$APP_ROOT/legacy" ]; then
    $SUDO mv "$APP_ROOT/legacy" "$APP_ROOT/legacy.failed.$STAMP" || true
  fi
  if [ -n "$OLD_LEGACY" ] && [ -d "$OLD_LEGACY" ]; then
    $SUDO mv "$OLD_LEGACY" "$APP_ROOT/legacy"
  fi
  if [ -d "$APP_ROOT/api" ]; then
    $SUDO mv "$APP_ROOT/api" "$APP_ROOT/api.failed.$STAMP" || true
  fi
  if [ -n "$OLD_API" ] && [ -d "$OLD_API" ]; then
    $SUDO mv "$OLD_API" "$APP_ROOT/api"
  fi
  if [ "$MEET_BOT_ENABLED" -eq 1 ]; then
    if [ -d "$MEET_BOT_DIR" ]; then
      $SUDO mv "$MEET_BOT_DIR" "$MEET_BOT_DIR.failed.$STAMP" || true
    fi
    if [ -n "$OLD_MEET_BOT" ] && [ -d "$OLD_MEET_BOT" ]; then
      $SUDO mv "$OLD_MEET_BOT" "$MEET_BOT_DIR"
      $SUDO chown -R dar:dar "$MEET_BOT_DIR"
    fi
  fi
  start_services
  SERVICES_STOPPED=0
  if wait_ready "http://127.0.0.1:5080/health/ready" && wait_ready "http://127.0.0.1:5081/health/ready"; then
    info "previous binaries restarted and healthy"
  else
    warn "previous binaries restarted but /health/ready is not OK; inspect journalctl"
  fi
  SWAPPED=0
  MEET_BOT_SWAPPED=0
}
