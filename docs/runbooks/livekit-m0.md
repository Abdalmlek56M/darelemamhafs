# Runbook — LiveKit M0 audio spike (feature-flagged, BLOCKED on the live host)

**Status:** **BLOCKED for the live host** — installing, opening ports and (especially) **closing production ports 7881/tcp + 7882/udp afterwards** are owner actions. Agents must not run any of this against production or staging.
**Scripts:** `deploy/livekit/install-livekit-test.sh` (feature-flagged), `deploy/livekit/README.md`
**Design context:** `docs/22-inhouse-meetings-design.md`; product not built yet.

## What is in `main` now

- The installer **refuses to run** without `--enable-livekit-test` (or `LIVEKIT_TEST_ENABLED=1`).
- The `livekit-server` tarball is verified against a **pinned SHA-256** (v1.13.11 linux/amd64). Any other version requires `LIVEKIT_SHA256=<digest>`; there is no unverified-download path.
- Media ports are **not opened by default** (`--open-media-ports` is explicit).
- The public `/live-test/` page (imports `livekit-client` from the jsdelivr CDN) is **not installed and not routed by default**: it needs `--with-test-page` and a hand-merged Nginx location from `deploy/livekit/nginx-livekit-test-page.conf.disabled`.
- `deploy/setup-nginx.sh` does **not** generate LiveKit locations.
- `deploy/update.sh` never installs or manages LiveKit.

## Owner sequence for the test (not run by agents)

```bash
# 1. signal-only install (no test page, no port changes)
sudo bash deploy/livekit/install-livekit-test.sh --enable-livekit-test

# 2. explicitly open the media ports
sudo ufw allow 7881/tcp && sudo ufw allow 7882/udp

# 3. merge deploy/livekit/nginx-livekit-locations.conf into the Dar vhost by hand
sudo nginx -t && sudo systemctl reload nginx

# 4. token + two-device checklist: see deploy/livekit/README.md
```

## Cleanup — the port closing is the critical BLOCKED owner action

Production must not keep 7881/7882 open after the spike. Closing them is a firewall change on the live host and is **not automated**:

```bash
sudo ufw delete allow 7881/tcp
sudo ufw delete allow 7882/udp
sudo ufw status numbered    # verify 7881/7882 are gone

# remove the hand-merged /livekit/ (+ /live-test/ if used) Nginx locations
sudo nginx -t && sudo systemctl reload nginx
sudo rm -rf /var/www/live-test

# stop and remove the spike service/binary/config
sudo systemctl disable --now dar-livekit
sudo rm -f /etc/systemd/system/dar-livekit.service /usr/local/bin/livekit-server \
             /usr/local/bin/dar-live-token /etc/dar/livekit.yaml /etc/dar/livekit.env \
             /etc/sysctl.d/99-dar-livekit.conf
```

## Why gated

LiveKit was only a test of live audio quality before the in-house meetings product. Keeping a permanently public media server (UDP media bypasses Cloudflare/Nginx) out of `main`'s default deploy path removes an unnecessary attack surface and an unowned service. The product decision (build in-house vs adopt LiveKit) stays with the owner — see `docs/22-inhouse-meetings-design.md`.

## NOT VERIFIED

- Nothing in this runbook has been executed on the live host by the change that added the feature flag; the previous spike state on the host (service installed? ports open?) was not inspected from the repo.
- The checksum pin was verified against the upstream release's `checksums.txt` at authoring time, not by downloading on the host.
