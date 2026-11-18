# RIGX Dar — DeepSeek Operating Manual

> هذا الملف هو أول ما يُقرأ وآخر ما يُحدّث في كل جلسة عمل.
> إذا تعارض أي شيء معه، فالمستندات الأحدث في `docs/` هي المرجع، ثم هذا الملف.

---

## 1. Read First

اقرأ بالترتيب:

1. `docs/07-gap-audit.md` — P0/P1/P2 الحالية.
2. `docs/01-business.md`
3. `docs/02-architecture.md`
4. `docs/03-security.md`
5. `docs/04-engineering-standards.md`
6. `docs/05-roadmap.md`
7. `docs/06-operations.md`
8. `docs/08-testing.md`
9. آخر ملف في `docs/checkpoints/`

ثم افحص الكود ذي الصلة فقط. لا تقرأ المشروع كله في كل مرة.

---

## 2. What This Project Is

نظام إداري إنتاجي لدار تعليمية/تحفيظ:

- سكرتارية وملفات.
- طالبات وأولياء أمور ومعلمات.
- حلقات ومستويات وجدول.
- حضور طالبات ومعلمات.
- أجر معلمات بالساعة/الحصة + مسير + قسائم.
- اشتراكات طالبات + مدفوعات + إيصالات + متأخرات.
- خزنة ومصروفات ودفتر قيود.
- تقارير ولوحة.

**Scope:** إداري/مالي فقط — ليس منصة تعليمية (LMS). لا مناهج/محتوى/امتحانات إلكترونية في MVP.

**Domain:** `darelemamhaf.rigxhardware.com`
**Backend:** .NET 10 / ASP.NET Core minimal API + Npgsql + Dapper
**Frontend:** Next.js 16 + React 19
**Database:** PostgreSQL 17+ على نفس السيرفر
**Auth:** Email OTP + Google (Google deferred)؛ كلمة مرور/جلسة مؤقتة الآن، بدون SMS
**Language:** عربي + إنجليزي
**Deploy:** Ubuntu 24.04 + Docker Compose + Caddy + Cloudflare

**الهدف النهائي:** تسليم النظام كاملًا على **host + domain** إنتاجي مع HTTPS ونسخ احتياطي ومراقبة — وليس مجرد بناء محلي أو Demo. أي مرحلة لا تُعد مكتملة إلا إذا كانت قابلة للنشر ضمن هذا المسار.

---

## 3. Current State

- **Phase 0.1:** Docs + Skill — ✅ done.
- **Phase 0.2:** Intake existing project — ✅ done. Project at `DarEltahfeez/`.
- **Phase 0.3:** Baseline build/run — ✅ partial (screenshots pending).
- **Phase 0.4:** Audit — ✅ done. See `docs/07-gap-audit.md`.
- **Phase 0.6:** Legacy docs consolidation — ✅ done (old folder archived).
- **Phase 1.1:** P0 fixes — 🟡 partial (rate limit, login audit, headers, financial purge guard).
- **Phase 1.2:** `.bat` removal — ✅ done (12 files; backup + direct PowerShell commands).
- **Phase 2.1:** New .NET solution — ✅ done (`Dar.slnx`, Host, Common, tests, 0 warnings).
- **Phase 2.3:** Identity — 🟡 first slice done (Email OTP, Google path, password fallback, sessions, logout; SMTP/Google config pending).
- **Phase 2.4:** Migration runner — ✅ done (checksums, advisory lock, 13 migrations, idempotent).
- **Phase 2.5:** OpenAPI + generated TS client — ✅ done (12 paths, 10 schemas, `openapi-typescript` + `openapi-fetch`, typecheck passes).
- **Phase 2.6:** CI baseline — ✅ workflow builds legacy + new solution, runs tests, frontend/api-client, security scans, and Compose validation. First GitHub Actions run still needs verification.
- **Phase 3.1:** Secretariat — 🟡 students list/get/create done.
- **Phase 1.5.1:** Legacy backend split — 🟡 `DomainEndpoints` fully split (13 files, max 376); `SystemAdminEndpoints` partial (main 304 + Export/Trash/Helpers); Test Center GUI archived.
- **Phase 1.5.2:** Frontend split — ✅ `useDarApplication` 889 → **363 lines**; `SystemAdminView` 456 → **307 lines** with `src/system/*`. All frontend files under 400.
- **Phase 1.6:** Full code review — ✅ `docs/10-code-review.md` written. P0 fixes verified: purge cascade blocked end-to-end (migration 014 + FK RESTRICT + API 409); audit log append-only (migration 015); financial/attendance restore disabled (descriptive fields only).
- **Phase 1.7:** Auth hardening — ✅ session revocation (`016_session_version.sql`), setup token/loopback bootstrap, same-origin guard, forwarded headers; verified on disposable PostgreSQL 17.
- **Phase 1.7.1:** Trash permissions + OTP pepper — ✅ per-entity trash checks (limited `trash.manage` user gets 403 for financial/student operations); OTP pepper now fails closed outside Development; all 10 legacy `MapDelete` endpoints removed.
- **Phase 1.8:** Host + domain deployment stack — ✅ `deploy/` Dockerfiles + Compose + Caddy; images built and local stack smoke-tested (16 migrations, both APIs healthy). Cross-platform backup path + `pg_dump` support added. Legacy live/ready health, last-admin guard, and per-email OTP throttle added.
- **Phase 1.9:** Frontend Vitest — ✅ 7 selector tests; `npm test` in CI.
- **Phase 1.10:** Live deployment — ✅ Contabo VPS `31.220.76.171` is live at **https://dar-elemam-hafs.rigxhardware.com** on **Nginx + Certbot + systemd + host PostgreSQL 17 + .NET 10**; 16 migrations restored, both APIs healthy, admin login verified, first backup created. Docker/Caddy stack retired; volumes retained.
- **Phase 1.11:** Host hardening — ✅ UFW, key-only SSH, fail2ban, unattended upgrades, Certbot certificate, daily backup timer. Cloudflare DNS-01 renewal works (dry-run passed); GitHub deploy key added and `/opt/dar` tracks `origin/main` (`git pull` verified). Admin password rotated and temporary file deleted. Google Drive offsite backup configured and restore-tested (local + remote 30-day retention). Pending: dedicated rclone OAuth client ID + Cloudflare token rotation.
- **Phase 1.12:** Teacher portal requirements — ✅ captured in `docs/13-teacher-portal-requirements.md` + `docs/14-ui-audit-and-mobile-direction.md`; 5-screen interactive sample at `docs/ui-sample/teacher-portal.html`. Password minimum lowered to 6 (owner request); desktop auto-start/connection controls removed. Sample approved with modifications; implementation in Phase 1.14.
- **Phase 1.13:** Legacy reuse audit — ✅ `docs/15-legacy-reuse-audit.md` confirms students, schedule, teacher/student attendance, payroll math, charges/payments/receipts/collections, and the audit log already exist. Reuse them; do not rebuild. P0 decisions: 15-minute minimum, explicit `Africa/Cairo` date handling, and `app_users.teacher_id`.
- **Phase 1.14:** Teacher/supervisor portal — ✅ live first slice. Migration `017_teacher_portal.sql` (teacher link, lock, sessions, notifications, payment trigger, 1–360 pay rule); `Dar.Modules.Teaching` APIs (`/api/v1/teacher/*`, `/api/v1/supervisor/*`, `/api/v1/notifications`); mobile PWA at `/teacher` and `/supervisor`; admin user dialog supports teacher link, lock, and the new permission bundles. Verified against a disposable PostgreSQL copy: start/end, scheduled pay cap (90 actual/60 scheduled → 100.00), early end (1-minute minimum), roster, submit, earnings, subscriptions, notification read/resolve, payment trigger, supervisor live/absences/unpaid/adjust, lock. Live deploy completed; `/teacher` + `/supervisor` return 200. Temporary `supervisor` account created (password file `/etc/dar/supervisor-initial-password`; change + delete). Teacher records/link + payroll lock pending.
- **Phase 1.15:** CI fix — ✅ added `workflow_dispatch`, migration job on PostgreSQL 17 with clean-schema verification, deploy-script syntax check, built-in tracked-file secret scan, and pinned API-client TypeScript to 5.7 for reproducible generation. GitHub Actions still needs the owner to enable/verify the first run.
- **Phase 1.16:** Supervision workspace + communications plan — ✅ captured in `docs/16-supervision-workspace-plan.md` (owner approved all suggestions). Scope: scoped supervisor/secretary workspace, teacher detail/rate/hours/notes, student/teacher notes, teacher absences, absence/cancellation/correction requests, admin notification center, WhatsApp sender (`wa.me`), weekly teacher calendar/history/login, offline queue, PDF/report review, financial UI gating, self-password permission, no-early-start, version label removal, full admin/supervisor responsive UI. Phases A1 → E. A1 is live; A2 starts next.
- **Phase 1.17:** Supervision A1 — ✅ live. Commit `b50fd94`; migration 018 applied (ledger 18); API + legacy SPA swapped at 2026-11-17 01:12. `018_supervision_permissions.sql` seeds the student/circle CRUD, teacher calendar/history/requests, supervision requests/communication/reports, `reports.finance` and `account.password.self` catalog; supervisor defaults to all student/circle CRUD with per-permission revocation. Added `POST /api/v1/auth/change-password` (`account.password.self`, current-password check, reuse rejection, session version bump + sign-out). Financial gating: teacher rate/pay hidden without `teacher.earnings.self`, supervisor pay hidden without `finance.read`, manual pay requires `finance.read`, payment notifications filtered, `/supervisor/unpaid` uses `unpaid.access`. Early start returns 409 until the Cairo schedule time; `canStart` drives the UI. Added the teacher account page, saved username profiles on login (no passwords/tokens), account nav tab, and removed `v0.8.25.0`. Locally verified: 18 migrations, 409 early start, `hourlyRate=null`/403 earnings without permission, password change 200 + old cookie/password 401 + new password 200, supervisor unpaid 403→200 and manual amount 403, live `payableAmount` null→37.50 after finance. Live: pre/post backups (214 TOC), supervisor granted 13 new defaults (19 total), smoke passed (`/health/ready`, `/`, `/teacher`, `/supervisor`, supervisor login/live/unpaid, change-password 403 without grant, no version label). See `docs/checkpoints/supervision-a1-deploy-1.0.md`.
- **Phase 1.18:** Supervision A2 — ✅ live. Commit `f27a3f9`; migration 019 applied (ledger 19); API + legacy SPA swapped 2026-11-17 02:43. Migration `019_app_user_scopes.sql` adds circle/teacher scope (no rows = all). New supervisor read APIs: scoped students list/detail, circles list/detail, teachers list/detail (scheduled vs present rate, hours, overtime/undertime, history, notes; pay/rate only with `finance.read`), student/teacher notes with audit, absences with absent teachers, teacher/student attendance by date, and admin scope list/options/set behind `users.manage`. Admin user access saves scope arrays and the user dialog has a circle/teacher multi-select. Supervisor UI adds tabs for live, absences, students, circles, teachers, attendance, and unpaid with detail pages and mobile/desktop layouts. Dev Vite origin allowed via `Security:AllowedOrigins` (production none). Verified on disposable PostgreSQL 17 and live: 19 migrations, all/circle/teacher scopes, out-of-scope 404, teacher rate/hours, absences, attendance, notes, admin scope PUT, non-admin 403, mobile (390×844) + desktop (1280×900) visual QA. Pre/post backups 214/220 TOC. Tests 16 unit + 6 integration; frontend build passes. Next: A3 requests/notifications/WhatsApp.
- **Phase 1.19:** E1 supervisor workspace overhaul — ✅ live. Commit `b2eac18`; frontend static only, no migration, deployed 2026-11-17. Replaced the narrow supervisor board with a full desktop shell (right sidebar, topbar, KPI dashboard, two-column panels, professional tables) and a mobile shell (compact topbar with title, five-item bottom nav, more sheet). Widened teacher pages to 860px on desktop. Added a safe built-in demo mode (`?demo=1` or “عرض نموذج بالبيانات”) with 8 students, 4 circles, 3 teachers, live sessions, absences, attendance, notes and unpaid examples; no database writes, clear banner, real data returns when disabled. Preserved the adjust-time sheet on the overview. Added a real empty-state demo CTA. Removed old `SupervisorBoard`. Live verified at 1440×1000 and 390×844; frontend build passes. See `docs/checkpoints/supervisor-workspace-e1-1.0.md`.
- **Phase 1.20:** F1 owner feedback — ✅ live. Commit `22f55fb`; API + frontend deployed 2026-11-17. Unpaid amounts are hidden without `finance.read` (list still shows who is late and `partial/unpaid`); payment notification bodies no longer include amounts; student detail shows subscription status only without amounts; added supervisor teacher-notes feed (session + per-student notes); added a PC right-side notification drawer / mobile full-screen sheet; removed the supervisor item from `TeacherNav`; enriched teacher home with quick links; fixed LTR phone alignment. Verified with a 250 charge + 125 payment: no-finance sees no amounts, finance sees 250/125/125. Pre-deploy backup `dar-20261117-074409.dump`; live smoke passed. Queued admin charge/payment audit, admin teacher-notes feed, and admin-wide audit without changing them now.
- **Phase 1.21:** A3.1 WhatsApp follow-up links — ✅ live (commit `72e312d`). Added `wa.me` links for supervisor absences (teacher/guardian), unpaid guardian, student detail guardian and teacher detail. Phone normalization defaults to Egypt +20; no paid API. `/supervisor/unpaid` now returns `guardianPhone`. Templates and communication log remain A3.2.
- **Phase 1.22:** A3.2 backend foundation + second review — 🟡 working tree only, not deployed. Added migration 020 (`attendance_requests`, notification scope columns, `communication_log`, request default grants); teacher request create/list/cancel and supervisor list/review endpoints with approval applying attendance rows/corrections and audit; `NotificationSyncService` replaces notification writes from `GET /unpaid`; scope filters added to unpaid, adjust, student subscription, and notifications list/read/read-all/resolve; teacher-notes kind filter moved into SQL before LIMIT. Backend builds 0 warnings. Remaining: request UI, `supervisor.communication` server-verified WhatsApp endpoint/buttons, integration tests, migration 020 + deploy, admin 502 investigation.
- **Queued owner tasks (recorded, not started):** homepage `/` with account entry + admin at `/management`; settings-controlled WhatsApp templates and visibility of messages above teacher notes; full teacher UI parity on all devices; admin console UI redesign and admin teacher-notes/notification pages; full project file/folder refactor (OOP, split large files); admin permissions 502 diagnosis; admin 250/125 charge-payment UI audit; admin-wide audit; subscription status in supervisor list; payroll lock; production E2E; GitHub Actions.
- **Phase 1.23:** Supervisor context navigation F2 — ✅ live. Teacher detail ↔ circle detail, student detail → circle, attendance/absences teacher+circle links, visible pill/↗ link styling and focus-consumption. Frontend-only; PC 1440×1000 verified live. See `docs/checkpoints/supervisor-context-navigation-f2-1.0.md`.
- **Phase 1.24:** A3.2 requests + scope hardening — ✅ live. Commit `4c0d98c`; migration 020 applied (ledger 20). Teacher/supervisor request UI + backend, approval applies attendance/correction, notifications, scope filters on unpaid/adjust/student subscription/notifications, SQL kind filter before LIMIT, unpaid notification sync service. Secure communication endpoint deployed but UI buttons still direct links. Pre/post backups `dar-20261117-210547.dump` / `dar-20261117-211434.dump` (237 TOC). See `docs/checkpoints/supervision-a32-requests-1.0.md`.
- **Phase 1.25:** Secure WhatsApp wiring — ✅ live (commit `79c41a7`). All supervisor WhatsApp buttons now call `POST /api/v1/supervisor/communications/whatsapp`; server enforces `supervisor.communication` + scope, builds the `wa.me` href and writes `communication_log`. Buttons hide without the permission. Teacher/guardian and unpaid links covered. Live smoke: teacher + student guardian returned `https://wa.me/20...`, 2 log rows. Post-deploy backup `dar-20261117-231837.dump`.
- **Phase 1.26:** Public homepage + `/management` — ✅ live. `/` renders a branded public homepage with entry cards for management, teacher and supervisor; the admin SPA moved to `/management`. Frontend-only; live verified `/`, `/management`, `/teacher`, `/supervisor` 200. See `docs/checkpoints/public-homepage-management-1.0.md`.
- **Phase 1.27:** Permanent integration tests — ✅ committed (`156ad69`). `tests/Dar.IntegrationTests/Supervision/` adds a Testcontainers `postgres:17` fixture that applies every migration and seeds two circles/teachers, students/enrollments, charges/payments, slots, attendance, scoped supervisor accounts and scoped notifications, plus 7 access tests: unpaid finance/scope, out-of-scope adjust 403, notification list/read scope, scoped student subscription, notes-kind filter before LIMIT, request approval (75 min → 62.50 at 50/hour), and communication permission + `wa.me`. Current suite: **16 unit + 15 integration passing**.
- **Phase 1.28:** Settings-controlled WhatsApp templates + notes banner — ✅ live (commit `fcbf864`, migration **021**, ledger 21). Admin settings edits the four WhatsApp templates (`{name}`, `{circle}`, `{brand}`) and the supervisor notes banner text/visibility. `CommunicationEndpoint` renders saved templates with defaults; `teacher-notes` returns `banner`; supervisor PC/mobile show a gold bar. Tests 16 unit + 15 integration. Verified live; pre/post backups `dar-20261118-001645.dump` / `dar-20261118-002144.dump`. See `docs/checkpoints/communication-templates-1.0.md`.
- **Phase 1.29:** Charge suggestion fix + template defaults reset — ✅ live (commit `7d43ff8`, frontend only). Monthly-charge suggestion now uses the agreed enrollment fee (`agreed_monthly_fee`) instead of prorating by active days; the old logic produced 108.33/116.67/125 for a 250 circle. `ChargeDialog` shows the agreed fee and a reset link. Admin settings gained “إعادة القوالب الافتراضية” for the four WhatsApp templates. Vitest 6/6 passing.
- **Phase 1.30:** Admin notifications/teacher-notes + teacher PC layout — ✅ live (commit `ba7b1d4`, no migration). Admin nav has **الإشعارات** and **ملاحظات المعلمات** with legacy endpoints (`/api/admin/notifications`, `/api/admin/teacher-notes`), read/read-all/resolve, category/kind/teacher filters, PC tables and mobile cards, and the published notes banner. Teacher portal removed the 520/860px centered tablet frame, added a right sidebar on PC, kept the bottom nav on mobile, widened pages and added desktop grids/typography. Mobile admin nav is a horizontal strip with all sections reachable. Local QA on disposable PostgreSQL 17 + legacy API + Vite passed for admin PC/mobile and teacher PC/mobile. Pre/post backups `dar-20261118-021510.dump` / `dar-20261118-022142.dump`. See `docs/checkpoints/admin-notifications-teacher-layout-1.0.md`.
- **Owner review backlog (18 Nov 2026):** full subscriptions/collections review, admin schedule + teacher-attendance lists review, admin console-wide review, file/OOP refactor. Live read-only audit found 9 trial-student charges for 2026-11 at 125.00/116.67 against 250.00 agreed fees (old proration); correction needs owner approval. Cloudflare beacon script is expected. See `docs/16-supervision-workspace-plan.md`.
- **Queued owner tasks (recorded, not started):** full admin UI parity/redesign; remaining teacher UI parity pages; file/folder/OOP refactor; admin 250/125 charge-payment UI audit; admin-wide audit; subscription status in supervisor list; payroll lock; production E2E; GitHub Actions. Admin 502 fixed via Nginx proxy buffers.
- **UI gate:** no UI implementation before the owner approves a visual sample.
- **Backend decision:** ✅ .NET is final (owner, 15 Nov 2026). TypeScript/NestJS is rejected; do not propose or build a second backend.
- **Google login:** deferred; temporary password + sessions is the current path.
- **Git:** `origin` = `https://github.com/Abdalmlek56M/darelemamhafs.git`; `main` is the source of truth. Run `git log -1` for the deployed commit; the visual sample and reuse audit are included.
- **Git rule:** every completed checkpoint = commit + push. No force-push.
- **Next:** deploy the admin notifications/teacher-notes pages and teacher PC layout, then start the subscriptions/collections full review (historical prorated charges first) and the admin schedule/attendance audit. Communication templates/notes banner live (`fcbf864`, migration 021); charge suggestion + template reset live (`7d43ff8`). A3.2 live (`79c41a7`), F2 live (`d9be7ee`), F1 live (`22f55fb`), homepage/`/management` live (`336d72b`). Keep teacher account creation/linking and the supervisor temporary-password change/delete in the owner’s admin workflow. Offsite backup is complete.
- **Legacy stack:** .NET 10 minimal API + React 19/Vite + PostgreSQL 17 + WPF/WebView2 + PowerShell Test Center. No `.bat` files remain.

### What Was Done vs. What Was Not

**Legacy code modified (P0 guards only):**
- `Program.cs` — rate limit, security headers, auto-migrate gate.
- `AuthEndpoints.cs` — login rate limit + login audit.
- `SystemAdminEndpoints.cs` — block permanent purge of financial/history records.
- `SystemAdminService.cs` — financial purge guard.
- Deleted all 12 `.bat` files; added `database/013_auth_email_otp.sql`.
- **Not touched:** `DomainEndpoints.cs`, the legacy frontend, WPF host, business logic.

**New code added (parallel foundation):**
- `Dar.slnx`, `src/Host/Dar.Api`, `src/Common/Dar.Common`.
- `src/Modules/Identity` (Email OTP, password fallback, sessions, logout, set email).
- `src/Modules/Secretariat` (students list/get/create, paged search).
- `tests/Dar.UnitTests`, `tests/Dar.IntegrationTests`.
- `docs/`, `README.md`, `.gitattributes`.

**Not done yet:**
- The legacy 1,680-line `DomainEndpoints.cs` is not split.
- The legacy frontend is not migrated to Next.js.
- The new API covers only Identity + Students; teachers/circles/attendance/finance/reports are still legacy.
- The .NET vs TypeScript final decision is unresolved.
- **Current code:** 11 C# files, 3 giant endpoint files, 874-line frontend hook, 12 migrations, 25 tables.
- **Migration:** Strangler, not big-bang. Legacy stays runnable until replacement passes.
- **Old docs:** read, extracted into `docs/`; replace after migration.
- **Auth:** resolved — Email OTP + Google (temporary password fallback during migration).
- **Language:** resolved — Arabic + English.
- **DB:** resolved — PostgreSQL on the same server; one `public` schema initially.
- **Data access:** resolved — Npgsql + Dapper, not EF Core.
- **Tests:** resolved — projects inside the solution, not a separate app.

---

## 4. Golden Rules

1. **Production-grade, not demo.**
2. **No secrets** in code/docs/logs/Git.
3. **No deletion** of financial/history records. Reversal/void only.
4. **No destructive DB commands** without backup + approval.
5. **No auto Git repo creation.**
6. **No paid API/credits** without approval.
7. **Server-side authorization** always.
8. **Money = decimal/numeric.** Never float. API returns strings when needed.
9. **Every financial mutation:** transaction + idempotency + audit.
10. **No `.bat` files.**
11. **UI sample gate:** before any UI implementation, produce a visual sample and get owner approval.
12. **No behavior change during a legacy split.** Build after each slice; no route/SQL/response changes.
13. **Arabic RTL first.**
14. **Tests are isolated.** Separate DB/environment. No Test Panel/Test Routes in production.
15. **No blind rewrite.** Audit first, then Strangler.
16. **Every step = docs + checkpoint.**
17. **If a business decision is missing: stop and ask.** Do not invent.

---

## 5. Workflow For Every Session

1. Read `deepseek.md`.
2. Read the latest checkpoint.
3. Read the roadmap step.
4. Inspect only the relevant code.
5. State assumptions if anything is ambiguous.
6. Implement the smallest correct slice.
7. Split by feature folder / use case file; never one giant service.
8. Keep new files within 200–300 lines; hard max 400. Split legacy files before adding features.
9. Keep tests in `tests/` projects, never a separate test app or product panel.
10. Run targeted tests while working.
11. Run the full relevant suite before finishing.
12. Update docs + checkpoint + roadmap.
13. Commit small, focused changes; push to `origin/main` after every checkpoint.
14. Report: what changed, tests, risks, next step.

**Work order:** one roadmap step at a time. No random branching, no unrelated refactors, no parallel features.

**Do not:**
- Start multiple unrelated features.
- Refactor outside the current step.
- Run destructive commands.
- Add dependencies without reason.
- Leave TODO in a financial path.
- Skip tests because "it's simple".

---

## 6. Commands

> الأوامر الحالية للمشروع الجديد. لا تخترع أوامر غير موجودة.

### Backend
```bash
dotnet build Dar.slnx
dotnet test Dar.slnx
dotnet run --project src/Host/Dar.Api
dotnet run --project src/Host/Dar.Api -- --migrate
```

### Frontend
```bash
npm install
npm run dev
npm run build
npm run typecheck
npm run lint
npm run test
```

### Full
```bash
docker compose up -d postgres
docker compose up -d
```

### Git
```bash
git status
git add <paths>
git commit -m "area: summary"
git push origin main
```

Remote: `https://github.com/Abdalmlek56M/darelemamhafs.git`

### Pre-Push Build Gate (mandatory)

**الغرض:** التأكد أن الملفات المرفوعة سليمة ومترابطة، وأن أي كسر أو خطأ يظهر قبل الـPush — وليس تنفيذ Build كطقس شكلي.

Before **every** commit/push:

```bash
dotnet build backend/DarEltahfeez.Api/DarEltahfeez.Api.csproj
dotnet build Dar.slnx
dotnet test Dar.slnx
npm run build --prefix frontend
```

When `apps/web` exists, run its build too:

```bash
npm run build --prefix apps/web
```

Rules:

- If any build or test fails: **do not commit, do not push.**
- Record the build/test result in the checkpoint.
- Never push generated output, `node_modules`, `bin`, `obj`, `dist`, or secrets.
- Every completed phase gets its own commit; do not mix unrelated phases.
- Push `origin/main` after each completed phase.
- No force-push or shared-history rewrite.

**لا `.bat`.**
**لا تشغيل migrations على الإنتاج بدون نسخة.**
**كل Checkpoint مكتمل = Build + Commit + Push.**
**لا force-push ولا إعادة كتابة تاريخ مشترك.**

---

## 7. Docs & Checkpoints

| File | Purpose |
|---|---|
| `docs/01-business.md` | المجال والقواعد |
| `docs/02-architecture.md` | الحالة الحالية + المستهدفة |
| `docs/03-security.md` | الأمان |
| `docs/04-engineering-standards.md` | معايير الكود |
| `docs/05-roadmap.md` | الخطوات |
| `docs/06-operations.md` | التشغيل والنشر |
| `docs/07-gap-audit.md` | نتائج الفحص |
| `docs/08-testing.md` | الاختبارات |
| `docs/09-legacy-refactor-plan.md` | خطة تفكيك الملفات القديمة |
| `docs/checkpoints/*.md` | Done / Uncommitted / Remaining / Decisions |
| `docs/checkpoints/README.md` | Ordered checkpoint index and next steps |

### Checkpoint format
```md
# Checkpoint: Phase X.Y — Name

Date: DD Mon YYYY

## Done
- ...

## Uncommitted
- ...

## Remaining
- ...

## Decisions
- ...
```

**Rule:** لا تُعتبر خطوة منجزة بدون Checkpoint.

---

## 8. Testing Separation

- Tests are **projects inside the solution** (`tests/Unit`, `tests/Integration`, `tests/Contract`, `tests/E2E`), not a separate application.
- Tests use a separate PostgreSQL database (`dar_test`) or Testcontainers.
- Never use production connection strings.
- E2E runs against a dedicated test/staging environment.
- No test routes, test users, or test panels in production.
- Test data is deterministic and isolated.
- Full details: `docs/08-testing.md`.

---

## 9. Definition of Done

- [ ] Build passes.
- [ ] Tests pass.
- [ ] No secrets.
- [ ] No `.bat`.
- [ ] Auth/RBAC negative tests.
- [ ] Financial flow matches business rules.
- [ ] Audit log.
- [ ] Docs + checkpoint updated.
- [ ] No P0/P1.
- [ ] Arabic RTL + accessibility.
- [ ] Backup/restore unaffected.

---

## 10. Open Decisions

**Resolved:**
- Auth: Email OTP + Google فقط.
- Language: عربي + إنجليزي.
- DB: PostgreSQL على نفس السيرفر.
- Tests: مشاريع داخل الحل، وليست تطبيقًا منفصلًا.
- Data access: Npgsql + Dapper.
- Schema: `public` واحد في البداية.

**Resolved / deferred:**
1. **D-01:** المالك لا يعرف مواعيد الدار شخصيًا. لا نخترع أوقاتًا. مستند القبول القديم يسجل `07:00/10:00/11:00`؛ نتحقق من الإنتاج أولًا، وأي تعديل يحتاج Preflight + Backup. الافتراضي: لا تغيير على الإنتاج، ونعمل على نسخة.
2. **D-04:** إيميلات مانويل + Google؛ Password Fallback مؤقتًا. بيانات الدخول لا تُكتب في أي ملف.

**Pending (non-blocking):**
3. سياسة خصم أيام الإيقاف وسط الشهر.
4. مزود البريد/واتساب.
5. Step-up scope.
6. Double-entry ledger from day one?
7. أولوية الإطلاق: الأجور أم مالية الطالبات؟ — بعد Audit.
8. أكثر من فرع؟
9. بيانات قديمة تحتاج استيراد؟
10. GitHub remote URL + `gh auth login` للـpush.

**Resolved:**
- Backend: .NET final. TypeScript rejected.
- Google: deferred. Password + session is the current path.
- File size: 200–300 target, 400 hard max; legacy exceptions listed in `docs/04-engineering-standards.md`.

---

## 11. Update Protocol

- غيّر قرارًا معماريًا → ADR + `docs/02` + هذا الملف.
- غيّر قاعدة مالية → `docs/01` + اختبارات + موافقة.
- غيّر صلاحية → `docs/03` + اختبارات سلبية.
- غيّر نشرًا → `docs/06`.
- أنهيت خطوة → Checkpoint + `docs/05`.
- إذا شككت → توقف واسأل.
- رد بالعربية المصرية، مختصر وواضح.
