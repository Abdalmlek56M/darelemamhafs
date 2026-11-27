# shellcheck shell=bash
# =============================================================================
# Dar production update - database credentials (never printed)
# =============================================================================
# Sourced by deploy/lib/update-functions.sh (through deploy/update.sh only).
# Defines : PG* connection variables, CONNECTION_STRING (set by
#           load_db_credentials), run_pg and psql_value.
# Reads   : /etc/dar/backup.env (preferred) then /etc/dar/api.env.
# =============================================================================
# shellcheck disable=SC2034,SC2154

PGHOST="127.0.0.1"
PGPORT="5432"
PGDATABASE="dar_database"
PGUSER="dar_app"
PGPASSWORD=""
CONNECTION_STRING=""

load_db_credentials() {
  step "Database credentials"
  if [ -f "$CONFIG_DIR/backup.env" ]; then
    backup_env_content="$($SUDO cat "$CONFIG_DIR/backup.env" 2>/dev/null || true)"
    while IFS= read -r line; do
      case "$line" in
      "" | \#*) continue ;;
      esac
      key="${line%%=*}"
      value="${line#*=}"
      case "$key" in
      PGHOST) PGHOST="$value" ;;
      PGPORT) PGPORT="$value" ;;
      PGDATABASE) PGDATABASE="$value" ;;
      PGUSER) PGUSER="$value" ;;
      PGPASSWORD) PGPASSWORD="$value" ;;
      esac
    done <<<"$backup_env_content"
  fi
  if [ -z "$PGPASSWORD" ] && [ -f "$CONFIG_DIR/api.env" ]; then
    connection="$($SUDO sed -n 's/^ConnectionStrings__Default=//p' "$CONFIG_DIR/api.env" | head -n 1)"
    if [ -n "$connection" ]; then
      local_ifs="$IFS"
      IFS=';'
      for part in $connection; do
        key="${part%%=*}"
        value="${part#*=}"
        case "$key" in
        Host | host) PGHOST="$value" ;;
        Port | port) PGPORT="$value" ;;
        Database | database) PGDATABASE="$value" ;;
        Username | username | User | user) PGUSER="$value" ;;
        Password | password) PGPASSWORD="$value" ;;
        esac
      done
      IFS="$local_ifs"
    fi
  fi
  if [ -z "$PGPASSWORD" ]; then
    warn "could not read the database password from $CONFIG_DIR/backup.env or $CONFIG_DIR/api.env"
    return 1
  fi
  case "$PGPASSWORD" in
  *"'"*) fail "database password contains a single quote; unsupported by this script." ;;
  esac
  CONNECTION_STRING="Host=$PGHOST;Port=$PGPORT;Database=$PGDATABASE;Username=$PGUSER;Password=$PGPASSWORD"
  info "database: $PGDATABASE@$PGHOST:$PGPORT (user $PGUSER)"
  return 0
}

run_pg() {
  $SUDO env PGPASSWORD="$PGPASSWORD" "$@"
}

psql_value() {
  local database="$1"
  local sql="$2"
  run_pg psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$database" -v ON_ERROR_STOP=1 -tAc "$sql"
}
