# shellcheck shell=bash
# =============================================================================
# Dar production update - stop/start services and swap the staged binaries
# =============================================================================
# Sourced by deploy/lib/update-functions.sh (through deploy/update.sh only).
# Defines : stop_services, start_services, swap_binaries (previous copies are
#           kept as legacy.old.<stamp>/api.old.<stamp> and restored on failure)
#           and swap_meet_bot (same pattern for the optional meet recorder bot).
# =============================================================================
# shellcheck disable=SC2034,SC2154

stop_services() {
  SERVICES_STOPPED=1
  if [ "$MEET_BOT_ENABLED" -eq 1 ]; then
    $SUDO systemctl stop "$MEET_BOT_SERVICE" || true
  fi
  $SUDO systemctl stop dar-legacy.service dar-api.service || true
}

start_services() {
  $SUDO systemctl start dar-legacy.service dar-api.service || true
  if [ "$MEET_BOT_ENABLED" -eq 1 ]; then
    $SUDO systemctl start "$MEET_BOT_SERVICE" || true
  fi
  if $SUDO systemctl is-active --quiet dar-legacy.service && $SUDO systemctl is-active --quiet dar-api.service; then
    SERVICES_STOPPED=0
  fi
}

swap_binaries() {
  step "Swap binaries"
  $SUDO install -d -m 0755 -o dar -g dar "$APP_ROOT"
  if [ -d "$APP_ROOT/legacy" ]; then
    OLD_LEGACY="$APP_ROOT/legacy.old.$STAMP"
    $SUDO mv "$APP_ROOT/legacy" "$OLD_LEGACY"
    info "previous legacy kept at $OLD_LEGACY"
  fi
  if [ -d "$APP_ROOT/api" ]; then
    OLD_API="$APP_ROOT/api.old.$STAMP"
    $SUDO mv "$APP_ROOT/api" "$OLD_API"
    info "previous api kept at $OLD_API"
  fi
  if ! $SUDO mv "$APP_ROOT/legacy.new" "$APP_ROOT/legacy"; then
    if [ -n "$OLD_LEGACY" ] && [ -d "$OLD_LEGACY" ]; then
      $SUDO mv "$OLD_LEGACY" "$APP_ROOT/legacy" || true
    fi
    fail "could not move the new legacy binaries into place"
  fi
  if ! $SUDO mv "$APP_ROOT/api.new" "$APP_ROOT/api"; then
    $SUDO mv "$APP_ROOT/legacy" "$APP_ROOT/legacy.failed.$STAMP" || true
    if [ -n "$OLD_LEGACY" ] && [ -d "$OLD_LEGACY" ]; then
      $SUDO mv "$OLD_LEGACY" "$APP_ROOT/legacy" || true
    fi
    if [ -n "$OLD_API" ] && [ -d "$OLD_API" ]; then
      $SUDO mv "$OLD_API" "$APP_ROOT/api" || true
    fi
    fail "could not move the new api binaries into place"
  fi
  $SUDO chown -R dar:dar "$APP_ROOT/legacy" "$APP_ROOT/api"
  swap_meet_bot
  SWAPPED=1
}

swap_meet_bot() {
  [ "$MEET_BOT_ENABLED" -eq 1 ] || return 0
  step "Swap meet recorder bot"
  if [ -d "$MEET_BOT_DIR" ]; then
    OLD_MEET_BOT="$MEET_BOT_DIR.old.$STAMP"
    $SUDO mv "$MEET_BOT_DIR" "$OLD_MEET_BOT"
    info "previous bot kept at $OLD_MEET_BOT"
  fi
  if ! $SUDO mv "$MEET_BOT_NEW" "$MEET_BOT_DIR"; then
    if [ -n "$OLD_MEET_BOT" ] && [ -d "$OLD_MEET_BOT" ]; then
      $SUDO mv "$OLD_MEET_BOT" "$MEET_BOT_DIR" || true
    fi
    fail "could not move the new meet-bot build into place"
  fi
  $SUDO chown -R dar:dar "$MEET_BOT_DIR"
  $SUDO chmod 0755 "$MEET_BOT_DIR"
  MEET_BOT_SWAPPED=1
}
