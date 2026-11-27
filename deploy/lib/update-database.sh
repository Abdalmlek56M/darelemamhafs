# shellcheck shell=bash
# =============================================================================
# Dar production update - mandatory database backup + migrations
# =============================================================================
# Sourced by deploy/lib/update-functions.sh (through deploy/update.sh only).
# Defines : take_db_backup (pg_dump -Fc + pg_restore TOC + sha256) and
#           apply_migrations (dotnet run --migrate + web_schema_migrations
#           count == database/*.sql count).
# =============================================================================
# shellcheck disable=SC2034,SC2154

take_db_backup() {
  step "Mandatory database backup"
  $SUDO install -d -m 0750 -o dar -g dar "$BACKUP_DB_DIR"
  DUMP_FILE="$BACKUP_DB_DIR/dar-pre-deploy-$STAMP.dump"
  run_pg pg_dump -Fc -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -f "$DUMP_FILE"
  $SUDO chown dar:dar "$DUMP_FILE"
  $SUDO chmod 0640 "$DUMP_FILE"
  run_pg pg_restore --list "$DUMP_FILE" >/dev/null 2>&1 || fail "backup archive is not readable: $DUMP_FILE"
  DUMP_TOC="$(run_pg pg_restore --list "$DUMP_FILE" | grep -c '^' || true)"
  [ "$DUMP_TOC" -gt 0 ] || fail "backup archive is empty: $DUMP_FILE"
  DUMP_SHA="$($SUDO sha256sum "$DUMP_FILE" | awk '{print $1}')"
  printf '%s  %s\n' "$DUMP_SHA" "$(basename "$DUMP_FILE")" | $SUDO tee "$DUMP_FILE.sha256" >/dev/null
  $SUDO chown dar:dar "$DUMP_FILE.sha256"
  $SUDO chmod 0640 "$DUMP_FILE.sha256"
  info "dump : $DUMP_FILE"
  info "size : $($SUDO du -h "$DUMP_FILE" | cut -f1)"
  info "toc  : $DUMP_TOC entries"
  info "sha  : $DUMP_SHA"
}

apply_migrations() {
  step "Database migrations"
  files_count="$(find "$REPO_DIR/database" -maxdepth 1 -type f -name '*.sql' | wc -l | tr -d ' ')"
  info "migration files in repository: $files_count"
  run_as_owner env ASPNETCORE_ENVIRONMENT=Production \
    ConnectionStrings__Default="$CONNECTION_STRING" \
    DOTNET_CLI_TELEMETRY_OPTOUT=1 \
    dotnet run -c Release --project "$REPO_DIR/src/Host/Dar.Api/Dar.Api.csproj" \
    --no-launch-profile -- --migrate
  applied_count="$(psql_value "$PGDATABASE" "SELECT count(*) FROM web_schema_migrations;")"
  info "web_schema_migrations rows: $applied_count"
  if [ "$applied_count" != "$files_count" ]; then
    fail "migration ledger mismatch (ledger=$applied_count files=$files_count); aborted before swapping binaries"
  fi
  MIGRATIONS_COUNT="$applied_count"
}
