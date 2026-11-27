# shellcheck shell=bash
# =============================================================================
# Dar production update - dry-run plan, main sequence and final summary
# =============================================================================
# Sourced by deploy/lib/update-functions.sh (through deploy/update.sh only).
# Defines : print_banner, print_plan and main.
#
# main keeps the order of operations documented at the top of deploy/update.sh
# and must never be reordered:
#   preflight -> backup -> git pull -> build/stage -> migrate -> verify ledger
#   -> stop services -> swap -> restart/smoke (auto binary rollback) -> retention
#   -> state -> summary.
# =============================================================================
# shellcheck disable=SC2034,SC2154

print_banner() {
  echo "======================================================================"
  echo " Dar production update"
  echo " stamp : $STAMP"
  echo " repo  : $REPO_DIR"
  echo " log   : $LOG_FILE"
  echo " mode  : dry-run=$DRY_RUN skip-build=$SKIP_BUILD allow-stopped=$ALLOW_STOPPED"
  echo "======================================================================"
}

print_plan() {
  echo "DRY RUN - no changes will be made."
  echo "  repo          : $REPO_DIR"
  echo "  branch        : $(git -C "$REPO_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
  echo "  current commit: $(git -C "$REPO_DIR" log -1 --oneline 2>/dev/null || echo unknown)"
  echo "  app root      : $APP_ROOT"
  echo "  services      : $SERVICES"
  echo "  migrations    : $(find "$REPO_DIR/database" -maxdepth 1 -type f -name '*.sql' | wc -l | tr -d ' ') files in repository"
  echo "  planned steps :"
  echo "    1. preflight (deploy/preflight.sh)"
  echo "    2. database backup -> $BACKUP_DB_DIR/dar-pre-deploy-$STAMP.dump (+sha256)"
  echo "    3. git pull --ff-only"
  echo "    4. build: npm ci + npm run build + dotnet publish -> app/legacy.new + app/api.new"
  echo "       (--skip-build reuses existing app/legacy.new + app/api.new)"
  echo "    5. dotnet run --project src/Host/Dar.Api -- --migrate"
  echo "    6. verify web_schema_migrations count == database/*.sql count"
  echo "    7. stop services, swap app dirs to *.old.$STAMP, start services"
  echo "    8. smoke: /health/ready 5080+5081, /, /management, /teacher, /supervisor, /api/v1/ping"
  echo "       on failure -> automatic binary rollback (database untouched)"
  echo "    9. retention: last 5 app copies + 30 days pre-deploy dumps"
  echo "   10. write $STATE_DIR/last-deploy.env and the log file"
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
  echo ""
  echo "UPDATE_OK"
  echo "  stamp      : $STAMP"
  echo "  commit     : $AFTER_COMMIT"
  echo "  previous   : $BEFORE_COMMIT"
  echo "  migrations : $MIGRATIONS_COUNT"
  echo "  backup     : $DUMP_FILE"
  echo "  backup sha : $DUMP_SHA"
  echo "  log        : $LOG_FILE"
  echo "  rollback   : sudo bash $SCRIPT_DIR/rollback.sh $STAMP"
}
