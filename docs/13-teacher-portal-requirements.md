# RIGX Dar — Teacher Portal & Notification Requirements

**Status:** requirements captured and 5-screen sample created (16 Nov 2026). UI implementation is gated on owner approval of the sample (`docs/ui-sample/teacher-portal.html`).
**Scope:** teacher accounts, supervisor account, live attendance, student attendance, teacher earnings, mobile-first UI, notification center.

---

## 1. Product Goal

Make the daily teacher workflow possible from a phone in under a minute:

1. Teacher logs in with her own account (session remembered).
2. Her current circle appears first when its time is now.
3. She taps **تسجيل حضور** → the session timer starts.
4. When the circle ends, she taps **إنهاء الحلقة**.
5. The student roster opens; she marks present/absent and submits.
6. The system records teacher time, student attendance, and her earnings from the saved hourly-rate snapshot.

The admin/secretariat experience remains a responsive desktop-first console. The teacher experience is a dedicated mobile-first portal.

---

## 2. Roles

| Role | Scope | Main capabilities |
|---|---|---|
| **Admin** | whole Dar | everything, accounts, finance, settings, audit |
| **Supervisor (مشرفة)** | all circles/attendance (or assigned circles) | live sessions, attendance review/correction, absent/unpaid follow-up, teacher follow-up; no destructive finance unless granted |
| **Teacher (معلمة)** | only her circles | see her schedule, start/end session, mark her students, see her own earnings |
| **Secretary (existing)** | students/circles per permissions | unchanged |

### Account model

- Add `app_users.teacher_id` nullable, unique FK to `teachers(id)`.
- A teacher account is an `app_users` row linked to exactly one teacher.
- New permission bundle:
  - `teacher.portal`
  - `teacher.attendance` (scoped to own circles)
  - `teacher.earnings.self`
- Do **not** grant broad `students.read`, `attendance.edit`, or `finance.read` to teachers; the teacher endpoints filter by the linked `teacher_id` server-side.
- Supervisor: `supervisor.portal`, `attendance.review`, `attendance.edit`, `teachers.read`, `students.read` (scoped views); optional `finance.read` for unpaid follow-up.
- Every teacher/supervisor action is audited with the actor user id.

---

## 3. Teacher Portal — Screens & Flow

### 3.1 Login / session

- Same credentials/session as the platform, but a dedicated `/teacher` entry.
- “تذكّرني” uses the existing 30-day persistent cookie.
- After login, land directly on **اليوم**.
- If the account is not linked to a teacher, show a clear message and no data.

### 3.2 Home — “اليوم”

Order of cards:

1. **الحلقة الآن** — if `now` is between the slot start and end (with a small grace window), show it first with a live badge and a primary **تسجيل حضور** button.
2. **الحلقة القادمة** — next slot today with countdown.
3. **باقي اليوم** — timeline of her circles.
4. **تنبيهات** — unread count; absent/unpaid summaries are for supervisor/admin, not teacher.

Each card shows: circle name, time, duration, student count, teacher name, status (لم تبدأ / جارية / انتهت / لم تسجل).

### 3.3 Start session

- `POST /api/v1/teacher/sessions/start` with `scheduleSlotId` + `sessionDate`.
- Server:
  - verifies the slot belongs to the authenticated teacher (or a substitute assignment);
  - verifies date/time window and no open session for the same slot/date;
  - creates `teacher_sessions` row with `started_at=now()`, `status='in_progress'`.
- UI: card becomes “أنت الآن في الحلقة” with a live timer; button changes to **إنهاء الحلقة**.
- A second device sees the same open session; only one active session per teacher/slot/date.

### 3.4 End session + student attendance

- `POST /api/v1/teacher/sessions/{id}/end`:
  - sets `ended_at`, computes `duration_minutes` from the actual clock;
  - opens the roster step (does not finalize student attendance yet).
- Roster:
  - students eligible for the session date (enrollment active, circle start, enrollment lifecycle);
  - default state: all **حاضر** (fast path), with one-tap toggles for absent/excused;
  - “تحديد الكل حاضر” / “تحديد الكل غائب”;
  - search by name/code;
  - note per student optional.
- Submit:
  - transaction writes `teacher_attendance` (actual duration, snapshot rate, payable amount) and `student_attendance` rows;
  - marks session `completed`;
  - audit includes counts and duration;
  - returns session earnings and month-to-date earnings.
- If the teacher closes the app before submit: session stays `in_progress` or `awaiting_attendance`; home shows **أكمل تسجيل الطلاب**.
- Supervisor can correct/add attendance with a reason; corrections are audited.

### 3.5 Earnings

- Show per session: duration, hourly-rate snapshot, payable amount.
- Show month-to-date: sessions, hours, payable.
- Never expose another teacher’s earnings to a teacher account.
- Admin/payroll can lock a month later; teacher view becomes read-only.

### 3.6 Absence / late / cancellation

- Teacher can mark the session as **لم تنعقد** with a reason (optional supervisor approval).
- If a substitute teacher takes the session, the session records the substitute; original teacher does not get paid.
- Grace period and rounding policy must be decided (see open questions).

---

## 4. Supervisor Portal

- Live board: who is in a session now, who started late, who has not submitted attendance.
- Today’s absences: students marked absent/excused, by circle.
- Unpaid/overdue: students with balance > 0 for the current month; filters by circle/teacher/status.
- Teacher follow-up: sessions missing attendance, missing start, unusually short/long sessions.
- Attendance correction with mandatory reason; audit trail.
- No access to salaries/settings unless explicitly granted.

---

## 5. Notification Center

Replace the current mix of toast + browser notification + local reminder with a persistent, role-aware center.

### Categories

| Category | Audience | Trigger |
|---|---|---|
| **الحلقة الآن** | teacher | 10 minutes before / at start |
| **لم تسجل حضورًا** | teacher/supervisor | session started but no attendance submitted |
| **طالبة غائبة** | supervisor/admin | student marked absent/excused |
| **اشتراك غير مدفوع** | supervisor/admin (finance permission) | balance > 0 after due date |
| **حلقات بلا استحقاق** | admin | active enrollment without a monthly charge |
| **تغيير جدول** | teacher/supervisor | slot/circle change |
| **نظام** | admin | backup, security, errors |

### Behavior

- Persistent `notifications` table + per-user `notification_reads`.
- Unread badge in the header/bottom nav; “تحديد الكل كمقروء”.
- Filters by category/date; group by day.
- Quiet hours + sound on/off + duration; browser push opt-in only; in-app center always works.
- Deduplicate: one notification per student/session/day, not one per render.
- Role scoping: teacher sees her circles only; supervisor sees assigned/all; admin sees all.
- Absent/unpaid lists are also first-class screens, not only notifications.

### Remove

- Desktop auto-start toggle.
- “فحص الاتصال” and “إعداد الاتصال” controls.
- Any desktop-only wording from the web UI.

---

## 6. Mobile-First UI Direction

- **Teacher portal:** bottom navigation: `اليوم` / `الحلقات` / `الحضور` / `التنبيهات` / `حسابي`.
- Sticky top bar with brand + session state.
- Cards instead of tables; bottom sheets for roster/actions; large primary buttons.
- Touch targets ≥ 44px; safe-area insets; no hover-only actions.
- RTL + Cairo; dark/light themes; reduced motion respected.
- PWA: manifest, install prompt, offline shell, “أضف إلى الشاشة الرئيسية”.
- Admin console remains desktop-first but fully responsive; tables become cards or horizontally scrollable with a sticky first column on phones.

See `docs/14-ui-audit-and-mobile-direction.md` for the audit and design system.

---

## 7. Data Model Changes (proposed)

```sql
ALTER TABLE app_users ADD COLUMN teacher_id UUID NULL UNIQUE REFERENCES teachers(id) ON DELETE SET NULL;

CREATE TABLE teacher_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID NOT NULL REFERENCES teachers(id),
  circle_id UUID NOT NULL REFERENCES circles(id),
  schedule_slot_id UUID NULL REFERENCES circle_schedule_slots(id),
  session_date DATE NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'in_progress',
  duration_minutes INT NULL,
  note TEXT NULL,
  created_by UUID NULL REFERENCES app_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (schedule_slot_id, session_date)
);

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NULL REFERENCES app_users(id) ON DELETE CASCADE,
  role_scope VARCHAR(40) NULL,
  category VARCHAR(40) NOT NULL,
  title VARCHAR(200) NOT NULL,
  body TEXT NOT NULL,
  entity_type VARCHAR(60) NULL,
  entity_id UUID NULL,
  action_url TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NULL
);

CREATE TABLE notification_reads (
  notification_id UUID NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (notification_id, user_id)
);
```

`teacher_attendance` already has `duration_minutes`, `hourly_rate_snapshot`, `payable_amount`, and `status`; add `teacher_session_id` nullable FK so the session and payroll row are linked.

---

## 8. API Surface (proposed, `/api/v1`)

Teacher:
- `GET /teacher/me`
- `GET /teacher/today`
- `GET /teacher/circles`
- `POST /teacher/sessions/start`
- `POST /teacher/sessions/{id}/end`
- `GET /teacher/sessions/{id}/roster`
- `POST /teacher/sessions/{id}/attendance`
- `GET /teacher/earnings?month=YYYY-MM`

Supervisor:
- `GET /supervisor/live`
- `GET /supervisor/absences?date=...`
- `GET /supervisor/unpaid?month=...`
- `POST /supervisor/attendance/{id}/correct`

Notifications:
- `GET /notifications`
- `POST /notifications/{id}/read`
- `POST /notifications/read-all`

All endpoints derive the teacher from the authenticated session; never trust a client-supplied `teacherId`.

---

## 9. Core Gaps This Exposes

1. Teachers have no login accounts or user link today.
2. No supervisor role/permission bundle.
3. No live session table/timer; `teacher_attendance` is admin-entered.
4. Teacher endpoints would currently be over-privileged if given `attendance.edit`/`students.read`.
5. No notification persistence/read state; current alerts are local/toast/browser only.
6. No mobile-first teacher UI or PWA.
7. No absent/unpaid follow-up screens; data exists but is scattered.
8. No attendance approval/correction workflow.
9. No payroll lock; earnings are calculated from attendance on the fly.
10. No test coverage for teacher scoping, session races, or notification deduplication.

---

## 10. Owner Decisions (16 Nov 2026)

1. **Late start:** record the actual start and show “بدأت متأخرًا” with the delay. The owner can see it.
2. **Overtime:** if the session exceeds its scheduled end, show a clear “الوقت +” alert; allow the teacher to add notes. The owner sees the overtime and the note.
3. **Rounding:** minute-level duration is the default. Keep money at 2 decimals (`MoneyRules`). Do not round duration to 5-minute blocks; a 5-minute grace is only for the “late” warning, not for pay.
4. **Supervisor lock:** the admin can lock/unlock the supervisor account. A locked supervisor cannot sign in or act.
5. **Unpaid alerts:** surface at the end of the month, or one month after the student joins, whichever applies to the billing cycle.
6. **Timezone:** all UI and date logic use `Africa/Cairo`.
7. **Reuse:** extend the existing students/attendance/payroll/collections tables and endpoints; do not rebuild them.
8. **Password policy:** temporarily 6 characters per owner request; raise later with lockout/2FA.

## 10.1 Reuse Map — What Already Exists

| Need | Existing asset | Reuse plan |
|---|---|---|
| Students/roster | `students`, `circle_enrollments`, `circles` | read-only scoped queries for the teacher |
| Schedule | `circle_schedule_slots` | “now/next” cards + start-session validation |
| Student attendance | `student_attendance` (`present`/`absent`/`excused`) | teacher roster writes through a scoped API |
| Teacher pay | `teacher_attendance` (`duration_minutes`, `hourly_rate_snapshot`, `payable_amount`) | link to `teacher_sessions`, reuse money rules |
| Unpaid | `monthly_charges`, `payments`, `collections` | supervisor unpaid list/filter, no new ledger |
| Teacher summaries | `getTeacherPaySummary`, dashboard totals | teacher self-view + supervisor board |
| Audit | `audit_log` | every start/end/submit/correction |
| Auth/session | `app_users`, cookie sessions, session version | add `teacher_id` and a scoped role |

**Do not rebuild** the financial model. Add the teacher/session/notification layer around it.

## 10.2 Visual Sample

`docs/ui-sample/teacher-portal.html` is a static, interactive 390×844 phone frame with five screens:

1. **اليوم** — live circle first, next circle, month summary, rest-of-day timeline.
2. **الحلقة الجارية** — live timer, late badge, overtime alert, earnings, note action, finish button.
3. **حضور الطلاب** — search, present/absent toggles, bulk actions, sticky submit, success sheet.
4. **التنبيهات** — category filters, unread state, absent/unpaid/missing-attendance cards.
5. **لوحة المشرفة** — live sessions, absences, unpaid list, supervisor lock toggle, team report.

The sample encodes: late start, `الوقت +` alert with a note composer (the saved note also appears on the supervisor board), minute-level duration (98 minutes → 163.33 at 100/hour), 2-decimal money, dynamic roster counts and success sheet, notification category filters, supervisor lock by admin, unpaid timing, and `Africa/Cairo` labels. It is **not** connected to the API and makes no data changes.

**Approval state:** awaiting owner review. Do not start the teacher PWA or change the admin UI until approved.

## 10.3 Still Open

1. **Who approves** a teacher-submitted absence/cancellation: supervisor only, or admin too?
2. **Can a teacher edit attendance after submit?** If yes, for how long, and who approves?
3. **Supervisor scope:** all circles or assigned circles?
4. **Teacher earnings visibility:** current month only, or historical months too?
5. **Mobile app:** PWA only for now, or native app later?
6. **Password policy:** when to raise the minimum again.

---

## 11. Phased Delivery

| Phase | Deliverable | Gate |
|---|---|---|
| **P0** | min-6 password, remove auto-start/connection UI, deploy | build + smoke — ✅ |
| **P1** | requirements + visual sample (teacher home/live/roster/notifications/supervisor) | owner approval |
| **P2** | DB migration: teacher link, sessions, notifications; scoped APIs | tests |
| **P3** | Teacher PWA UI (mobile-first) | sample parity |
| **P4** | Supervisor dashboard + absent/unpaid | tests |
| **P5** | Notification center + dedupe/read state | tests |
| **P6** | Payroll lock/approval + reports | owner sign-off |
| **P7** | Full code review fixes + E2E | CI green |

UI implementation starts only after P1 approval.
