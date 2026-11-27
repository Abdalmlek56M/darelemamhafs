# shellcheck shell=bash
# =============================================================================
# Dar production update - git pull --ff-only + build/stage binaries
# =============================================================================
# Sourced by deploy/lib/update-functions.sh (through deploy/update.sh only).
# Defines : git_update (fast-forward only; exits 0 when already up to date),
#           build_and_stage (npm ci/build + dotnet publish into app/*.new) and
#           stage_meet_bot (optional: build services/meet-recorder into
#           /opt/dar-meet-bot.new when the bot is installed on this host).
# =============================================================================
# shellcheck disable=SC2154,SC2034

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
  stage_meet_bot
}

# Rebuild the meet recorder bot into $MEET_BOT_NEW (never in place, so a failed
# build cannot break the running service). Only called when detect_meet_bot found
# a real install; the swap happens in update-swap.sh with the app binaries.
stage_meet_bot() {
  [ "$MEET_BOT_ENABLED" -eq 1 ] || return 0
  step "Build and stage meet recorder bot"
  if [ "$SKIP_BUILD" -eq 1 ]; then
    [ -f "$MEET_BOT_NEW/dist/index.js" ] || fail "--skip-build: $MEET_BOT_NEW/dist/index.js does not exist; run once without --skip-build"
    info "reusing prepared bot build: $MEET_BOT_NEW"
    return 0
  fi
  $SUDO rm -rf -- "$MEET_BOT_NEW"
  $SUDO install -d -m 0755 -o "$REPO_OWNER" -g "$REPO_OWNER" "$MEET_BOT_NEW"
  info "sources: $MEET_BOT_SRC -> $MEET_BOT_NEW"
  if command -v rsync >/dev/null 2>&1; then
    run_as_owner rsync -a --delete --exclude node_modules --exclude dist --exclude '*.log' \
      "$MEET_BOT_SRC/" "$MEET_BOT_NEW/"
  else
    run_as_owner cp -a "$MEET_BOT_SRC/." "$MEET_BOT_NEW/"
    run_as_owner rm -rf -- "$MEET_BOT_NEW/node_modules" "$MEET_BOT_NEW/dist"
  fi
  info "bot: npm ci + npm run build"
  # package-lock.json is committed, so npm ci is reproducible; the build is run as
  # the repository owner and the result is chowned to dar at swap time.
  run_as_owner bash -c "cd '$MEET_BOT_NEW' && npm ci --no-audit --no-fund && npm run build"
  [ -f "$MEET_BOT_NEW/dist/index.js" ] || fail "meet-bot build output is missing dist/index.js"
  run_as_owner tee "$MEET_BOT_NEW/.deploy-meta" >/dev/null <<EOF
DEPLOY_STAMP=$STAMP
DEPLOY_COMMIT=$AFTER_COMMIT
DEPLOY_AT=$(date -Is)
DEPLOY_BACKUP=$DUMP_FILE
EOF
}
