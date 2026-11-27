# shellcheck shell=bash
# =============================================================================
# Dar healthcheck - text/JSON rendering and the opt-in Telegram alert
# =============================================================================
# Sourced by deploy/scripts/dar-healthcheck.sh (installed to /usr/local/lib/dar/healthcheck).
# Uses the CHECK_NAMES/CHECK_STATUSES/CHECK_DETAILS arrays and the result counters
# prepared by the entry point. The JSON document is built with jq; the Telegram
# token is only ever written into a 0600 curl config file that is deleted right
# after the call, so it never appears in argv or in the output/log.
# =============================================================================
# shellcheck disable=SC2154

render_text() {
  printf 'Dar healthcheck — %s — %s\n' "$NOW_ISO" "$HOST_NAME"
  printf '\n'
  local index=0
  local name
  for name in "${CHECK_NAMES[@]}"; do
    printf '[%-8s] %s: %s\n' \
      "$(printf '%s' "${CHECK_STATUSES[$index]}" | tr '[:lower:]' '[:upper:]')" \
      "$name" "${CHECK_DETAILS[$index]}"
    index=$((index + 1))
  done
  printf '\nRESULT: %s (ok=%s warning=%s critical=%s)\n' \
    "$(printf '%s' "$RESULT" | tr '[:lower:]' '[:upper:]')" \
    "$OK_COUNT" "$WARNING_COUNT" "$CRITICAL_COUNT"
}

render_json() {
  local check_file
  check_file="$(mktemp)"
  local index=0
  local name
  for name in "${CHECK_NAMES[@]}"; do
    printf '%s\t%s\t%s\n' "$name" "${CHECK_STATUSES[$index]}" "${CHECK_DETAILS[$index]}" >>"$check_file"
    index=$((index + 1))
  done
  local checks_json
  checks_json="$(jq -R -s 'split("\n") | map(select(length > 0) | split("\t") | {name: .[0], status: .[1], detail: (.[2:] | join("\t"))})' "$check_file")"
  rm -f -- "$check_file"
  jq -n \
    --arg time "$NOW_ISO" \
    --arg hostname "$HOST_NAME" \
    --arg result "$RESULT" \
    --argjson exit_code "$EXIT_CODE" \
    --argjson ok "$OK_COUNT" \
    --argjson warning "$WARNING_COUNT" \
    --argjson critical "$CRITICAL_COUNT" \
    --argjson checks "$checks_json" \
    --argjson disk_min "$DISK_MIN_FREE_PCT" \
    --argjson backup_max "$BACKUP_MAX_AGE_HOURS" \
    --argjson offsite_max "$OFFSITE_MAX_AGE_HOURS" \
    --argjson cert_min "$CERT_MIN_DAYS" \
    '{
      schema_version: 1,
      time: $time,
      hostname: $hostname,
      result: $result,
      exit_code: $exit_code,
      counts: {ok: $ok, warning: $warning, critical: $critical},
      thresholds: {
        disk_min_free_percent: $disk_min,
        backup_max_age_hours: $backup_max,
        offsite_max_age_hours: $offsite_max,
        cert_min_days: $cert_min
      },
      checks: $checks
    }'
}

telegram_configured() {
  [ -n "$TELEGRAM_TOKEN" ] && [ -n "$TELEGRAM_CHAT_ID" ]
}

notify_telegram() {
  if [ "$TELEGRAM_ENABLED" = "0" ]; then
    return 0
  fi
  if ! telegram_configured; then
    if [ "$TELEGRAM_ENABLED" = "1" ]; then
      printf 'WARN: HEALTHCHECK_TELEGRAM_ENABLED=1 but the token/chat id are empty; alert skipped\n' >&2
    fi
    return 0
  fi
  if [ "$RESULT" = "ok" ] && [ "$TELEGRAM_NOTIFY_ALWAYS" != "1" ]; then
    return 0
  fi
  if ! command -v curl >/dev/null 2>&1; then
    printf 'WARN: curl not available; Telegram alert skipped\n' >&2
    return 0
  fi
  local text line index=0
  text="Dar healthcheck: $(printf '%s' "$RESULT" | tr '[:lower:]' '[:upper:]') on $HOST_NAME (ok=$OK_COUNT warning=$WARNING_COUNT critical=$CRITICAL_COUNT)"
  for line in "${CHECK_NAMES[@]}"; do
    if [ "${CHECK_STATUSES[$index]}" != "ok" ]; then
      text="$text | $line=${CHECK_STATUSES[$index]}: ${CHECK_DETAILS[$index]}"
    fi
    index=$((index + 1))
    if [ "$index" -ge 15 ]; then
      text="$text | ..."
      break
    fi
  done
  text="${text:0:3500}"
  text="${text//$'\n'/ | }"
  text="${text//\"/\'}"
  local cfg
  cfg="$(mktemp)"
  chmod 0600 "$cfg"
  {
    printf 'silent\n'
    printf 'show-error\n'
    printf 'max-time = 10\n'
    printf 'url = "https://api.telegram.org/bot%s/sendMessage"\n' "$TELEGRAM_TOKEN"
    printf 'data-urlencode = "chat_id=%s"\n' "$TELEGRAM_CHAT_ID"
    printf 'data-urlencode = "text=%s"\n' "$text"
  } >"$cfg"
  if curl --config "$cfg" >/dev/null 2>&1; then
    printf 'Telegram alert sent (%s)\n' "$RESULT" >&2
  else
    printf 'WARN: Telegram alert delivery failed (healthcheck result is unchanged)\n' >&2
  fi
  rm -f -- "$cfg"
}
