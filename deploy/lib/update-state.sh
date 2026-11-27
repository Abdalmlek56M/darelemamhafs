# shellcheck shell=bash
# =============================================================================
# Dar production update - record the deployed state for operators/rollback
# =============================================================================
# Sourced by deploy/lib/update-functions.sh (through deploy/update.sh only).
# Defines : write_state ($STATE_DIR/last-deploy.env: stamp, commits, backup,
#           migration count, quality-gate/bot status and log path).
# =============================================================================
# shellcheck disable=SC2154

write_state() {
  local gate_status="ran"
  local bot_status="not-installed"
  local db_name="${PGDATABASE:-unknown}"
  if [ "$SKIP_QUALITY_GATE" -eq 1 ]; then
    gate_status="skipped"
  fi
  if [ "$MEET_BOT_ENABLED" -eq 1 ]; then
    bot_status="updated"
  fi
  $SUDO install -d -m 0755 -o root -g root "$STATE_DIR"
  $SUDO tee "$STATE_DIR/last-deploy.env" >/dev/null <<EOF
DEPLOY_STAMP=$STAMP
DEPLOY_AT=$(date -Is)
PREVIOUS_COMMIT=$BEFORE_COMMIT
DEPLOY_COMMIT=$AFTER_COMMIT
BACKUP_FILE=$DUMP_FILE
BACKUP_SHA256=$DUMP_SHA
MIGRATIONS_APPLIED=$MIGRATIONS_COUNT
QUALITY_GATE=$gate_status
MEET_BOT=$bot_status
MEET_BOT_DIR=$MEET_BOT_DIR
DATABASE=$db_name
LOG_FILE=$LOG_FILE
EOF
  info "state written to $STATE_DIR/last-deploy.env"
}
