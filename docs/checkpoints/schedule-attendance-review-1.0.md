# Checkpoint: Schedule + Teacher Attendance Review 1.0

Date: 18 Nov 2026

## Review result

- Teacher pay follows the saved `hourly_rate_snapshot` and corrected duration; the admin table, per-teacher summary and month total agree.
- Future sessions are disabled in the UI; the server now rejects them too.
- Teacher attendance now validates that the session date matches the slot’s weekday.
- Inactive circles no longer offer attendance actions that the server would reject; their slots are labelled “حلقة متوقفة” and remain visible for history.
- Upcoming sessions exclude inactive circles.
- Filters by teacher/circle, month picker, historical badge, substitution note and duration editing are wired correctly.

## Changes

- Commit `2cbceba`: server-side weekday + future-date validation for `POST /api/teacher-attendance`.
- Commit `ee3fe3d`: `schedule-slots` returns `circleIsActive`; admin schedule hides actions for inactive circles, labels their slots, and excludes them from upcoming sessions.

## Verified

- Legacy API + `Dar.slnx` build 0 warnings/0 errors.
- Frontend `tsc -b && vite build` passed.
- Live pages `/`, `/management`, `/teacher`, `/supervisor` → 200.
- Deployed at 2026-11-18 03:13 and 03:19; artifacts retained at `legacy.old.20261118-031310` / `legacy.old.20261118-031952`.

## Open review notes

- The admin schedule “upcoming” countdown uses the device’s local timezone; the teacher portal uses explicit Cairo time. If the admin device is outside Egypt, the countdown can differ by the timezone offset. The page states this explicitly.
- The schedule sessions table is wide by design and scrolls horizontally on mobile; it does not have a separate mobile-card view yet.
- Payroll lock/approval is still pending.
