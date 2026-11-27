# Runbook — backup and restore

**Goal:** prove backups are restorable, and restore data **without ever writing over the live
production database**.
**Scripts:** `deploy/scripts/dar-backup.sh`, `deploy/scripts/restore-drill.sh`,
`deploy/setup-host-db.sh`.
**Detail:** `../06-operations.md` §7, `../11-deployment.md` §6.

## 1. What exists (production host)

| Piece | Detail |
|---|---|
| Timer | `dar-backup.timer` daily ~02:30 Africa/Cairo (+ up to 15 min randomized). Manual: `sudo systemctl start dar-backup.service` |
| Local dir | `/var/lib/dar/backups/db` |
| Files per run | `dar-<stamp>.dump` (pg_dump `-Fc`) + `dar-<stamp>.manifest.json` + `.dump.sha256`; optional `globals-<stamp>.sql`, `config-<stamp>.tar.gz`, `media-<stamp>-*.tar.gz` |
| Manifest | status (`success`/`failed`), size, sha256, `toc_entries`, `web_schema_migrations` count, offsite `{status, uploaded, verified, error}` |
| Offsite | `rclone` to `$RCLONE_REMOTE/<dest-subdir>` (e.g. Google Drive); size always verified, SHA-256 when the remote supports it; an offsite failure exits non-zero and triggers `dar-healthcheck` |
| Retention | keeps the last `BACKUP_KEEP_COUNT` **verified** backups (default 30); failed/unverified dumps are kept for investigation, never age-only deletion |
| Lock | single-instance lock (`flock`, mkdir fallback); a second overlapping run warns and exits 0 |
| RPO/RTO | RPO 24 h minimum, RTO 4 h (`../02-architecture.md` §5.7) — **NOT VERIFIED**: real offsite restore |

Config lives in `/etc/dar/backup.env` (600 `dar:dar`) — never committed, never printed.

## 2. Verify the latest backup (do this before relying on it)

```bash
sudo systemctl start dar-backup.service            # manual run
sudo systemctl status dar-backup.service --no-pager
sudo journalctl -u dar-backup -n 50 --no-pager
ls -lh /var/lib/dar/backups/db | tail -5

latest=$(ls -t /var/lib/dar/backups/db/dar-*.manifest.json | head -1)
sudo cat "$latest"                                  # status=success, sha256, toc_entries, migrations, offsite
dump="${latest%.manifest.json}.dump"
sudo -u dar sha256sum -c "$dump.sha256"
sudo -u postgres pg_restore --list "$dump" | head
```

A dump with `status=failed` or `offsite.verified` not set is **not** a restore candidate.

## 3. Scheduled restore drill (disposable databases only)

Weekly unit: `dar-restore-drill.timer` (Sun 04:30 + up to 30 min) → runs
`/usr/local/bin/dar-restore-drill` (repo: `deploy/scripts/restore-drill.sh`) as user `dar` with
`/etc/dar/restore-drill.env` (`RESTORE_DRILL_PROD_DB` required so the script can refuse it).

```bash
systemctl list-timers dar-restore-drill.timer
sudo journalctl -u dar-restore-drill -n 100 --no-pager
sudo systemctl start dar-restore-drill.service     # manual drill
```

The script restores the daily backup and a fresh snapshot into disposable databases named
`dar_restore_s9_daily_<stamp>` / `dar_restore_s9_fresh_<stamp>`, runs read-only metrics and an app
`/health/ready` smoke, checks the offsite copy when configured, then drops everything. It
**refuses** any DB name without the `dar_restore_s9_` prefix. Its log lines (`DAILY_RESTORE=OK`,
`FRESH_VS_SOURCE=EXACT_MATCH`, `SUMMARY …`) are the evidence to record in the checkpoint.

## 4. Manual restore check (disposable copy, no service impact)

Use this to inspect an arbitrary dump. Never point it at `<production-db>`; stop writes first if
you need a consistent view.

```bash
sudo systemctl stop dar-legacy dar-api                      # stop writes for consistency
sudo -u postgres createdb dar_restore_check
sudo -u postgres pg_restore --no-owner --no-privileges --exit-on-error \
  -d dar_restore_check /var/lib/dar/backups/db/<file>.dump
sudo -u postgres psql -d dar_restore_check -c \
  'select count(*) from app_users; select count(*) from web_schema_migrations;'
sudo -u postgres psql -d dar_restore_check -f deploy/sql/integrity-checks.sql
sudo -u postgres dropdb dar_restore_check
sudo systemctl start dar-legacy dar-api
```

Verify the 7-point smoke afterwards (`deploy.md` §3). Do **not** leave test data/DBs around.

## 5. Restoring production data (owner approval)

Only when data loss is confirmed and a forward fix is impossible. Prefer the dedicated
**`deploy/rollback-db.sh`** path documented in `rollback-db.md`: it restores the pre-deploy dump
into a **fresh** database, verifies it, repoints the env files and restarts the services, keeping
the previous database intact. The in-place-swap script `deploy/setup-host-db.sh` below remains the
supported path when you deliberately want to swap database names:

```bash
sudo bash deploy/setup-host-db.sh --dump <verified.dump> --confirm-restore   # backup only, prints next step
sudo bash deploy/setup-host-db.sh --dump <verified.dump> --confirm-restore --force
```

It (a) always takes a verified pre-restore snapshot, (b) restores into
`<production-db>_restore_<stamp>`, (c) compares per-table row counts with live, (d) swaps names
only if they match, keeps the previous live DB as `<production-db>_pre_restore_<stamp>`, and
prints the manual rename commands to undo the swap. Without both flags it refuses to overwrite a
non-empty live database. **Never** run `pg_restore` directly against the live DB.

If the restore is still in progress or the DB is unhealthy, use `incident-response.md` and keep the
owner informed; record dump path, SHA, stamp and approver in `../checkpoints/`.

## 6. If a backup or restore fails

- Backup job failed: check `/etc/dar/backup.env` permissions (600 `dar:dar`), rclone config
  (`/var/lib/dar/rclone/rclone.conf`, 600 `dar:dar` — the 24 Nov incident was a wrong owner),
  disk space (`df -h`), then rerun manually and confirm the manifest + offsite.
- Restore drill failed: read `journalctl -u dar-restore-drill`; never "fix" it by restoring to
  production. Fix forward, rerun the drill, record it.
- Offsite copy stale/failing: production backups still exist locally; escalate to the owner and
  follow `incident-response.md` §5.
