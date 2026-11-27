# shellcheck shell=bash
# =============================================================================
# Dar healthcheck - optional-service checks (meet recorder bot, LiveKit spike)
# =============================================================================
# Sourced by deploy/scripts/dar-healthcheck.sh (installed to /usr/local/lib/dar/healthcheck).
# These services are optional: a missing unit is reported ok (not installed), while an
# installed unit that is not healthy is a critical failure. Same record() contract as
# healthcheck-checks.sh.
# =============================================================================
# shellcheck disable=SC2154
# Optional Google-Meet recorder bot. Not installed on every host: a missing unit is
# fine (ok), but an installed unit that is not active is critical.
check_meet_bot() {
  local loadstate state
  if ! command -v systemctl >/dev/null 2>&1; then
    record "meet-bot" "warning" "systemctl not available; meet-bot check skipped"
    return
  fi
  loadstate="$(systemctl show -p LoadState --value "$MEET_BOT_SERVICE" 2>/dev/null || true)"
  case "$loadstate" in
  loaded)
    state="$(systemctl is-active "$MEET_BOT_SERVICE" 2>/dev/null || true)"
    if [ "$state" = "active" ]; then
      record "meet-bot" "ok" "state=active ($MEET_BOT_SERVICE)"
    else
      record "meet-bot" "critical" "state=${state:-unknown}; expected active"
    fi
    ;;
  "" | not-found)
    record "meet-bot" "ok" "not installed (optional; deploy/setup-host-meet.sh installs it)"
    ;;
  *)
    record "meet-bot" "warning" "unit $MEET_BOT_SERVICE state=$loadstate"
    ;;
  esac
}

# LiveKit M0 spike is feature-flagged and normally NOT installed on production.
# auto = only check when the unit exists; 1 = require it; 0 = never check.
check_livekit() {
  local loadstate state code
  if [ "$LIVEKIT_ENABLED" = "0" ]; then
    record "livekit" "ok" "disabled by HEALTHCHECK_LIVEKIT_ENABLED=0"
    return
  fi
  if ! command -v systemctl >/dev/null 2>&1; then
    record "livekit" "warning" "systemctl not available; LiveKit check skipped"
    return
  fi
  loadstate="$(systemctl show -p LoadState --value "$LIVEKIT_SERVICE" 2>/dev/null || true)"
  if [ "$loadstate" != "loaded" ]; then
    if [ "$LIVEKIT_ENABLED" = "1" ]; then
      record "livekit" "critical" "HEALTHCHECK_LIVEKIT_ENABLED=1 but $LIVEKIT_SERVICE is not installed"
    else
      record "livekit" "ok" "not installed (M0 spike is gated: deploy/livekit/install-livekit-test.sh --enable-livekit-test)"
    fi
    return
  fi
  state="$(systemctl is-active "$LIVEKIT_SERVICE" 2>/dev/null || true)"
  if [ "$state" != "active" ]; then
    record "livekit" "critical" "state=${state:-unknown}; expected active ($LIVEKIT_SERVICE)"
    return
  fi
  if ! command -v curl >/dev/null 2>&1; then
    record "livekit" "warning" "service active but curl missing; HTTP check skipped"
    return
  fi
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time "$TIMEOUT" "${LIVEKIT_URL%/}/" 2>/dev/null || true)"
  if [ "$code" = "200" ]; then
    record "livekit" "ok" "state=active, ${LIVEKIT_URL%/}/ -> HTTP 200"
  else
    record "livekit" "critical" "state=active but ${LIVEKIT_URL%/}/ -> HTTP ${code:-000} (expected 200)"
  fi
}
