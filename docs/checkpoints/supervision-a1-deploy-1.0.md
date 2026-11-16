# Checkpoint: Supervision A1 Live Deploy 1.0

Date: 17 Nov 2026

## Done

- Pushed A1 as `b50fd94` (`feat: A1 supervision guardrails, financial gating and self-password`).
- Pre-migration backup: `dar-20261117-010642.dump` (214 TOC entries).
- Applied **migration 018** with the new migration runner; live ledger is now **18** (`018_supervision_permissions`).
- Published and swapped:
  - New API: `/opt/dar/app/api` (A1 teacher/supervisor/identity changes).
  - Legacy API + SPA: `/opt/dar/app/legacy` (A1 frontend build).
- Old artifacts retained for rollback:
  - `/opt/dar/app/api.old.20261117-011212`
  - `/opt/dar/app/legacy.old.20261117-011212`
- Granted the live `supervisor` account the 13 new default supervision permissions (student/circle CRUD, teacher notes, requests, communication, reports). It now has **19** permissions; `account.password.self` remains off by default and `finance.read` is not granted, so pay amounts stay hidden.
- Services restarted; public smoke passed:
  - `/health/ready` → `{"status":"ready","database":"connected"}`.
  - `/api/v1/ping` → 200; `/` → 200; `/teacher` → 200; `/supervisor` → 200.
  - `/manifest-teacher.webmanifest` and `/sw.js` → 200.
  - `/api/v1/auth/change-password` → 401 without a session.
  - `/api/v1/teacher/today` → 401 without a session.
  - Supervisor login → 200; `/api/v1/supervisor/live` → 200; `/api/v1/supervisor/unpaid` → 200; `/api/v1/auth/me` reports 19 permissions.
  - Supervisor `POST /api/v1/auth/change-password` → 403 (permission not granted).
  - Built admin assets contain no `v0.8.25.0`; sidebar/footer version label removed.
- Post-deploy backup: `dar-20261117-011725.dump` (214 TOC entries).

## Behavior Verified Locally Before Deploy

- All 18 migrations on an empty PostgreSQL 17 database.
- Early start → 409; `today.canStart=false` before the Cairo schedule time.
- Without `teacher.earnings.self`: `today.hourlyRate=null` and `/teacher/earnings` → 403.
- Change password → 200; old cookie → 401; old password → 401; new password → 200.
- Supervisor without `finance.read`: live `payableAmount=null`, `/unpaid` → 403, manual amount → 403, time adjustment without amount → 200 with `payableAmount=null`.
- After granting `supervisor.unpaid` + `finance.read`: `/unpaid` → 200 and live `payableAmount=37.50` for 45 minutes at 50/hour.
- Build 0 warnings/0 errors; 16 unit + 5 integration tests; frontend `tsc -b && vite build`.

## Pending

1. Owner changes the `supervisor` password (the temporary file still exists at `/etc/dar/supervisor-initial-password`) and deletes the file. The file has CRLF line endings; strip the trailing newline when pasting/using it.
2. Owner creates real teacher records and links accounts. The live `asmaa` account still has no teacher link.
3. Payroll lock/approval and production E2E for supervision flows.
4. GitHub Actions first-run verification.
5. Start Phase A2: `app_user_scopes`, scoped supervision read models, teacher detail/notes, teacher absences, student/circle lists.

## Rollback

```bash
sudo systemctl stop dar-api dar-legacy
sudo mv /opt/dar/app/api /opt/dar/app/api.failed
sudo mv /opt/dar/app/api.old.20261117-011212 /opt/dar/app/api
sudo mv /opt/dar/app/legacy /opt/dar/app/legacy.failed
sudo mv /opt/dar/app/legacy.old.20261117-011212 /opt/dar/app/legacy
sudo systemctl start dar-api dar-legacy
```

Migration 018 is additive (permission catalog + role templates). Old binaries ignore the new codes; do not drop the rows as a rollback step.
