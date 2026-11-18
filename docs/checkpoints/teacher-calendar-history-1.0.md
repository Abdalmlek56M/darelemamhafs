# Checkpoint: Teacher Calendar + History 1.0

Date: 18 Nov 2026

## Done

- New teacher APIs:
  - `GET /api/v1/teacher/calendar?from=YYYY-MM-DD&days=7` (`teacher.calendar`):
    returns every day in the range with the teacher’s active-circle sessions, student counts, session status, timing, payable minutes and attendance id. Defaults to Cairo today and 7 days; range 1–31 days.
  - `GET /api/v1/teacher/history?limit=50` (`teacher.history.self`):
    previous sessions (status, scheduled/actual/payable minutes, present/total students, note), recorded teacher-attendance rows (pay amount only with `teacher.earnings.self`), and the last five login sessions from `auth_sessions` without tokens.
- Teacher UI:
  - **تقويم الأسبوع** page: 7-day strip, previous/next week, “this week”, today highlight, session cards with status and student count; opens live session or roster where applicable.
  - **سجلي** page: session history, attendance history, and last five logins (device label, IP, last activity).
  - Both linked from the teacher home quick-links grid; PC uses a 4-column calendar and 2-column history cards, mobile stays single-column.
- Integration tests: calendar returns 7 days with the seeded session; history returns attendance and a logins array.
- Test suite now **16 Unit + 17 Integration** passing.

## Verified

- `dotnet build` 0 warnings/0 errors; frontend `tsc -b && vite build` passed.
- Live `/`, `/management`, `/teacher`, `/supervisor` → 200.
- `GET /api/v1/teacher/calendar` and `/history` → 401 unauthenticated (routes live).
- Live `auth_sessions` table has login rows, so the history login section has real data in production.
- Deployed commit `998c3a0`; pre/post backups `dar-20261118-041924.dump` / `dar-20261118-042339.dump`; old API retained at `api.old.20261118-042227`.

## Next

- Offline queue for roster/notes.
- reports.finance + PDF sample.
- Payroll lock.
- Admin console parity.
