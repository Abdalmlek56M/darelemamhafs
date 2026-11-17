# Checkpoint: A3.2 Requests + Scope Hardening 1.0

Date: 17 Nov 2026

## Done

- Commit `4c0d98c`; migration **020** applied live (ledger 20).
- Request workflow:
  - Teacher create/list/cancel absence, cancellation and correction requests.
  - Supervisor list/review with approve/reject.
  - Approval applies `teacher_attendance` rows/corrections and linked `teacher_sessions`; audit records before/after.
  - Notifications on submit/review.
  - Teacher page “طلباتي” and supervisor “طلبات المعلمات”.
- Scope hardening in backend:
  - `UnpaidEndpoint` filters by `SupervisionScope`.
  - `AdjustEndpoint` verifies circle + teacher scope before updating.
  - Student-detail subscription query filters by scope.
  - Notifications list/counts/read/read-all/resolve filter by `scope_circle_id`/`scope_teacher_id`; admins bypass.
  - Teacher-notes `kind` filter moved into SQL before `LIMIT`.
  - Unpaid notification writes removed from `GET /unpaid`; `NotificationSyncService` runs every 6 hours.
- `CommunicationEndpoint` (`POST /api/v1/supervisor/communications/whatsapp`) deployed and wired to the UI:
  - Requires `supervisor.communication` or admin.
  - Validates recipient scope, normalizes +20, returns a `wa.me` href, writes `communication_log`.
  - Supervisor absences (teacher/guardian), unpaid guardian, student detail guardian and teacher detail now call this endpoint instead of building client-side links.
  - `canCommunicate` hides the buttons entirely when the permission is missing.
- Frontend:
  - Teacher request page + nav + home quick link.
  - Supervisor request page + nav.
  - Clickable teacher/circle context links from F2 remain.
  - Admin user list query fixed for notification scope columns.
- Nginx 502 root cause fixed earlier (`upstream sent too big header`; larger proxy buffers).

## Verified

- Disposable PostgreSQL 17 with migration 020:
  - Teacher absence request → supervisor approve → `teacher_attendance` row `absent`, payable 0.
  - Teacher correction request 60→75 minutes → supervisor approve → duration 75, payable 62.50 at 50/hour.
  - Request status/list/notification flows returned expected results.
- Live:
  - `/health/ready`, `/`, `/teacher`, `/supervisor?demo=1` → 200.
  - Supervisor login → 200; `/supervisor/requests` → 200; `/notifications` → 200; `/unpaid` → 200.
  - Ledger 20.
  - WhatsApp endpoint: teacher and student guardian returned `https://wa.me/20...` and wrote 2 `communication_log` rows.
- Pre-deploy backup `dar-20261117-210547.dump`; post-deploy `dar-20261117-211434.dump` (237 TOC); WhatsApp wiring backup `dar-20261117-231837.dump`.
- Permanent integration suite (commit `156ad69`):
  - `tests/Dar.IntegrationTests/Supervision/SupervisionFixture.cs` spins up Testcontainers `postgres:17`, applies all 20 migrations and seeds scoped data.
  - `SupervisionAccessTests.cs` adds 7 tests: unpaid finance/scope, out-of-scope adjust 403, notification list/read scope, scoped student subscription, notes-kind filter before limit, request approval applying 75 min → 62.50, communication permission + `wa.me`.
  - `dotnet test Dar.slnx` → **16 unit + 13 integration passing**.

## Pending

1. Admin 502 re-test after Nginx buffer fix.
2. Admin teacher-notes/notification pages; admin 250/125 UI audit.
3. Settings-controlled WhatsApp templates; teacher UI parity; full file/folder/OOP refactor.
4. Owner changes the supervisor password and deletes `/etc/dar/supervisor-initial-password`.
