# shellcheck shell=bash
# =============================================================================
# Dar production update - health/readiness wait, HTTP smoke checks and the
# post-swap "real login + one money read" smoke
# =============================================================================
# Sourced by deploy/lib/update-functions.sh (through deploy/update.sh only).
# Defines : wait_ready (90s readiness poll), check_http, smoke_all (the seven
#           public endpoints), wait_meet_bot_active, load_smoke_credentials,
#           smoke_login_and_money_read and restart_and_smoke (restart, then
#           smoke; a failure rolls the binaries back).
#
# The login smoke never prints a credential: the JSON request body is written to
# a 0600 temporary file, curl reads it with --data @file, and only HTTP status
# codes are logged.
# =============================================================================
# shellcheck disable=SC2154,SC2034

wait_ready() {
  local url="$1"
  local deadline=$((SECONDS + 90))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if curl -fsS --max-time 5 "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  return 1
}

check_http() {
  local label="$1"
  local url="$2"
  local code
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$url" 2>/dev/null || true)"
  if [ "$code" = "200" ]; then
    info "smoke OK   $label ($code)"
    return 0
  fi
  printf '    smoke FAIL %s (HTTP %s)\n' "$label" "${code:-none}" >&2
  return 1
}

smoke_all() {
  local failures=0
  local label
  local url
  while IFS='|' read -r label url; do
    [ -n "$label" ] || continue
    if ! check_http "$label" "$url"; then
      failures=$((failures + 1))
    fi
  done <<'SMOKE'
legacy health|http://127.0.0.1:5080/health/ready
api health|http://127.0.0.1:5081/health/ready
home page|http://127.0.0.1:5080/
management page|http://127.0.0.1:5080/management
teacher portal|http://127.0.0.1:5080/teacher
supervisor portal|http://127.0.0.1:5080/supervisor
api ping|http://127.0.0.1:5081/api/v1/ping
SMOKE
  [ "$failures" -eq 0 ]
}

wait_meet_bot_active() {
  [ "$MEET_BOT_ENABLED" -eq 1 ] || return 0
  local deadline=$((SECONDS + 45))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if $SUDO systemctl is-active --quiet "$MEET_BOT_SERVICE" 2>/dev/null; then
      info "meet-bot: $MEET_BOT_SERVICE is active"
      return 0
    fi
    sleep 2
  done
  return 1
}

# Reads SMOKE_USERNAME/SMOKE_PASSWORD from the environment first and then from
# $SMOKE_ENV_FILE (default /etc/dar/smoke.env). Returns 1 when no credentials are
# configured; never echoes the values.
load_smoke_credentials() {
  SMOKE_USERNAME="${DAR_SMOKE_USERNAME:-}"
  SMOKE_PASSWORD="${DAR_SMOKE_PASSWORD:-}"
  if [ -z "$SMOKE_USERNAME" ] || [ -z "$SMOKE_PASSWORD" ]; then
    if $SUDO test -r "$SMOKE_ENV_FILE" 2>/dev/null; then
      local content line key value
      content="$($SUDO cat "$SMOKE_ENV_FILE" 2>/dev/null || true)"
      while IFS= read -r line; do
        line="${line%$'\r'}"
        case "$line" in
        "" | \#*) continue ;;
        esac
        key="${line%%=*}"
        value="${line#*=}"
        case "$key" in
        SMOKE_USERNAME | DAR_SMOKE_USERNAME) SMOKE_USERNAME="$value" ;;
        SMOKE_PASSWORD | DAR_SMOKE_PASSWORD) SMOKE_PASSWORD="$value" ;;
        esac
      done <<<"$content"
      unset content
    fi
  fi
  if [ -z "$SMOKE_USERNAME" ] || [ -z "$SMOKE_PASSWORD" ]; then
    SMOKE_ENABLED=0
    return 1
  fi
  SMOKE_ENABLED=1
  return 0
}

smoke_json_escape() {
  local value="${1-}"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/\\r}"
  value="${value//$'\t'/\\t}"
  printf '%s' "$value"
}

# A rejected login/permission is an operator configuration problem, not an app
# regression, so by default it warns instead of rolling the deploy back.
# DAR_SMOKE_STRICT=1 turns it into a failure.
smoke_auth_problem() {
  if [ "$SMOKE_STRICT" = "1" ]; then
    printf '    smoke FAIL login: %s\n' "$*" >&2
    return 1
  fi
  warn "post-deploy login smoke: $*; deployment continues (fix $SMOKE_ENV_FILE or set DAR_SMOKE_STRICT=1)"
  return 0
}

smoke_login_and_money_read() {
  if ! load_smoke_credentials; then
    warn "post-deploy login smoke skipped: no credentials in $SMOKE_ENV_FILE (see deploy/smoke.env.example)"
    return 0
  fi
  local mode
  mode="$($SUDO stat -c '%a' "$SMOKE_ENV_FILE" 2>/dev/null || true)"
  case "$mode" in
  600 | 640 | 400) ;;
  "" | unknown) ;;
  *) warn "$SMOKE_ENV_FILE permissions are $mode, expected 600/640" ;;
  esac
  step "Post-deploy smoke: real login + money read"
  local jar resp payload code month body_head
  jar="$(mktemp)"
  resp="$(mktemp)"
  payload="$(mktemp)"
  chmod 0600 "$jar" "$resp" "$payload"
  printf '{"username":"%s","password":"%s"}' \
    "$(smoke_json_escape "$SMOKE_USERNAME")" "$(smoke_json_escape "$SMOKE_PASSWORD")" >"$payload"

  code="$(curl -sS -o "$resp" -w '%{http_code}' -c "$jar" -b "$jar" \
    -H 'Content-Type: application/json' --data @"$payload" --max-time 20 \
    "http://127.0.0.1:5080/api/auth/login" 2>/dev/null || true)"
  rm -f -- "$payload"
  unset SMOKE_PASSWORD
  case "$code" in
  200)
    info "smoke OK   login (HTTP 200)"
    ;;
  401 | 403 | 423 | 429)
    rm -f -- "$jar" "$resp"
    smoke_auth_problem "login rejected (HTTP $code); credentials/lockout or Turnstile"
    return $?
    ;;
  *)
    rm -f -- "$jar" "$resp"
    printf '    smoke FAIL login (HTTP %s)\n' "${code:-none}" >&2
    return 1
    ;;
  esac

  month="$(date +%Y-%m)"
  code="$(curl -sS -o "$resp" -w '%{http_code}' -b "$jar" --max-time 20 \
    "http://127.0.0.1:5080/api/collections?month=$month" 2>/dev/null || true)"
  body_head="$(head -c 1 "$resp" 2>/dev/null || true)"
  rm -f -- "$jar"
  case "$code" in
  200)
    if [ "$body_head" != "[" ] && [ "$body_head" != "{" ]; then
      rm -f -- "$resp"
      printf '    smoke FAIL money read returned a non-JSON body (HTTP 200)\n' >&2
      return 1
    fi
    rm -f -- "$resp"
    info "smoke OK   money read (/api/collections?month=$month, HTTP 200)"
    ;;
  401 | 403)
    rm -f -- "$resp"
    smoke_auth_problem "money read permission rejected (HTTP $code)"
    return $?
    ;;
  *)
    rm -f -- "$resp"
    printf '    smoke FAIL money read (/api/collections, HTTP %s)\n' "${code:-none}" >&2
    return 1
    ;;
  esac
  return 0
}

restart_and_smoke() {
  step "Restart services and smoke"
  start_services
  if ! wait_ready "http://127.0.0.1:5080/health/ready" || ! wait_ready "http://127.0.0.1:5081/health/ready"; then
    warn "services did not become ready after the swap"
    rollback_binaries
    fail "new binaries failed the readiness check; binaries rolled back automatically"
  fi
  if ! wait_meet_bot_active; then
    warn "meet recorder bot did not become active after the swap"
    rollback_binaries
    fail "the new meet-bot build failed to start; binaries and bot rolled back automatically"
  fi
  if ! smoke_all; then
    rollback_binaries
    fail "new binaries failed the smoke checks; binaries rolled back automatically"
  fi
  if ! smoke_login_and_money_read; then
    rollback_binaries
    fail "post-swap login/money smoke failed; binaries rolled back automatically"
  fi
}
