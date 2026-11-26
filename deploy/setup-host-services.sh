#!/usr/bin/env bash
# =============================================================================
# Dar host services - configure systemd units + environment files (idempotent)
# =============================================================================
# Purpose : write /etc/dar/*.env and the two Dar systemd units, then start or
#           restart dar-legacy (5080) and dar-api (5081) and verify /health/ready.
# Requires: root, or the deploy user with passwordless sudo.
#           deploy/.env with POSTGRES_PASSWORD + OTP_PEPPER (see deploy/.env.example).
#           Published binaries in /opt/dar/app/legacy and /opt/dar/app/api
#           (run deploy/update.sh first on a fresh host, or pass --skip-start).
# Usage   : sudo bash deploy/setup-host-services.sh [--skip-start]
# Safe    : copies the current /etc/dar/*.env and /etc/systemd/system/dar-*.service
#           files to /var/backups/dar-config/<stamp>/ before writing. Secrets are
#           never echoed, logged or written outside /etc/dar (0640 root:dar).
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${DAR_REPO_DIR:-$(cd -- "$SCRIPT_DIR/.." && pwd)}"
if [ ! -f "$REPO_DIR/deploy/.env" ] && [ -f /opt/dar/deploy/.env ]; then
  REPO_DIR=/opt/dar
fi
ENV_FILE="$REPO_DIR/deploy/.env"
CONFIG_DIR="${DAR_CONFIG_DIR:-/etc/dar}"
UNIT_DIR="${DAR_UNIT_DIR:-/etc/systemd/system}"
APP_ROOT="${DAR_APP_ROOT:-/opt/dar/app}"
BACKUP_STAMP="$(date +%Y%m%d-%H%M%S)"
CONFIG_BACKUP_DIR="/var/backups/dar-config/$BACKUP_STAMP"
SKIP_START=0

usage() {
  cat <<'USAGE'
Usage: setup-host-services.sh [--skip-start]

  --skip-start  Write units/env files and enable the units, but do not start
                or restart the services (useful before the binaries exist).
  --help        Show this help.

Reads secrets from deploy/.env, never prints them.
USAGE
}

for arg in "$@"; do
  case "$arg" in
  --skip-start) SKIP_START=1 ;;
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

if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
else
  if ! sudo -n true 2>/dev/null; then
    echo "Run as root or as a user with passwordless sudo." >&2
    exit 1
  fi
  SUDO="sudo"
fi

if [ ! -r "$ENV_FILE" ]; then
  echo "Environment file not found: $ENV_FILE" >&2
  echo "Copy deploy/.env.example to deploy/.env and fill the required values." >&2
  exit 1
fi

POSTGRES_PASSWORD="$(sed -n 's/^POSTGRES_PASSWORD=//p' "$ENV_FILE" | head -n 1)"
OTP_PEPPER="$(sed -n 's/^OTP_PEPPER=//p' "$ENV_FILE" | head -n 1)"
SMTP_HOST="$(sed -n 's/^SMTP_HOST=//p' "$ENV_FILE" | head -n 1)"
SMTP_PORT="$(sed -n 's/^SMTP_PORT=//p' "$ENV_FILE" | head -n 1)"
SMTP_USER="$(sed -n 's/^SMTP_USER=//p' "$ENV_FILE" | head -n 1)"
SMTP_PASSWORD="$(sed -n 's/^SMTP_PASSWORD=//p' "$ENV_FILE" | head -n 1)"
SMTP_FROM="$(sed -n 's/^SMTP_FROM=//p' "$ENV_FILE" | head -n 1)"
SMTP_ENABLE_SSL="$(sed -n 's/^SMTP_ENABLE_SSL=//p' "$ENV_FILE" | head -n 1)"
GOOGLE_CLIENT_ID="$(sed -n 's/^GOOGLE_CLIENT_ID=//p' "$ENV_FILE" | head -n 1)"
DAR_DOMAIN_VALUE="$(sed -n 's/^DAR_DOMAIN=//p' "$ENV_FILE" | head -n 1 || true)"
[ -n "$DAR_DOMAIN_VALUE" ] || DAR_DOMAIN_VALUE="deployment.example.invalid"

if [ -z "$POSTGRES_PASSWORD" ] || [ "$POSTGRES_PASSWORD" = "change-me-hex" ]; then
  echo "POSTGRES_PASSWORD is missing or still the example value in $ENV_FILE." >&2
  exit 1
fi
if [ -z "$OTP_PEPPER" ] || [ "$OTP_PEPPER" = "change-me-hex" ]; then
  echo "OTP_PEPPER is missing or still the example value in $ENV_FILE." >&2
  echo "Dar.Api refuses to start outside Development without a real pepper." >&2
  exit 1
fi
[ -n "$SMTP_PORT" ] || SMTP_PORT=587
[ -n "$SMTP_ENABLE_SSL" ] || SMTP_ENABLE_SSL=true

DB="Host=127.0.0.1;Port=5432;Database=dar_database;Username=dar_app;Password=$POSTGRES_PASSWORD"

echo "==> Service user"
if ! id dar >/dev/null 2>&1; then
  echo "Creating system user dar (home /var/lib/dar, no login shell)."
  $SUDO useradd --system --home-dir /var/lib/dar --create-home \
    --shell /usr/sbin/nologin --comment "Dar application services" dar
fi

echo "==> Directories"
$SUDO install -d -m 0750 -o root -g dar "$CONFIG_DIR"
$SUDO install -d -m 0750 -o dar -g dar /var/lib/dar
$SUDO install -d -m 0750 -o dar -g dar /var/lib/dar/backups
$SUDO install -d -m 0750 -o dar -g dar /var/lib/dar/backups/db
$SUDO install -d -m 0750 -o dar -g dar /var/lib/dar/app
$SUDO install -d -m 0750 -o dar -g dar /var/lib/dar/logs
# ADR-0006: both APIs must share one Data Protection key ring, otherwise the
# admin cookie issued by dar-legacy cannot be read by dar-api.
$SUDO install -d -m 0700 -o dar -g dar /var/lib/dar/keys
$SUDO install -d -m 0750 -o dar -g dar /var/lib/dar/.local/share/DarEltahfeez/Logs
$SUDO install -d -m 0755 -o root -g root /var/log/dar
$SUDO install -d -m 0755 -o root -g root "$APP_ROOT"

echo "==> Config backup ($CONFIG_BACKUP_DIR)"
$SUDO install -d -m 0700 -o root -g root "$CONFIG_BACKUP_DIR"
for existing in "$CONFIG_DIR"/*.env; do
  [ -f "$existing" ] || continue
  $SUDO install -m 0600 -o root -g root "$existing" "$CONFIG_BACKUP_DIR/"
done
for existing in "$UNIT_DIR"/dar-legacy.service "$UNIT_DIR"/dar-api.service; do
  [ -f "$existing" ] || continue
  $SUDO install -m 0600 -o root -g root "$existing" "$CONFIG_BACKUP_DIR/"
done

write_secret_file() {
  local target="$1"
  local tmp
  tmp="$(mktemp)"
  cat >"$tmp"
  chmod 0640 "$tmp"
  $SUDO chown root:dar "$tmp"
  $SUDO mv -f "$tmp" "$target"
}

write_unit_file() {
  local target="$1"
  local tmp
  tmp="$(mktemp)"
  cat >"$tmp"
  chmod 0644 "$tmp"
  $SUDO chown root:root "$tmp"
  $SUDO mv -f "$tmp" "$target"
}

echo "==> Environment files"
write_secret_file "$CONFIG_DIR/legacy.env" <<EOF
ASPNETCORE_ENVIRONMENT=Production
ASPNETCORE_URLS=http://127.0.0.1:5080
ConnectionStrings__DarDatabase=$DB
Database__ApplyMigrationsOnStartup=false
Backup__RootPath=/var/lib/dar/backups
Auth__SetupToken=
DataProtection__KeysPath=/var/lib/dar/keys
TZ=Africa/Cairo
HOME=/var/lib/dar
ForwardedHeaders__KnownProxies__0=127.0.0.1
EOF

write_secret_file "$CONFIG_DIR/api.env" <<EOF
ASPNETCORE_ENVIRONMENT=Production
ASPNETCORE_URLS=http://127.0.0.1:5081
ConnectionStrings__Default=$DB
Auth__Otp__Pepper=$OTP_PEPPER
Auth__Smtp__Host=$SMTP_HOST
Auth__Smtp__Port=$SMTP_PORT
Auth__Smtp__User=$SMTP_USER
Auth__Smtp__Password=$SMTP_PASSWORD
Auth__Smtp__From=$SMTP_FROM
Auth__Smtp__EnableSsl=$SMTP_ENABLE_SSL
Auth__Google__ClientId=$GOOGLE_CLIENT_ID
DataProtection__KeysPath=/var/lib/dar/keys
TZ=Africa/Cairo
HOME=/var/lib/dar
ForwardedHeaders__KnownProxies__0=127.0.0.1
EOF

# Meet recording module (ADR-0007, docs/19). Created once and never rewritten:
# it holds the Google OAuth secret and the AES key that protects stored tokens.
MEET_ENV_FILE="$CONFIG_DIR/meet.env"
if [ -f "$MEET_ENV_FILE" ]; then
  echo "==> Meet env: keeping existing $MEET_ENV_FILE"
else
  echo "==> Meet env: creating $MEET_ENV_FILE"
  meet_key="$(openssl rand -base64 32)"
  meet_tmp="$(mktemp)"
  cat >"$meet_tmp" <<EOF
# Google Calendar OAuth (fill once, then: systemctl restart dar-api). See docs/19.
Meet__Google__ClientId=
Meet__Google__ClientSecret=
Meet__Google__RedirectUri=https://$DAR_DOMAIN_VALUE/api/v1/meet/calendar/callback
# AES-256-GCM key for the stored refresh token and the signed OAuth state.
Meet__EncryptionKey=$meet_key
EOF
  unset meet_key
  chmod 0640 "$meet_tmp"
  $SUDO chown root:dar "$meet_tmp"
  $SUDO mv -f "$meet_tmp" "$MEET_ENV_FILE"
fi

echo "==> systemd units"
write_unit_file "$UNIT_DIR/dar-legacy.service" <<'EOF'
[Unit]
Description=Dar legacy API
After=network-online.target postgresql.service
Wants=network-online.target
Requires=postgresql.service

[Service]
Type=simple
User=dar
Group=dar
WorkingDirectory=/opt/dar/app/legacy
EnvironmentFile=/etc/dar/legacy.env
ExecStart=/usr/bin/dotnet /opt/dar/app/legacy/DarEltahfeez.Api.dll
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=/var/lib/dar
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF

write_unit_file "$UNIT_DIR/dar-api.service" <<'EOF'
[Unit]
Description=Dar new API v1
After=network-online.target postgresql.service
Wants=network-online.target
Requires=postgresql.service

[Service]
Type=simple
User=dar
Group=dar
WorkingDirectory=/opt/dar/app/api
EnvironmentFile=/etc/dar/api.env
EnvironmentFile=-/etc/dar/meet.env
ExecStart=/usr/bin/dotnet /opt/dar/app/api/Dar.Api.dll
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=/var/lib/dar
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF

$SUDO systemctl daemon-reload
$SUDO systemctl enable dar-legacy.service dar-api.service >/dev/null

wait_ready() {
  local url="$1"
  local label="$2"
  local deadline=$((SECONDS + 60))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if curl -fsS --max-time 5 "$url" >/dev/null 2>&1; then
      echo "    $label ready: $url"
      return 0
    fi
    sleep 2
  done
  echo "    $label did not become ready: $url" >&2
  return 1
}

LEGACY_DLL="$APP_ROOT/legacy/DarEltahfeez.Api.dll"
API_DLL="$APP_ROOT/api/Dar.Api.dll"

if [ "$SKIP_START" -eq 1 ]; then
  echo "==> --skip-start: units enabled, services not started."
elif [ ! -f "$LEGACY_DLL" ] || [ ! -f "$API_DLL" ]; then
  echo "==> WARN: published binaries are missing at $APP_ROOT."
  echo "    Units are enabled but not started. Publish the app (deploy/update.sh) first."
else
  echo "==> Restart services"
  $SUDO systemctl restart dar-legacy.service dar-api.service
  echo "==> Health checks"
  if ! wait_ready "http://127.0.0.1:5080/health/ready" "dar-legacy"; then
    $SUDO systemctl --no-pager --full status dar-legacy.service | sed -n '1,25p' || true
    $SUDO journalctl -u dar-legacy.service -n 30 --no-pager || true
    exit 1
  fi
  if ! wait_ready "http://127.0.0.1:5081/health/ready" "dar-api"; then
    $SUDO systemctl --no-pager --full status dar-api.service | sed -n '1,25p' || true
    $SUDO journalctl -u dar-api.service -n 30 --no-pager || true
    exit 1
  fi
fi

echo "==> Status"
$SUDO systemctl --no-pager --full status dar-legacy.service dar-api.service | sed -n '1,30p' || true
echo "SERVICES_OK"
