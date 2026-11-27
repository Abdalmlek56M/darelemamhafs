# shellcheck shell=bash
# =============================================================================
# Dar production update - stop/start services and swap the staged binaries
# =============================================================================
# Sourced by deploy/lib/update-functions.sh (through deploy/update.sh only).
# Defines : stop_services, start_services and swap_binaries (previous copies are
#           kept as legacy.old.<stamp>/api.old.<stamp> and restored on failure).
# =============================================================================
# shellcheck disable=SC2034,SC2154

stop_services() {
  SERVICES_STOPPED=1
  $SUDO systemctl stop dar-legacy.service dar-api.service || true
}

start_services() {
  $SUDO systemctl start dar-legacy.service dar-api.service || true
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
  SWAPPED=1
}
