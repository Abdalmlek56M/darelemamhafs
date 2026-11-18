# Checkpoint: Admin Requests Review 1.0

Date: 18 Nov 2026

## Done

- Added legacy admin endpoints:
  - `GET /api/admin/requests?status=pending|approved|rejected|cancelled|all` — all requests, newest pending first, limit 250.
  - `POST /api/admin/requests/{id}/review` — approve/reject with an optional note, guarded by `attendance.edit`.
- Approval applies the same effects as the supervisor flow:
  - absence → `teacher_attendance` status `absent`, payable 0, linked `teacher_sessions` cancelled;
  - cancellation → `teacher_attendance` status `cancelled`, payable 0;
  - correction → proposed duration/pay applied to `teacher_attendance` and linked session, `pay_basis='manual'`.
- Teacher notification on review (when the teacher has an active account) with dedupe `request-review:{id}`.
- Audit rows: `request.review` for every request and `request.correction.apply` for corrections.
- Admin page **طلبات المعلمات**:
  - pending/approved/rejected/all filters;
  - teacher, circle, type, date, reason, correction payload and review note;
  - approve/reject inline form; rejection requires a note;
  - added to the admin navigation with `attendance.edit`.

## Verified

- Legacy + `Dar.slnx` build 0 warnings/0 errors; frontend `tsc -b && vite build` passed.
- Local disposable PostgreSQL 17:
  - list returned 2 pending requests;
  - correction approval → `teacher_attendance.duration_minutes=75`, `payable_amount=62.50`;
  - absence rejection → request status `rejected`;
  - final counts: 1 approved, 1 rejected;
  - audit rows: `request.correction.apply`, `request.review` ×2.
- Live: `/`, `/management`, `/teacher`, `/supervisor` → 200; `GET /api/admin/requests` → 401 unauthenticated (route live). Live pending requests = 0 at deploy time.
- Deployed commit `8cc90dd`; artifact `legacy.old.20261118-034541`.

## Next

- Teacher weekly calendar + session/login history.
- Offline queue.
- reports.finance + PDF sample.
- Payroll lock.
- Admin console parity.
