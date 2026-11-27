# Runbook — deploy to production

**Goal:** ship the current `origin/main` to the production host safely: mandatory backup →
build → migrations → binary swap → smoke → automatic binary rollback on failure.
**Entry point:** `sudo bash deploy/update.sh` — the only approved deploy path.
**Do not:** `git pull` + restart by hand, run migrations manually, edit an applied migration, or
deploy without a backup. Detail: `../11-deployment.md` §7.

## 1. Preconditions (all required)

- [ ] Owner approved the deploy (message/decision recorded) and the deploy window is known.
- [ ] The same commit was verified on **staging** (`../staging-environment.md`) — smoke + the
      changed flows; no production data was used there.
- [ ] `main` is green: full regression PASS (`sudo -E bash tests/run-regression.sh`) and
      `node tests/regression/docs-migration-count/run.mjs` (docs count == `database/*.sql`).
- [ ] A fresh verified backup exists (`dar-backup.timer` ran; see `backup-restore.md`).
- [ ] You are on the host as root/deploy with passwordless sudo, in `/opt/dar`, branch `main`,
      and the tree has no uncommitted tracked changes.

## 2. Procedure

```bash
cd /opt/dar
git status --short                 # must be empty (script also refuses dirty trees)
sudo bash deploy/preflight.sh      # read-only; must end with PREFLIGHT_OK
sudo bash deploy/update.sh --dry-run
```

Read the dry-run output: repo/branch/commit, app root, migration file count, planned backup path,
log file. Then:

```bash
sudo bash deploy/update.sh
```

First deploy on a host whose services are not running yet:
`sudo bash deploy/update.sh --allow-stopped-services`.

Interrupted during the build? `sudo bash deploy/update.sh --skip-build` reuses
`app/legacy.new` + `app/api.new` (only after confirming they are the intended build).

**Fixed order inside `update.sh` (never reorder or do pieces by hand):**
1. preflight (git branch/clean tree + `deploy/preflight.sh`),
2. mandatory DB backup: `pg_dump -Fc` + `pg_restore --list` TOC + SHA-256 sidecar,
3. `git pull --ff-only`,
4. build: `npm ci` + `npm run build --prefix frontend`, `dotnet publish` legacy + new API,
   copy `frontend/dist` into `legacy/wwwroot`,
5. migrations: `dotnet run --project src/Host/Dar.Api -- --migrate` (Production),
6. ledger check: `web_schema_migrations` count == `database/*.sql` count (abort before swapping
   if not equal),
7. stop `dar-legacy` + `dar-api`, swap `app/legacy|api` to `*.old.<stamp>`,
8. start + readiness (90 s) + 7-point smoke: `/health/ready` :5080 and :5081, `/`,
   `/management`, `/teacher`, `/supervisor`, `/api/v1/ping`,
9. on any failure after the swap: **automatic binary rollback** (database untouched),
10. retention (last 5 app copies + 30 days pre-deploy dumps), state file
    `/var/lib/dar/deploy/last-deploy.env`, log `/var/log/dar/update-<stamp>.log`.

Success prints `UPDATE_OK` with stamp, commit, previous commit, migrations count, backup path +
SHA, and the exact rollback command. Keep that output in the deploy record/checkpoint.

## 3. Post-deploy verification (manual, public side)

- [ ] `https://<deployment-host>/` , `/management`, `/teacher`, `/supervisor` → 200.
- [ ] Admin login works; a permission-gated page loads.
- [ ] `sudo bash deploy/scripts/dar-healthcheck.sh --json` → no `critical`.
- [ ] `systemctl --failed` empty; `journalctl -u dar-legacy -u dar-api --since "15 min ago"` has
      no new unhandled exceptions.
- [ ] `systemctl list-timers dar-backup.timer dar-healthcheck.timer` → next run scheduled.
- [ ] If any migration was applied: ledger count and a financial integrity check
      (`deploy/sql/integrity-checks.sql`) look sane.

## 4. If it failed

- The script already tried the binary rollback. Read the tail of `/var/log/dar/update-<stamp>.log`
  and the `UPDATE_FAILED`/`ERROR:` line first — do not improvise.
- Deploy-related, DB schema compatible → use `rollback.md` (binary rollback is safe: migrations
  are additive and the previous binaries ignore new objects).
- A migration itself failed before the swap → services were never swapped; fix forward on `main`
  (new migration only), retest on staging, redeploy. Do not hand-edit the database.
- DB data suspected damaged → stop; follow `backup-restore.md` and `rollback-db.md`, and get owner
  approval before any data restore.
- Record the incident/attempt in `../checkpoints/` and notify the owner with impact + next action.

Never restore a pre-deploy dump over the live database as a "quick fix" — see `rollback.md` §3.
