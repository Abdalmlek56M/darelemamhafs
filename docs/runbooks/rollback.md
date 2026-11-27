# Runbook — rollback

Two different operations; pick deliberately:

| Situation | Operation | Database |
|---|---|---|
| A deploy broke the app; schema is compatible (normal case) | **binary rollback** — `deploy/rollback.sh` | untouched |
| A migration is truly incompatible with older code (should not happen — expand/contract) | **database rollback** — `deploy/rollback-db.sh`, runbook `rollback-db.md` (owner approval) | fresh DB from the pre-deploy dump; app repointed; old DB kept |

Prefer a **forward fix** (new migration + redeploy) over restoring the database.

## 1. Binary rollback (fast, normal)

```bash
sudo bash deploy/rollback.sh --list          # stamps with both legacy + api copies and commit
sudo bash deploy/rollback.sh <stamp> --dry-run
sudo bash deploy/rollback.sh <stamp>
```

What it does:
- Stops `dar-legacy` + `dar-api`, moves the live dirs to `app/legacy.rolledback.<stamp>` /
  `app/api.rolledback.<stamp>`, moves `legacy.old.<stamp>` + `api.old.<stamp>` back into place,
  fixes ownership (`dar:dar`), restarts, waits for readiness, runs the same 7-point smoke.
- If the rolled-back binaries fail smoke, the script **restores the binaries that were live
  before the rollback** automatically.
- Writes `/var/log/dar/rollback-<target>-<stamp>.log` and
  `/var/lib/dar/deploy/last-rollback.env`; keeps the last 3 rolled-back copies.
- **Never touches the database.** Migrations applied by the newer release stay applied; migrations
  in this repo are additive, so the older binaries ignore the newer tables/columns.

Verify afterwards with the deploy checklist (`deploy.md` §3) and record the rollback + reason in
`../checkpoints/`. If the target stamp is missing one of the two dirs it is not rollback-able —
choose another stamp or fix forward.

## 2. Update.sh already rolled back automatically

`deploy/update.sh` performs exactly the binary rollback above when readiness/smoke fail after the
swap. Before doing anything else, read `/var/log/dar/update-<stamp>.log`; if it says the binaries
were rolled back, the app is on the previous build. Then:
- fix the cause on `main` (test first, full regression, staging) and redeploy; or
- if the old build is also broken, use §3 (with owner approval).

## 3. Database rollback (last resort — owner approval required)

The database is **never** restored over the live one. The dedicated path is
`deploy/rollback-db.sh` with its own runbook `rollback-db.md` — use it instead of improvising;
this section only lists the rules and the evidence to collect.

1. Prefer a **forward fix** (new migration + redeploy with a fresh backup) over restoring data.
2. Get **owner approval** for the data loss between the pre-deploy backup and now.
3. The script verifies the pre-deploy dump (sha256 sidecar + `pg_restore --list`), restores it into
   a **fresh** database, points `/etc/dar/legacy.env`, `/etc/dar/api.env` and
   `/etc/dar/backup.env` at it (old files backed up under `/var/backups/dar-config/`), restarts
   `dar-legacy` + `dar-api` (+ `dar-meet-bot` if installed), verifies `/health/ready`, and writes
   `/var/lib/dar/deploy/last-rollback-db.env`. The previous database is **never dropped**.
   See `rollback-db.md` for the exact commands, `--list`/`--dry-run` and the automatic env-file
   restore if the restart fails.
4. Recover the pre-deploy backup from `/var/lib/dar/backups/db/dar-pre-deploy-<stamp>.dump` (or the
   `BACKUP_FILE` in `/var/lib/dar/deploy/last-deploy.env`). Do not restore a dump whose sha/TOC
   verification fails.
5. Verify before declaring recovery: app `users` count, `web_schema_migrations` count,
   `deploy/sql/integrity-checks.sql`, financial totals you expect, then the 7-point smoke.
6. After the ledger goes backwards, the next `update.sh` re-applies the newer migrations from the
   restored ledger — verify the count before the next deploy.

For inspecting an arbitrary dump without touching production, use the disposable-DB check in
`backup-restore.md` §4. The supported alternative that swaps databases in place is
`deploy/setup-host-db.sh --dump … --confirm-restore --force` (it takes its own verified
pre-restore snapshot and keeps the previous live DB); both paths are documented in `rollback-db.md`
and `backup-restore.md` §5.

## 4. After any rollback

- Confirm: `/health/ready` both APIs, 7-point smoke, `dar-healthcheck.sh --json`, no
  `systemctl --failed`, logs clean.
- Tell the owner what was rolled back, what data (if any) was restored, and the new state.
- Update `../00-current-state.md` production revision/ledger if it changed, and record the
  incident in `../checkpoints/`.
