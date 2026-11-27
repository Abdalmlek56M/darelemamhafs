# shellcheck shell=bash
# =============================================================================
# Dar production update - read-only preflight checks
# =============================================================================
# Sourced by deploy/lib/update-functions.sh (through deploy/update.sh only).
# Defines : run_preflight (git checkout/branch/clean tree + deploy/preflight.sh).
# =============================================================================
# shellcheck disable=SC2154

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
}
