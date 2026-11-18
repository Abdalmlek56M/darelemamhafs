# Checkpoint: Monthly Payroll Lock 1.0

Date: 18 Nov 2026

## Done

- Migration **022** (`database/022_payroll_locks.sql`, ledger 22) adds `payroll_locks`:
  - one row per billing month, `is_locked`, lock actor/time/note and unlock actor/time/note.
- Admin endpoints:
  - `GET /api/admin/payroll/lock?month=YYYY-MM` (`finance.read`).
  - `POST /api/admin/payroll/lock` (`finance.edit`) with a required reason.
  - `POST /api/admin/payroll/unlock` (`users.manage`) with a required reason.
  - Both lock/unlock write `payroll.lock` / `payroll.unlock` audit rows.
- Guards when a month is locked:
  - legacy `PUT /api/teacher-attendance/{id}/duration` → 409.
  - legacy `POST /api/teacher-attendance` → 409.
  - admin request approval for an affected month → 409 (unlock first).
  - new API supervisor `POST /api/v1/supervisor/attendance/{id}/adjust` → 409.
- UI:
  - **قفل مسير الرواتب** panel on the admin schedule page for the selected month;
  - shows lock state and reason, accepts a reason, locks/unlocks;
  - hides duration edit and attendance action buttons while locked.
- Integration test: supervisor adjust is blocked while the month is locked.

## Verified

- Local disposable PostgreSQL 17:
  - before lock: duration edit 200;
  - lock → duration edit 409 and admin request review 409;
  - unlock → duration edit 200 and request approval succeeds;
  - audit rows are written.
- Builds: legacy + new API 0 warnings/0 errors; frontend `tsc -b && vite build` passed.
- Tests: **16 Unit + 19 Integration** passing.
- Live: migration 022 applied (ledger 22), `/`, `/management`, `/teacher`, `/supervisor` → 200; payroll lock endpoint 401 unauthenticated.
- Pre/post backups `dar-20261118-051846.dump` / `dar-20261118-052221.dump`; old artifacts retained at `api.old.20261118-052126` / `legacy.old.20261118-052126`.

## Policy note

- The lock is intentionally strict: to change attendance/pay or approve an affected request, an authorized admin must unlock the month with a written reason, which is audited, then re-lock it.
