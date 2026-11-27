#!/usr/bin/env bash
# =============================================================================
# Dar LiveKit M0 spike installer - FEATURE FLAGGED, CHECKSUM VERIFIED
# =============================================================================
# Purpose : temporary test instance used to validate live audio quality before the
#           in-house meetings product (docs/22). It is NOT part of production and is
#           never installed by deploy/update.sh.
# Modes   : refuses to do anything unless the explicit feature flag is present:
#             sudo bash deploy/livekit/install-livekit-test.sh --enable-livekit-test
#           (or LIVEKIT_TEST_ENABLED=1 in the environment).
# Safety  :
#   * The livekit-server tarball is verified against a pinned SHA-256 digest
#     (v1.13.11 linux/amd64). Any other version needs LIVEKIT_SHA256=<digest>
#     or the installer fails closed - there is no silent unverified download.
#   * Media ports 7881/tcp + 7882/udp are NOT opened by default. Opening them is an
#     explicit --open-media-ports decision; closing them again on the live host is
#     an OWNER action (BLOCKED for agents, see deploy/livekit/README.md).
#   * The public /live-test/ CDN page is opt-in (--with-test-page) and never part of
#     deploy/setup-nginx.sh.
# Usage:
#   sudo bash deploy/livekit/install-livekit-test.sh --enable-livekit-test
#        [--with-test-page] [--open-media-ports]
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
VERSION="${LIVEKIT_VERSION:-v1.13.11}"
BIN=/usr/local/bin/livekit-server
CONF=/etc/dar/livekit.yaml
ENVF=/etc/dar/livekit.env
PAGE_DIR=/var/www/live-test
ENABLED="${LIVEKIT_TEST_ENABLED:-0}"
WITH_TEST_PAGE=0
OPEN_MEDIA_PORTS=0
# SHA-256 of livekit_1.13.11_linux_amd64.tar.gz (from the release's checksums.txt).
PINNED_SHA256_V1_13_11="1e9ee90ca301e1842b2887fc77cb122759756a9c8aeb4334ee91de3325ec43fb"
TMP_DIR=""

usage() {
  cat <<'USAGE'
Usage: install-livekit-test.sh --enable-livekit-test [--with-test-page] [--open-media-ports]

  --enable-livekit-test  Required feature flag. Without it (or LIVEKIT_TEST_ENABLED=1)
                         the installer refuses and changes nothing.
  --with-test-page       Also install the temporary /live-test/ static page (it imports
                         livekit-client from a public CDN - test only, never production).
  --open-media-ports     Open 7881/tcp + 7882/udp in UFW. Default: leave the ports closed
                         and print the command; closing them on the live host is an owner action.
  --help                 Show this help.

Environment:
  LIVEKIT_VERSION        Release tag (default v1.13.11).
  LIVEKIT_SHA256         Expected tarball digest; required for any version other than v1.13.11.
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
  --enable-livekit-test) ENABLED=1; shift ;;
  --with-test-page) WITH_TEST_PAGE=1; shift ;;
  --open-media-ports) OPEN_MEDIA_PORTS=1; shift ;;
  --help | -h) usage; exit 0 ;;
  *)
    echo "Unknown argument: $1" >&2
    usage >&2
    exit 2
    ;;
  esac
done

if [ "$ENABLED" != "1" ]; then
  cat >&2 <<'REFUSED'
REFUSED: the LiveKit M0 spike is feature-flagged and is not installed by default.
  It is a temporary audio-quality test, not a product component. Without the explicit
  flag this script changes nothing. Re-run with:
    sudo bash deploy/livekit/install-livekit-test.sh --enable-livekit-test
  See deploy/livekit/README.md for the checklist and the owner actions around ports
  7881/7882.
REFUSED
  exit 2
fi

if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
else
  if ! sudo -n true 2>/dev/null; then
    echo "Run as root or as a user with passwordless sudo." >&2
    exit 1
  fi
  SUDO="sudo"
fi

cleanup() {
  if [ -n "$TMP_DIR" ] && [ -d "$TMP_DIR" ]; then
    rm -rf -- "$TMP_DIR" 2>/dev/null || true
  fi
}
trap cleanup EXIT

ARCH="$(uname -m)"
if [ "$ARCH" != "x86_64" ]; then
  echo "This spike installer only supports linux/amd64 (host is '$ARCH')." >&2
  exit 1
fi
command -v curl >/dev/null 2>&1 || { echo "curl is required." >&2; exit 1; }
command -v sha256sum >/dev/null 2>&1 || { echo "sha256sum is required." >&2; exit 1; }
command -v openssl >/dev/null 2>&1 || { echo "openssl is required." >&2; exit 1; }

TARBALL="livekit_${VERSION#v}_linux_amd64.tar.gz"
URL="https://github.com/livekit/livekit/releases/download/$VERSION/$TARBALL"
EXPECTED_SHA="${LIVEKIT_SHA256:-}"
if [ -z "$EXPECTED_SHA" ] && [ "$VERSION" = "v1.13.11" ]; then
  EXPECTED_SHA="$PINNED_SHA256_V1_13_11"
fi
if [ -z "$EXPECTED_SHA" ]; then
  echo "No pinned digest for $VERSION. Set LIVEKIT_SHA256=<sha256 of $TARBALL> (the release ships checksums.txt)." >&2
  exit 1
fi
case "$EXPECTED_SHA" in
*[!0-9a-f]*)
  echo "LIVEKIT_SHA256 must be a lowercase 64-character hex digest." >&2
  exit 1
  ;;
esac
if [ "${#EXPECTED_SHA}" -ne 64 ]; then
  echo "LIVEKIT_SHA256 must be a 64-character hex digest (got ${#EXPECTED_SHA} characters)." >&2
  exit 1
fi

echo "==> Directories"
$SUDO mkdir -p /var/lib/livekit /etc/dar
if ! id livekit >/dev/null 2>&1; then
  $SUDO useradd --system --create-home --home-dir /var/lib/livekit --shell /usr/sbin/nologin livekit
fi
$SUDO chown -R livekit:livekit /var/lib/livekit
$SUDO chmod 750 /var/lib/livekit

if [ ! -x "$BIN" ]; then
  TMP_DIR="$(mktemp -d)"
  chmod 700 "$TMP_DIR"
  echo "==> Download livekit-server $VERSION"
  curl -fsSL --retry 3 --retry-delay 2 --max-time 300 -o "$TMP_DIR/$TARBALL" "$URL"
  printf '%s  %s\n' "$EXPECTED_SHA" "$TARBALL" >"$TMP_DIR/expected.sha256"
  if ! (cd "$TMP_DIR" && sha256sum -c --quiet expected.sha256); then
    echo "CHECKSUM MISMATCH for $TARBALL; refusing to install (download removed)." >&2
    exit 1
  fi
  echo "    sha256 verified: $EXPECTED_SHA"
  tar -xzf "$TMP_DIR/$TARBALL" -C "$TMP_DIR"
  $SUDO install -m 0755 "$TMP_DIR/livekit-server" "$BIN"
  rm -rf -- "$TMP_DIR"
  TMP_DIR=""
else
  echo "==> $BIN already installed; keeping it (delete it to force a re-download)"
fi

if [ ! -f "$ENVF" ]; then
  (umask 077 && printf 'LIVEKIT_API_KEY=%s\nLIVEKIT_API_SECRET=%s\n' \
    "$(openssl rand -hex 8)" "$(openssl rand -hex 24)" >"$ENVF")
fi
$SUDO chown root:livekit "$ENVF"
$SUDO chmod 640 "$ENVF"
# shellcheck disable=SC1090
. "$ENVF"

(umask 077 && cat >"$CONF" <<EOF
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
)
$SUDO chown root:livekit "$CONF"
$SUDO chmod 640 "$CONF"

echo "==> Token helper + systemd unit (from $SCRIPT_DIR)"
$SUDO install -m 0755 -o root -g root "$SCRIPT_DIR/dar-livekit-token.py" /usr/local/bin/dar-live-token
$SUDO install -m 0644 -o root -g root "$SCRIPT_DIR/dar-livekit.service" /etc/systemd/system/dar-livekit.service

if [ "$WITH_TEST_PAGE" -eq 1 ]; then
  echo "==> Test page (opt-in; imports livekit-client from a public CDN)"
  [ -f "$SCRIPT_DIR/live-test-index.html" ] || { echo "Missing test page: $SCRIPT_DIR/live-test-index.html" >&2; exit 1; }
  $SUDO install -d -o root -g root -m 0755 "$PAGE_DIR"
  $SUDO install -o root -g root -m 0644 "$SCRIPT_DIR/live-test-index.html" "$PAGE_DIR/index.html"
else
  echo "==> Test page NOT installed (add --with-test-page only for the M0 spike)"
fi

echo "==> Firewall (media ports)"
if [ "$OPEN_MEDIA_PORTS" -eq 1 ]; then
  $SUDO ufw allow 7881/tcp >/dev/null
  $SUDO ufw allow 7882/udp >/dev/null
  echo "    opened 7881/tcp + 7882/udp (owner must close them after the spike)"
else
  echo "    media ports stay CLOSED. To run the spike, the owner opens them explicitly:"
  echo "      sudo ufw allow 7881/tcp && sudo ufw allow 7882/udp"
  echo "    Closing them on the live host after the spike is an OWNER action (BLOCKED for agents):"
  echo "      sudo ufw delete allow 7881/tcp; sudo ufw delete allow 7882/udp"
fi

echo "==> systemd"
$SUDO systemctl daemon-reload
$SUDO systemctl enable dar-livekit >/dev/null 2>&1 || true
$SUDO systemctl restart dar-livekit
sleep 2
$SUDO systemctl is-active dar-livekit
$SUDO ss -lntup 2>/dev/null | grep -E ':(7880|7881|7882) ' || true
echo "LIVEKIT_INSTALL_OK version=$VERSION test_page=$WITH_TEST_PAGE media_ports_opened=$OPEN_MEDIA_PORTS"
echo "  WSS:    https://<deployment-host>/livekit  (Nginx location added by hand from deploy/livekit/nginx-livekit-locations.conf)"
echo "  ports : 7881/7882 are owner actions; never expose the test page without a token."
