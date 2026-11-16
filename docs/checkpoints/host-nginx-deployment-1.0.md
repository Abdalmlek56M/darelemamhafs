# Checkpoint: Host Nginx + Systemd Deployment 1.0

Date: 16 Nov 2026

## Live
- **URL:** https://dar-elemam-hafs.rigxhardware.com
- **Server:** Contabo VPS 4 — `31.220.76.171`
- **OS:** Ubuntu 24.04.5 LTS
- **Architecture:** Nginx + Certbot + systemd + host PostgreSQL 17 + .NET 10
- **Certificate:** Let's Encrypt ECDSA, valid to 2027-02-14

## Installed
- .NET SDK `10.0.115`
- Node.js `v24.22.3` / npm `11.19.1`
- PostgreSQL `17.12`
- Nginx `1.24.0`
- Certbot `2.9.0` (+ nginx and Cloudflare DNS plugins)
- rclone `1.60.1`

## Database
- Host cluster `17/main`, timezone `Africa/Cairo`.
- Role `dar_app`, database `dareltahfeez`.
- Restored from the Docker backup:
  - users: **1**
  - `web_schema_migrations`: **16**
  - students: **0**
- Admin login verified: `admin`, 28 permissions.

## App
- Artifacts extracted from the built Docker images:
  - `/opt/dar/app/legacy` (API + `wwwroot` + `database`)
  - `/opt/dar/app/api` (Dar.Api)
- Systemd:
  - `dar-legacy.service` → `127.0.0.1:5080`
  - `dar-api.service` → `127.0.0.1:5081`
- Env:
  - `/etc/dar/legacy.env` (root:dar 640)
  - `/etc/dar/api.env` (root:dar 640)
- Runtime user: `dar`; app data under `/var/lib/dar`.

## Nginx / TLS
- Site: `/etc/nginx/sites-available/dar-elemam-hafs` (copy in `deploy/nginx/dar-elemam-hafs.conf`).
- Routes:
  - `/api/v1/*` → `127.0.0.1:5081`
  - everything else → `127.0.0.1:5080`
- `client_max_body_size 12m`, `X-Forwarded-Proto https`.
- HTTP → HTTPS redirect.
- Certbot certificate installed; `certbot.timer` enabled.

## Backup
- `/usr/local/bin/dar-backup` + `dar-backup.service` + `dar-backup.timer`.
- Daily at 02:30 Africa/Cairo.
- First local dump created: `/var/lib/dar/backups/db/dar-20261116-080533.dump` (86 KB).
- `RCLONE_REMOTE` is empty; offsite copy pending.

## Verification
- Public `/health/ready` → database connected.
- Public `/api/v1/ping` → ok.
- Public `/` → 200.
- Services active: `nginx`, `postgresql`, `dar-legacy`, `dar-api`.
- Memory: legacy ~68 MB, new API ~41 MB, Nginx ~7 MB; host ~770 MB used / 7.8 GB.
- Disk: 8.9 GB used / 96 GB.
- Docker stack stopped; volumes retained as rollback.

## Issues / Pending
1. **Let's Encrypt renewal:** `certbot renew --dry-run` through Cloudflare HTTP-01 failed with `Connection reset by peer`. DNS-01 is the reliable path. `python3-certbot-dns-cloudflare` is installed; `/root/.secrets/cloudflare.ini` is ready for a scoped Cloudflare token.
2. **GitHub deploy key:** generated on the server but not yet added to GitHub. Public key:
   `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILYgHunQJEMXH3Mx5blGCqvkHHwjtcRc4qPdosx6pcub dar-server-deploy`
   `/opt/dar` is initialized with remote `origin`, but `git fetch` will fail until the key is added.
3. **Offsite backup:** rclone remote and bucket keys pending.
4. **Admin password:** `/opt/dar/.initial-admin-password` still exists. Change the password, then delete it.
5. **Temporary Docker volumes** (`dar_pgdata`, `dar_backups`, `dar_caddy_data`) retained; do not delete without a verified backup.
6. The two hardware stores and Quran site are not deployed on this host.
