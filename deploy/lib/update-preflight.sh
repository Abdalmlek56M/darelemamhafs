# shellcheck shell=bash
# =============================================================================
# Dar production update - read-only preflight checks
# =============================================================================
# Sourced by deploy/lib/update-functions.sh (through deploy/update.sh only).
# Defines : run_preflight (git checkout/branch/clean tree + deploy/preflight.sh)
#           and detect_meet_bot (is the meet recorder bot installed here?).
# =============================================================================
# shellcheck disable=SC2154,SC2034

# The meet recorder bot is only rebuilt/restarted by update.sh when the host has
# a real install of it: the source tree must exist in the repo, the published
# build must exist at $MEET_BOT_DIR, and deploy/systemd/dar-meet-bot.service must
# be installed. Otherwise the bot is skipped and legacy+api deploy normally.
detect_meet_bot() {
  MEET_BOT_ENABLED=0
  if [ ! -d "$MEET_BOT_DIR" ]; then
    info "meet recorder bot not installed at $MEET_BOT_DIR; bot update skipped"
    return 0
  fi
  if [ ! -f "$MEET_BOT_DIR/dist/index.js" ]; then
    warn "meet recorder bot dir exists but $MEET_BOT_DIR/dist/index.js is missing; bot update skipped"
    return 0
  fi
  if [ ! -d "$MEET_BOT_SRC" ]; then
    warn "meet recorder sources missing at $MEET_BOT_SRC; bot update skipped"
    return 0
  fi
  if ! command -v systemctl >/dev/null 2>&1 || ! $SUDO systemctl cat "$MEET_BOT_SERVICE" >/dev/null 2>&1; then
    warn "meet recorder bot installed but $MEET_BOT_SERVICE is not; run deploy/setup-host-meet.sh first (bot update skipped)"
    return 0
  fi
  MEET_BOT_ENABLED=1
  info "meet recorder bot: enabled ($MEET_BOT_DIR, $MEET_BOT_SERVICE)"
}

run_preflight() {
  step "Preflight"
  [ -d "$REPO_DIR/.git" ] || fail "not a git checkout: $REPO_DIR"
  [ -f "$ENV_FILE" ] || fail "deploy/.env is missing (copy deploy/.env.example)."
  branch="$(git -C "$REPO_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
  [ "$branch" = "main" ] || fail "current branch is '$branch', expected main"
  if [ -n "$(git -C "$REPO_DIR" status --porcelain --untracked-files=no 2>/dev/null || true)" ]; then
    fail "working tree has uncommitted tracked changes; commit or discard them first"
  fi
  preflight_args=()
  if [ "$ALLOW_STOPPED" -eq 1 ]; then
    preflight_args+=(--allow-inactive)
  fi
  if [ -f "$SCRIPT_DIR/preflight.sh" ]; then
    if ! bash "$SCRIPT_DIR/preflight.sh" "${preflight_args[@]}"; then
      if [ "$DRY_RUN" -eq 1 ]; then
        warn "preflight reported blockers; dry run continues with the plan only"
      else
        fail "preflight reported blockers, deployment aborted before any change"
      fi
    fi
  else
    warn "deploy/preflight.sh not found; continuing with basic checks only"
  fi
  detect_meet_bot
}
