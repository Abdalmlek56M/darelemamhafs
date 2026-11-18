# Checkpoint: Owner Feedback Round 2 1.0

Date: 18 Nov 2026

## Done

### 12-hour time + teacher auto-refresh
- Added `formatTime12` and applied it across admin schedule/attendance/reports, supervisor pages, teacher home/live/requests/calendar/history.
- `timeRange`, `localTime` and report session rows now show `ص/م`.
- Teacher portal automatically refreshes the “today” data before the next slot starts, so the start button unlocks without a manual refresh; it also rechecks at most once per minute while waiting.

### Requests after approval + session notes
- Session/attendance notes are now **appended** on approval instead of overwritten (absence, cancellation and correction paths; both legacy admin and new supervisor endpoints).
- Added `database/023_request_effects.sql`:
  - `effect_before` / `effect_after` snapshots on `attendance_requests`;
  - `is_trashed` for soft deletion.
- Approval snapshots the affected attendance/session rows.
- Admin can now:
  - **تعديل** a pending request (reason, date, proposed duration/note);
  - **إعادة للمراجعة** an approved request, which restores the previous attendance/session state and reopens it;
  - **حذف** pending/rejected requests via a soft-delete action (approved requests must be reopened first).
- Every action writes `request.update`, `request.reopen` or `request.delete` audit rows.

### Supervisor circle detail + add students
- Circle detail sessions now include per-student attendance (name, code, status, note) in an expandable list.
- Added “إضافة طالبات” in the circle detail, gated by `supervisor.students.create`:
  - search available scoped students, multi-select, submit;
  - backend `POST /api/v1/supervisor/circles/{id}/students` validates scope, avoids duplicates, uses the circle fee, and audits the bulk add.
- Integration test: scoped supervisor adds a student to a scoped circle and the roster reflects it.

### Admin bulk enrollment
- Added `POST /api/circle-enrollments/bulk` (`students.edit`) for multi-student enrollment.
- Circle detail now has **إلحاق مجموعة**: search, check students, start date, optional closed-circle override, one save.
- Uses the circle’s monthly fee, skips existing active/paused enrollments, and audits `enrollment.bulk_create`.

### OOP / structure
- Extracted teacher offline logic into `useTeacherOutbox` hook, removing state/effects from `TeacherApp`.
- Added `BulkEnrollmentDialog` and `PayrollLockPanel` as focused components.

## Verified

- Builds: legacy API, new API, frontend 0 warnings/0 errors.
- Tests: **16 Unit + 20 Integration** passing.
- Local disposable PostgreSQL:
  - correction approval preserved the original note and produced 75 min / 62.50;
  - reopen restored 60 min / 50.00 and the original note;
  - edit pending and soft-delete succeeded; approved delete is blocked until reopen.
  - payroll lock still blocks edits and request approvals.
- Live:
  - migration **023** applied (ledger 23);
  - `/`, `/management`, `/teacher`, `/supervisor` → 200;
  - bulk enrollment and supervisor add-student routes return 401 unauthenticated.
- Pre/post backups `dar-20261118-150223.dump` / `dar-20261118-150616.dump`; artifacts `api.old.20261118-150539` / `legacy.old.20261118-150539`.

## Remaining

- Receipt/refund UI audit, admin console-wide parity, full file/folder refactor, production E2E, GitHub Actions first run.
- Owner review of the generated PDF sample.
- Supervisor password change and `asmaa` teacher link remain with the owner.
