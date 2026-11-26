#!/usr/bin/env bash
# =============================================================================
# Dar meet - interactive Google sign-in session (lab, isolated from the site)
# =============================================================================
# Purpose : open the bot's Chromium profile on a private virtual display and expose it
#           through noVNC on loopback, so the owner can complete Google's sign-in once
#           (password + 2FA). Nothing here touches Dar.Api, the database or the site.
# Usage   : sudo dar-meet-login            (keep this terminal open while signing in)
#           then from your machine:
#             ssh -N -L 6080:127.0.0.1:6080 <deploy-user>@<server-address>
#             http://localhost:6080/vnc.html?autoconnect=1&resize=scale
# Safe    : loopback only, no VNC password, no public port; cleans up on exit.
# =============================================================================
set -euo pipefail

if [ "$(id -u)" -eq 0 ]; then SUDO=""; else SUDO="sudo -n"; fi

# Runs a command as the dar service user, whether this script runs as root or via sudo.
run_as_dar() {
  if [ "$(id -u)" -eq 0 ]; then
    runuser -u dar -- env HOME=/var/lib/dar "$@"
  else
    sudo -n -u dar env HOME=/var/lib/dar "$@"
  fi
}

BOT_DIR="${DAR_MEET_BOT_DIR:-/opt/dar-meet-bot}"
LAB_ROOT="${DAR_MEET_LAB_ROOT:-/var/lib/dar/meet-lab}"
MEDIA_ROOT="$LAB_ROOT/media"
PROFILE_DIR="${DAR_MEET_PROFILE:-/var/lib/dar/meet/profile}"
DISPLAY_NUM="${DAR_MEET_LAB_DISPLAY:-98}"
LOGIN_TIMEOUT_MIN="${DAR_MEET_LOGIN_MINUTES:-25}"
VNC_PORT=5900
WEB_PORT=6080

[ -f "$BOT_DIR/dist/index.js" ] || { echo "Bot build missing at $BOT_DIR/dist" >&2; exit 1; }

cleanup() {
  $SUDO pkill -x x11vnc 2>/dev/null || true
  $SUDO pkill -x websockify 2>/dev/null || true
  $SUDO pkill -x Xvfb 2>/dev/null || true
  rm -f "/tmp/.X${DISPLAY_NUM}-lock" "/tmp/.X11-unix/X${DISPLAY_NUM}" 2>/dev/null || true
}
cleanup
sleep 1

$SUDO install -d -m 0750 -o dar -g dar "$LAB_ROOT" "$MEDIA_ROOT" /var/lib/dar/meet
$SUDO chown -R dar:dar /var/lib/dar/meet
$SUDO install -d -m 0700 -o dar -g dar "$PROFILE_DIR" || true
trap cleanup EXIT INT TERM

echo "==> Starting the bot browser profile on display :$DISPLAY_NUM"
run_as_dar BOT_DISPLAY="$DISPLAY_NUM" BOT_PROFILE_DIR="$PROFILE_DIR" \
  BOT_MEDIA_ROOT="$MEDIA_ROOT" BOT_LOG_LEVEL=info \
  node "$BOT_DIR/dist/index.js" --login >"$LAB_ROOT/login.log" 2>&1 &
LOGIN_PID=$!
sleep 12

if ! kill -0 "$LOGIN_PID" 2>/dev/null; then
  echo "The browser exited immediately; see $LAB_ROOT/login.log" >&2
  tail -5 "$LAB_ROOT/login.log" >&2
  exit 1
fi

run_as_dar x11vnc -display ":$DISPLAY_NUM" -localhost -forever -shared -nopw -quiet \
  >"$LAB_ROOT/x11vnc.log" 2>&1 &
run_as_dar websockify "127.0.0.1:$WEB_PORT" "127.0.0.1:$VNC_PORT" --web /usr/share/novnc \
  >"$LAB_ROOT/websockify.log" 2>&1 &
sleep 3

cat <<EOF

================================================================
 جلسة تسجيل دخول Google للبوت (مؤقتة، loopback فقط)
================================================================
1) من جهازك، افتح نافذة PowerShell واتركها مفتوحة:
   ssh -N -L $WEB_PORT:127.0.0.1:$WEB_PORT <deploy-user>@<server-address>

2) في المتصفح:
   http://localhost:$WEB_PORT/vnc.html?autoconnect=1&resize=scale

3) سجّل الدخول بحساب الدار وانتظر فتح Google Calendar.
   المهلة: $LOGIN_TIMEOUT_MIN دقيقة، ثم تُغلق الجلسة تلقائيًا.

اللوج: $LAB_ROOT/login.log
================================================================
EOF

set +e
wait "$LOGIN_PID"
STATUS=$?
set -e

echo ""
if [ "$STATUS" -eq 0 ]; then
  echo "LOGIN_OK — البروفايل أصبح مسجّلًا. اللوج:"
else
  echo "LOGIN_FAILED (exit=$STATUS) — لم يكتمل تسجيل الدخول. اللوج:"
fi
tail -4 "$LAB_ROOT/login.log"
cleanup
