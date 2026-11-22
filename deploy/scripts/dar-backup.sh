#!/usr/bin/env bash
# Dar daily PostgreSQL backup.
#
# Pipeline: pg_dump (custom format) -> integrity checks (pg_restore --list + SHA-256)
#           -> JSON manifest (same directory) -> offsite copy + remote verification (rclone)
#           -> local/offsite retention.
#
# A single-instance lock prevents overlapping runs. Any failure exits non-zero, keeps the
# local dump (previous behaviour) and, when possible, writes the manifest with status=failed.
#
# Run (manual):  sudo bash deploy/scripts/dar-backup.sh
# Installed as:  /usr/local/bin/dar-backup (systemd units dar-backup.service + dar-backup.timer)
#
# Backward compatible environment (same file and keys as the previous script):
#   PG*                    standard libpq variables (usually from /etc/dar/backup.env)
#   RCLONE_CONFIG          rclone config path (default /var/lib/dar/rclone/rclone.conf)
#   RCLONE_REMOTE          offsite remote root, e.g. gdrive:dar-backups (empty = disabled)
# Optional tuning:
#   BACKUP_ENV_FILE        env file path (default /etc/dar/backup.env)
#   BACKUP_DIR             local dump directory (default /var/lib/dar/backups/db)
#   BACKUP_RETENTION_DAYS  local/offsite retention in days (default 30)
#   VERIFY_RESTORE_LIST    1 = verify with pg_restore --list (default 1)
#   RCLONE_DEST_SUBDIR     sub-directory under RCLONE_REMOTE (default dar/db)
#   BACKUP_LOCK_FILE       lock file path (default <BACKUP_DIR>/.dar-backup.lock)

set -euo pipefail

log() {
  local message="$*"
  logger -t dar-backup -- "$message" 2>/dev/null || true
  printf 'dar-backup: %s\n' "$message" >&2
}

fail() {
  log "ERROR: $*"
  exit 1
}

json_escape() {
  local value="${1-}"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/\\r}"
  value="${value//$'\t'/\\t}"
  printf '%s' "$value"
}

json_string_or_null() {
  if [ -n "${1:-}" ]; then
    printf '"%s"' "$(json_escape "$1")"
  else
    printf 'null'
  fi
}

json_number_or_null() {
  case "${1:-}" in
    ''|*[!0-9]*) printf 'null' ;;
    *) printf '%s' "$1" ;;
  esac
}

ENV_FILE="${BACKUP_ENV_FILE:-/etc/dar/backup.env}"
if [ ! -r "$ENV_FILE" ]; then
  fail "backup env file is not readable: $ENV_FILE"
fi
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

DIR="${BACKUP_DIR:-/var/lib/dar/backups/db}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
VERIFY_RESTORE_LIST="${VERIFY_RESTORE_LIST:-1}"
RCLONE_CONFIG_FILE="${RCLONE_CONFIG:-/var/lib/dar/rclone/rclone.conf}"
RCLONE_DEST_SUBDIR="${RCLONE_DEST_SUBDIR:-dar/db}"
LOCK_FILE="${BACKUP_LOCK_FILE:-$DIR/.dar-backup.lock}"
DATABASE_NAME="${PGDATABASE:-dareltahfeez}"
HOST_NAME="$(hostname 2>/dev/null || printf 'unknown')"

case "$RETENTION_DAYS" in
  ''|*[!0-9]*) fail "BACKUP_RETENTION_DAYS must be a positive integer (got '$RETENTION_DAYS')" ;;
esac
if [ "$RETENTION_DAYS" -lt 1 ]; then
  fail "BACKUP_RETENTION_DAYS must be at least 1"
fi
case "$VERIFY_RESTORE_LIST" in
  0|1) ;;
  *) fail "VERIFY_RESTORE_LIST must be 0 or 1 (got '$VERIFY_RESTORE_LIST')" ;;
esac

mkdir -p -- "$DIR" 2>/dev/null || fail "cannot create backup directory: $DIR"

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/dar-backup.XXXXXX")" || fail "cannot create a temporary directory"
LOCK_DIR=""
cleanup() {
  rm -rf -- "$TMP_DIR" 2>/dev/null || true
  if [ -n "$LOCK_DIR" ]; then
    rmdir -- "$LOCK_DIR" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# ---- single-instance lock (flock when available, mkdir fallback) ----
if command -v flock >/dev/null 2>&1; then
  if ! : >"$LOCK_FILE" 2>/dev/null; then
    fail "cannot create lock file: $LOCK_FILE"
  fi
  exec 9>"$LOCK_FILE"
  if ! flock -n 9; then
    log "WARN: another dar-backup run is already active; skipping this run."
    exit 0
  fi
else
  LOCK_DIR="$DIR/.dar-backup.lock.d"
  if ! mkdir -- "$LOCK_DIR" 2>/dev/null; then
    log "WARN: another dar-backup run is already active (mkdir lock); skipping this run."
    exit 0
  fi
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="$DIR/dar-$STAMP.dump"
MANIFEST="$DIR/dar-$STAMP.manifest.json"
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

log "INFO: starting backup stamp=$STAMP database=$DATABASE_NAME dir=$DIR"

if ! pg_dump -Fc -f "$FILE" 2>"$TMP_DIR/pg_dump.err"; then
  rm -f -- "$FILE" 2>/dev/null || true
  tail -n 3 "$TMP_DIR/pg_dump.err" 2>/dev/null || true
  fail "pg_dump failed; the partial dump was removed."
fi
log "INFO: pg_dump finished: $FILE"

# ---- integrity verification ----
TOC_ENTRIES=""
VERIFY_NOTE="skipped"
if [ "$VERIFY_RESTORE_LIST" = "1" ]; then
  if ! command -v pg_restore >/dev/null 2>&1; then
    fail "pg_restore is required when VERIFY_RESTORE_LIST=1"
  fi
  LIST_FILE="$TMP_DIR/toc.txt"
  if ! pg_restore --list "$FILE" >"$LIST_FILE" 2>"$TMP_DIR/pg_restore.err"; then
    tail -n 3 "$TMP_DIR/pg_restore.err" 2>/dev/null || true
    fail "pg_restore --list rejected the new dump."
  fi
  TOC_ENTRIES="$(sed -n 's/^;[[:space:]]*TOC Entries:[[:space:]]*//p' "$LIST_FILE" | head -n 1 | tr -d '[:space:]' || true)"
  case "$TOC_ENTRIES" in
    ''|*[!0-9]*) TOC_ENTRIES="$(grep -cv '^;' "$LIST_FILE" 2>/dev/null || printf '0')" ;;
  esac
  case "$TOC_ENTRIES" in
    ''|*[!0-9]*) TOC_ENTRIES="0" ;;
  esac
  if [ "$TOC_ENTRIES" -le 0 ]; then
    fail "pg_restore --list returned zero TOC entries; the dump is not usable."
  fi
  VERIFY_NOTE="pg_restore --list ok ($TOC_ENTRIES entries)"
  log "INFO: $VERIFY_NOTE"
fi

SIZE_BYTES="$(stat -c %s "$FILE" 2>/dev/null || printf '')"
case "$SIZE_BYTES" in
  ''|*[!0-9]*) fail "cannot read dump size: $FILE" ;;
esac
if [ "$SIZE_BYTES" -le 0 ]; then
  fail "dump file is empty: $FILE"
fi
SHA256="$(sha256sum "$FILE" 2>"$TMP_DIR/sha256.err" | awk '{print $1}')" || fail "sha256sum failed"
case "$SHA256" in
  *[!0-9a-f]*) fail "sha256sum produced an unexpected digest: '$SHA256'" ;;
esac
if [ "${#SHA256}" -ne 64 ]; then
  fail "sha256sum produced an unexpected digest length."
fi
log "INFO: dump verified size=${SIZE_BYTES}B sha256=$SHA256"

# ---- database metadata (best effort; never invalidates a verified dump) ----
SERVER_VERSION=""
MIGRATIONS_COUNT=""
METADATA_WARNING=""
if command -v psql >/dev/null 2>&1; then
  SERVER_VERSION="$(psql -tAc "SHOW server_version" 2>"$TMP_DIR/psql.err" | head -n 1 | tr -d '[:space:]' || true)"
  MIGRATIONS_COUNT="$(psql -tAc "SELECT count(*) FROM web_schema_migrations" 2>/dev/null | tr -d '[:space:]' || true)"
  case "$MIGRATIONS_COUNT" in
    ''|*[!0-9]*) MIGRATIONS_COUNT="$(psql -tAc "SELECT count(*) FROM schema_migrations" 2>/dev/null | tr -d '[:space:]' || true)" ;;
  esac
  case "$MIGRATIONS_COUNT" in
    ''|*[!0-9]*) MIGRATIONS_COUNT=""; METADATA_WARNING="migrations ledger table not found" ;;
  esac
else
  METADATA_WARNING="psql not found"
fi
if [ -z "$SERVER_VERSION" ]; then
  METADATA_WARNING="${METADATA_WARNING:+$METADATA_WARNING; }server_version unavailable"
fi
if [ -n "$METADATA_WARNING" ]; then
  log "WARN: manifest metadata incomplete: $METADATA_WARNING"
fi

# ---- offsite copy + remote verification ----
FINAL_STATUS="success"
OFFSITE_STATUS="disabled"
OFFSITE_UPLOADED=0
OFFSITE_VERIFY_MODE="none"
REMOTE_SIZE=""
REMOTE_SHA=""
OFFSITE_ERROR=""
WARNINGS_JSON=""
add_warning() {
  local item
  item="$(json_string_or_null "$1")"
  if [ -z "$WARNINGS_JSON" ]; then
    WARNINGS_JSON="$item"
  else
    WARNINGS_JSON="$WARNINGS_JSON, $item"
  fi
}
if [ "$VERIFY_RESTORE_LIST" != "1" ]; then
  add_warning "pg_restore --list verification disabled"
fi
if [ -n "$METADATA_WARNING" ]; then
  add_warning "$METADATA_WARNING"
fi

write_manifest() {
  local finished_at tmp_manifest
  finished_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  tmp_manifest="$MANIFEST.tmp.$$"
  {
    printf '{\n'
    printf '  "schema_version": 1,\n'
    printf '  "status": %s,\n' "$(json_string_or_null "$FINAL_STATUS")"
    printf '  "started_at": %s,\n' "$(json_string_or_null "$STARTED_AT")"
    printf '  "finished_at": %s,\n' "$(json_string_or_null "$finished_at")"
    printf '  "hostname": %s,\n' "$(json_string_or_null "$HOST_NAME")"
    printf '  "database": %s,\n' "$(json_string_or_null "$DATABASE_NAME")"
    printf '  "file": %s,\n' "$(json_string_or_null "$(basename -- "$FILE")")"
    printf '  "size_bytes": %s,\n' "$(json_number_or_null "$SIZE_BYTES")"
    printf '  "sha256": %s,\n' "$(json_string_or_null "$SHA256")"
    printf '  "toc_entries": %s,\n' "$(json_number_or_null "$TOC_ENTRIES")"
    printf '  "server_version": %s,\n' "$(json_string_or_null "$SERVER_VERSION")"
    printf '  "web_schema_migrations": %s,\n' "$(json_number_or_null "$MIGRATIONS_COUNT")"
    printf '  "verify_restore_list": %s,\n' "$([ "$VERIFY_RESTORE_LIST" = "1" ] && printf true || printf false)"
    printf '  "retention_days": %s,\n' "$RETENTION_DAYS"
    printf '  "rclone_remote": %s,\n' "$(json_string_or_null "${RCLONE_REMOTE:-}")"
    printf '  "offsite": {\n'
    printf '    "status": %s,\n' "$(json_string_or_null "$OFFSITE_STATUS")"
    printf '    "uploaded": %s,\n' "$([ "$OFFSITE_UPLOADED" = "1" ] && printf true || printf false)"
    printf '    "verified": %s,\n' "$(json_string_or_null "$OFFSITE_VERIFY_MODE")"
    printf '    "size_bytes": %s,\n' "$(json_number_or_null "$REMOTE_SIZE")"
    printf '    "sha256": %s,\n' "$(json_string_or_null "$REMOTE_SHA")"
    printf '    "error": %s\n' "$(json_string_or_null "$OFFSITE_ERROR")"
    printf '  },\n'
    printf '  "warnings": [%s]\n' "$WARNINGS_JSON"
    printf '}\n'
  } >"$tmp_manifest" 2>/dev/null || fail "cannot write manifest: $MANIFEST"
  mv -f -- "$tmp_manifest" "$MANIFEST" || fail "cannot move the manifest into place: $MANIFEST"
  log "INFO: manifest written: $MANIFEST"
}

REMOTE_PATH=""
REMOTE_DUMP=""
if [ -n "${RCLONE_REMOTE:-}" ]; then
  if [ ! -f "$RCLONE_CONFIG_FILE" ]; then
    OFFSITE_STATUS="failed"
    OFFSITE_ERROR="rclone config not found at $RCLONE_CONFIG_FILE"
  elif ! command -v rclone >/dev/null 2>&1; then
    OFFSITE_STATUS="failed"
    OFFSITE_ERROR="rclone executable not found"
  else
    REMOTE_ROOT="${RCLONE_REMOTE%/}"
    REMOTE_PATH="${REMOTE_ROOT}/${RCLONE_DEST_SUBDIR#/}"
    REMOTE_DUMP="${REMOTE_PATH}/$(basename -- "$FILE")"
    log "INFO: copying dump offsite: $REMOTE_DUMP"
    if rclone --config "$RCLONE_CONFIG_FILE" copy "$FILE" "${REMOTE_PATH}/" --include "$(basename -- "$FILE")" 2>"$TMP_DIR/rclone-copy.err"; then
      OFFSITE_UPLOADED=1
      REMOTE_SIZE="$(rclone --config "$RCLONE_CONFIG_FILE" lsjson --no-mimetype --no-modtime "$REMOTE_DUMP" 2>/dev/null | sed -n 's/.*"Size":[[:space:]]*\([0-9][0-9]*\).*/\1/p' | head -n 1 || true)"
      case "$REMOTE_SIZE" in
        ''|*[!0-9]*) REMOTE_SIZE="" ;;
      esac
      REMOTE_SHA=""
      if rclone --config "$RCLONE_CONFIG_FILE" hashsum SHA-256 "$REMOTE_DUMP" >"$TMP_DIR/rclone-hash.out" 2>"$TMP_DIR/rclone-hash.err"; then
        REMOTE_SHA="$(awk 'NR==1 {print $1}' "$TMP_DIR/rclone-hash.out" | tr -d '[:space:]' || true)"
        case "$REMOTE_SHA" in
          ''|*[!0-9a-fA-F]*) REMOTE_SHA="" ;;
        esac
      fi
      if [ -z "$REMOTE_SIZE" ]; then
        OFFSITE_STATUS="failed"
        OFFSITE_ERROR="offsite dump exists but its size could not be verified"
      elif [ "$REMOTE_SIZE" != "$SIZE_BYTES" ]; then
        OFFSITE_STATUS="failed"
        OFFSITE_ERROR="offsite size mismatch (local=$SIZE_BYTES remote=$REMOTE_SIZE)"
      elif [ -n "$REMOTE_SHA" ] && [ "$REMOTE_SHA" != "$SHA256" ]; then
        OFFSITE_STATUS="failed"
        OFFSITE_ERROR="offsite SHA-256 mismatch"
      elif [ -n "$REMOTE_SHA" ]; then
        OFFSITE_STATUS="verified"
        OFFSITE_VERIFY_MODE="size+sha256"
      else
        OFFSITE_STATUS="verified"
        OFFSITE_VERIFY_MODE="size"
      fi
      log "INFO: offsite dump status=$OFFSITE_STATUS verification=$OFFSITE_VERIFY_MODE size=${REMOTE_SIZE:-unknown}"
    else
      OFFSITE_STATUS="failed"
      OFFSITE_ERROR="rclone copy failed for the dump"
      tail -n 3 "$TMP_DIR/rclone-copy.err" 2>/dev/null || true
    fi
  fi
  if [ "$OFFSITE_STATUS" = "failed" ]; then
    FINAL_STATUS="failed"
  fi
fi

write_manifest

# The manifest is generated locally with the final offsite status; copy it only when
# the dump itself was uploaded and verified.
if [ -n "$REMOTE_PATH" ] && [ "$OFFSITE_STATUS" = "verified" ]; then
  REMOTE_MANIFEST="${REMOTE_PATH}/$(basename -- "$MANIFEST")"
  if rclone --config "$RCLONE_CONFIG_FILE" copy "$MANIFEST" "${REMOTE_PATH}/" --include "$(basename -- "$MANIFEST")" 2>"$TMP_DIR/rclone-manifest.err"; then
    MANIFEST_SIZE="$(stat -c %s "$MANIFEST" 2>/dev/null || printf '')"
    REMOTE_MANIFEST_SIZE="$(rclone --config "$RCLONE_CONFIG_FILE" lsjson --no-mimetype --no-modtime "$REMOTE_MANIFEST" 2>/dev/null | sed -n 's/.*"Size":[[:space:]]*\([0-9][0-9]*\).*/\1/p' | head -n 1 || true)"
    if [ -n "$REMOTE_MANIFEST_SIZE" ] && [ "$REMOTE_MANIFEST_SIZE" = "$MANIFEST_SIZE" ]; then
      log "INFO: manifest copied offsite and verified: $REMOTE_MANIFEST"
    else
      log "WARN: manifest copied offsite but the remote size could not be verified."
    fi
  else
    OFFSITE_STATUS="failed"
    OFFSITE_ERROR="rclone copy failed for the manifest"
    FINAL_STATUS="failed"
    tail -n 3 "$TMP_DIR/rclone-manifest.err" 2>/dev/null || true
    write_manifest
  fi
fi

# ---- retention (local always, even when offsite failed: previous behaviour) ----
find "$DIR" -maxdepth 1 -type f -name 'dar-*.dump' -mtime "+$RETENTION_DAYS" -delete 2>/dev/null || true
find "$DIR" -maxdepth 1 -type f -name 'dar-*.manifest.json' -mtime "+$RETENTION_DAYS" -delete 2>/dev/null || true

if [ -n "$REMOTE_PATH" ] && command -v rclone >/dev/null 2>&1 && [ -f "$RCLONE_CONFIG_FILE" ]; then
  rclone --config "$RCLONE_CONFIG_FILE" delete "${REMOTE_PATH}/" --min-age "${RETENTION_DAYS}d" \
    --include 'dar-*.dump' --include 'dar-*.manifest.json' \
    || log "WARN: offsite retention cleanup failed."
fi

if [ "$FINAL_STATUS" = "success" ]; then
  log "INFO: backup completed successfully."
  exit 0
fi

log "ERROR: backup incomplete; the local dump was kept: $FILE (offsite=$OFFSITE_STATUS${OFFSITE_ERROR:+ error=$OFFSITE_ERROR})"
exit 1
