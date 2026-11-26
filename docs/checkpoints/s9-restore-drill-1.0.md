# S-9 — Backup restore drill (1.0)

**Status:** Drill executed against disposable databases; **not marked Done** pending owner review.
**Production impact:** none. No production database writes, no service restarts, no deployment, no backup/retention/permission changes.

## Backup under test

- File: `/var/lib/dar/backups/db/dar-20261124-023044.dump`
- Size: 247,444 bytes
- SHA-256: `cb225f9b3d52758994698d1e8a3f6abff95bd2628e78500adae1906ba2627710`
- `pg_restore --list`: accepted; 318 non-comment TOC lines (header TOC 322)
- Offsite: `gdrive:dar-backups/dar/db` downloaded to a temporary 600 file; **SHA-256 match**.
- Daily timer: last success 2026-11-24 02:30:44 EET; next 2026-11-25 02:35:04; no failed units.

## Restore checks

| Check | Result |
|---|---|
| Daily backup restored into disposable DB | PASS — `pg_restore --exit-on-error` exit 0 |
| Daily restored schema/tables | PASS structurally, but **older than current** (see drift) |
| Daily restored row counts / sums | Present and internally consistent; **77 metric lines differ from current production**, expected because the backup predates later writes |
| Fresh read-only `pg_dump` of production during drill | PASS; source metrics stable before/after |
| Fresh snapshot restored into disposable DB | PASS |
| Fresh restore vs source: all table counts, financial sums, hashes | **EXACT MATCH** |
| App health on restored daily DB | PASS — `/health/ready` 200, temp DB, no production env files |
| App health on restored fresh DB | PASS — `/health/ready` 200, temp DB, no production env files |
| Cleanup | PASS — temp DBs, role, dumps and temporary files removed (verified absent) |

## Schema drift found (finding, not corruption)

The latest **daily** backup predates two migrations applied later:

- Daily restored: 43 tables / 474 columns / 217 constraints / 116 indexes / **28 migrations**
- Current production: 44 tables / 482 columns / 218 constraints / 118 indexes / **30 migrations**
- Missing from daily backup: `029_login_lockout`, `030_login_attempts` (applied 2026-11-24 08:39 and 09:27).

So the daily restore is a valid older snapshot, and the app health endpoint returns 200 against it, but a disaster restore of that daily backup would **not include the latest login-lockout schema** unless migrations are replayed or the app auto-migrates. The predeploy backup from 15:31 does include the current schema.

## What was deleted / cleaned

Temporary only:

- `dar_restore_s9_daily_20261124162519`
- `dar_restore_s9_fresh_20261124162519`
- `dar_restore_s9_app_20261124162519` role
- drill temp directory and offsite/fresh temporary dumps

Verified after cleanup: no `dar_restore_s9_%` databases/roles, no `/tmp/s9-drill.*` or temp dumps. Production backup SHA/mtime/permissions unchanged; installed backup script SHA unchanged; timer and services unchanged.

## Not verified / caveats

1. Full authenticated application behavior on the restored DB was **not** tested; only `/health/ready`. Login/Turnstile/pages may depend on migrations 029/030 missing from the daily snapshot.
2. Media/Meet recording files are not part of the DB backup; this drill covers PostgreSQL only.
3. Offsite was byte-compared to local, but the restored DB came from the local copy; no separate restore from Drive was performed.
4. Installed `/usr/local/bin/dar-backup` is older than the repo script: it has no automatic manifest/SHA/TOC; manual SHA/TOC verification was used. Per owner instruction, it was not changed.
5. Backup permissions/retention were not changed. Latest daily file is `644`; predeploy dumps are not covered by the installed retention pattern. Recorded as notes only.

## Reproduction

```bash
sudo bash deploy/scripts/restore-drill.sh
```

The script refuses any database name without the `dar_restore_s9_` prefix, never targets `<database>`, uses read-only metrics on production, and removes its temporary databases/role/files on exit.
