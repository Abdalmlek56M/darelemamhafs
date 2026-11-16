# Checkpoint: Live Deployment 1.0 — Contabo VPS

Date: 16 Nov 2026

## Server
- Provider: Contabo Cloud VPS 4 (EU)
- IP: `31.220.76.171`
- OS: Ubuntu 24.04.5 LTS
- Specs: 4 vCPU / 8 GB RAM / 100 GB SSD / 200 Mbit/s
- Timezone: `Africa/Cairo`
- Swap: 2 GB
- Docker: `29.9.3`
- Compose: `v5.7.1`
- UFW: `22`, `80`, `443`
- fail2ban: sshd jail active
- Unattended upgrades: enabled
- SSH: key-only for `root` and `deploy`; password authentication disabled
- Deploy user: `deploy` (sudo + docker), key at `C:\Users\Abdalmlek\.ssh\dar_deploy_ed25519`

## Application
- Code: `/opt/dar` (copied via tar; Git checkout pending deploy key)
- Secrets: `/opt/dar/deploy/.env` (mode 600, generated on server)
- Migrations: **16 applied** by the one-shot `migrate` service
- Running containers:
  - `dar-postgres-1` (healthy)
  - `dar-legacy-api-1` (healthy)
  - `dar-new-api-1` (healthy)
  - `dar-caddy-1` (TLS active)
- Temporary URL: **https://dar.31.220.76.171.nip.io**
- Frontend: HTTP 200
- `GET /health/ready` → `{"status":"ready","database":"connected"}`
- `GET /api/v1/ping` → `{"status":"ok","service":"Dar.Api","version":"0.1.0"}`

## First Admin
- Username: `admin`
- Display name: مدير الدار
- Permissions: **28**
- Password stored on the server at `/opt/dar/.initial-admin-password` (mode 600).
- Login and `/api/auth/me` verified.
- `SETUP_TOKEN` cleared and `legacy-api` restarted after bootstrap.

## Backup Test
- Created a full backup through the API:
  - `DarEltahfeez_all_20261116-054345.backup` (85 KB)
  - Matching `.json` manifest
- Stored in `/var/lib/dar/backups` (`dar_backups` volume).

## Resource Use (idle)
| Container | CPU | RAM |
|---|---:|---:|
| Caddy | 0.00% | 14 MB |
| Legacy API | 0.84% | 57 MB |
| New API | 0.89% | 38 MB |
| PostgreSQL | 0.03% | 34 MB |

- Host RAM: ~817 MB used / 7.8 GB (7.0 GB available)
- Disk: 7.5 GB used / 96 GB (89 GB free)
- Swap: 0 B used

## Issues Found and Fixed
1. **Caddy global options syntax**: the first Caddyfile used JSON-like `{"email": "..."}`, which Caddy rejected. Fixed to `email {$CADDY_EMAIL}`; certificate issued successfully.
2. **Private GitHub repo**: server could not clone over HTTPS. Code was copied via tar for the first deploy. A read-only deploy key was generated:
   - Public key: `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILYgHunQJEMXH3Mx5blGCqvkHHwjtcRc4qPdosx6pcub dar-server-deploy`
   - Pending: add it to GitHub → Settings → Deploy keys (read-only).
3. **Temporary domain**: `nip.io` is used for TLS testing. Final domain and DNS are pending.

## Pending
- Add the deploy key to GitHub; convert `/opt/dar` to a Git checkout for updates.
- Point the final domain (`darelemamhaf.rigxhardware.com`) to `31.220.76.171`; update `DAR_DOMAIN` and restart Caddy.
- Offsite backup copy (R2/B2) + restore drill.
- Deploy the two hardware stores and the Quran site as separate Compose projects behind the central Caddy.
- First GitHub Actions run verification.
- UI sample gate before Next.js work.
- Retrieve the admin password, change it, then delete `/opt/dar/.initial-admin-password`.
