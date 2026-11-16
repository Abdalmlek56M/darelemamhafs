# Checkpoint: Teacher Portal Requirements 1.0

Date: 16 Nov 2026

## Captured
- `docs/13-teacher-portal-requirements.md`:
  - Teacher accounts linked to `teachers`.
  - Supervisor account/role.
  - Mobile-first teacher flow: today → live circle → start timer → finish → student roster → submit → earnings.
  - Persistent notification center (absent, unpaid, unmarked sessions, schedule, system).
  - Proposed data model (`app_users.teacher_id`, `teacher_sessions`, `notifications`, `notification_reads`).
  - Proposed `/api/v1/teacher/*` and `/supervisor/*` endpoints.
  - Open decisions (grace period, rounding, approval, supervisor scope, unpaid timing, earnings visibility, PWA/native).
- `docs/14-ui-audit-and-mobile-direction.md`:
  - Current design audit (Cairo, navy/teal glass, sidebar, dense tables).
  - Mobile problems: hidden nav below 760px, small touch targets, tables, `window.confirm`, no PWA.
  - Design tokens, bottom nav, cards/bottom sheets, sample scope, standards.
  - Dedicated teacher PWA at `/teacher`; responsive admin.
- `docs/05-roadmap.md`: Phase 7 teacher portal/mobile, Phase 8 payroll/follow-up.
- `docs/07-gap-audit.md`: P1-21..P1-27 + P2-15/16 for the new gaps.

## Code Changes
- Password minimum lowered to **6** in backend + frontend (owner request; security tradeoff recorded).
- Removed desktop auto-start, connection check, and connection settings from the web UI.
- Deployed to the live host:
  - `db1532a` plus the docs commit.
  - `dar-legacy`/`dar-api` rebuilt and restarted.
  - Public health/ping verified.

## Important
- **No teacher portal UI has been implemented yet.** The UI gate remains: owner must approve a visual sample first.
- The current UI is desktop-first; the teacher portal needs new backend scoping, not just screens.

## Next
1. Produce a static visual sample (teacher home, live session, roster, notifications, supervisor board).
2. Owner approves/adjusts.
3. Implement the DB migration + scoped teacher APIs.
4. Build the teacher PWA.
5. Supervisor + notification center.
6. Bug review/tests.
