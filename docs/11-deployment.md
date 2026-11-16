# RIGX Dar — Host + Domain Deployment

**Status:** live on Contabo VPS `31.220.76.171` at **https://dar-elemam-hafs.rigxhardware.com** (16 Nov 2026).
**Architecture:** Ubuntu 24.04 + Nginx + Certbot + systemd + host PostgreSQL 17 + .NET 10.
**Legacy note:** the earlier Docker/Caddy stack is retired on this host; its volumes are retained as a rollback copy.

---

## 1. What Runs

| Component | Purpose | Public? |
|---|---|---|
| Nginx | TLS, HTTP→HTTPS, reverse proxy | Ports 80/443 |
| `dar-legacy.service` | full legacy app + React SPA + `/api/*` on `127.0.0.1:5080` | via Nginx |
| `dar-api.service` | `/api/v1/*` + health on `127.0.0.1:5081` | via Nginx |
| PostgreSQL 17 | `dareltahfeez` database on `127.0.0.1:5432` | no |
| `dar-backup.timer` | daily `pg_dump` + Google Drive offsite (30-day retention) | no |
| Certbot | Let's Encrypt certificate + renewal timer | ports 80/443 during issuance |

Routing:
- `/api/v1/*` → `127.0.0.1:5081`
- everything else → `127.0.0.1:5080`

---

## 2. Server Baseline

- Contabo Cloud VPS 4: 4 vCPU / 8 GB RAM / 100 GB SSD / 200 Mbit/s / EU.
- Ubuntu 24.04.5 LTS, timezone `Africa/Cairo`, 2 GB swap.
- Docker 29.9.3 + Compose v5.7.1 (kept for the retired stack; not used by the live host services).
- .NET SDK 10.0.115, Node.js 24.22.3, PostgreSQL 17.12, Nginx 1.24.0, Certbot 2.9.0, rclone 1.60.1.
- UFW: `22`, `80`, `443`.
- fail2ban sshd jail, unattended upgrades.
- SSH key-only for `root` and `deploy`; password authentication disabled.
- Deploy user: `deploy` (sudo + docker). Local key: `C:\Users\Abdalmlek\.ssh\dar_deploy_ed25519`.

Bootstrap script: `deploy/bootstrap-server.sh`.

---

## 3. First Deploy

```bash
# 1. Bootstrap the OS
scp deploy/bootstrap-server.sh deploy@31.220.76.171:/root/
ssh root@31.220.76.171 'bash /root/bootstrap-server.sh'

# 2. Install host packages
# .NET 10, Node 24, PostgreSQL 17, Nginx, Certbot, rclone
# (see deploy/setup-host-db.sh and deploy/setup-host-services.sh for the exact sequence)

# 3. Restore the database
# Take a dump from the old Docker stack, then:
scp deploy/setup-host-db.sh deploy@31.220.76.171:/home/deploy/
ssh deploy@31.220.76.171 'bash /home/deploy/setup-host-db.sh'

# 4. Publish/extract the app
# From the Docker image:
docker create --name dar-legacy-extract dar-legacy-api
docker cp dar-legacy-extract:/app /opt/dar/app/legacy
docker rm dar-legacy-extract
# Same for Dar.Api -> /opt/dar/app/api

# 5. Configure systemd services
scp deploy/setup-host-services.sh deploy@31.220.76.171:/home/deploy/
ssh deploy@31.220.76.171 'bash /home/deploy/setup-host-services.sh'

# 6. Configure Nginx
scp deploy/setup-nginx.sh deploy@31.220.76.171:/home/deploy/
ssh deploy@31.220.76.171 'bash /home/deploy/setup-nginx.sh'

# 7. Issue the certificate
ssh deploy@31.220.76.171 \
  'sudo certbot --nginx -d dar-elemam-hafs.rigxhardware.com --non-interactive --agree-tos -m admin@rigxhardware.com --redirect'
```

For a Git-based deploy, add the server's read-only deploy key to GitHub and use `/opt/dar` as a checkout (see §9).

---

## 4. Environment Files

- `/etc/dar/legacy.env` (root:dar, 640) — connection string, backup path, setup token (empty after bootstrap), timezone, forwarded headers.
- `/etc/dar/api.env` (root:dar, 640) — connection string, OTP pepper, SMTP, Google client ID.
- `/etc/dar/backup.env` (dar:dar, 600) — `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, `RCLONE_CONFIG`, `RCLONE_REMOTE`.
- `/var/lib/dar/rclone/rclone.conf` (dar:dar, 600) — the Google Drive remote used by the daily offsite backup. Its parent directory is `0700 dar:dar` so rclone can persist token refreshes; do not move it back under `/etc/dar` (root-owned).
- `/opt/dar/deploy/.env` (deploy:deploy, 600) — the original install secrets; keep for reference, never commit.

---

## 5. Nginx + TLS

- Site file: `/etc/nginx/sites-available/dar-elemam-hafs` (copy in `deploy/nginx/dar-elemam-hafs.conf`).
- `client_max_body_size 12m` for receipt uploads.
- `X-Forwarded-Proto https` is set explicitly because Cloudflare terminates TLS.
- Certificate: `/etc/letsencrypt/live/dar-elemam-hafs.rigxhardware.com/`.
- Renewal: `certbot.timer` is enabled.
- **DNS-01 is configured** after HTTP-01 through the Cloudflare proxy failed:
  - Token: `/root/.secrets/cloudflare.ini` (`600 root:root`), scoped `Zone:DNS:Edit` for `rigxhardware.com`.
  - Forced renewal and `certbot renew --dry-run --no-random-sleep-on-renew` both succeeded.
  - If the token is rotated, replace the file and rerun the dry-run:
    ```bash
    sudo certbot renew --dry-run --no-random-sleep-on-renew
    ```

---

## 6. Backups

**Status: configured and verified on 16 Nov 2026.**

- Local: `/var/lib/dar/backups/db/dar-YYYYmmdd-HHMMSS.dump`, **30-day retention**.
- Offsite: Google Drive at `gdrive:dar-backups/dar/db/`, **30-day retention**.
- Timer: `dar-backup.timer`, daily at ~02:30 Africa/Cairo (systemd adds a randomized delay; check `systemctl list-timers`).
- Credentials:
  - `/var/lib/dar/rclone/rclone.conf` (`dar:dar`, `600`, parent `0700 dar:dar`) — Google Drive remote `gdrive:`.
  - `/etc/dar/backup.env` (`dar:dar`, `600`) — `RCLONE_CONFIG=/var/lib/dar/rclone/rclone.conf`, `RCLONE_REMOTE=gdrive:dar-backups`.
- The script copies the new dump to `${RCLONE_REMOTE}/dar/db/` and deletes offsite dumps older than 30 days. Local dumps older than 30 days are deleted too.
- If the offsite copy fails or the rclone config is missing, the service exits non-zero **after** creating the local dump, so `systemctl --failed` shows the problem. The local retention cleanup still runs.

Manual verification:

```bash
sudo systemctl start dar-backup.service
ls -lh /var/lib/dar/backups/db
sudo -u dar rclone --config /var/lib/dar/rclone/rclone.conf ls gdrive:dar-backups/dar/db/
```

Verified result (16 Nov 2026):

- Local and remote dump `dar-20261116-095559.dump` were byte-identical (`sha256` match).
- `rclone check --include 'dar-*.dump' --one-way` → **6 matching files, 0 differences** (the two pre-offsite dumps were backfilled).
- `pg_restore --list` → **184 TOC entries**.
- Restored to a disposable PostgreSQL database: **1 user / 16 migrations**, matching live.
- Disposable database dropped after the test.
- Retention dry-run with `--min-age 30d --include 'dar-*.dump'` deleted nothing.

Restore drill: restore the dump to a disposable database and compare `app_users` and `web_schema_migrations` counts. Never restore over the live database.

Setup reference (already completed; keep for a future host):

```powershell
rclone config   # n -> gdrive -> drive -> authorize in browser -> q
scp "$env:APPDATA\rclone\rclone.conf" deploy@31.220.76.171:/home/deploy/rclone.conf
```

```bash
sudo install -d -m 0700 -o dar -g dar /var/lib/dar/rclone
sudo install -m 0600 -o dar -g dar /home/deploy/rclone.conf /var/lib/dar/rclone/rclone.conf
sudo rm /home/deploy/rclone.conf
sudo systemctl start dar-backup.service
```

---

## 7. Operations

```bash
# Status
systemctl status nginx postgresql dar-legacy dar-api
systemctl list-timers 'dar-backup.timer' 'certbot.timer'

# Logs
journalctl -u dar-legacy -f
journalctl -u dar-api -f
tail -f /var/log/nginx/error.log

# Restart
sudo systemctl restart dar-legacy dar-api
sudo systemctl reload nginx

# Database
sudo -u postgres psql -d dareltahfeez
```

### Update from Git

```bash
cd /opt/dar
git pull --ff-only
# rebuild/publish if code changed, then:
sudo systemctl restart dar-legacy dar-api
```

The first Git checkout needs the server deploy key (see §9).

---

## 8. Smoke Checklist

- [x] `https://dar-elemam-hafs.rigxhardware.com/` → 200
- [x] `/health/ready` → database connected
- [x] `/api/v1/ping` → ok
- [x] Admin login + `/api/auth/me` → 28 permissions
- [x] Full backup created (`.dump` + manifest)
- [x] UFW active; password SSH disabled; fail2ban active
- [x] Cloudflare DNS-01 renewal + dry-run
- [x] Offsite rclone copy to Google Drive
- [x] GitHub deploy key + `git pull`
- [x] Restore drill (local and offsite dumps)
- [x] Admin password changed; `/opt/dar/.initial-admin-password` deleted

---

## 9. GitHub Deploy Key

The server's read-only deploy key is:

```text
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILYgHunQJEMXH3Mx5blGCqvkHHwjtcRc4qPdosx6pcub dar-server-deploy
```

This key has been added to GitHub. `/opt/dar` is now a Git checkout tracking `origin/main`:

```bash
cd /opt/dar
git fetch origin
git reset --hard origin/main
git branch --set-upstream-to=origin/main main
git pull --ff-only
```

`.env`, `app/`, and `backups/` are untracked and remain in place.

---

## 10. Retired Docker Stack (reference only)

`deploy/docker-compose.yml`, `deploy/legacy.Dockerfile`, `deploy/api.Dockerfile`, and `deploy/Caddyfile` remain in the repository as an alternative/local stack. They are not running on the production host. The old Docker volumes (`dar_pgdata`, `dar_backups`, `dar_caddy_data`) are retained as a rollback copy; do not delete them without a verified backup.

---

## 11. Known Gaps

- **rclone 1.60.1 uses the shared Google Drive client ID, which rclone plans to retire during 2026.** Create a dedicated Google OAuth client ID and re-authorize `gdrive:` before the shared client stops working. Until then, verify backups weekly.
- **Rotate the Cloudflare API token** that was shared in chat. Replace `/root/.secrets/cloudflare.ini`, then rerun `certbot renew --dry-run --no-random-sleep-on-renew`.
- **Rotate the earlier Google OAuth grant** if the Drive config was authorized before the token exposure; re-authorize with the new dedicated client ID.
- The two hardware stores and the Quran site are not deployed on this host yet.
- The new Next.js UI is not built; the deployed frontend is the legacy React/Vite SPA.
- Teacher/supervisor/notification APIs and the mobile PWA are implemented in code (migration 017, `Dar.Modules.Teaching`, `/teacher` and `/supervisor` entries). First production deploy, teacher/supervisor account creation, and linking are pending.
