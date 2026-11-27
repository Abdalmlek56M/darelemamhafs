# Runbook — Separate DB roles + PostgreSQL tuning (scripts only, owner action)

**Status:** scripts and docs ready; **NOT applied** to any host by this change (scripts only, no execution).
**Scripts:** `deploy/sql/db-roles.sql`, `deploy/setup-host-db-roles.sh`, `deploy/postgresql/dar-postgresql-tuning.conf`
**Audience:** owner/operator with root or passwordless sudo on the deploy host.

## 1. Separate roles: dar_migrator / dar_app / dar_read_only

Today the runtime and migrations share one role (`dar_app`). The role split makes DDL (migrations) and read-only reporting separate credentials:

| Role | Purpose | Rights |
|---|---|---|
| `dar_migrator` | runs migrations (`dotnet run -- --migrate`) | DB owner + CREATE on public schema (after `--transfer-ownership`) |
| `dar_app` | runtime APIs | SELECT/INSERT/UPDATE/DELETE + sequence usage |
| `dar_read_only` | diagnostics/reporting | SELECT only; every session forced `default_transaction_read_only = on` |

### Apply (additive, no connection-string change)

```bash
# plan only - prints roles/DB and where passwords come from, changes nothing
sudo bash deploy/setup-host-db-roles.sh

# apply the roles + grants (idempotent)
sudo bash deploy/setup-host-db-roles.sh --confirm

# optional: move DB + public-schema ownership to dar_migrator so future migrations
# own their objects (explicit flag; runtime dar_app keeps working)
sudo bash deploy/setup-host-db-roles.sh --confirm --transfer-ownership
```

Passwords:

- `DB_APP_PASSWORD` — defaults to `POSTGRES_PASSWORD` (so the running app keeps working).
- `DB_MIGRATOR_PASSWORD` / `DB_READ_ONLY_PASSWORD` — if missing in the untracked `deploy/.env`, the script generates them with `openssl rand -hex 24` and appends them to that file (mode 600, git-ignored). Nothing is printed.

Secrets never reach argv: the psql prelude (`\set ...`) is written into a 0600 temp file and piped on stdin (`psql -f -`).

### Verify

```bash
sudo -u postgres psql -tAc "SELECT rolname FROM pg_roles WHERE rolname LIKE 'dar_%' ORDER BY 1;"
sudo -u postgres psql -d <database> -tAc \
  "SELECT has_table_privilege('dar_read_only','payments','INSERT');"   # must be f
sudo -u postgres psql -d <database> -tAc \
  "SELECT has_table_privilege('dar_app','payments','SELECT');"          # must be t
```

### Notes / follow-ups (owner decisions)

- The env files keep using `dar_app`. Switching migrations to `dar_migrator` (and adding a `dar_read_only` DSN for diagnostics) is a separate change after this script is applied and verified.
- After `--transfer-ownership`, re-run the role script once so default privileges for `dar_migrator` apply to any objects created between runs.
- Rollback: `GRANT`/`ROLE` changes are non-destructive; dropping the two new roles is possible (`DROP ROLE dar_read_only, dar_migrator;`) but pointless unless they were never used. `--transfer-ownership` can be reversed by `ALTER DATABASE <db> OWNER TO <old-owner>; ALTER SCHEMA public OWNER TO <old-owner>;`.

## 2. PostgreSQL tuning fragment (from stock defaults)

`deploy/postgresql/dar-postgresql-tuning.conf` raises the stock Ubuntu values (which target a 1 GB VM) for the 4 vCPU / 8 GB VPS:

| Setting | Stock | Dar |
|---|---|---|
| `shared_buffers` | 128MB | 2GB |
| `effective_cache_size` | 4GB | 6GB |
| `work_mem` | 4MB | 16MB |
| `maintenance_work_mem` | 64MB | 512MB |
| `max_connections` | 100 | 200 |
| `max_wal_size` | 1GB | 4GB |
| `random_page_cost` | 4 | 1.1 (SSD) |
| `effective_io_concurrency` | 1 | 200 (SSD) |
| `idle_in_transaction_session_timeout` | 0 | 5min |
| `lock_timeout` | 0 | 5s |

Apply (owner action, host only):

```bash
sudo cp deploy/postgresql/dar-postgresql-tuning.conf \
  /etc/postgresql/17/main/conf.d/00-dar-tuning.conf
sudo chown root:postgres /etc/postgresql/17/main/conf.d/00-dar-tuning.conf
sudo chmod 0640 /etc/postgresql/17/main/conf.d/00-dar-tuning.conf
sudo systemctl restart postgresql
sudo -u postgres psql -tAc "SHOW shared_buffers; SHOW work_mem; SHOW max_connections;"
```

Rollback: `sudo rm /etc/postgresql/17/main/conf.d/00-dar-tuning.conf && sudo systemctl restart postgresql`.

**NOT VERIFIED:** none of the above has been executed on the live host. Measure after rollout (`pg_stat_statements`, `pg_stat_database`, backup duration, restore drill) and adjust `work_mem` first if p99 latency changes.
