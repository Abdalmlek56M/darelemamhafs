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
| `dar-backup.timer` | daily `pg_dump` + optional rclone offsite | no |
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
- `/etc/dar/backup.env` (dar:dar, 600) — `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, optional `RCLONE_REMOTE`.
- `/opt/dar/deploy/.env` (deploy:deploy, 600) — the original install secrets; keep for reference, never commit.

---

## 5. Nginx + TLS

- Site file: `/etc/nginx/sites-available/dar-elemam-hafs` (copy in `deploy/nginx/dar-elemam-hafs.conf`).
- `client_max_body_size 12m` for receipt uploads.
- `X-Forwarded-Proto https` is set explicitly because Cloudflare terminates TLS.
- Certificate: `/etc/letsencrypt/live/dar-elemam-hafs.rigxhardware.com/`.
- Renewal: `certbot.timer` is enabled.
- **Important:** HTTP-01 renewal through the Cloudflare proxy failed the dry-run (`Connection reset by peer`). Use **Cloudflare DNS-01** for reliable renewal:
  1. Create a scoped Cloudflare API token: `Zone:DNS:Edit` for `rigxhardware.com`.
  2. Save it as `/root/.secrets/cloudflare.ini`:
     ```ini
     dns_cloudflare_api_token = <token>
     ```
     `chmod 600`.
  3. Run:
     ```bash
     sudo certbot certonly --dns-cloudflare \
       --dns-cloudflare-credentials /root/.secrets/cloudflare.ini \
       --cert-name dar-elemam-hafs.rigxhardware.com \
       -d dar-elemam-hafs.rigxhardware.com \
       --non-interactive --agree-tos -m admin@rigxhardware.com
     ```
  4. `sudo certbot renew --dry-run --no-random-sleep-on-renew`.

---

## 6. Backups

- Local: `/var/lib/dar/backups/db/dar-YYYYmmdd-HHMMSS.dump`, 14-day retention.
- Timer: `dar-backup.timer`, daily at 02:30 Africa/Cairo.
- Offsite: set `RCLONE_REMOTE` in `/etc/dar/backup.env` (e.g. `r2:dar-backups`) and create the rclone remote:
  ```bash
  rclone config
  ```
  Use Cloudflare R2 or Backblaze B2. The script copies only the new dump to `${RCLONE_REMOTE}/dar/db/`.
- Test:
  ```bash
  sudo systemctl start dar-backup.service
  ls -lh /var/lib/dar/backups/db
  ```
- Restore drill: restore the dump to a disposable database and compare row counts.

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
- [ ] Cloudflare DNS-01 renewal (token pending)
- [ ] Offsite rclone copy (keys pending)
- [ ] GitHub deploy key + `git pull` (public key pending)
- [ ] Restore drill

---

## 9. GitHub Deploy Key

The server's read-only deploy key is:

```text
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILYgHunQJEMXH3Mx5blGCqvkHHwjtcRc4qPdosx6pcub dar-server-deploy
```

Add it in GitHub → repository `darelemamhafs` → **Settings → Deploy keys → Add deploy key**:
- Title: `dar-server`
- Key: the line above
- Leave **Allow write access** unchecked.

Then test from the server:

```bash
cd /opt/dar
git fetch origin
git reset --hard origin/main
```

`.env`, `app/`, and `backups/` are untracked and remain in place.

---

## 10. Retired Docker Stack (reference only)

`deploy/docker-compose.yml`, `deploy/legacy.Dockerfile`, `deploy/api.Dockerfile`, and `deploy/Caddyfile` remain in the repository as an alternative/local stack. They are not running on the production host. The old Docker volumes (`dar_pgdata`, `dar_backups`, `dar_caddy_data`) are retained as a rollback copy; do not delete them without a verified backup.

---

## 11. Known Gaps

- Cloudflare DNS-01 token is not configured yet; HTTP-01 renewal through the proxy failed.
- Offsite rclone destination and keys are not configured yet.
- GitHub deploy key is generated but not yet added; `/opt/dar` is not a full Git checkout.
- Admin password file `/opt/dar/.initial-admin-password` still exists; change the password, then delete it.
- The two hardware stores and the Quran site are not deployed on this host yet.
- The new Next.js UI is not built; the deployed frontend is the legacy React/Vite SPA.
