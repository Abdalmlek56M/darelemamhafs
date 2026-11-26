#!/usr/bin/env bash
# =============================================================================
# Dar deployment preflight - read-only readiness checks
# =============================================================================
# Purpose : verify the host is safe to deploy/update before touching anything.
# Requires: root, or the deploy user with passwordless sudo (needed for
#           systemctl, nginx -t, and reading /etc/dar/*.env).
# Usage   : sudo bash deploy/preflight.sh [--allow-inactive]
# Exit    : 0 when no check failed; 1 when at least one check failed.
# Checks  : git checkout state, deploy/.env, /etc/dar env files/permissions,
#           required tools, service state, /health/ready on 5080/5081, nginx -t,
#           TLS certificate expiry, free disk, last database backup age,
#           PostgreSQL reachability, published app binaries, backup timer.
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${DAR_REPO_DIR:-$(cd -- "$SCRIPT_DIR/.." && pwd)}"
if [ ! -f "$REPO_DIR/deploy/.env" ] && [ -f /opt/dar/deploy/.env ]; then
  REPO_DIR=/opt/dar
fi
ENV_FILE="$REPO_DIR/deploy/.env"
CONFIG_DIR="${DAR_CONFIG_DIR:-/etc/dar}"
APP_ROOT="${DAR_APP_ROOT:-/opt/dar/app}"
BACKUP_DB_DIR="${DAR_BACKUP_DB_DIR:-/var/lib/dar/backups/db}"
ALLOW_INACTIVE=0
FAIL=0
WARN=0

usage() {
  cat <<'USAGE'
Usage: preflight.sh [--allow-inactive]

  --allow-inactive  Downgrade service/health/certificate checks to warnings
                    (first deploy before the services are configured).
  --help            Show this help.

Exit code 0 = ready, 1 = blockers found. This script changes nothing.
USAGE
}

for arg in "$@"; do
  case "$arg" in
  --allow-inactive) ALLOW_INACTIVE=1 ;;
  --help | -h)
    usage
    exit 0
    ;;
  *)
    echo "Unknown argument: $arg" >&2
    usage >&2
    exit 2
    ;;
  esac
done

section() {
  printf '\n== %s ==\n' "$*"
}

ok() {
  printf '  [ OK ] %s\n' "$*"
}

warn() {
  printf '  [WARN] %s\n' "$*"
  WARN=$((WARN + 1))
}

bad() {
  printf '  [FAIL] %s\n' "$*"
  FAIL=$((FAIL + 1))
}

soft() {
  if [ "$ALLOW_INACTIVE" -eq 1 ]; then
    warn "$* (allowed by --allow-inactive)"
  else
    bad "$*"
  fi
}

if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
else
  if ! sudo -n true 2>/dev/null; then
    echo "preflight requires root or passwordless sudo." >&2
    exit 1
  fi
  SUDO="sudo"
fi

section "Repository"
if git -C "$REPO_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  ok "git checkout: $REPO_DIR"
  branch="$(git -C "$REPO_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
  if [ "$branch" = "main" ]; then
    ok "branch: main"
  else
    bad "branch is '$branch', expected main"
  fi
  head_commit="$(git -C "$REPO_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"
  ok "HEAD: $head_commit"
  tracked_changes="$(git -C "$REPO_DIR" status --porcelain --untracked-files=no 2>/dev/null || true)"
  if [ -z "$tracked_changes" ]; then
    ok "no uncommitted tracked changes"
  else
    bad "working tree has uncommitted tracked changes"
    printf '%s\n' "$tracked_changes" | sed -n '1,10p'
  fi
  if git -C "$REPO_DIR" remote get-url origin >/dev/null 2>&1; then
    ok "git remote origin configured"
  else
    bad "git remote origin is not configured"
  fi
else
  bad "$REPO_DIR is not a git checkout"
fi

section "Configuration"
if [ -f "$ENV_FILE" ]; then
  ok "deploy/.env exists"
  env_mode="$(stat -c '%a' "$ENV_FILE" 2>/dev/null || echo unknown)"
  case "$env_mode" in
  600 | 400) ok "deploy/.env permissions: $env_mode" ;;
  *) warn "deploy/.env permissions are $env_mode, expected 600" ;;
  esac
  if grep -q '^POSTGRES_PASSWORD=change-me-hex' "$ENV_FILE"; then
    bad "POSTGRES_PASSWORD is still the example value in deploy/.env"
  elif grep -q '^POSTGRES_PASSWORD=.' "$ENV_FILE"; then
    ok "POSTGRES_PASSWORD is set"
  else
    bad "POSTGRES_PASSWORD is missing from deploy/.env"
  fi
  if git -C "$REPO_DIR" check-ignore -q deploy/.env 2>/dev/null; then
    ok "deploy/.env is git-ignored"
  else
    bad "deploy/.env is not git-ignored"
  fi
else
  bad "deploy/.env is missing"
fi

for env_name in legacy.env api.env; do
  env_path="$CONFIG_DIR/$env_name"
  if [ -f "$env_path" ]; then
    mode="$($SUDO stat -c '%a' "$env_path" 2>/dev/null || echo unknown)"
    owner="$($SUDO stat -c '%U:%G' "$env_path" 2>/dev/null || echo unknown)"
    if [ "$mode" = "640" ] && [ "$owner" = "root:dar" ]; then
      ok "$CONFIG_DIR/$env_name permissions: 640 root:dar"
    else
      warn "$CONFIG_DIR/$env_name is $mode $owner, expected 640 root:dar"
    fi
  else
    soft "missing $CONFIG_DIR/$env_name (services not configured yet)"
  fi
done
if [ -f "$CONFIG_DIR/api.env" ] && $SUDO grep -q '^Auth__Otp__Pepper=.' "$CONFIG_DIR/api.env"; then
  ok "OTP pepper configured for dar-api"
else
  bad "OTP pepper is missing; dar-api refuses to start outside Development"
fi

section "Toolchain"
for tool in git dotnet node npm psql pg_dump pg_restore curl sha256sum systemctl nginx openssl find sed awk; do
  if command -v "$tool" >/dev/null 2>&1; then
    ok "command available: $tool"
  else
    bad "command missing: $tool"
  fi
done
if command -v dotnet >/dev/null 2>&1; then
  if dotnet --list-sdks 2>/dev/null | grep -q '^10\.'; then
    ok ".NET SDK 10 present"
  else
    bad ".NET SDK 10 not found"
  fi
fi
if command -v node >/dev/null 2>&1; then
  node_major="$(node --version 2>/dev/null | sed 's/^v//' | cut -d. -f1)"
  if [ -n "$node_major" ] && [ "$node_major" -ge 24 ] 2>/dev/null; then
    ok "Node.js major version: $node_major"
  else
    warn "Node.js version is $node_major, expected 24 or newer"
  fi
fi

section "Services"
for service in nginx postgresql dar-legacy dar-api; do
  if $SUDO systemctl is-active --quiet "$service" 2>/dev/null; then
    ok "$service is active"
  else
    soft "$service is not active"
  fi
done
if $SUDO systemctl is-enabled --quiet dar-backup.timer 2>/dev/null; then
  ok "dar-backup.timer is enabled"
else
  warn "dar-backup.timer is not enabled"
fi

section "Health endpoints"
check_health() {
  local url="$1"
  local label="$2"
  if curl -fsS --max-time 5 "$url" >/dev/null 2>&1; then
    ok "$label"
  else
    soft "$label failed ($url)"
  fi
}
check_health "http://127.0.0.1:5080/health/ready" "dar-legacy /health/ready"
check_health "http://127.0.0.1:5081/health/ready" "dar-api /health/ready"
check_health "http://127.0.0.1:5081/api/v1/ping" "dar-api /api/v1/ping"

section "Nginx"
if $SUDO nginx -t >/tmp/dar-preflight-nginx.log 2>&1; then
  ok "nginx -t passes"
else
  bad "nginx -t failed"
  sed -n '1,10p' /tmp/dar-preflight-nginx.log
fi
rm -f /tmp/dar-preflight-nginx.log
if [ -L "/etc/nginx/sites-enabled/dar-elemam-hafs" ] || [ -f "/etc/nginx/sites-enabled/dar-elemam-hafs" ]; then
  ok "Dar site is enabled"
else
  warn "Dar Nginx site is not enabled"
fi

section "TLS certificate"
DOMAIN=""
if [ -r "$ENV_FILE" ]; then
  DOMAIN="$(sed -n 's/^DAR_DOMAIN=//p' "$ENV_FILE" | head -n 1)"
fi
[ -n "$DOMAIN" ] || { echo 'DAR_DOMAIN is required (set it in deploy/.env).' >&2; exit 1; }
CERT_FILE="/etc/letsencrypt/live/$DOMAIN/fullchain.pem"
if $SUDO test -f "$CERT_FILE"; then
  end_date="$($SUDO openssl x509 -in "$CERT_FILE" -noout -enddate 2>/dev/null | cut -d= -f2)"
  end_epoch="$(date -d "$end_date" +%s 2>/dev/null || echo "")"
  now_epoch="$(date +%s)"
  if [ -n "$end_epoch" ]; then
    days_left=$(((end_epoch - now_epoch) / 86400))
    if [ "$days_left" -lt 7 ]; then
      bad "certificate for $DOMAIN expires in $days_left day(s)"
    elif [ "$days_left" -lt 21 ]; then
      warn "certificate for $DOMAIN expires in $days_left day(s)"
    else
      ok "certificate for $DOMAIN valid for $days_left day(s)"
    fi
  else
    warn "could not read certificate expiry for $DOMAIN"
  fi
else
  soft "certificate not found for $DOMAIN"
fi

section "Disk"
disk_used="$(df -P "$REPO_DIR" 2>/dev/null | awk 'NR==2 {gsub("%", "", $5); print $5}')"
if [ -n "$disk_used" ]; then
  if [ "$disk_used" -ge 85 ]; then
    bad "disk usage is $disk_used% (limit 85%)"
  elif [ "$disk_used" -ge 75 ]; then
    warn "disk usage is $disk_used%"
  else
    ok "disk usage is $disk_used%"
  fi
else
  warn "could not read disk usage"
fi

section "Backups"
LATEST_BACKUP=""
if [ -d "$BACKUP_DB_DIR" ]; then
  LATEST_BACKUP="$($SUDO find "$BACKUP_DB_DIR" -maxdepth 1 -type f -name 'dar-*.dump' -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -n 1 | cut -d' ' -f2- || true)"
fi
if [ -n "$LATEST_BACKUP" ] && $SUDO test -f "$LATEST_BACKUP"; then
  backup_epoch="$($SUDO stat -c '%Y' "$LATEST_BACKUP" 2>/dev/null || echo 0)"
  now_epoch="$(date +%s)"
  age_hours=$(((now_epoch - backup_epoch) / 3600))
  if [ "$age_hours" -gt 26 ]; then
    bad "newest database backup is $age_hours hour(s) old (limit 26h): $LATEST_BACKUP"
  elif [ "$age_hours" -gt 12 ]; then
    warn "newest database backup is $age_hours hour(s) old: $LATEST_BACKUP"
  else
    ok "newest database backup is $age_hours hour(s) old"
  fi
else
  bad "no database backup found in $BACKUP_DB_DIR"
fi

section "Database"
if pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1; then
  ok "PostgreSQL accepts connections on 127.0.0.1:5432"
else
  bad "PostgreSQL is not accepting connections on 127.0.0.1:5432"
fi

section "Published binaries"
if [ -f "$APP_ROOT/legacy/DarEltahfeez.Api.dll" ]; then
  ok "dar-legacy binary present"
else
  soft "dar-legacy binary missing at $APP_ROOT/legacy"
fi
if [ -f "$APP_ROOT/api/Dar.Api.dll" ]; then
  ok "dar-api binary present"
else
  soft "dar-api binary missing at $APP_ROOT/api"
fi
if [ -f "$APP_ROOT/legacy/wwwroot/index.html" ]; then
  ok "admin SPA build present in wwwroot"
else
  warn "admin SPA build is missing from $APP_ROOT/legacy/wwwroot"
fi

section "Summary"
echo "  failures: $FAIL"
echo "  warnings: $WARN"
if [ "$FAIL" -gt 0 ]; then
  echo "PREFLIGHT_FAILED failures=$FAIL warnings=$WARN"
  exit 1
fi
echo "PREFLIGHT_OK warnings=$WARN"
exit 0
