# shellcheck shell=bash
# =============================================================================
# Dar production update - git pull --ff-only + build/stage binaries
# =============================================================================
# Sourced by deploy/lib/update-functions.sh (through deploy/update.sh only).
# Defines : git_update (fast-forward only; exits 0 when already up to date) and
#           build_and_stage (npm ci/build + dotnet publish into app/*.new).
# =============================================================================
# shellcheck disable=SC2154

git_update() {
  step "Git pull --ff-only"
  BEFORE_COMMIT="$(git -C "$REPO_DIR" rev-parse HEAD)"
  info "before: $(git -C "$REPO_DIR" log -1 --oneline)"
  run_as_owner git -C "$REPO_DIR" pull --ff-only
  AFTER_COMMIT="$(git -C "$REPO_DIR" rev-parse HEAD)"
  info "after : $(git -C "$REPO_DIR" log -1 --oneline)"
  if [ "$BEFORE_COMMIT" = "$AFTER_COMMIT" ]; then
    info "origin/main is already deployed; nothing to build."
    info "the mandatory backup was still refreshed: $DUMP_FILE"
    echo "UPDATE_NO_CHANGES commit=$AFTER_COMMIT"
    echo "  backup: $DUMP_FILE"
    echo "  log   : $LOG_FILE"
    exit 0
  fi
}

build_and_stage() {
  step "Build and stage binaries"
  LEGACY_NEW="$APP_ROOT/legacy.new"
  API_NEW="$APP_ROOT/api.new"
  if [ "$SKIP_BUILD" -eq 1 ]; then
    [ -d "$LEGACY_NEW" ] || fail "--skip-build: $LEGACY_NEW does not exist; run once without --skip-build"
    [ -d "$API_NEW" ] || fail "--skip-build: $API_NEW does not exist; run once without --skip-build"
    info "reusing prepared artifacts: $LEGACY_NEW and $API_NEW"
  else
    $SUDO install -d -m 0755 -o "$REPO_OWNER" -g "$REPO_OWNER" "$APP_ROOT"
    if [ -e "$LEGACY_NEW" ] || [ -e "$API_NEW" ]; then
      fail "stale $LEGACY_NEW or $API_NEW exists; remove it or rerun with --skip-build"
    fi
    $SUDO install -d -m 0755 -o "$REPO_OWNER" -g "$REPO_OWNER" "$LEGACY_NEW"
    $SUDO install -d -m 0755 -o "$REPO_OWNER" -g "$REPO_OWNER" "$API_NEW"
    info "frontend: npm ci + npm run build"
    run_as_owner npm ci --prefix "$REPO_DIR/frontend" --no-audit --no-fund
    run_as_owner npm run build --prefix "$REPO_DIR/frontend"
    info "backend: dotnet publish legacy -> $LEGACY_NEW"
    run_as_owner dotnet publish "$REPO_DIR/backend/DarEltahfeez.Api/DarEltahfeez.Api.csproj" \
      -c Release -o "$LEGACY_NEW" --nologo
    info "backend: dotnet publish api -> $API_NEW"
    run_as_owner dotnet publish "$REPO_DIR/src/Host/Dar.Api/Dar.Api.csproj" \
      -c Release -o "$API_NEW" --nologo
    info "frontend: copy dist into legacy wwwroot"
    run_as_owner mkdir -p "$LEGACY_NEW/wwwroot"
    run_as_owner cp -a "$REPO_DIR/frontend/dist/." "$LEGACY_NEW/wwwroot/"
    run_as_owner tee "$LEGACY_NEW/.deploy-meta" >/dev/null <<EOF
DEPLOY_STAMP=$STAMP
DEPLOY_COMMIT=$AFTER_COMMIT
DEPLOY_AT=$(date -Is)
DEPLOY_BACKUP=$DUMP_FILE
EOF
    run_as_owner cp "$LEGACY_NEW/.deploy-meta" "$API_NEW/.deploy-meta"
  fi
  [ -f "$LEGACY_NEW/DarEltahfeez.Api.dll" ] || fail "legacy publish output is missing DarEltahfeez.Api.dll"
  [ -f "$API_NEW/Dar.Api.dll" ] || fail "api publish output is missing Dar.Api.dll"
  [ -f "$LEGACY_NEW/wwwroot/index.html" ] || fail "frontend build output is missing index.html"
  if [ -d "$API_NEW/database" ]; then
    info "migration files staged with the api"
  else
    warn "api publish output has no database/ folder; --migrate will fail"
  fi
}
