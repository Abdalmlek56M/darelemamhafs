# shellcheck shell=bash
# =============================================================================
# Dar production update - single concurrent deploy (flock) + early quality gate
# =============================================================================
# Sourced by deploy/lib/update-functions.sh (through deploy/update.sh only).
# Defines : acquire_deploy_lock, release_deploy_lock, run_quality_gate.
#
# Only one real deploy may run at a time: the lock is non-blocking on purpose
# (waiting silently behind another operator is worse than failing fast). It is
# taken before any backup/build/swap work and released by the EXIT trap.
# --dry-run changes nothing, so it neither takes nor needs the lock.
# =============================================================================
# shellcheck disable=SC2034,SC2154

acquire_deploy_lock() {
  [ "$DRY_RUN" -eq 0 ] || {
    info "single-deploy lock skipped for --dry-run"
    return 0
  }
  if ! command -v flock >/dev/null 2>&1; then
    fail "the flock utility is required for the single-deploy lock (install util-linux)"
  fi
  $SUDO install -d -m 0750 -o root -g "$REPO_OWNER" "$STATE_DIR"
  $SUDO touch "$LOCK_FILE"
  $SUDO chown root:"$REPO_OWNER" "$LOCK_FILE"
  $SUDO chmod 0660 "$LOCK_FILE"
  if [ ! -w "$LOCK_FILE" ]; then
    fail "cannot open the deploy lock file for writing: $LOCK_FILE"
  fi
  # File descriptor 9 is held for the lifetime of the script; flock releases it
  # automatically even if the process is killed.
  exec 9>"$LOCK_FILE"
  if ! flock -n 9; then
    exec 9>&- || true
    fail "another deploy is already running (lock: $LOCK_FILE); wait for it to finish"
  fi
  LOCK_HELD=1
  info "deploy lock acquired: $LOCK_FILE"
}

release_deploy_lock() {
  [ "$LOCK_HELD" -eq 1 ] || return 0
  flock -u 9 2>/dev/null || true
  exec 9>&- 2>/dev/null || true
  LOCK_HELD=0
}

# -----------------------------------------------------------------------------
# CI / quality gate: fail before building anything when the deploy tooling or its
# static-contract regressions are broken. Skips only with the explicit
# --skip-quality-gate flag (recorded in /var/lib/dar/deploy/last-deploy.env).
# -----------------------------------------------------------------------------
run_quality_gate() {
  step "CI / quality gate"
  if [ "$SKIP_QUALITY_GATE" -eq 1 ]; then
    warn "quality gate explicitly skipped (--skip-quality-gate); this deploy is not contract-gated"
    return 0
  fi
  command -v bash >/dev/null 2>&1 || fail "bash is required for the quality gate"
  command -v node >/dev/null 2>&1 || fail "node is required for the quality gate (install Node 24 or pass --skip-quality-gate)"
  command -v find >/dev/null 2>&1 || fail "find is required for the quality gate"

  local failures=0
  local file
  local shell_count=0
  local node_count=0

  while IFS= read -r file; do
    [ -n "$file" ] || continue
    shell_count=$((shell_count + 1))
    if ! bash -n "$file"; then
      warn "bash -n failed: $file"
      failures=$((failures + 1))
    fi
  done < <(find "$REPO_DIR/deploy" -maxdepth 3 -type f -name '*.sh' | sort)
  [ "$shell_count" -gt 0 ] || fail "no deploy shell scripts found under $REPO_DIR/deploy"
  info "bash -n: $shell_count deploy script(s)"

  while IFS= read -r file; do
    [ -n "$file" ] || continue
    node_count=$((node_count + 1))
    if ! node --check "$file"; then
      warn "node --check failed: $file"
      failures=$((failures + 1))
    fi
  done < <(find "$REPO_DIR/tests/regression/tier2-deploy" -maxdepth 1 -type f -name '*.mjs' 2>/dev/null | sort)
  [ "$node_count" -gt 0 ] || fail "deploy contract suite tests/regression/tier2-deploy is missing"
  info "node --check: $node_count deploy contract file(s)"

  for suite in tier2-deploy backup-source repo-secrets; do
    local suite_file="$REPO_DIR/tests/regression/$suite/run.mjs"
    [ -f "$suite_file" ] || fail "missing static-contract suite: $suite_file"
    # The suites use repo-root-relative paths; run them from $REPO_DIR so the gate
    # works no matter where the operator invoked update.sh from.
    if ! (cd "$REPO_DIR" && run_as_owner node "tests/regression/$suite/run.mjs"); then
      warn "static-contract suite failed: $suite"
      failures=$((failures + 1))
    fi
  done
  [ "$failures" -eq 0 ] || fail "quality gate failed with $failures failure(s); fix them or pass --skip-quality-gate (not recommended)"
  info "quality gate passed (deploy syntax + static deploy/backup/secrets contracts)"
}
