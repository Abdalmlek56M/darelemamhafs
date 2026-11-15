# RIGX Dar — Operations

**Status:** Target runbook. Commands will be aligned with the real solution after intake.
**Scope:** Local setup, migrations, tests, backups, deployment, monitoring, incidents.

---

## 1. Requirements

| Tool | Version |
|---|---|
| .NET SDK | 10 LTS |
| Node.js | 24 LTS |
| npm | 10+ |
| Docker | 27+ + Compose v2 |
| PostgreSQL | 17+ (container or local) |
| Playwright | latest |

**No `.bat` files.** Use terminal commands, Docker, or a cross-platform task runner.

### Legacy Desktop Commands (temporary)

The old desktop app is still runnable directly through PowerShell while the web version is built:

```powershell
# Start legacy desktop app (source or installed)
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File .\tools\run-desktop.ps1

# Build React + API for acceptance (does not start PostgreSQL or apply migrations)
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File .\tools\Build-DarForRehearsal.ps1

# Legacy Test Center GUI is archived. Run individual Verify-*.ps1 runners
# only while converting them to tests/ projects.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File .\tests\runners\Verify-FinancialRounding.ps1

# System Center
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File .\tools\Start-SystemCenter.ps1

# Port/diagnostics helpers
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File .\tools\Show-DarPortOwner.ps1
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File .\tools\Export-Diagnostics.ps1
```

These commands are **legacy only**. They will be removed after the web app reaches parity.

---

## 2. Local Setup

> ⚠️ Paths/commands will be finalized after the real solution is inspected.

```bash
# 1. Environment
cp .env.example .env
# set local-only secrets

# 2. Database
docker compose up -d postgres

# 3. Backend
dotnet tool restore
dotnet build Dar.slnx
dotnet test Dar.slnx
dotnet run --project src/Host/Dar.Api

# 4. Frontend
npm install
npm run dev
```

Expected:

- API: `http://localhost:8080`
- Web: `http://localhost:3000`
- PostgreSQL: `127.0.0.1:5433` (host mapping; not public in production)

---

## 3. Configuration

- Local: `.env` (not committed).
- Production: host secret store / Docker secrets.
- Never commit `.env`, connection strings, SMTP passwords, JWT keys.
- `.env.example` contains names only.

Required configuration groups:

| Group | Examples |
|---|---|
| Database | `ConnectionStrings__Default` |
| Auth | `Auth__Otp__Pepper`, `Auth__Otp__ExpiryMinutes`, `Auth__Otp__MaxAttempts` |
| Google | `Auth__Google__ClientId` |
| Email | `Auth__Smtp__Host`, `Port`, `User`, `Password`, `From`, `EnableSsl` |
| Storage | media root / S3-compatible |
| Backup | destinations, retention, pg_dump path |
| Observability | log level, alert webhook |

---

## 3.5 Git & GitHub

- Git repo is initialized locally only by explicit owner request.
- `.gitignore` excludes `node_modules`, `bin`, `obj`, `dist`, `.env*`, backups, archives, and secrets.
- Commit messages: `area: imperative summary`.
- No secrets, logs, screenshots, ZIPs, or DB dumps in Git.
- Push requires a confirmed remote and `gh auth login`.

```bash
git status
git add .
git commit -m "chore: baseline project and new foundation"
git remote add origin <repo-url>
git push -u origin main
```

If `gh` is not authenticated:

```bash
gh auth login
```

Never force-push shared history. Ask before rewriting history.

---

## 4. Database Migrations

Migrations are ordered SQL files in `database/`, initially one schema.

```bash
# Apply all, ordered (checksums + advisory lock)
dotnet run --project src/Host/Dar.Api -- --migrate

# Add a migration
# create database/0NN_short_name.sql with IF NOT EXISTS / expand-contract rules
```

The new runner records checksums in `web_schema_migrations`. The legacy
`schema_migrations` table remains untouched. A baseline mode for an existing
legacy DB is still pending.

Rules:

- Backup before production migration.
- Expand/contract.
- No destructive change without approval.
- Test on staging.
- Migration runner is the single ordered list.
- App role has no DDL; migration role is separate.

---

## 5. First Owner Account

- One-time bootstrap command (interactive), not a public endpoint.
- Owner signs in with **Email OTP or Google** and creates staff accounts.
- No public self-registration.
- No passwords.

> Exact command will be added after the real Identity module is built.

---

## 6. Tests

```bash
# Backend
dotnet test DAR.slnx

# One area
dotnet test --filter "FullyQualifiedName~Payroll"

# Frontend
npm run typecheck
npm run lint
npm run test

# E2E
npx playwright test
```

**Test isolation:**

- Tests are projects inside the solution (`tests/Unit`, `tests/Integration`, `tests/Contract`, `tests/E2E`), not a separate application.
- Separate PostgreSQL database (`dar_test`) or Testcontainers.
- Never production connection string.
- E2E runs against a dedicated test/staging environment.
- No test routes/panel in production.
- See `docs/08-testing.md`.

---

## 7. Backups

### 7.1 What a backup contains

- `database.dump` (`pg_dump --format=custom --no-owner`).
- `media/` (documents, receipts, photos).
- `manifest.json` (time, version, DB size, file count, SHA-256, migrations).

### 7.2 Schedule

- Daily at a configured Cairo hour.
- Retention: 7 daily, 4 weekly, 12 monthly.
- Offsite encrypted copy.
- A run succeeds only if all destinations receive the file.

### 7.3 Restore (manual, never from web)

1. Pick the newest verified archive.
2. Stop the API so nothing writes.
3. Restore:
   ```bash
   pg_restore --clean --if-exists --no-owner \
     --dbname=<db> --host=<host> --username=<user> database.dump
   ```
4. Restore `media/`.
5. Run migrations if the archive is older than the deployed app.
6. Start API; check `/health/ready` and sign-in.
7. Verify counts and a sample financial statement.

### 7.4 Restore drill

- Monthly.
- Restore into `dar_restore_check_*`.
- Verify checksum, table counts, key balances.
- Drop the temp DB.
- Record duration and result.

---

## 8. Deployment

### 8.1 Topology

```
Cloudflare → Caddy → Next.js → /api → .NET API → PostgreSQL
```

- `darelemamhaf.rigxhardware.com` → Next.js.
- API internal only in MVP.
- PostgreSQL/Redis private.
- Caddy handles TLS.
- Cloudflare WAF/DNS.

### 8.2 Host

- Ubuntu 24.04 LTS.
- Docker Engine + Compose v2.
- Non-root deploy user.
- UFW: 22 restricted, 80, 443.
- fail2ban.
- Unattended security updates.

### 8.3 Services

| Service | Notes |
|---|---|
| `caddy` | TLS + reverse proxy |
| `web` | Next.js standalone |
| `api` | .NET API |
| `worker` | background jobs |
| `postgres` | volume, no public port |
| `backup` | cron |
| `uptime-kuma` | monitoring |

### 8.4 Deploy

1. CI builds images with SHA tag.
2. Push to GHCR.
3. SSH to host.
4. Pull images.
5. Run migrations (one-off).
6. `docker compose up -d --wait`.
7. Health check.
8. Smoke test.
9. Rollback to previous tag on failure.

### 8.5 Rollback

- Keep previous image tags.
- Rollback app image first.
- Do not rollback DB destructively; use forward fix or restore.
- Document incident.

---

## 9. Monitoring

| Check | Tool |
|---|---|
| HTTP uptime | Uptime Kuma |
| API health | `/health/live`, `/health/ready` |
| Logs | Serilog JSON + Docker rotation |
| Errors | log alerts / Sentry optional |
| DB | connections, slow queries, disk |
| Backups | last success + restore drill |
| Disk/CPU/RAM | host metrics |

Alerts: Telegram/email. No paid service without approval.

---

## 10. Runbooks

### 10.1 API down

1. Check container status/logs.
2. Check DB connectivity.
3. Check disk.
4. Restart API if safe.
5. Rollback if deploy-related.
6. Record incident.

### 10.2 DB down

1. Stop writes.
2. Check container/logs/disk.
3. Restart DB.
4. If corrupted: restore from verified backup.
5. Verify financial balances before reopening.

### 10.3 Disk full

1. Identify large files/logs.
2. Rotate/clean logs.
3. Clean old backups per retention.
4. Do not delete DB volumes.
5. Add disk if recurring.

### 10.4 Secret exposure

1. Rotate affected secret.
2. Revoke sessions/tokens.
3. Check audit logs.
4. Patch source of leak.
5. Document.

### 10.5 Failed migration

1. Stop deploy.
2. Do not run destructive rollback.
3. Inspect migration.
4. Restore backup if data affected.
5. Fix forward and retest on staging.

---

## 11. Domain & DNS

| Record | Value |
|---|---|
| `darelemamhaf.rigxhardware.com` | Cloudflare → host |
| `www` | redirect to apex/subdomain if needed |
| `staging` | optional |

- SSL Full (strict).
- HSTS.
- Origin firewall allows Cloudflare IPs only.
- No direct API subdomain in MVP.

---

## 12. Data Retention & Privacy

- Student/guardian data: retained while active + legal/accounting retention.
- Financial records: retained (no deletion).
- Audit logs: retained per policy.
- Backups: retention above.
- Logs: 30–90 days, no PII.
- Export: permission + audit.

---

## 13. Operational Decisions

### Resolved

- **DB:** PostgreSQL on the same server.
- **Auth:** Email OTP + Google.
- **Language:** Arabic + English.
- **Tests:** projects inside the solution, not a separate app.

### Open

1. Staging on same host or separate?
2. Email provider.
3. WhatsApp: manual links or API?
4. Backup offsite destination.
5. Monitoring alert channel.
6. Host provider/spec.
