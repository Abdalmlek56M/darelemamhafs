# Runbook — Database rollback (restore the pre-deploy dump into a FRESH database)

**Script:** `deploy/rollback-db.sh` (manual only — never invoked by `deploy/update.sh`)
**Audience:** owner/operator on the deploy host, with root or passwordless sudo.
**Related:** `docs/11-deployment.md` §7.3, `deploy/rollback.sh` (binaries only), `deploy/scripts/restore-drill.sh` (drill only).

## When to use it

Use this only when a deploy shipped something a forward fix cannot recover from quickly, e.g.:

- a migration changed/removed data that the older binaries still need; or
- a data-corrupting bug ran in production and the fastest safe recovery is the pre-deploy snapshot.

Preconditions:

1. You know the **pre-deploy backup** from `deploy/update.sh` (`/var/lib/dar/backups/db/dar-pre-deploy-<stamp>.dump`).
2. You have **owner approval** for the data loss between the backup and now.
3. You understand this does **not** restore over the live database: it creates a new one and points the app at it.

## What the script does (never changes the live DB)

1. Picks the backup: `--backup PATH`, else `BACKUP_FILE` from `/var/lib/dar/deploy/last-deploy.env`, else the newest `dar-pre-deploy-*.dump`.
2. Verifies the `.sha256` sidecar (when present) and the `pg_restore --list` archive.
3. Creates a **new** database `dar_rollback_<stamp>` (must start with `dar_rollback_`; an existing non-empty database with that name is refused) owned by the app role.
4. Restores the dump into the new database, then verifies `web_schema_migrations`, `app_users` and the public-table count.
5. Copies `/etc/dar/legacy.env`, `/etc/dar/api.env`, `/etc/dar/backup.env` to `/var/backups/dar-config/rollback-db-<stamp>/` and repoints their `Database=` / `PGDATABASE=` values at the new database (mode/owner preserved).
6. Restarts `dar-legacy` + `dar-api` (+ `dar-meet-bot` when installed) and waits for `/health/ready` on 5080/5081.
7. Writes `/var/lib/dar/deploy/last-rollback-db.env`.

If step 6 fails the env files are restored automatically and the services restart on the old database; the restored database is kept for diagnosis. **The original database is never dropped, renamed or overwritten.**

## Commands

```bash
# 1) See the available pre-deploy backups
sudo bash deploy/rollback-db.sh --list

# 2) Plan only (same as running without --confirm): prints target DB, backup, env files
sudo bash deploy/rollback-db.sh --backup /var/lib/dar/backups/db/dar-pre-deploy-<stamp>.dump

# 3) Execute (mandatory confirm gate)
sudo bash deploy/rollback-db.sh --backup /var/lib/dar/backups/db/dar-pre-deploy-<stamp>.dump --confirm

# 4) Verify
sudo systemctl status dar-legacy dar-api
curl -fsS http://127.0.0.1:5080/health/ready && echo OK
sudo bash deploy/scripts/dar-healthcheck.sh
```

Optional: `--db-name dar_rollback_manual_<date>` to choose the database name (still must start with `dar_rollback_`).

## Going back to the previous database

`--revert` points the env files back at the database that was live before the rollback (recorded in `last-rollback-db.env`) and restarts the services. It restores no data and drops nothing:

```bash
sudo bash deploy/rollback-db.sh --revert            # plan only, exit 2
sudo bash deploy/rollback-db.sh --revert --confirm  # restore env files + restart
```

The rollback database stays in place for inspection; drop it manually **only after** you are sure (and after a verified backup), e.g.:

```bash
sudo -u postgres psql -c 'DROP DATABASE dar_rollback_<stamp>;'
```

## After recovery

1. Record what happened (deploy stamp + backup file + rollback DB name) in the incident notes (`docs/06-operations.md` incident section or `docs/OVERNIGHT-REPORT.md`).
2. Fix forward on `main` with a new migration (never edit an applied migration — the checksum guard rejects it).
3. Re-run `deploy/update.sh` only after CI + preflight are green, then take a fresh backup.
4. Ask the owner whether the rollback database should be archived before deletion.

## Why the script refuses to run without `--confirm`

A database rollback loses every write made after the backup. The confirm gate plus the plan output (live DB, backup, target DB, env files) exists so this decision is always explicit and reviewable, never an accidental side effect of a deploy.
