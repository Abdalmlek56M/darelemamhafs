# shellcheck shell=bash
# =============================================================================
# Dar production update - record the deployed state for operators/rollback
# =============================================================================
# Sourced by deploy/lib/update-functions.sh (through deploy/update.sh only).
# Defines : write_state ($STATE_DIR/last-deploy.env: stamp, commits, backup,
#           migration count and log path).
# =============================================================================
# shellcheck disable=SC2154

write_state() {
  $SUDO install -d -m 0755 -o root -g root "$STATE_DIR"
  $SUDO tee "$STATE_DIR/last-deploy.env" >/dev/null <<EOF
DEPLOY_STAMP=$STAMP
DEPLOY_AT=$(date -Is)
PREVIOUS_COMMIT=$BEFORE_COMMIT
DEPLOY_COMMIT=$AFTER_COMMIT
BACKUP_FILE=$DUMP_FILE
BACKUP_SHA256=$DUMP_SHA
MIGRATIONS_APPLIED=$MIGRATIONS_COUNT
LOG_FILE=$LOG_FILE
EOF
  info "state written to $STATE_DIR/last-deploy.env"
}
