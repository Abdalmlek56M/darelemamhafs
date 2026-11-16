# Checkpoint: Teacher Portal Implementation 1.0

Date: 16 Nov 2026

## Done

- **Migration 017** (`database/017_teacher_portal.sql`):
  - `app_users.teacher_id` unique link + `is_locked`/lock audit fields.
  - `teacher_sessions` with actual/payable/overtime/undertime and note.
  - `teacher_attendance` actual/pay-basis/overtime/undertime + session link; duration rule relaxed to **1–360**.
  - `notifications` + `notification_reads` with `open`/`resolved`, read state, dedupe key.
  - Teacher/supervisor permissions and role templates.
  - Payment trigger resolves the unpaid notification only when the charge is fully paid; reopens it if the charge becomes unpaid again.
- **Pay policy** (`Dar.Common.Domain.Money`):
  - Scheduled duration is paid when the teacher reaches/exceeds it; the excess is recorded but not paid.
  - Early end pays actual whole minutes, minimum 1.
  - 2-decimal money; tests 16 unit + 5 integration passing.
- **New `Dar.Modules.Teaching` APIs:**
  - `/api/v1/teacher/today`, start, end, roster, submit, earnings, subscriptions.
  - `/api/v1/supervisor/live`, absences, unpaid, attendance adjustment.
  - `/api/v1/notifications` list/read/read-all/resolve.
  - Scoped by `app_users.teacher_id`; supervisor uses permission bundles.
- **Mobile PWA:**
  - `/teacher` and `/supervisor` entries in the existing Vite SPA.
  - Screens: login, today, live timer, finish sheet + note, roster with حاضر/بعذر/غائب, success sheet, notifications, subscriptions, supervisor board, adjust sheet.
  - Bottom nav, safe-area padding, 44px targets, PWA teacher manifest/service worker.
  - Checked at 430×932 against a mock API.
- **Admin UI:**
  - User dialog now has teacher link, lock/reason, and teacher/supervisor permission groups.
  - `PUT /api/admin/users/{id}/access` applies link/lock and audits it; general user update cannot silently unlock.
- **CI:** `workflow_dispatch`, migration job on PostgreSQL 17, clean-schema verification, deploy-script syntax check, API-client TypeScript pinned for reproducible generation.

## Verification

- Disposable DB restored from `dar-20261116-104645.dump`; migration 017 applied.
- Clean DB: all **17 migrations** applied successfully.
- Teacher login, today, start, end, roster, submit, earnings, subscriptions.
- End with 90 actual / 60 scheduled → **60 paid minutes, 100.00**, overtime 30.
- End with 0 actual → **1 paid minute, 1.67**, undertime 59.
- Supervisor login, live, absences, unpaid, adjustment.
- Supervisor lock → login 401 and existing session 401; unlock → login 200.
- Payment insert → unpaid notification resolved; unpaid list count drops.
- Absence notification resolved with note; teacher notification read ≠ resolved.
- Teacher resolution attempt → 403; supervisor resolution of payment → 409.
- PWA rendered at 430×932: home, live, finish, roster, notifications, subscriptions, supervisor, adjust.

## Pending

1. Apply migration 017 to the live DB after a fresh backup.
2. Publish/restart the new API and legacy SPA on the host.
3. Create/link the owner’s teacher and supervisor accounts via the admin UI.
4. Smoke-test `https://dar-elemam-hafs.rigxhardware.com/teacher` and `/supervisor`.
5. Payroll lock/approval and production E2E.

## Files

- `database/017_teacher_portal.sql`
- `src/Modules/Teaching/**`
- `src/Common/Dar.Common/Domain/Money.cs`
- `src/Modules/Identity/**` (teacher claim, lock, session refresh)
- `backend/DarEltahfeez.Api/**` (lock, teacher link, access audit, 1–360 rule)
- `frontend/src/teacher/**`
- `frontend/src/components/dialogs/UserDialog.tsx`
- `frontend/src/application/useUserActions.ts`
- `frontend/public/manifest-teacher.webmanifest`, `frontend/public/sw.js`
- `.github/workflows/ci.yml`
- `packages/api-client/openapi.v1.json`, `src/schema.d.ts`
