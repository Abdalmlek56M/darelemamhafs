# shellcheck shell=bash
# =============================================================================
# Dar DB rollback - helper functions
# =============================================================================
# Sourced by deploy/rollback-db.sh only. These functions read the script's globals
# (SUDO, CONFIG_DIR, ENV_LEGACY/ENV_API/ENV_BACKUP, BACKUP, TARGET_DB, CURRENT_DB,
# CONFIG_BACKUP_DIR, ENV_REWRITTEN) and call step/info/warn/fail from the entry
# point. They never print a secret.
# =============================================================================
# shellcheck disable=SC2154,SC2034
db_field() { # db_field <connection-string> <Database|Username>
  local field="$2"
  local part
  local IFS=';'
  for part in $1; do
    case "$part" in
    "$field"=*) printf '%s' "${part#*=}"; return 0 ;;
    esac
  done
  return 1
}

current_db_name() {
  local conn
  if $SUDO test -r "$ENV_LEGACY"; then
    conn="$($SUDO sed -n 's/^ConnectionStrings__DarDatabase=//p' "$ENV_LEGACY" | head -n 1)"
  fi
  [ -n "${conn:-}" ] || fail "cannot read ConnectionStrings__DarDatabase from $ENV_LEGACY"
  CURRENT_DB="$(db_field "$conn" Database)"
  APP_ROLE="$(db_field "$conn" Username || true)"
  [ -n "$APP_ROLE" ] || APP_ROLE="dar_app"
  [ -n "$CURRENT_DB" ] || fail "cannot parse the database name from $ENV_LEGACY"
}

list_backups() {
  echo "Pre-deploy backups in $BACKUP_DB_DIR:"
  local found=0 file
  while IFS= read -r file; do
    [ -n "$file" ] || continue
    found=1
    printf '  %-46s %8s  sha256=%s\n' "$(basename -- "$file")" \
      "$($SUDO du -h "$file" 2>/dev/null | cut -f1)" \
      "$($SUDO test -f "$file.sha256" && echo yes || echo missing)"
  done < <($SUDO find "$BACKUP_DB_DIR" -maxdepth 1 -type f -name 'dar-pre-deploy-*.dump' -printf '%T@ %p\n' 2>/dev/null | sort -rn | cut -d' ' -f2-)
  [ "$found" -eq 1 ] || echo "  (none)"
}

pick_backup() {
  [ -n "$BACKUP" ] || {
    if $SUDO test -r "$STATE_DIR/last-deploy.env"; then
      BACKUP="$($SUDO sed -n 's/^BACKUP_FILE=//p' "$STATE_DIR/last-deploy.env" | head -n 1)"
    fi
  }
  if [ -z "$BACKUP" ]; then
    BACKUP="$($SUDO find "$BACKUP_DB_DIR" -maxdepth 1 -type f -name 'dar-pre-deploy-*.dump' -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -n 1 | cut -d' ' -f2-)"
  fi
  [ -n "$BACKUP" ] || fail "no pre-deploy backup found; pass --backup PATH"
  $SUDO test -r "$BACKUP" || fail "backup is not readable: $BACKUP"
}

validate_target() {
  case "$TARGET_DB" in
  dar_rollback_*) ;;
  *) fail "the target database name must start with dar_rollback_ (got '$TARGET_DB')" ;;
  esac
  printf '%s' "$TARGET_DB" | grep -Eq '^[a-z][a-z0-9_]{0,62}$' || fail "invalid database name: $TARGET_DB"
  [ "$TARGET_DB" != "$CURRENT_DB" ] || fail "the target database is the live database ($CURRENT_DB); refusing"
}

verify_backup() {
  local toc
  if $SUDO test -f "$BACKUP.sha256"; then
    (cd "$(dirname -- "$BACKUP")" && $SUDO sha256sum -c --quiet "$(basename -- "$BACKUP").sha256") \
      || fail "backup sha256 verification failed: $BACKUP"
    info "sha256: verified"
  else
    warn "no .sha256 sidecar next to $BACKUP; skipping the digest check"
  fi
  $SUDO pg_restore --list "$BACKUP" >/dev/null 2>&1 || fail "backup is not a readable pg_dump archive: $BACKUP"
  toc="$($SUDO pg_restore --list "$BACKUP" | grep -c '^' || true)"
  [ "$toc" -gt 0 ] || fail "backup archive is empty: $BACKUP"
  info "archive: $toc TOC entries"
}

restore_env_files() {
  [ -n "$CONFIG_BACKUP_DIR" ] || return 1
  local name
  for name in legacy.env api.env backup.env; do
    if $SUDO test -f "$CONFIG_BACKUP_DIR/$name"; then
      $SUDO install -m 0640 -o root -g dar "$CONFIG_BACKUP_DIR/$name" "$CONFIG_DIR/$name"
    fi
  done
  ENV_REWRITTEN=0
}

rewrite_env_files() {
  local name
  $SUDO install -d -m 0700 -o root -g root "$CONFIG_BACKUP_DIR"
  for name in legacy.env api.env backup.env; do
    $SUDO test -f "$CONFIG_DIR/$name" || continue
    $SUDO install -m 0600 -o root -g root "$CONFIG_DIR/$name" "$CONFIG_BACKUP_DIR/$name"
  done
  # From here on the cleanup trap restores these files if anything fails.
  ENV_REWRITTEN=1
  if $SUDO test -f "$ENV_LEGACY"; then
    $SUDO sed -i "s/Database=[^;]*/Database=$TARGET_DB/" "$ENV_LEGACY"
    $SUDO chown root:dar "$ENV_LEGACY"
    $SUDO chmod 0640 "$ENV_LEGACY"
  fi
  if $SUDO test -f "$ENV_API"; then
    $SUDO sed -i "s/Database=[^;]*/Database=$TARGET_DB/" "$ENV_API"
    $SUDO chown root:dar "$ENV_API"
    $SUDO chmod 0640 "$ENV_API"
  fi
  if $SUDO test -f "$ENV_BACKUP"; then
    $SUDO sed -i "s/^PGDATABASE=.*/PGDATABASE=$TARGET_DB/" "$ENV_BACKUP"
    $SUDO chown dar:dar "$ENV_BACKUP"
    $SUDO chmod 0600 "$ENV_BACKUP"
  fi
  info "env files now point at $TARGET_DB (originals in $CONFIG_BACKUP_DIR)"
}

restart_services() {
  $SUDO systemctl restart dar-legacy.service dar-api.service || return 1
  if command -v systemctl >/dev/null 2>&1 && systemctl cat dar-meet-bot.service >/dev/null 2>&1; then
    $SUDO systemctl restart dar-meet-bot.service 2>/dev/null || warn "could not restart dar-meet-bot.service"
  fi
  local deadline=$((SECONDS + 90))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if curl -fsS --max-time 5 http://127.0.0.1:5080/health/ready >/dev/null 2>&1 \
      && curl -fsS --max-time 5 http://127.0.0.1:5081/health/ready >/dev/null 2>&1; then
      info "services are ready on the rollback database"
      return 0
    fi
    sleep 2
  done
  return 1
}

write_state() {
  $SUDO install -d -m 0755 -o root -g root "$STATE_DIR"
  $SUDO tee "$STATE_FILE" >/dev/null <<EOF
ROLLBACK_DB_STAMP=$STAMP
ROLLBACK_DB_AT=$(date -Is)
PREVIOUS_DATABASE=$1
ROLLBACK_DATABASE=$TARGET_DB
BACKUP_FILE=$BACKUP
CONFIG_BACKUP_DIR=$CONFIG_BACKUP_DIR
LOG_FILE=${LOG_FILE:-}
EOF
  info "state written to $STATE_FILE"
}
