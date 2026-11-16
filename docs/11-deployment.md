# RIGX Dar — Host + Domain Deployment

**Status:** live on a disposable Contabo VPS at **https://dar.31.220.76.171.nip.io** (16 Nov 2026). Final domain, DNS, and offsite backups are pending.
**Target:** Ubuntu 24.04 + Docker Compose + Caddy + Cloudflare, domain `darelemamhaf.rigxhardware.com`.

---

## 1. What Runs

| Service | Purpose | Public? |
|---|---|---|
| `postgres` | PostgreSQL 17, named volume `dar_pgdata` | No (internal network only) |
| `migrate` | one-shot `dotnet Dar.Api.dll --migrate` | No |
| `legacy-api` | full legacy app + React SPA + `/api/*` | Via Caddy |
| `new-api` | `/api/v1/*`, health, OpenAPI | Via Caddy |
| `caddy` | TLS, HTTP→HTTPS, HSTS, routing | Ports 80/443 |

Routing:
- `/api/v1/*`, `/health/live`, `/health/ready` → `new-api`
- everything else → `legacy-api`

The legacy API image includes PostgreSQL 17 client tools (`pg_dump`/`pg_restore`) so the in-app backup screen works on Linux.

---

## 2. Prerequisites

- Ubuntu 24.04 host with Docker Engine 27+ and Compose v2.
- DNS `A` record for `darelemamhaf.rigxhardware.com` pointing to the host.
- Ports `80/tcp`, `443/tcp`, `443/udp` open.
- If Cloudflare proxy is enabled, use **Full (strict)** SSL. For the first certificate, either set the record to DNS-only or use a Cloudflare Origin Certificate / DNS-01 challenge.
- At least 2 GB RAM and 20 GB disk for the app + database + backups.

---

## 3. First Deploy

```bash
# 1. Get the code
sudo mkdir -p /opt/dar
sudo chown "$USER" /opt/dar
git clone https://github.com/Abdalmlek56M/darelemamhafs.git /opt/dar
cd /opt/dar

# 2. Configure secrets (never commit deploy/.env)
cp deploy/.env.example deploy/.env
# Edit deploy/.env:
#   DAR_DOMAIN, CADDY_EMAIL
#   POSTGRES_PASSWORD  (openssl rand -hex 32)
#   SETUP_TOKEN        (openssl rand -hex 32)
#   OTP_PEPPER         (openssl rand -hex 32)
#   SMTP_* and GOOGLE_CLIENT_ID when available

# 3. Build and start
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --build

# 4. Watch the one-shot migration
docker compose --env-file deploy/.env -f deploy/docker-compose.yml logs migrate

# 5. Check health
docker compose --env-file deploy/.env -f deploy/docker-compose.yml ps
```

Caddy obtains the TLS certificate automatically once DNS points to the host.

### First admin

Remote setup is blocked unless `SETUP_TOKEN` is set. After the stack is healthy:

```bash
set -a; . deploy/.env; set +a
curl -fsS -X POST "https://$DAR_DOMAIN/api/setup/admin" \
  -H 'Content-Type: application/json' \
  -H "X-Setup-Token: $SETUP_TOKEN" \
  -d '{"username":"admin","displayName":"مدير الدار","password":"CHANGE-ME-STRONG"}'
```

Open `https://$DAR_DOMAIN` and log in. Change the password immediately from the account menu.
The setup endpoint returns `409` after the first account exists.

---

## 4. Environment Variables

| Variable | Required | Notes |
|---|---|---|
| `DAR_DOMAIN` | Yes | Public hostname used by Caddy. |
| `CADDY_EMAIL` | Recommended | ACME account email. |
| `POSTGRES_PASSWORD` | Yes | Use URL-safe hex; it is embedded in connection strings. |
| `SETUP_TOKEN` | Yes for remote bootstrap | One-time first-admin token. |
| `OTP_PEPPER` | Yes in Production | `Dar.Api` refuses to start without it outside Development. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_FROM` | For OTP email | Without SMTP, OTP requests fail; password login still works. |
| `GOOGLE_CLIENT_ID` | Optional | Google login remains deferred. |
| `CADDY_PROXY_IP` | Yes | Must match the Caddy static IP (`172.28.0.10` by default). |

**Never commit `deploy/.env`.** It is ignored by `.dockerignore` and `.gitignore` patterns.

---

## 5. Backups

- The legacy API writes full/scoped backups to the `dar_backups` volume (`/var/lib/dar/backups`).
- Each full backup is a PostgreSQL custom archive plus a `.json` manifest with SHA-256 and `pg_restore --list` validation.
- Copy backups off-host regularly (e.g. `rclone`/`restic` from a host cron job). Offsite automation is still pending.
- **Do not** run `docker compose down -v` or delete the `dar_pgdata`/`dar_backups` volumes.
- Run a restore drill before launch:
  1. create a full backup from the UI;
  2. restore it to a disposable database;
  3. compare row counts and required tables;
  4. document the time.

---

## 6. Updates and Rollback

```bash
cd /opt/dar
git pull --ff-only
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --build
docker compose --env-file deploy/.env -f deploy/docker-compose.yml logs -f migrate
```

- Migrations are forward-only and checksum-protected. Do not edit an applied SQL file.
- Keep the previous image tags or a full database backup before a schema change.
- Rollback: restore the previous app image and, only if the schema changed, restore the matching database backup. Never delete the database volume.

---

## 7. Smoke Test Checklist

- [ ] `https://$DAR_DOMAIN/health` returns `ok`.
- [ ] `https://$DAR_DOMAIN/health/ready` returns `ready`.
- [ ] `https://$DAR_DOMAIN/api/v1/ping` returns `ok`.
- [ ] Login works; `/api/auth/me` returns the session.
- [ ] Unauthenticated `/api/students` returns `401`.
- [ ] Cross-origin `POST` returns `403`.
- [ ] Setup after the first admin returns `409`.
- [ ] Create a teacher/circle/student/enrollment/charge/payment.
- [ ] Trash a financial record; purge is refused.
- [ ] Create and download a full backup; verify the `.json` manifest.
- [ ] Check Caddy logs for certificate success and no proxy errors.
- [ ] Reboot the host and confirm the stack returns automatically (`restart: unless-stopped`).

---

## 8. Known Gaps

- Offsite backup automation is not implemented yet.
- Full antiforgery token (beyond the same-origin guard) is pending.
- Per-email OTP throttle / resend timer is pending.
- The new Next.js UI is not built yet; the deployed frontend is the legacy React/Vite SPA.
- The three known schedule conflicts must be resolved before migration 012 is applied to production data.
