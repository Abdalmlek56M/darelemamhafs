# shellcheck shell=bash
# =============================================================================
# Dar production update - health/readiness wait + HTTP smoke checks
# =============================================================================
# Sourced by deploy/lib/update-functions.sh (through deploy/update.sh only).
# Defines : wait_ready (90s readiness poll), check_http, smoke_all (the seven
#           public endpoints) and restart_and_smoke (restart, then smoke; a
#           failure rolls the binaries back).
# =============================================================================
# shellcheck disable=SC2154

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

restart_and_smoke() {
  step "Restart services and smoke"
  start_services
  if ! wait_ready "http://127.0.0.1:5080/health/ready" || ! wait_ready "http://127.0.0.1:5081/health/ready"; then
    warn "services did not become ready after the swap"
    rollback_binaries
    fail "new binaries failed the readiness check; binaries rolled back automatically"
  fi
  if ! smoke_all; then
    rollback_binaries
    fail "new binaries failed the smoke checks; binaries rolled back automatically"
  fi
}
