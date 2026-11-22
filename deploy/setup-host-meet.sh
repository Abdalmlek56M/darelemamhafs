#!/usr/bin/env bash
# =============================================================================
# Dar meet recorder - install the bot service, its slice and its environment
# =============================================================================
# Purpose : publish services/meet-recorder to /opt/dar-meet-bot, build it,
#           create /etc/dar/meet-bot.env, install dar-meet.slice + the unit,
#           then start the service and verify the internal API answers.
# Requires: root or passwordless sudo, Node 24, ffmpeg, Xvfb, PulseAudio
#           (deploy/setup-host-meet-deps.sh installs those), and Dar.Api running.
# Usage   : sudo bash deploy/setup-host-meet.sh [--skip-build] [--skip-start]
# Safe    : idempotent; never overwrites an existing /etc/dar/meet-bot.env and
#           never prints a secret.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${DAR_REPO_DIR:-$(cd -- "$SCRIPT_DIR/.." && pwd)}"
CONFIG_DIR="${DAR_CONFIG_DIR:-/etc/dar}"
UNIT_DIR="${DAR_UNIT_DIR:-/etc/systemd/system}"
BOT_DIR="${DAR_MEET_BOT_DIR:-/opt/dar-meet-bot}"
MEDIA_ROOT="${DAR_MEET_MEDIA_ROOT:-/var/lib/dar/media/meet}"
SRC_DIR="$REPO_DIR/services/meet-recorder"
SKIP_BUILD=0
SKIP_START=0

usage() {
  cat <<'USAGE'
Usage: setup-host-meet.sh [--skip-build] [--skip-start]

  --skip-build  Reuse the existing /opt/dar-meet-bot/dist (no npm install/build).
  --skip-start  Install everything but do not start or restart the service.
  --help        Show this help.
USAGE
}

for arg in "$@"; do
  case "$arg" in
  --skip-build) SKIP_BUILD=1 ;;
  --skip-start) SKIP_START=1 ;;
  --help | -h) usage; exit 0 ;;
  *) echo "Unknown argument: $arg" >&2; usage >&2; exit 2 ;;
  esac
done

if [ "$(id -u)" -eq 0 ]; then SUDO=""; else
  if ! sudo -n true 2>/dev/null; then
    echo "Run as root or as a user with passwordless sudo." >&2
    exit 1
  fi
  SUDO="sudo"
fi

[ -d "$SRC_DIR" ] || { echo "Missing bot sources: $SRC_DIR" >&2; exit 1; }
if ! id dar >/dev/null 2>&1; then
  echo "System user 'dar' is missing; run deploy/setup-host-services.sh first." >&2
  exit 1
fi
for tool in node npm ffmpeg Xvfb pactl; do
  command -v "$tool" >/dev/null 2>&1 || { echo "Missing required tool: $tool" >&2; exit 1; }
done

echo "==> Directories"
$SUDO install -d -m 0755 -o dar -g dar "$BOT_DIR"
$SUDO install -d -m 0750 -o dar -g dar "$MEDIA_ROOT"
$SUDO install -d -m 0750 -o dar -g dar "$MEDIA_ROOT/.runtime"

echo "==> Sources -> $BOT_DIR"
if command -v rsync >/dev/null 2>&1; then
  $SUDO rsync -a --delete \
    --exclude node_modules --exclude dist --exclude '*.log' \
    "$SRC_DIR/" "$BOT_DIR/"
else
  $SUDO find "$BOT_DIR" -mindepth 1 -maxdepth 1 ! -name node_modules ! -name dist -exec rm -rf {} +
  $SUDO cp -a "$SRC_DIR/." "$BOT_DIR/"
fi
$SUDO chown -R dar:dar "$BOT_DIR"

if [ "$SKIP_BUILD" -eq 0 ]; then
  echo "==> Build"
  # npm install (not ci) until a package-lock.json is committed.
  $SUDO -u dar env HOME=/var/lib/dar bash -c "cd '$BOT_DIR' && npm install --no-audit --no-fund && npm run build"
fi
[ -f "$BOT_DIR/dist/index.js" ] || { echo "Build output missing: $BOT_DIR/dist/index.js" >&2; exit 1; }

echo "==> Service token (shared with Dar.Api)"
MEET_ENV="$CONFIG_DIR/meet.env"
[ -f "$MEET_ENV" ] || { echo "Missing $MEET_ENV; run deploy/setup-host-services.sh first." >&2; exit 1; }
TOKEN="$($SUDO sed -n 's/^Meet__InternalToken=//p' "$MEET_ENV" | head -n 1)"
if [ -z "$TOKEN" ]; then
  TOKEN="$(openssl rand -hex 32)"
  printf 'Meet__InternalToken=%s\n' "$TOKEN" | $SUDO tee -a "$MEET_ENV" >/dev/null
  echo "    generated a new Meet__InternalToken in $MEET_ENV"
  echo "    restart dar-api so it picks the token up: systemctl restart dar-api"
fi

echo "==> Bot environment"
BOT_ENV="$CONFIG_DIR/meet-bot.env"
if [ -f "$BOT_ENV" ]; then
  echo "    keeping existing $BOT_ENV"
else
  tmp_env="$(mktemp)"
  cat >"$tmp_env" <<EOF
DAR_API_URL=http://127.0.0.1:5081
DAR_SERVICE_TOKEN=$TOKEN
BOT_WORKER_NAME=dar-meet-bot-1
BOT_MEDIA_ROOT=$MEDIA_ROOT
BOT_DISPLAY=99
BOT_WIDTH=1280
BOT_HEIGHT=720
BOT_FRAMERATE=30
BOT_VIDEO_BITRATE=2500k
BOT_AUDIO_BITRATE=128k
BOT_DISK_BLOCK_GB=25
BOT_POLL_MS=5000
BOT_HEARTBEAT_MS=15000
BOT_LOG_LEVEL=info
BOT_SELFTEST_SECONDS=30
EOF
  chmod 0640 "$tmp_env"
  $SUDO chown root:dar "$tmp_env"
  $SUDO mv -f "$tmp_env" "$BOT_ENV"
  echo "    created $BOT_ENV"
fi
unset TOKEN

echo "==> systemd units"
write_unit() {
  local target="$1" tmp
  tmp="$(mktemp)"
  cat >"$tmp"
  chmod 0644 "$tmp"
  $SUDO chown root:root "$tmp"
  $SUDO mv -f "$tmp" "$target"
}
write_unit "$UNIT_DIR/dar-meet.slice" <"$SCRIPT_DIR/systemd/dar-meet.slice"
write_unit "$UNIT_DIR/dar-meet-bot.service" <"$SCRIPT_DIR/systemd/dar-meet-bot.service"
$SUDO systemctl daemon-reload
$SUDO systemctl enable dar-meet-bot.service >/dev/null

if [ "$SKIP_START" -eq 0 ]; then
  echo "==> Restart dar-api (token) and dar-meet-bot"
  $SUDO systemctl restart dar-api.service
  $SUDO systemctl restart dar-meet-bot.service
  sleep 3
  printf '    dar-api       : %s\n' "$(systemctl is-active dar-api.service)"
  printf '    dar-meet-bot  : %s\n' "$(systemctl is-active dar-meet-bot.service)"
  curl -fsS --max-time 10 http://127.0.0.1:5081/health/ready >/dev/null && printf '    api health    : 200\n'
fi

echo ""
echo "SETUP_HOST_MEET_OK"
echo "  bot dir  : $BOT_DIR"
echo "  media    : $MEDIA_ROOT"
echo "  env      : $BOT_ENV"
echo "  unit     : $UNIT_DIR/dar-meet-bot.service (slice dar-meet.slice)"
echo "  self test: sudo -u dar env HOME=/var/lib/dar XDG_RUNTIME_DIR=/run/dar-meet \\"
echo "             node $BOT_DIR/dist/index.js --selftest"
