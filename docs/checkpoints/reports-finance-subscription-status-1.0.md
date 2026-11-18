# Checkpoint: Reports Finance Gate + Supervisor Subscription Status 1.0

Date: 18 Nov 2026

## Done

- **Reports finance gate**
  - All report financial sections now require both `finance.read` and `reports.finance` for internal reports.
  - Applied to school, circles, teacher, teacher-attendance and student reports.
  - Financial data is no longer fetched for the report builder unless the gate is satisfied.
  - Added a visible notice when the account has `finance.read` but not `reports.finance`: financial columns are hidden.
- **Supervisor student list**
  - `GET /api/v1/supervisor/students` now returns `subscriptionStatus` (`paid`, `partial`, `unpaid`, `not-set`) for the current Cairo month, scoped to the supervisor’s circles.
  - No amounts are returned; the list stays amount-free.
  - Table adds an **الاشتراك** column and mobile cards show the same status badge.
  - Demo students now show a realistic mix of statuses.
- Integration test added: student list returns `partial` for the seeded student and does not expose `amountDue`.
- Test suite: **16 Unit + 18 Integration** passing.

## Verified

- New API + frontend build 0 warnings/0 errors.
- Live `/`, `/management`, `/teacher`, `/supervisor` → 200.
- Pre/post backups `dar-20261118-044647.dump` / `dar-20261118-044849.dump`; old API retained at `api.old.20261118-044822`.

## Pending

- Formal PDF sample: **generated** at `docs/samples/report-school-2026-11.pdf` with `docs/samples/report-builder-preview.png`; owner review still required.
- Payroll lock.
- Admin console parity and 250/125 charge-payment UI audit.
- File/OOP refactor.
- Production E2E and GitHub Actions first run.
