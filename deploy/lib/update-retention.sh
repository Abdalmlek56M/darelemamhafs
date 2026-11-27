# shellcheck shell=bash
# =============================================================================
# Dar production update - retention of old app copies and pre-deploy dumps
# =============================================================================
# Sourced by deploy/lib/update-functions.sh (through deploy/update.sh only).
# Defines : cleanup_retention (last 5 legacy.old/api.old/meet-bot.old copies,
#           last 3 failed copies per component, pre-deploy dumps older than 30
#           days).
# =============================================================================
# shellcheck disable=SC2154

cleanup_retention() {
  step "Retention"
  local component
  local count
  local path
  for component in legacy api; do
    count=0
    while IFS= read -r path; do
      [ -n "$path" ] || continue
      count=$((count + 1))
      if [ "$count" -gt 5 ]; then
        $SUDO rm -rf -- "$path"
        info "removed old app copy: $path"
      fi
    done < <(find "$APP_ROOT" -maxdepth 1 -type d -name "$component.old.*" -printf '%T@ %p\n' 2>/dev/null | sort -rn | cut -d' ' -f2-)
    count=0
    while IFS= read -r path; do
      [ -n "$path" ] || continue
      count=$((count + 1))
      if [ "$count" -gt 3 ]; then
        $SUDO rm -rf -- "$path"
        info "removed failed app copy: $path"
      fi
    done < <(find "$APP_ROOT" -maxdepth 1 -type d -name "$component.failed.*" -printf '%T@ %p\n' 2>/dev/null | sort -rn | cut -d' ' -f2-)
  done
  if [ "$MEET_BOT_ENABLED" -eq 1 ]; then
    local bot_parent
    bot_parent="$(dirname -- "$MEET_BOT_DIR")"
    local bot_name
    bot_name="$(basename -- "$MEET_BOT_DIR")"
    count=0
    while IFS= read -r path; do
      [ -n "$path" ] || continue
      count=$((count + 1))
      if [ "$count" -gt 5 ]; then
        $SUDO rm -rf -- "$path"
        info "removed old meet-bot copy: $path"
      fi
    done < <(find "$bot_parent" -maxdepth 1 -type d -name "$bot_name.old.*" -printf '%T@ %p\n' 2>/dev/null | sort -rn | cut -d' ' -f2-)
    count=0
    while IFS= read -r path; do
      [ -n "$path" ] || continue
      count=$((count + 1))
      if [ "$count" -gt 3 ]; then
        $SUDO rm -rf -- "$path"
        info "removed failed meet-bot copy: $path"
      fi
    done < <(find "$bot_parent" -maxdepth 1 -type d -name "$bot_name.failed.*" -printf '%T@ %p\n' 2>/dev/null | sort -rn | cut -d' ' -f2-)
  fi
  $SUDO find "$BACKUP_DB_DIR" -maxdepth 1 -type f -name 'dar-pre-deploy-*' -mtime +30 -delete 2>/dev/null || true
  info "pre-deploy dumps older than 30 days removed"
}
