# shellcheck shell=bash
# =============================================================================
# Dar production update - dry-run plan, main sequence and final summary
# =============================================================================
# Sourced by deploy/lib/update-functions.sh (through deploy/update.sh only).
# Defines : print_banner, print_plan and main.
#
# main keeps the order of operations documented at the top of deploy/update.sh
# and must never be reordered:
#   lock -> preflight -> backup -> git pull -> quality gate -> build/stage
#   (app + optional meet-bot) -> migrate -> verify ledger -> stop services
#   -> swap (app + bot) -> restart/smoke (readiness, bot, HTTP, real login +
#   money read; auto binary rollback) -> retention -> state -> summary.
# =============================================================================
# shellcheck disable=SC2034,SC2154

print_banner() {
  echo "======================================================================"
  echo " Dar production update"
  echo " stamp : $STAMP"
  echo " repo  : $REPO_DIR"
  echo " log   : $LOG_FILE"
  echo " lock  : $LOCK_FILE (dry-run does not lock)"
  echo " mode  : dry-run=$DRY_RUN skip-build=$SKIP_BUILD allow-stopped=$ALLOW_STOPPED skip-quality-gate=$SKIP_QUALITY_GATE"
  echo " bot   : $MEET_BOT_ENABLED (1 = rebuild/swap $MEET_BOT_SERVICE)"
  echo "======================================================================"
}

print_plan() {
  echo "DRY RUN - no changes will be made."
  echo "  repo          : $REPO_DIR"
  echo "  branch        : $(git -C "$REPO_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
  echo "  current commit: $(git -C "$REPO_DIR" log -1 --oneline 2>/dev/null || echo unknown)"
  echo "  app root      : $APP_ROOT"
  echo "  services      : $SERVICES"
  echo "  meet-bot      : $([ "$MEET_BOT_ENABLED" -eq 1 ] && echo "rebuild+swap+restart $MEET_BOT_SERVICE ($MEET_BOT_DIR)" || echo "not installed; skipped")"
  echo "  migration     : $(find "$REPO_DIR/database" -maxdepth 1 -type f -name '*.sql' | wc -l | tr -d ' ') files in repository"
  echo "  planned steps :"
  echo "    1. single-deploy flock on $LOCK_FILE"
  echo "    2. preflight (deploy/preflight.sh)"
  echo "    3. database backup -> $BACKUP_DB_DIR/dar-pre-deploy-$STAMP.dump (+sha256)"
  echo "    4. git pull --ff-only"
  echo "    5. CI/quality gate (bash -n + node --check + tier2-deploy/backup-source/repo-secrets suites)"
  echo "       (--skip-quality-gate skips this and is recorded in the deploy state)"
  echo "    6. build: npm ci + npm run build + dotnet publish -> app/legacy.new + app/api.new"
  echo "       optional meet-bot: npm ci + npm run build -> $MEET_BOT_DIR.new"
  echo "       (--skip-build reuses existing *.new artifacts)"
  echo "    7. dotnet run --project src/Host/Dar.Api -- --migrate"
  echo "    8. verify web_schema_migrations count == database/*.sql count"
  echo "    9. stop services, swap app dirs to *.old.$STAMP (+ meet-bot.old.$STAMP), start services"
  echo "   10. smoke: /health/ready 5080+5081, /, /management, /teacher, /supervisor, /api/v1/ping"
  echo "       + optional real login (/api/auth/login) + money read (/api/collections)"
  echo "       using $SMOKE_ENV_FILE credentials (never printed; skipped when absent)"
  echo "       on failure -> automatic binary rollback (database untouched)"
  echo "   11. retention: last 5 app/bot copies + 30 days pre-deploy dumps"
  echo "   12. write $STATE_DIR/last-deploy.env and the log file"
  echo "  log file      : $LOG_FILE"
}

main() {
  parse_args "$@"
  detect_privileges
  resolve_repo_owner
  if [ "$DRY_RUN" -eq 0 ]; then
    init_logging
  fi
  trap on_exit EXIT
  acquire_deploy_lock

  print_banner

  if ! load_db_credentials; then
    if [ "$DRY_RUN" -eq 1 ]; then
      warn "dry run continues without database credentials"
    else
      fail "database credentials are required for a real deployment"
    fi
  fi
  run_preflight
  if [ "$DRY_RUN" -eq 1 ]; then
    print_plan
    echo "DRY_RUN_OK"
    exit 0
  fi
  take_db_backup
  git_update
  run_quality_gate
  build_and_stage
  apply_migrations
  step "Stop services"
  stop_services
  swap_binaries
  restart_and_smoke
  cleanup_retention
  write_state
  # The deployment finished; clear the "binaries are live" flag so the EXIT trap
  # does not print a misleading rollback warning after a successful run.
  SWAPPED=0
  MEET_BOT_SWAPPED=0
  echo ""
  echo "UPDATE_OK"
  echo "  stamp      : $STAMP"
  echo "  commit     : $AFTER_COMMIT"
  echo "  previous   : $BEFORE_COMMIT"
  echo "  migrations : $MIGRATIONS_COUNT"
  echo "  meet-bot   : $([ "$MEET_BOT_ENABLED" -eq 1 ] && echo updated || echo not-installed)"
  echo "  gate       : $([ "$SKIP_QUALITY_GATE" -eq 1 ] && echo skipped || echo passed)"
  echo "  backup     : $DUMP_FILE"
  echo "  backup sha : $DUMP_SHA"
  echo "  log        : $LOG_FILE"
  echo "  rollback   : sudo bash $SCRIPT_DIR/rollback.sh $STAMP"
  echo "  db rollback: sudo bash $SCRIPT_DIR/rollback-db.sh --list   (manual; restores into a fresh DB)"
}
