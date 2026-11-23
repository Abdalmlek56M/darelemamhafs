# LiveKit M0 test deployment (Dar)

Temporary test instance used to validate live audio quality **before** building the in-house meetings product (docs/22). It is isolated from the product: separate service, separate static page, no product routes changed except two Nginx locations.

## What runs

| Part | Where | Notes |
|---|---|---|
| livekit-server v1.13.11 | `/usr/local/bin/livekit-server` + `dar-livekit.service` | binds signaling to 127.0.0.1:7880 |
| RTC | UDP 7882 (mux) + TCP 7881 | opened in UFW by the installer; media never goes through Nginx/Cloudflare |
| WSS signaling | `/livekit/` in the Nginx site | `https://dar-elemam-hafs.rigxhardware.com/livekit` |
| Test page | `/var/www/live-test/` → `/live-test/` | static, unlisted; no real auth, tokens required to join |
| Tokens | `/usr/local/bin/dar-live-token ROOM IDENTITY NAME TTL_HOURS` | HS256, reads `/etc/dar/livekit.env` |
| Config/secrets | `/etc/dar/livekit.yaml`, `/etc/dar/livekit.env` (640 root:livekit) | never committed |
| UDP buffers | `/etc/sysctl.d/99-dar-livekit.conf` | 16MB rmem/wmem |

## Deploy / update

```bash
# from the repo root (after copying the files to /tmp as the script expects)
sudo bash deploy/livekit/install-livekit-test.sh
# nginx snippet is merged into /etc/nginx/sites-available/dar-elemam-hafs (backup is taken)
sudo nginx -t && sudo systemctl reload nginx
```

The installer is idempotent; it downloads the binary only if missing and keeps existing API keys.

## Issue a token + link

```bash
ROOM="dar-test-$(openssl rand -hex 3)"
TOKEN=$(sudo /usr/local/bin/dar-live-token "$ROOM" owner 'المالك' 12)
echo "https://dar-elemam-hafs.rigxhardware.com/live-test/#room=$ROOM&t=$TOKEN"
```

## Test checklist (two devices, different networks)

1. Open the link on two devices (Chrome/Edge desktop + Android Chrome; iOS Safari only if a real device is available).
2. Join room → press "تشغيل الصوت" (autoplay gesture) → unmute mic on one side and speak.
3. Listen for dropouts/gaps on the other side; switch one device to mobile data to test NAT/TURN need.
4. Try "مشاركة الشاشة" while speaking (load test equivalent of the recorder failure case).
5. If a device on mobile data fails to connect while WiFi works → UDP is blocked, TURN is required (next step).

## Rollback / removal

```bash
sudo systemctl disable --now dar-livekit
sudo rm -f /etc/systemd/system/dar-livekit.service /var/www/live-test/index.html /usr/local/bin/dar-live-token /usr/local/bin/livekit-server
sudo rm -f /etc/dar/livekit.yaml /etc/dar/livekit.env /etc/sysctl.d/99-dar-livekit.conf
# restore the Nginx site backup created during install, then: sudo nginx -t && sudo systemctl reload nginx
sudo ufw delete allow 7881/tcp; sudo ufw delete allow 7882/udp
```

## Security notes for the test

- The page is unlisted but public; joining needs a short-lived signed token. Do not publish the links.
- The API key/secret stay on the host in `/etc/dar/livekit.env`; rotate by deleting the file + restarting (config is regenerated from env on install).
- This is a spike: no TURN, no recording, no auth integration, no monitoring/alerts yet.
