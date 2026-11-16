# Legacy Reuse Audit — Students, Attendance, Payroll, Collections

**Date:** 16 Nov 2026
**Scope:** read-only audit of the existing database, legacy API, and frontend before building the teacher portal.
**Goal:** reuse the working domain model; add only the teacher/supervisor/notification layer.

---

## 1. Verdict

Most of the required domain already exists. The teacher portal is a **scoped self-service layer**, not a new ERP.

Do **not** rebuild:

- students, teachers, circles, enrollments;
- schedule slots;
- teacher attendance/pay rows;
- student attendance;
- monthly charges, payments, receipts, collections;
- the audit log;
- the `MoneyRules` money math.

---

## 2. Existing Data Model

| Table | What it already does | Teacher portal reuse |
|---|---|---|
| `students` | identity, guardian, `joined_on`, status | roster and unpaid timing (`joined_on`) |
| `teachers` | `hourly_rate`, status, notes | login link + pay snapshot |
| `circles` | teacher assignment, monthly fee, schedule text | teacher’s circles |
| `circle_enrollments` | student ↔ circle, starts/ends, agreed fee, status | roster eligibility |
| `circle_schedule_slots` | day, start time, duration (15–360), active | “now/next” + start-session validation |
| `teacher_attendance` | `session_date`, `scheduled_start`, `duration_minutes`, `hourly_rate_snapshot`, `payable_amount`, status, substitute teacher, unique `(schedule_slot_id, session_date)` | final pay row for a completed teacher session |
| `student_attendance` | per-slot/date/enrollment `present`/`absent`/`excused`, note, active unique index | teacher roster writes |
| `monthly_charges` | one charge per enrollment/month, `amount_due` | unpaid/overdue list |
| `payments` | amount, date, method, reference, receipt bytes | collections; no new ledger |
| `collection_reports` | saved monthly snapshots | supervisor/admin reports |
| `audit_log` | append-only actor/action/before/after | every start/end/submit/correction |
| `teacher_notes` | historical notes per teacher | optional teacher follow-up |

### Schema constraints that matter

- `teacher_attendance.duration_minutes` and `MoneyRules.TryCalculateTeacherPayableAmount` both require **15–360 minutes**.
- `teacher_attendance` is unique per `(schedule_slot_id, session_date)`; the legacy POST already upserts.
- `student_attendance` is unique per active `(schedule_slot_id, session_date, enrollment_id)`.
- `monthly_charges` is unique per `(enrollment_id, billing_month)` and `billing_month` must be day 1.
- `payments.amount` must be **> 0**; reversals/voids must follow the existing non-destructive rules.
- `teachers.hourly_rate` is `NUMERIC(12,2)`; the attendance row stores a snapshot.

---

## 3. Existing API Surface (legacy `/api`)

| Area | Existing endpoints | Reuse |
|---|---|---|
| Schedule | `GET/POST /api/schedule-slots` | teacher “today”, start validation |
| Teacher attendance | `GET /api/teacher-attendance`, `POST /api/teacher-attendance`, `PUT /api/teacher-attendance/{id}/duration` | final pay row, duration correction, substitute support |
| Student attendance | `GET /api/student-attendance/roster`, `GET /api/student-attendance/session-summary`, `GET/POST /api/student-attendance` | roster + submit |
| Billing | `GET /api/finance-entry-options`, `GET /api/collections`, `POST /api/charges`, `PUT /api/charges/{id}`, `POST /api/payments`, `POST /api/payments/with-receipt` | unpaid list, payment history |
| People | students/teachers/circles/enrollments endpoints | scoped reads |
| Dashboard | summary/unpaid indicators | supervisor totals |
| Audit | append-only `audit_log` writes | teacher/supervisor actions |

**Important:** these endpoints use the existing permission bundles. A teacher account must **not** receive broad `students.read`, `finance.read`, or `attendance.edit`. Teacher/supervisor endpoints must filter by the authenticated user server-side.

### Teacher pay math

`MoneyRules.TryCalculateTeacherPayableAmount(hourlyRate, durationMinutes)` already does:

```text
payable = round(hourlyRate × durationMinutes / 60, 2, away from zero)
```

The sample’s `98 minutes × 100 / 60 = 163.33` matches this rule. Keep `MoneyRules`; do not add a second calculator.

---

## 4. Existing Frontend

| Page | Existing capability |
|---|---|
| `StudentsPage` | student list/create/update, history |
| `TeachersPage` | teacher list, hourly rate, notes |
| `CirclesPage` | circles, teacher/fee, enrollments |
| `SchedulePage` | schedule slots, teacher attendance, student attendance |
| `PaymentsPage` | charges, payments, receipts |
| `DashboardPage` | totals, unpaid/collection indicators |
| `ManagementReportBuilder` | management reports |
| `SystemPage` | users/roles/audit/backup controls |

The admin console remains desktop-first. The teacher portal is a separate mobile-first route.

---

## 5. What Must Be Added (Not Rebuilt)

1. `app_users.teacher_id` nullable unique FK + teacher permission bundle.
2. Supervisor role/permissions + admin lock state (session version / disabled flag).
3. `teacher_sessions` for timer/status/notes, linked to `teacher_attendance`.
4. Persistent `notifications` + `notification_reads` with dedupe and quiet hours.
5. Scoped `/api/v1/teacher/*` and `/api/v1/supervisor/*` endpoints.
6. Month lock/attendance approval for payroll.
7. Mobile-first `/teacher` PWA and responsive admin cards.
8. Tests for teacher scoping, session races, duration limits, notification dedupe, and lockout.

---

## 6. Conflicts and Risks Found

| # | Risk | Decision needed |
|---|---|---|
| R1 | **15-minute minimum.** A session shorter than 15 minutes cannot be stored or paid; longer than 360 minutes is also rejected. | Block ending too early, or add a migration/flow for short/cancelled sessions with 0 pay and a reason. Do not bypass silently. |
| R2 | **Timezone.** `session_date` is a `DATE`; the host is `Africa/Cairo`, but code must compute “today” explicitly in Cairo. | Use a single `Africa/Cairo` clock in the teacher/supervisor APIs; never rely on server UTC. |
| R3 | **Teacher identity.** `teacher_attendance.marked_by` points to `app_users`; teacher self-service must set it to the linked user, not null. | Add `app_users.teacher_id`; audit actor = user id. |
| R4 | **Roster statuses.** `student_attendance` supports `excused`, but the sample only shows present/absent. | Decide whether the teacher roster exposes “بعذر” now or later. |
| R5 | **Unpaid timing.** Charges are monthly (day 1) and `students.joined_on` exists; the alert rule is a view, not a new ledger. | Implement “month-end OR one month after join” as a query/filter; do not create duplicate charges. |
| R6 | **Payroll lock.** No month lock exists; earnings are calculated from attendance on the fly. | Add a lock table/flag and freeze teacher view after lock. |
| R7 | **Supervisor scope.** The role does not exist; existing permissions are broad. | Decide all circles vs assigned circles before the API. |
| R8 | **Notification persistence.** Only toast/browser alerts exist. | Add the tables and a dedupe key; do not send one row per render. |
| R9 | **Teacher account lock.** Admin can lock the supervisor; the same mechanism should cover a compromised teacher account. | Reuse `session_version` + an `is_disabled`/lock flag. |
| R10 | **Payment corrections.** `payments.amount > 0`; no negative rows. | Use reversal/void records, never delete or negate history. |

---

## 7. Implementation Order After Sample Approval

1. Migration: `app_users.teacher_id`, `teacher_sessions`, `notifications`, `notification_reads`, lock flag.
2. Resolve R1 (15-minute rule) and R5 (unpaid timing) explicitly.
3. Scoped teacher APIs: today, start, end, roster, submit, earnings.
4. Student attendance upsert through the existing unique index; link final `teacher_attendance` row.
5. Supervisor APIs: live, absences, unpaid, correction, lock.
6. Notification writer + read state + dedupe.
7. Teacher PWA and supervisor board; admin remains responsive.
8. Payroll lock/approval + reports; tests and review.

---

## 8. Evidence

- `database/001_initial_schema.sql` — students/teachers/circles/enrollments/charges/payments/audit.
- `database/003_schedule_attendance_ads_receipts.sql` — schedule, teacher attendance/pay, receipts.
- `database/006_student_attendance.sql` + `007_student_attendance_active_unique.sql` — student attendance.
- `database/009_teacher_notes.sql` — teacher notes.
- `database/014_financial_fk_restrict.sql` + `015_audit_log_append_only.sql` — financial/history protection.
- `backend/DarEltahfeez.Api/DomainEndpoints.ScheduleAttendance.cs` — attendance endpoints.
- `backend/DarEltahfeez.Api/DomainEndpoints.Collections.cs` — charges/payments/collections.
- `backend/DarEltahfeez.Api/MoneyRules.cs` — 2-decimal pay math and 15–360 limit.
- `frontend/src/pages/SchedulePage.tsx`, `PaymentsPage.tsx`, `StudentsPage.tsx`, `TeachersPage.tsx`, `CirclesPage.tsx`.
