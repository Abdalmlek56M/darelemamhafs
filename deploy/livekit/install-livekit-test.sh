#!/usr/bin/env bash
# Dar LiveKit test deployment (M0/M3 preview) — installs livekit-server on the host,
# binds signaling to loopback (Nginx proxies WSS), opens the media ports and starts systemd.
set -euo pipefail
VERSION="${LIVEKIT_VERSION:-v1.13.11}"
BIN=/usr/local/bin/livekit-server
CONF=/etc/dar/livekit.yaml
ENVF=/etc/dar/livekit.env
mkdir -p /var/lib/livekit
if ! id livekit >/dev/null 2>&1; then
  useradd --system --create-home --home-dir /var/lib/livekit --shell /usr/sbin/nologin livekit
fi
chown -R livekit:livekit /var/lib/livekit
chmod 750 /var/lib/livekit

if [ ! -x "$BIN" ]; then
  TMP=$(mktemp -d)
  echo "downloading livekit-server $VERSION"
  curl -fsSL "https://github.com/livekit/livekit/releases/download/$VERSION/livekit_${VERSION#v}_linux_amd64.tar.gz" -o "$TMP/lk.tgz"
  tar -xzf "$TMP/lk.tgz" -C "$TMP"
  install -m 0755 "$TMP/livekit-server" "$BIN"
  rm -rf "$TMP"
fi

if [ ! -f "$ENVF" ]; then
  umask 077
  printf 'LIVEKIT_API_KEY=%s\nLIVEKIT_API_SECRET=%s\n' "$(openssl rand -hex 8)" "$(openssl rand -hex 24)" > "$ENVF"
fi
chown root:livekit "$ENVF"
chmod 640 "$ENVF"
. "$ENVF"

umask 077
cat > "$CONF" <<EOF
port: 7880
bind_addresses:
  - 127.0.0.1
rtc:
  tcp_port: 7881
  udp_port: 7882
  use_external_ip: true
  # Single UDP mux port keeps the host firewall simple (open 7882/udp + 7881/tcp).
keys:
  $LIVEKIT_API_KEY: $LIVEKIT_API_SECRET
room:
  auto_create: true
  empty_timeout: 300
  max_participants: 50
turn:
  enabled: false
logging:
  level: info
  json: true
EOF
chown root:livekit "$CONF"
chmod 640 "$CONF"

install -d -o root -g root -m 0755 /var/www/live-test
if [ -f /tmp/live-test-index.html ]; then
  install -o root -g root -m 0644 /tmp/live-test-index.html /var/www/live-test/index.html
fi
if [ -f /tmp/dar-livekit-token.py ]; then
  install -o root -g root -m 0755 /tmp/dar-livekit-token.py /usr/local/bin/dar-live-token
fi
if [ -f /tmp/dar-livekit.service ]; then
  install -o root -g root -m 0644 /tmp/dar-livekit.service /etc/systemd/system/dar-livekit.service
fi

ufw allow 7881/tcp >/dev/null || true
ufw allow 7882/udp >/dev/null || true

systemctl daemon-reload
systemctl enable dar-livekit >/dev/null 2>&1 || true
systemctl restart dar-livekit
sleep 2
systemctl is-active dar-livekit
ss -lntup | grep -E ':(7880|7881|7882) ' || true
echo "LIVEKIT_INSTALL_OK version=$VERSION"
