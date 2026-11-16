# Checkpoint: Teacher Portal Live Deploy 1.0

Date: 16 Nov 2026

## Done

- Fresh live backup before migration: `dar-20261116-155118.dump` (184 TOC entries, uploaded to Google Drive, `rclone check` 0 differences / 7 matching files).
- Applied **migration 017** to the live `dareltahfeez` database via the new migration runner. Ledger: 17 migrations.
- Published and swapped:
  - New API: `/opt/dar/app/api` (backend `fe03ce6`; teacher/supervisor/notifications module).
  - Legacy API + SPA: `/opt/dar/app/legacy` (backend `485e9f3`, frontend `fe03ce6` build).
- Old artifacts retained for rollback:
  - `/opt/dar/app/legacy.old.20261116-155934`
  - `/opt/dar/app/legacy.old.20261116-162127`
  - `/opt/dar/app/api.old.20261116-155934`
- Services restarted; public smoke passed:
  - `/health/ready` → ready (legacy + API).
  - `/api/v1/ping` → ok.
  - `/` → 200, `/teacher` → 200, `/supervisor` → 200.
  - `/manifest-teacher.webmanifest` → 200, `/sw.js` → 200, teacher JS asset → 200.
  - `/api/setup/status` → `needsInitialAdmin=false`.
  - `/api/auth/me`, `/api/v1/auth/me`, `/api/v1/teacher/today` → 401 without a session.
  - Bad new-API login → 401.
- Found and fixed the null `@userId` type inference in the teacher-link check plus typed JSON audit parameters (`485e9f3`); redeployed the legacy API and retested against a disposable DB.
- Created a live **supervisor** account (`supervisor` / «المشرفة») with the supervisor permission bundle. Temporary password is at `/opt/dar/.supervisor-initial-password` (`root:root`, `600`); it must be changed and the file deleted after first login.
- Live supervisor login → `/api/v1/supervisor/live` → `{sessions:[]}` and `/unpaid` → `{count:0}` (no operational data yet).

## Verified Before Swap

- Access endpoint: create user linked to teacher → list shows `teacherId`/`isLocked`; lock → login 401; unlock → login 200; duplicate teacher link → 409; audit insert committed.
- Teacher flow: start/end, 90 actual/60 scheduled → 100.00, early end 1-minute minimum, roster/submit, earnings, subscriptions.
- Supervisor: live/absences/unpaid/adjust, lock, notification resolve.
- Payment trigger: insert payment → unpaid notification resolved; unpaid count drops.
- Clean database: all 17 migrations applied.

## Pending

1. Owner creates the real teacher records and links user accounts through **إدارة الحسابات** (teacher link + teacher permission bundle). The existing `asmaa` account has no permissions or teacher link yet.
2. Owner changes the supervisor password from **إدارة الحسابات**, then deletes `/opt/dar/.supervisor-initial-password`.
3. Owner tests lock/unlock for the supervisor account.
4. Payroll lock/approval and production E2E.
5. First GitHub Actions run verification (Actions access still not available to the agent).

## Rollback

```bash
sudo systemctl stop dar-legacy dar-api
sudo mv /opt/dar/app/legacy /opt/dar/app/legacy.failed
sudo mv /opt/dar/app/legacy.old.20261116-155934 /opt/dar/app/legacy
sudo mv /opt/dar/app/api /opt/dar/app/api.failed
sudo mv /opt/dar/app/api.old.20261116-155934 /opt/dar/app/api
sudo systemctl start dar-legacy dar-api
```

Migration 017 is additive; the old binaries ignore the new tables/columns. Do not drop the new columns as a rollback step.
