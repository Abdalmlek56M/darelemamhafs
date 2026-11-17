# Supervision Workspace, Communications and Admin UX — Plan

**Date:** 16 Nov 2026
**Status:** A1 is live (commit `b50fd94`). A2 is implemented and verified locally; deployment pending. Phases A3–E not started.
**Owner approval:** all previously listed gaps and suggestions are approved. Manual adjustments, supervisor scope, offline handling, calendar, requests, admin notifications, WhatsApp sender, reports and the full admin/supervisor UI are in scope.

Related: `docs/13-teacher-portal-requirements.md`, `docs/14-ui-audit-and-mobile-direction.md`, `docs/15-legacy-reuse-audit.md`, `docs/11-deployment.md`.

---

## 1. Product Goal

Make the supervision workspace the operational backbone of the Dar:

- Supervisor/secretary sees the students, circles, teachers, attendance, notes, requests and alerts they are allowed to see.
- Teacher sees her week, circles, history, attendance, notes and earnings.
- Admin sees everything, with manual control over time, pay, notes, scope, locks and permissions.
- Money disappears completely when the user does not have the financial permission — no “0” and no empty money cards.
- Communication is one click: absentees/unpaid lists → selected students → WhatsApp message.

The existing students/attendance/payroll/collections model is reused. This is an extension layer, not a second ERP.

---

## 2. Roles and Permission Matrix

### Roles

| Role | Default scope | Notes |
|---|---|---|
| **Admin** | whole Dar | all permissions; finance on; can grant/revoke everything |
| **Supervisor** | all circles, or scoped circles/teachers | default all circles; no finance by default |
| **Secretary** | selected teachers/circles | broad student/teacher/attendance/notes; finance optional |
| **Teacher** | own linked teacher + her circles | no admin/finance; supervisor board only if `supervisor.portal` granted |

The exact “supervisor vs secretary” split is a naming/role-template decision. The implementation should use **permission bundles + scope**, not hard-coded role checks. A supervisor can be given secretary-level permissions and vice versa.

### New permission codes (proposed)

| Code | Purpose | Default |
|---|---|---|
| `account.password.self` | allow self password change; otherwise admin only | off |
| `supervisor.students.read` | student list/profile for scoped circles | on for supervisor |
| `supervisor.students.create` | add students | on for supervisor |
| `supervisor.students.edit` | edit students | on for supervisor |
| `supervisor.students.delete` | archive/trash students | on for supervisor |
| `supervisor.students.notes` | add/edit student notes | on for supervisor |
| `supervisor.circles.read` | circle list/details for scoped circles | on for supervisor |
| `supervisor.circles.create` | add circles | on for supervisor |
| `supervisor.circles.edit` | edit circles | on for supervisor |
| `supervisor.circles.delete` | archive/trash circles | on for supervisor |
| `supervisor.teachers.notes` | add/edit teacher notes | on for supervisor |
| `supervisor.teachers.read` | teacher list/details | on for supervisor |
| `supervisor.attendance.requests` | review absence/cancellation/correction requests | on for supervisor |
| `supervisor.communication` | WhatsApp sender/templates | on for supervisor |
| `supervisor.reports` | supervision reports | on for supervisor |
| `teacher.calendar` | weekly calendar | on for teacher |
| `teacher.history.self` | previous sessions/login history | on for teacher |
| `teacher.requests` | submit absence/cancellation/correction requests | on for teacher |
| `reports.finance` | financial sections in reports | off unless `finance.read` |

Existing codes reused: `students.read`, `teachers.read`, `circles.read`, `attendance.read/edit`, `finance.read`, `teacher.subscriptions.read`, `teacher.earnings.self`, `supervisor.live/absences/unpaid`, `supervisor.attendance.correct`, `users.manage`.

### Financial visibility

The UI must **remove** a money surface entirely when the permission is absent. Never render `0.00`, an empty card, or a disabled money tab.

| Surface | Permission required |
|---|---|
| Admin finance pages/reports | `finance.read` |
| Supervisor unpaid tab/amounts | `supervisor.unpaid` or `finance.read` |
| Teacher subscription link/amounts | `teacher.subscriptions.read` |
| Teacher earnings stat/live pay | `teacher.earnings.self` |
| Report financial columns | `finance.read` plus the report-specific permission |
| Manual pay edit | `supervisor.attendance.correct` or `attendance.edit`; admin always |

If `finance.read` is off for a supervisor, the unpaid route must return 403 and the nav item must not exist.

---

## 3. Scope Model

Add `app_user_scopes`:

```sql
CREATE TABLE app_user_scopes (
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  scope_type VARCHAR(20) NOT NULL CHECK (scope_type IN ('circle','teacher')),
  scope_id UUID NOT NULL,
  created_by UUID NULL REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, scope_type, scope_id)
);
```

- No rows = all circles/teachers (backward compatible).
- Supervisor default: all circles and students, with add/edit/delete permissions for students and circles. The admin can revoke any of the create/edit/delete toggles independently; “add only” means `create` on and `edit/delete` off.
- Secretary default: selected teachers/circles, plus the student/circle read/notes/CRUD toggles the admin chooses.
- Admin UI: per-user scope picker (all / selected circles / selected teachers) and separate CRUD checkboxes.
- Supervisor/secretary endpoints add an `EXISTS` scope filter.
- Teacher endpoints stay scoped by `app_users.teacher_id`; the table is for supervisor/secretary.
- Default: supervisor all circles; secretary is configured by the admin.

---

## 4. Supervision Workspace

The supervisor/secretary workspace is one mobile-first + responsive shell with tabs/permissions:

1. **نظرة عامة** — live sessions, absent teachers, absent students, unpaid (only if allowed), open requests, unread alerts.
2. **الطلاب** — scoped student list; profile: circle, guardian, attendance history, subscription status (only with permission), notes, WhatsApp.
3. **الحلقات** — scoped circles; roster, schedule, teacher, student counts, session history.
4. **المعلمات** — scoped teacher list; detail page below.
5. **الحضور** — teacher attendance (present/absent/cancelled), student attendance (present/excused/absent), filters by date/circle/teacher.
6. **الطلبات** — absence/cancellation/correction requests with approve/reject + note.
7. **التنبيهات** — persistent center; open/resolved; filters; resolve with reason.
8. **التواصل** — WhatsApp sender/templates.
9. **التقارير** — supervision reports; no finance sections without permission.

### Teacher detail page

- Attendance rate for a selected month (present / scheduled).
- Present/absent/cancelled counts; total hours; overtime/undertime minutes.
- Payable amount/rate only with finance permission.
- Session history: date, circle, scheduled vs actual vs payable, student count, note.
- Teacher notes timeline (add note if `supervisor.teachers.notes`).
- Linked circles/students.
- “Open WhatsApp” for the teacher if the phone exists and communication permission is on.

### Student detail page

- Identity, guardian, joined date, circle(s), enrollment status.
- Attendance history + rate; absent with excuse vs without excuse.
- Subscription status/balance only with permission; no receipts unless finance.
- Student notes timeline; add note with `supervisor.students.notes`.
- WhatsApp action with the guardian/student phone.
- Alerts: unpaid after one month/end of month; missing attendance.

### Attendance pages

- Teacher attendance by date/circle/teacher: present, absent, cancelled, duration, overtime/undertime, note.
- Student attendance by date/circle: present, excused, absent; search; notes.
- “Absent teachers” list (no attendance recorded after session end).
- “Absent students” list with excuse status.
- No financial amounts without permission.

---

## 5. Teacher Experience Additions

- **Weekly calendar** (mobile-first): week strip + day cards, circles, times, status; click a day to see sessions and history.
- **History**: previous sessions with actual/payable duration, notes, student counts; previous login sessions (last 5) with device/time, no tokens.
- **Login**: remember the last username/profile; ask for password only; session persisted; logout clears sensitive data.
- **Requests**: absence/cancellation request with reason; attendance correction request; status timeline (pending/approved/rejected).
- **No early start**: server rejects start before the scheduled Cairo start; late start is allowed and recorded; end/roster as today.
- **Notes**: finish note; history notes read; edit only if allowed; note history visible.
- **Password**: no self-change UI unless `account.password.self`; admin can reset.
- **Offline**: queue roster/notes submissions in IndexedDB when offline; retry on reconnect; show “بانتظار الإرسال”; do not cache money or other students’ data.
- **Supervisor tab** only if `supervisor.portal`; otherwise hidden.

---

## 6. Requests and Approvals

New table `session_requests` (or `attendance_requests`):

```sql
CREATE TABLE session_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_type VARCHAR(24) NOT NULL CHECK (request_type IN ('absence','cancellation','correction')),
  teacher_id UUID NOT NULL REFERENCES teachers(id) ON DELETE RESTRICT,
  session_id UUID NULL REFERENCES teacher_sessions(id) ON DELETE SET NULL,
  attendance_id UUID NULL REFERENCES teacher_attendance(id) ON DELETE SET NULL,
  requested_by UUID NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL,
  requested_payload JSONB NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  reviewed_by UUID NULL REFERENCES app_users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ NULL,
  review_note TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- Teacher creates a request from history/live.
- Supervisor with `supervisor.attendance.requests` (or admin) reviews.
- Approval applies the change in a transaction and audits before/after; rejection keeps the original.
- Notifications: request submitted (supervisor), approved/rejected (teacher); persistent until read/resolved.
- Correction payload stores proposed status/duration/note; server validates.

---

## 7. Admin Notification Center

- Admin-scoped persistent notifications (existing `notifications` table with `role_scope='admin'`).
- A section/page in the admin console; topbar badge; open/resolved filters.
- Categories: unpaid, missing attendance, absent teacher, request, system/backup, security.
- Resolve with reason; payment auto-resolves; absence resolves via follow-up; requests resolve on review.
- Links to student/teacher/session; no financial detail without permission.
- Daily Cairo-time sync job creates unpaid/unmarked alerts even if the board is not opened.
- Backup/system alerts: backup failure, certificate expiry (later).

---

## 8. WhatsApp Sender

No paid WhatsApp API. Use deep links:

```text
https://wa.me/<international-phone>?text=<url-encoded-message>
```

- Admin and supervisor (with `supervisor.communication`) have a communication page.
- Templates table (`message_templates`): name, body, category, audience (student/guardian/teacher), active.
- Lists: absent students, unpaid students (permission), absent teachers, selected circle/teacher.
- Select one/many → preview message → open WhatsApp per recipient; one click per recipient.
- Store a `communication_log` row (actor, template, recipient type/id, phone, sent_at) for audit; no need to store the full message text.
- Default country code `+20`; normalize phone numbers; reject invalid.
- Templates support placeholders: `{{student_name}}`, `{{circle}}`, `{{amount}}`, `{{date}}`, `{{teacher_name}}`.
- Finance placeholders are removed when the user lacks permission.

---

## 9. Reports / PDF Review

Existing report builder: `frontend/src/components/ManagementReportBuilder.tsx` (HTML print, 6 report kinds). It is functional but text-heavy and financial columns appear in some non-finance contexts.

Requirements:
- Generate a **sample PDF** of the existing reports first; review readability/print layout; only change after approval.
- Arabic RTL, Cairo font, print-safe colors, page headers/footers, no clipped tables, clear numbers.
- Reports:
  - School summary (respect finance permission).
  - Circle report (attendance + finance gated).
  - Teacher report (hours, attendance rate, notes, student counts; pay only with permission).
  - Teacher attendance summary (all teachers or scoped).
  - Student attendance summary (excused vs absent).
  - Student statement (subscription/payments only with finance).
  - New: supervision absences, teacher absences, unpaid list, requests.
- PDF via browser print (`window.print`) or a proper PDF library later; no server-side dependency unless approved.
- Add `reports.finance` and hide financial columns entirely when absent.
- Add filters (date range, circle, teacher), page numbers, generated-at Cairo time, and a “no data” line that is not a zero-money placeholder.
- **Two audiences:** `internal` (admin/secretary with finance) includes money, internal notes and management sections; `share` (guardian/teacher/public) excludes internal finance, internal notes and staff-only data. The existing `ReportAudience` type is the anchor; every report must render both variants deliberately.
- **Owner review gate:** generate a sample PDF of the current reports (internal + share) and show it before changing the layout. If the current layout is good, keep it; otherwise improve readability and print pagination.

---

## 10. Admin UX Overhaul

- Remove `v0.8.25.0` from the sidebar/footer and any user-facing version label; use the brand or build SHA in diagnostics only.
- Responsive navigation: PC sidebar + mobile bottom nav; no hidden-only-active nav; 44px targets.
- Consistent design tokens with the teacher/supervisor PWA; cards, tables → cards on mobile.
- Users: teacher link, lock, scope, permission bundles, self-password toggle; show linked teacher/lock state in the list.
- Students/teachers: notes, attendance, subscription links, WhatsApp.
- Notifications page; backup/system health card.
- Reports page with PDF sample.
- All money surfaces gated; no empty money cards.
- Confirm dialogs replaced by accessible sheets/dialogs where practical; clearer Arabic microcopy.
- Keep files under 400 lines; split by feature.

---

## 11. Phases and Order

Do not build everything at once. Each phase = code + tests + docs + commit/push.

| Phase | Scope | Gate |
|---|---|---|
| **A1. Visibility + guardrails** | financial UI gating, `account.password.self`, no early start, remove version label, clearer notes, teacher login memory | build + targeted tests + live smoke |
| **A2. Scope + supervision read models** | `app_user_scopes`, scoped student/circle/teacher lists, teacher detail, teacher/student notes, teacher absences, attendance pages | API tests + mobile/PC visual |
| **B. Teacher calendar/history/requests** | weekly calendar, history, absence/cancellation/correction requests, offline queue, supervisor tab permission | tests + PWA QA |
| **C. Admin notification center + requests review** | admin notifications page, request review, daily sync | tests + live |
| **D. WhatsApp + reports** | templates, sender, communication log, PDF sample/review, report additions | owner PDF approval + tests |
| **E. Admin/supervisor UI overhaul** | full responsive design, navigation, polish, accessibility | visual QA + E2E + release |

Start with **A1** because it is small, high-impact and prevents financial leakage. Then A2, B, C, D, E.

---

## 12. Commands (build / deploy / verify)

```powershell
dotnet build backend\DarEltahfeez.Api\DarEltahfeez.Api.csproj
dotnet build Dar.slnx
dotnet test Dar.slnx
npm run build --prefix frontend
npm run typecheck --prefix packages/api-client
```

```bash
# Migration (on the host, after a fresh backup)
cd /opt/dar
ConnectionStrings__Default="Host=127.0.0.1;Port=5432;Database=dareltahfeez;Username=dar_app;Password=..." \
  ASPNETCORE_ENVIRONMENT=Production \
  dotnet run --project src/Host/Dar.Api -- --migrate

# Backup
sudo systemctl start dar-backup.service
```

```bash
# Publish/deploy (host)
npm run build --prefix frontend
dotnet publish backend/DarEltahfeez.Api -c Release -o /opt/dar/app/legacy.new --no-self-contained
dotnet publish src/Host/Dar.Api -c Release -o /opt/dar/app/api.new --no-self-contained
sudo cp -a frontend/dist/. /opt/dar/app/legacy.new/wwwroot/
sudo systemctl stop dar-legacy dar-api
# swap old/new, chown dar:dar, start, smoke
```

```powershell
git add <files>; git commit -m "<phase>"; git push origin main
```

---

## 13. Open Decisions (defaults proposed)

1. **Supervisor vs secretary:** one workspace with permission bundles; secretary is a template, not a separate screen. Default: yes.
2. **Scope:** support both circle and teacher scope; no rows = all. Default: yes.
3. **Financial gate:** `finance.read` hides all money; `supervisor.unpaid`/`teacher.subscriptions.read` are separate. Default: yes.
4. **Early start:** block before scheduled start; late allowed until end of day, then record late. Default: yes.
5. **Notes after payroll lock:** admin only with reason; supervisor no after lock. Default: yes.
6. **WhatsApp:** `wa.me` deep links only; default country code +20; no paid API. Default: yes.
7. **Password:** `account.password.self` off by default; admin can grant or reset. Default: yes.
8. **Teacher login history:** last 5 login events + previous attendance sessions; no tokens. Default: yes.
9. **Request approval:** supervisor with `supervisor.attendance.requests` or admin; reason required. Default: yes.
10. **PDF:** produce a sample of existing reports before redesign; owner approves; internal and share variants. Default: yes.
11. **Supervisor student/circle CRUD:** default all add/edit/delete; admin can revoke each independently (add-only/edit-only/etc.). Default: yes.

If any default is wrong, the owner can change it before that phase starts.

---

## 14. What Is Missing Today

- Supervisor/secretary: student/circle/teacher lists, teacher detail, notes, absences, attendance and scope are implemented in A2 (pending live deploy). Still missing: requests, WhatsApp, admin notification page.
- Teacher: no weekly calendar, no history screen, no previous login/profile list, no absence/correction request, no offline queue.
- Financial UI is not fully gated in later report surfaces: report financial columns still need `reports.finance` (A1 covers teacher/supervisor money surfaces and payment notifications).
- No daily alert sync; unpaid notifications appear when the board is opened.
- Notes are readable but admin/supervisor editing during/after submission is not a first-class flow; A2 adds student/teacher note timelines for supervisors.
- A1 added `account.password.self`; later phases still need the full self-service/previous-login surface.
- No admin notification center; no WhatsApp sender.
- Reports are HTML print layouts; no PDF sample review.
- No production E2E for the new supervision flows.

---

## 15. What I Will Start With

**Phase A1** (small, high-value, low risk):

1. Financial visibility gating in the teacher/supervisor UI and APIs (hide, never zero).
2. `account.password.self` permission; admin-only password reset remains.
3. Server-side no-early-start guard with a clear Arabic message; late start still recorded.
4. Remove the version label from the admin UI.
5. Clearer finish/notes presentation and teacher login memory (last username/profiles) without storing tokens.
6. Tests for the above; commit/push; deploy; smoke.

Then Phase A2 (scope + supervision read models), then B/C/D/E as above.

No code from later phases will be mixed into A1.

---

## 16. Implementation Log

### A1 — Visibility + guardrails

Implemented:

- `database/018_supervision_permissions.sql`: seeds the A1–E permission catalog (student/circle CRUD, teacher calendar/history/requests, supervision requests/communication/reports, `account.password.self`, `reports.finance`) and supervisor/teacher role templates. Supervisor template defaults to all circle/student CRUD; every toggle can be revoked per user.
- `POST /api/v1/auth/change-password` behind `account.password.self`; verifies the current password, rejects reuse, bumps `session_version`, and signs the current session out.
- Financial gating: `teacher.earnings.self` hides the hourly rate and all pay amounts from `/teacher/today`, session start/end, and the teacher UI; `finance.read` hides `payableAmount` from supervisor live/adjust; a supervisor cannot set a manual amount without `finance.read`; payment-category notifications are filtered unless the viewer has `supervisor.unpaid`/`finance.read`/`users.manage`; `/supervisor/unpaid` uses the `unpaid.access` policy.
- No early start: `POST /teacher/sessions/start` returns 409 before the Cairo scheduled time, with the scheduled time in the message; late start remains allowed and recorded. `/teacher/today` exposes `canStart` and the UI disables early start.
- Teacher account screen with `account.password.self`; saved username profiles on the login screen (username only, never a password/token); account tab in the teacher/supervisor nav.
- Removed `v0.8.25.0` from the admin sidebar/footer.
- Fixed role routing so a supervisor-only account does not land on an empty teacher home and vice versa.

Verification (disposable PostgreSQL 17 + local API):

- All 18 migrations applied cleanly to an empty database; supervisor role resolved to 19 permissions.
- Login + `today` exposed `hourlyRate=50.00`, `canStart=false` for a slot two hours ahead.
- Early start returned `409` with the Cairo scheduled time.
- After removing `teacher.earnings.self`: `hourlyRate=null`, `/teacher/earnings` returned `403`.
- Change password returned `200`; the old cookie returned `401`, the old password `401`, and the new password `200`.
- Supervisor live returned `payableAmount=null` without `finance.read`; `/supervisor/unpaid` returned `403`; adjust with a manual amount returned `403`; adjust without an amount succeeded with `payableAmount=null`.
- After granting `supervisor.unpaid` + `finance.read`: `/supervisor/unpaid` returned `200`, and live returned `payableAmount=37.50` for the adjusted 45 minutes at 50/hour.
- Build: `dotnet build` 0 warnings/0 errors; `dotnet test` 16 unit + 5 integration passed; frontend `tsc -b && vite build` passed.

Deployed live on 17 Nov 2026:

- Pre/post backups `dar-20261117-010642.dump` and `dar-20261117-011725.dump` (214 TOC entries each).
- Migration 018 applied; ledger 18. Old artifacts retained at `api.old.20261117-011212` / `legacy.old.20261117-011212`.
- Live `supervisor` account granted the 13 new default supervision permissions (19 total); `account.password.self` and `finance.read` remain off.
- Smoke passed: ready/ping, `/`, `/teacher`, `/supervisor`, manifests, 401s, supervisor login + live + unpaid, change-password 403 without the permission, version label absent.
- See `docs/checkpoints/supervision-a1-deploy-1.0.md`.

### A2 — Scope + supervision read models

Implemented:

- `database/019_app_user_scopes.sql`: `(user_id, scope_type, scope_id)` with `circle`/`teacher`; no rows = all.
- `SupervisionScope.LoadAsync`: admin bypass via `users.manage`; circle scopes expand to teachers and teacher scopes expand to circles; both arrays are applied in every supervisor read model.
- Supervisor read APIs under `/api/v1/supervisor`:
  - `GET /students` (search, circle filter), `GET /students/{id}` (profile, circles, attendance summary/history, notes, scoped).
  - `GET /circles`, `GET /circles/{id}` (roster, schedule, recent sessions).
  - `GET /teachers`, `GET /teachers/{id}` (scheduled vs present rate, hours, overtime/undertime, circles, history, notes; pay/rate only with `finance.read`).
  - `POST /students/{id}/notes` and `POST /teachers/{id}/notes` with audit.
  - `GET /absences` now returns absent teachers after session end plus student absences, scoped.
  - `GET /attendance/teachers` and `GET /attendance/students` by date, scoped.
  - Admin scope API: `GET /supervisor/scopes`, `GET /supervisor/scopes/options`, `PUT /supervisor/scopes/{userId}` behind `users.manage`.
- Admin users list/access now carries `scopeCircleIds`/`scopeTeacherIds`; the user dialog has a scoped multi-select for circles/teachers. Empty scope = all. The access save is audited.
- Supervisor workspace tabs: live, absences, students, circles, teachers, attendance, unpaid (permission-gated). Student/teacher detail, notes timelines, attendance lists, mobile cards and a 2-column desktop list at ≥900px.
- Development Vite origin (`http://localhost:5173`) is allowed through `Security:AllowedOrigins` in `appsettings.Development.json`; production has no allowed extra origin.

Verified on a disposable PostgreSQL 17 database:

- All 19 migrations applied.
- All-scope supervisor saw 2 students/2 circles/2 teachers; circle-scoped saw 1/1/1; teacher-scoped saw only that teacher’s circle; out-of-scope detail/notes returned 404.
- Teacher detail: scheduled 8, present 2, rate 25%, 1.8 hours, 15 undertime; pay null without finance.
- Absences returned the missing teacher for the day; teacher/student attendance returned the expected rows.
- Student/teacher notes created and audited; admin scope PUT set all and restored a circle scope; non-admin got 403.
- Mobile (390×844) and desktop (1280×900) screenshots reviewed; no console errors beyond the expected pre-login 401s.
- Tests: 16 unit + 6 integration passing; frontend build passing.
