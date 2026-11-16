# Checkpoint: Host + Domain Deployment Stack

Date: 16 Nov 2026

## Done
- Added `deploy/legacy.Dockerfile`:
  - Node 24 builds the Vite SPA.
  - .NET 10 SDK builds/publishes the legacy API.
  - Runtime is .NET 10 Noble + PostgreSQL 17 client (`pg_dump`/`pg_restore`).
  - Runs as the non-root `app` user; `/var/lib/dar/backups` is writable.
- Added `deploy/api.Dockerfile` for `Dar.Api` with a `/health/ready` healthcheck.
- Added `deploy/docker-compose.yml`:
  - PostgreSQL 17 with a named volume.
  - One-shot `migrate` service (all 16 migrations).
  - `legacy-api`, `new-api`, `caddy`.
  - Internal-only database/APIs; only Caddy exposes 80/443.
  - Static Caddy proxy IP + forwarded-header trust.
- Added `deploy/Caddyfile`:
  - `/api/v1/*` and new health endpoints → `new-api`.
  - everything else → `legacy-api`.
  - HSTS/security headers, zstd/gzip.
- Added `deploy/.env.example` and `.dockerignore`.
- Made `SystemAdminService` cross-platform:
  - `Backup:RootPath` override for containers;
  - Linux default backup folder;
  - `pg_dump`/`pg_restore` names without `.exe` on Linux.
- Added `docs/11-deployment.md` with first deploy, bootstrap, updates, backups, rollback, and smoke checklist.

## Verification
- `docker compose config`: **valid**.
- Images built: `dar-legacy-api`, `dar-new-api`, `dar-migrate`.
- Local stack smoke test:
  - PostgreSQL healthy.
  - `migrate` applied **16 migrations** and exited 0.
  - legacy `/health` → `{"status":"ok","database":"connected"}`.
  - new `/health/ready` → `{"status":"ready","database":"connected"}`.
- Stack stopped with `docker compose down` (no `-v`); volumes retained.
- Build gate: legacy 0/0, `Dar.slnx` 0/0, 12 unit + 5 integration pass, frontend build pass.

## Not Done
- No deploy to the final host yet; DNS/TLS/staging smoke test pending.
- Caddyfile validation could not complete locally because pulling the Caddy image timed out; the compose stack itself was validated and the Caddy config is syntactically straightforward.
- Offsite backup automation is still pending.
- The three known schedule conflicts must be resolved before migration 012 touches production data.

## Notes
- No production database was read or modified.
- No real secrets were committed; `deploy/.env` is ignored.
- UI gate remains closed until the owner approves a visual sample.
