# RIGX Dar — Architecture

**Status:** Current state (27 Nov 2026 — after hardening batch) + architectural principles.
**Scope:** Shape, modules, data, API, frontend, deployment, decisions.
**Source of truth:** `docs/00-current-state.md` — يحدد الحالة الآن. هذا الملف يشرح **الشكل والسبب**؛ وأي تعارض يُحسم لصالح `docs/00`.
**Related:** `docs/17-master-plan.md` (الخطة)، `docs/23-hardening-plan.md` + `docs/OVERNIGHT-REPORT.md` (التحصين)، `docs/adr/*` (الفهرس: `docs/adr/README.md`).

---

## 1. Shape of the System

### Current

```
frontend/                 React 19 + Vite SPA — homepage + admin + teacher/supervisor PWA (82 ts + 98 tsx)
backend/DarEltahfeez.Api  ASP.NET Core 10 minimal API — legacy domain/admin APIs on 5080 (77 C# files)
src/Host/Dar.Api          ASP.NET Core 10 minimal API — /api/v1 on 5081 (composition root)
src/Modules/*             Identity + Secretariat + Teaching + Meet (128 C# files)
src/Common/*              AppException, PagedResult, Money, PermissionCodes, Messages
database/*.sql            42 SQL migrations (public schema), ledger = web_schema_migrations
tests/                    xUnit Unit/Integration (Testcontainers) + node/bash regression suites
services/meet-recorder/   Node 24 + Playwright bot (Xvfb/PulseAudio/FFmpeg) — separate systemd service
PostgreSQL 17             host PostgreSQL on 127.0.0.1:5432
```

- الواجهة **React 19 + Vite + TypeScript** نهائيًا — قرار Next.js ملغي (ADR-0001). لا `apps/web` ولا BFF.
- الـSPA واحدة تخدم: الصفحة العامة `/`، لوحة الإدارة `/management`، بوابة المعلمة `/teacher`، ومساحة المشرفة `/supervisor`.
- Strangler migration: الـbackend القديم ما زال مالكًا للدومين/الإدارة/المالية، والـhost الجديد يملك `/api/v1` (Identity + Secretariat + Teaching + Meet).
- كلا الـAPIs خلف نفس الـorigin عبر Nginx؛ الصلاحيات والجلسات مشتركة في قاعدة البيانات لكن بمصادقة منفصلة لكل host (انظر §6.4/ADR-0006/ADR-0008).
- **Modular Monolith:** حدود وحدات قوية داخل عملية واحدة؛ أي وحدة قابلة للاستخراج لاحقًا. Microservices مرفوضة (تكلفة تشغيل بلا فائدة).
- **Public origin:** `https://<deployment-host>` — Nginx يخدم ملفات الـSPA الثابتة من الـlegacy API (5080)، و`/api/v1/*` → 5081، وأي `/api/*` آخر → 5080. PostgreSQL و`/internal/*` غير منشورين.

---

## 2. Module Map

| Module | Owns | Current status (27 Nov 2026) |
|---|---|---|
| **Identity** | users, sessions, permissions, email OTP + Google, profile | legacy: password login + flat permissions + per-account lockout (029)؛ new `/api/v1`: password/sessions/change-password/OTP paths (Google deferred، Turnstile جاهز وينتظر مفاتيح) |
| **Secretariat** | students, guardians, teachers, documents, enrollment/withdrawal | legacy: كامل؛ new: `/api/v1/students` list/get/create + scope filtering |
| **Academic** | groups/levels, schedules, holidays, conflict detection | legacy: circles + schedule slots + منع تداخل المعلمة (012/025/035) + حفظ ذري with-schedule |
| **Attendance** | student/teacher attendance, approvals, edits, make-up sessions | legacy: تسجيل مباشر + طلبات/تصحيحات؛ Teaching: teacher sessions/roster/requests + outbox واجهة |
| **Payroll** | teacher rates, session pay, runs, payslips, adjustments | on-the-fly pay + **قفل شهري** (022 + 029 guard)؛ لا runs/payslips |
| **Billing** | fee plans, charges, discounts, payments, allocations, receipts, refunds | charges/payments + Charge Audit + **Reverse/Void (024/031)** + idempotency (033)؛ لا receipt_no ولا خصومات |
| **Treasury** | expenses, revenues, accounts, period close, journal entries | مصروفات + إعلانات فقط؛ الإيرادات وتقفيل الشهر في Phase 2.6؛ **لا** قيد مزدوج (ADR-0003) |
| **Teaching** | teacher sessions, roster, requests, earnings, supervisor read models | ✅ live — `src/Modules/Teaching` (`/api/v1/teacher/*`, `/api/v1/supervisor/*`, `/api/v1/notifications`) |
| **Meet** | Google Calendar, events, recording scope, bot jobs, media | ✅ live (3.0–3.3) — ADR-0006/0007، migrations 026/036/038، OAuth sync، bot control plane loopback (ADR-0007) |
| **Reporting** | read models, reports, exports, dashboard KPIs | legacy: 6 تقارير PDF + snapshots؛ المالية محجوبة بدون `finance.read`+`reports.finance` |
| **Notifications** | persistent center, absence/payment alerts, WhatsApp links | ✅ live — notifications + read/resolve + admin pages + `wa.me` + `communication_log` |
| **Auditing** | security events, business audit log, restore allowlist | audit append-only (015)؛ trash بصلاحيات لكل كيان؛ restore وصفي فقط |
| **System** | settings, backups, export, health, trash, retention | legacy: settings/backups/export/health/trash؛ النشر الآمن (2.1) + retention worker + TrashPurgeWorker |

**Rule:** a module owns its tables. One `public` schema؛ module boundaries in code. No cross-module table access; cross-module communication through `Contracts`.

---

## 3. Inside a Module

```
src/Modules/<Module>/
  Domain/          entities, value objects, status rules (no Npgsql, no HTTP)
  Features/        one folder per use case (Request/Handler/Validator/Endpoint)
  Persistence/     Npgsql/Dapper repositories, SQL (public schema)
  Contracts/       public DTOs + interfaces other modules may call
  <Module>Module.cs DI registration + endpoint mapping
```

- **Vertical slices.** A use case is found in one folder, not spread across a 1,400-line service.
- Endpoints thin؛ Domain بلا Npgsql/Dapper/HTTP/ASP.NET.
- Other modules talk through `Contracts` only؛ لا cross-module repository calls ولا shared tables.
- Host only composes: `Add<Module>()`, `Map<Module>Endpoints()`.
- **OOP + no duplication:** مسؤولية واحدة لكل كلاس/ملف؛ لا نسخ لمنطق مالي/صلاحيات/تنسيق (unify قبل الإضافة).

---

## 4. Cross-Cutting

| Concern | Mechanism |
|---|---|
| **Errors** | `Common.Domain.AppException` + `AppExceptionHandler` في `src/Host/Dar.Api`؛ legacy يرجع رسائل محلية في بعض المسارات. |
| **Validation** | Validation يدوية/داخل handler في الوحدات الحالية؛ FluentValidation = هدف. |
| **Authorization** | permission constants + `RequireAuthorization("<permission>")`؛ legacy policies من `Security.cs`؛ `ScopedAccessEndpointFilter` deny-by-default للـroutes غير المعروفة (FINAL 0.6). |
| **Audit log** | كتابة صريحة داخل المعاملة + before/after؛ append-only trigger (migration 015). |
| **Soft delete / Trash** | soft delete للبيانات الأساسية؛ المالية لا تُحذف؛ الإلغاء Reverse/Void (ADR-0005) + TrashPurgeWorker. |
| **Concurrency** | `row_version` هدف؛ الحالي `FOR UPDATE` على صفوف المال + advisory locks للمواعيد. |
| **Time** | `Africa/Cairo` للأعمال؛ `CairoTime` helper موحّد (Z2)؛ لا `TimeProvider` شامل بعد. |
| **Paging/filtering** | `PagedResult<T>` + server-side pagination في الـnew API والعديد من شاشات الإدارة؛ legacy lists متبقية. |
| **Background work** | `NotificationSyncService` (6h)، `TrashPurgeWorker` (6h)، meet bot scheduler/poller، retention worker، OTP email queue، backup timer (systemd). |
| **Email** | SMTP queue مُنفّذ (bounded)؛ المزوّد غير مُعد → OTP requests fail حتى الضبط. |
| **Media** | إيصالات BYTEA داخل القاعدة؛ تسجيلات Meet على `/var/lib/dar/media/meet` (خارج DB) + HLS/prune. |
| **Logging** | `DarFileLoggerProvider` في legacy + ILogger في `src/`؛ Serilog هدف. |
| **Idempotency** | `Idempotency-Key` مُنفّذ للـpayments/charges (033)؛ باقي المالية transaction + `FOR UPDATE`. |
| **Sessions/cookies** | ADR-0006 (جسر الجلسة) + ADR-0008 (كوكي أدمن نحيف، الصلاحيات من DB) + B10 (Secure يتبع scheme). |

---

## 5. Data

### 5.1 Database

- PostgreSQL 17+؛ one database، **one `public` schema**؛ module boundaries in code.
- **Npgsql + Dapper** (لا EF Core): الـSQL الحالي هو السلوك المُثبت؛ إعادة كتابة EF = مخاطرة بلا قيمة.
- SQL migrations هي المصدر المرتّب: **42 ملفًا (001→041)** في `database/` — 039 مقسمة `039a_enrollment_status_history_table` + `039b_enrollment_status_history_backfill`، و040 (pg_trgm GIN indexes للبحث)، و041 (blob file storage) أحدث ملف؛ **الإنتاج متأخر على 26/26** حتى النشر القادم.
- `MigrationRunner` (`dotnet run --project src/Host/Dar.Api -- --migrate`) هو المسؤول الوحيد: checksums + advisory lock + تبنّي ledger القديم.
- `web_schema_migrations` هو الـledger الفعلي؛ `schema_migrations` القديم متوقف عند 16؛ `DatabaseInitializer` القديم مقيّد بـDevelopment فقط (إزالته ضمن التنظيف 2.8).
- Do **not** auto-apply migrations in Production؛ backup قبل أي migration إنتاجية.

### 5.2 Conventions

- Money: `numeric(14,2)` EGP — never `float`.
- Dates: `timestamptz` UTC؛ business display Africa/Cairo.
- Statuses: enums/smart constants in Domain؛ IDs UUID + public codes.
- `created_at`, `updated_at`, `row_version` where applicable؛ soft delete for master data.

### 5.3 Integrity

- Unique attendance per `(session_id, student_id)` / teacher per `(session_id, teacher_id, role)` (partial unique بعد 034).
- Partial unique active enrollment per `(student_id, group_id)`.
- منع تداخل جدول المعلمة أسبوعيًا (012 + advisory locks 025/035).
- Check constraints للمبالغ؛ payment allocation ≤ payment/charge؛ Reverse/Void schema (024/031).
- Document sequences atomic and gap-free — **مؤجل** مع receipt_no.

### 5.4 Transactions

- Financial operations inside one transaction؛ `SELECT ... FOR UPDATE` on charge rows؛ لا side effects خارج المعاملة.

### 5.5 Migrations

- Expand/contract؛ لا `DROP` destructive في الإنتاج بدون backup.
- Backup قبل أي migration إنتاجية (إلزامي — مؤتمت في `deploy/update.sh`).
- Migration مطبّقة لا تُعدَّل (checksum guard)؛ التصحيح = migration جديد. Checksums normalize CRLF/LF (1.16).

### 5.6 Roles

| Role | Permissions |
|---|---|
| `app_rw` | DML on operational tables, no DDL |
| `app_migrator` | DDL/migrations only |
| `backup` | read for backups |
| `readonly` | reporting/analysis |

- No superuser for the app؛ `REVOKE CREATE ON SCHEMA public FROM PUBLIC`؛ `scram-sha-256`؛ لا public 5432.
- ملاحظة: فصل الـDB roles لم يُنفّذ بالكامل على الـhost بعد (backlog).

### 5.7 Backups

- `deploy/scripts/dar-backup.sh` (systemd timer يوميًا): `pg_dump -Fc` + TOC + SHA-256 + manifest + globals + config/keys + offsite مشفّر (Google Drive/rclone) + retention بعدد النسخ الموثّقة.
- `dar-healthcheck.timer` + `dar-restore-drill.timer` (weekly) — انظر `docs/11-deployment.md` §6.
- RPO 24h minimum، RTO 4h. **NOT VERIFIED:** live rclone crypt + actual offsite restore.

---

## 6. API

### 6.1 Shape

- REST: `/api/v1/*` على الـhost الجديد (**82 route mapping**)، و`/api/*` القديمة (**105 mapping**) للدومين والإدارة حتى اكتمال الـstrangler.
- OpenAPI 3.1 يُولَّد من `src/Host/Dar.Api` على `/api/openapi/v1.json` (غير منشور عبر Nginx).
- `packages/api-client/openapi.v1.json` **ناقص** (27 path مقابل 82 mapping فعلي) و**غير مستخدم** في الواجهة.
- **لا يوجد contract test بعد** — إعادة التوليد + contract test + استخدام الـclient هي Phase 2.5-b.
- حتى ذلك الحين: أنواع TypeScript المكتوبة يدويًا (`frontend/src/domain/types.ts`، `frontend/src/teacher/teacherTypes.ts` barrel + core/live/supervisor) هي المصدر؛ أي تغيير endpoint يحدّثها في نفس التغيير.

### 6.2 Errors

RFC 9457 ProblemDetails for every failure (type/title/status/detail/instance/requestId)؛ لا stack traces في الإنتاج؛ `requestId` في كل response؛ 401/403/404/429 mapped globally.

### 6.3 Conventions

- Plural resources؛ Actions `POST /x/{id}/approve`؛ Pagination `?page=1&pageSize=25`؛ filters/sort صريحة.
- Idempotency: `Idempotency-Key`؛ Concurrency: `row_version`/`If-Match` (هدف)؛ No mass assignment؛ DTOs صريحة.
- Public DTOs never expose cost, private data, or passwords.

### 6.4 Auth

- **المسار الحالي:** username/password (PBKDF2-SHA256, 210k) + cookie sessions؛ لا SMS.
- Email OTP paths مُنفّذة وتحتاج SMTP + pepper؛ Google مؤجل؛ password fallback مستمر حتى تُجمع الإيميلات.
- كوكيز منفصلة لكل host: `DarEltahfeez.Admin` (SameSite=Strict) للـlegacy — الـticket نحيف ويحمل الهوية و`session_version` فقط والصلاحيات تُقرأ من `user_permissions` في كل طلب (ADR-0008)، و`dar_session` (SameSite=Lax) للـnew API. كلاهما `HttpOnly`. الـlegacy `Secure` يتبع scheme (`SameAsRequest`): Secure دائمًا خلف HTTPS الإنتاج (nginx يضيف `X-Forwarded-Proto: https` ويحوّل :80→:443) ولا يظهر على HTTP staging؛ الـnew API `Secure` خارج Development (docs/03 §27/§28).
- Revocation: `session_version` bump عند تغيير كلمة المرور/إزالة صلاحية، ويُتحقق في الـhostين.
- CSRF: **لا token** — origin/referer guard + SameSite + لا CORS.
- Rate limit: **5/دقيقة لكل IP** على مسارات auth (`Auth__RateLimit__PermitLimit`) + **per-account lockout تدريجي** (5 محاولات: 30ث→15د، migration 029) — Turnstile جاهز وينتظر مفاتيح Cloudflare.
- لا `__Host-` prefix بعد. Session lifetime: 8 ساعات + sliding (legacy).
- API docs disabled or protected in production.

### 6.5 Background Jobs

| Job | Status |
|---|---|
| `NotificationSyncService` | ✅ كل 6 ساعات — upsert لإشعارات الدفع المقيّدة بالـscope |
| `TrashPurgeWorker` | ✅ كل 6 ساعات — purge للمهملات غير المالية فقط |
| Meet bot scheduler/poller | ✅ إنشاء مهام T-60s، claim واحد، heartbeat، status |
| Retention worker | ✅ sessions/OTP/notifications/communication عامة — لا money-linked ولا audit |
| `BillingChargeJob` / `PayrollDraftJob` | هدف — الشهر الحالي يدوي، لا runs |
| `BackupJob` | ✅ خارج التطبيق: systemd timer + script |
| `ReportJob` | هدف — التقارير عبر window.print الآن |

- Idempotent، retries، dead-letter، distributed lock = متطلبات التصميم للـjobs الجديدة.

---

## 7. Frontend

### 7.1 Shape (React 19 + Vite — final)

```
frontend/src/
  main.tsx              route switch حسب location.pathname (/ /teacher /supervisor /management)
  App.tsx               admin shell (sidebar/topbar/theme/login gate + lazy pages + manualChunks)
  SystemAdminView.tsx   لوحة النظام (401 سطر — أعلى ملف، يحتاج تقسيمًا)
  home/  pages/         الصفحة العامة + صفحات الإدارة (lazy)
  application/          useDarApplication barrel + State/ActionsA/ActionsB/useDarAuth/useDarDataLoaders/selectors
  components/           shared UI + dialogs (ApplicationDialogs, ManagementReportBuilder)
  domain/  lib/         types/defaults + money/formatters/pagination/apiClient/portalHeaders
  meet/                 صفحة التسجيل والمحاضرات
  security/             Turnstile/guard helpers
  services/             apiClient (fetch فقط — لا desktop bridges)
  system/               ثوابت/تنسيق لوحة النظام
  teacher/              TeacherApp (8) + TeacherAppView (222) + useTeacherAppState (378) + SupervisorWorkspace + teacherApi
  styles/               18 ملف CSS (tokens + لكل منطقة)
```

- SPA واحدة تُبنى بـ`vite build` وتُخدَم من `wwwroot` الخاص بالـlegacy API؛ manifest + service worker للـPWA.
- التوجيه يدوي حسب `window.location.pathname` في `main.tsx`؛ لا router library ولا i18n.
- الواجهة الإدارية تتكلم مع `/api/*` القديمة؛ بوابة المعلمة/المشرفة مع `/api/v1/*` فقط.
- **لا Next.js، لا `apps/web`، لا Server Components، لا BFF** (ADR-0001).

### 7.2 Data Fetching

- `fetch` + `credentials: 'include'` + `cache: 'no-store'`؛ same-origin فقط؛ لا tokens في المتصفح.
- Wrappers: `services/apiClient.ts` (admin) و`teacher/teacherApi.ts` (teacher/supervisor؛ يضيف `X-Dar-Portal`)؛ React hooks عادية؛ لا TanStack Query.
- Loading/empty/error/no-permission required على كل صفحة؛ offline outbox للحضور (IndexedDB v3 + claim).

### 7.3 Design System

- CSS tokens في `frontend/src/styles/`؛ Font: Cairo؛ navy/teal + glass cards؛ dark/light عبر `data-theme`.
- **العربية فقط الآن** (RTL)؛ الإنجليزية مؤجلة (ADR-0004).
- Components: Button, Input, Select, Dialog/Sheet, Table (+ mobile cards), ResponsiveTable, Tabs, Badge, Toast, EmptyState, ErrorState, Skeleton.
- States: loading, empty, error, no-permission, long-text.

### 7.4 Motion & Accessibility

- framer-motion؛ 150–250ms micro-interactions؛ transform/opacity فقط؛ `prefers-reduced-motion`.
- WCAG 2.2 AA: keyboard navigation, focus visible, labels, error association, contrast 4.5:1، touch targets 44px.

### 7.5 Performance

- Route-level lazy loading لكل صفحات الإدارة + `manualChunks` (vendor-react/vendor-motion/صفحات).
- آخر build محلي (27 Nov): إجمالي JS غير مضغوط ≈1MB موزّع على chunks، أكبرها vendor-react ≈223KB؛ لا يوجد رقم gzip موثّق جديد — الميزانية: LCP < 2.5s، INP < 200ms، CLS < 0.1.
- **أولوية UI المعتمدة (22 Nov): تجاوب 100% للوحة الإدارة على الموبايل** — انظر `docs/audits/admin-mobile-responsive-audit.md`.

### 7.6 Visual QA

- مراجعة يدوية على 1440/1024/390؛ RTL + light/dark؛ empty/loading/error/long text/0/1/1000 rows.
- Playwright + visual regression = هدف (2.5 smoke / 2.9 E2E). Print: A4 عبر `window.print()`.

---

## 8. Deployment

### 8.1 Topology (live)

```
Cloudflare DNS/WAF → Nginx + Certbot (:443) → SPA + legacy /api (:5080)
                                           ↘ /api/v1/* → new API (:5081)
                                           ↘ /internal/* → 404 (edge)
legacy + new API → PostgreSQL 17 (127.0.0.1:5432)
dar-meet-bot (dar-meet.slice) → loopback /internal/meet on :5081
systemd timers: dar-backup, dar-healthcheck, dar-restore-drill, certbot
```

### 8.2 Domains

| Domain | Service |
|---|---|
| `<deployment-host>` | Nginx → SPA + APIs (live) |
| `api.` subdomain | غير مستخدم؛ الـAPIs داخلية فقط |
| `staging` | **موجود** على نفس الـhost: `http://<deployment-host>:8088/` + vhost منفصل + IP allow-list، بلا DNS/certificate — `docs/staging-environment.md` |

- Cloudflare DNS/WAF؛ SSL Full (strict)؛ Certbot DNS-01 عبر Cloudflare token.
- تقييد الـorigin على Cloudflare IPs: جزء منه عبر `DAR_REAL_IP_MODE=cloudflare` (real-IP snippet موثّق)؛ تقييد الـfirewall الكامل غير منفَّذ (2.7).

### 8.3 Host

- Contabo VPS 4: 4 vCPU / 8GB / 100GB، Ubuntu 24.04 LTS، TZ `Africa/Cairo`.
- UFW: 22/80/443؛ SSH keys only؛ fail2ban؛ unattended upgrades.
- Docker مثبت من bootstrap لكنه **غير مستخدم** لخدمات الإنتاج؛ ملفات Docker/Caddy stack أُزيلت من الريبو (2.15).

### 8.4 Services

| Service | Notes |
|---|---|
| `nginx` | TLS + reverse proxy + buffers (إصلاح 502) + security headers |
| `dar-legacy.service` | SPA + `/api/*` على 5080 |
| `dar-api.service` | `/api/v1/*` + health على 5081 |
| `postgresql` | 17 على 127.0.0.1:5432 |
| `dar-meet-bot.service` (+slice) | bot التسجيل — loopback فقط، isolated slice |
| `dar-backup.timer` / `dar-healthcheck.timer` / `dar-restore-drill.timer` | dump+offsite / فحوصات 6h / تدريب استرجاع أسبوعي |
| `certbot.timer` | تجديد الشهادات |

- الخدمات تعمل بمستخدم `dar` (غير جذري)؛ سكربتات الإعداد (setup-*) idempotent بعد Phase 2.1.

### 8.5 CI/CD

- GitHub Actions `ci.yml`: backend (build/test/bash -n)، meet-recorder (typecheck/test)، migrations على PostgreSQL 17 + schema asserts + SQL regression، frontend (typecheck/test/build)، api-client (no-drift)، security (vuln + audit + secret scan).
- **لا نشر آلي ولا rollback job**؛ أول تشغيل على GitHub لم يُتحقق منه بعد.
- النشر المعتمد: `sudo bash deploy/update.sh` (backup → pull → build → migrate → swap → smoke → rollback تلقائي للبيناريز)؛ `git pull + restart` ممنوع. راجع `docs/11-deployment.md`.

### 8.6 Monitoring

- `/health/live` و`/health/ready` على كلا الـAPIs (Nginx ينشر `/health/*` من legacy).
- `dar-healthcheck.sh --json` + journald؛ تنبيه فشل النسخ عبر `OnFailure`.
- Uptime/monitoring خارجي/alerting: غير مُنشأ بعد (2.7).

---

## 9. Decisions Log

| # | Decision | Why |
|---|---|---|
| 1 | .NET 10 + ASP.NET Core minimal API | owner choice; strong typing, long-term support |
| 2 | ~~Next.js 16 frontend~~ → **ملغى** (استُبدل بـ#27) | RSC/SSR غير مطلوب لنظام إداري؛ Next.js لم يُبنَ أبدًا |
| 3 | PostgreSQL 17 + **Npgsql/Dapper** | preserve proven SQL; relational money data; transactions/row locks |
| 4 | Modular monolith | one owner + AI engineers; low ops cost |
| 5 | One `public` schema initially | avoid risky table moves; module boundaries in code |
| 6 | Vertical slices | small files, one place per use case |
| 7 | Same-origin Nginx proxy | cookies بلا CORS، والـAPIs داخلية |
| 8 | Cookie sessions | HttpOnly, revocation, no tokens in browser |
| 9 | OpenAPI contract + generated TS client | **متبقٍ Phase 2.5** — الـclient غير مستخدم والملف ناقص (27/82) |
| 10 | No `.bat` | production web deployment, cross-platform |
| 11 | Tests inside the solution | xUnit/Testcontainers + `tests/regression`; isolated DB; no test panel/routes |
| 12 | ~~Double-entry ledger from day one~~ → **مؤجل** (انظر #28) | treasury + إيرادات/مصروفات + تقفيل شهري بدون ledger |
| 13 | Soft delete + audit | no history loss, accountability |
| 14 | Reports HTML print + XLSX | reliable Arabic typography |
| 15 | Strangler migration | preserve working UI/business logic |
| 16 | Keep existing SQL/business rules | don't rewrite proven financial behavior blindly |
| 17 | Email OTP + Google | owner decision; temporary password fallback during migration |
| 18 | Remove WPF/WebView2/desktop | ✅ web-only product؛ الأدوات أُزيلت من الريبو |
| 19 | No purge of financial history | corrections via Reverse/Void (#30، ADR-0005) |
| 20 | ~~Arabic + English~~ → **العربية الآن، الإنجليزية مؤجلة** (#29) | لم يُنفَّذ i18n |
| 21 | .NET is the final backend | owner decision; TypeScript/NestJS rejected |
| 22 | Google login deferred | temporary password + sessions is the current path |
| 23 | File size budget 200–400 lines | split every use case (Z1)؛ legacy exceptions في docs/04 |
| 24 | One unified .NET backend; OpenAPI is the generated/stable boundary | contract stability + replaceable modules |
| 25 | UI sample gate | owner approves a visual sample before any UI implementation |
| 26 | Legacy split first, no behavior change | partial classes → feature files → modules؛ characterization tests قبل أي split |
| **27** | **React 19 + Vite + TypeScript نهائي؛ Next.js ملغي** | نظام إداري داخلي؛ الواجهة live ومُختبرة (ADR-0001) |
| **28** | **الخزنة الآن بدون قيد مزدوج** | نطاق Phase 2.6؛ القيد المزدوج مؤجل (ADR-0003) |
| **29** | **الإنجليزية مؤجلة** | العربية فقط الآن (ADR-0004) |
| **30** | **Reverse/Void بدل الحذف المالي** | كل سجل مالي يبقى ظاهرًا؛ إلغاء عكسي + سبب + Audit (ADR-0005؛ منفّذ 024/031) |
| **31** | **كوكي الأدمن نحيف: الصلاحيات من `user_permissions` في كل طلب** | حجم الكوكي وحدود nginx/proxy + صلاحيات فورية (ADR-0008؛ FINAL B7) |
| **32** | **Secure flag يتبع scheme في legacy** | إنتاج HTTPS يبقى Secure؛ staging HTTP لا يكسر الجلسات (B10؛ ADR-0008) |
| **33** | **staging منفصل على نفس الـhost بـIP allow-list** | اختبار نشر/UI قبل الإنتاج بلا DNS/certificate (docs/staging-environment.md) |

---

## 10. Current State — Snapshot (27 Nov 2026)

> التفاصيل الكاملة في `docs/00-current-state.md`؛ هذا ملخص معماري.

| Area | Current |
|---|---|
| Frontend | React 19 + Vite SPA واحدة + lazy pages/manualChunks؛ 82 ts + 98 tsx؛ **89 Vitest** |
| Backend (legacy) | `backend/DarEltahfeez.Api` — 77 ملف C#، **105 route mapping** على 5080، يخدم الـSPA + كل الدومين/الإدارة/المالية |
| Backend (new) | `src/` — 128 ملف C#، **82 route mapping** على 5081: Identity + Secretariat + Teaching + Meet |
| Database | PostgreSQL 17 — **42 migration** (001→041)؛ الإنتاج 26/26؛ ledger `web_schema_migrations`؛ `schema_migrations` متوقف عند 16 |
| Auth | password + cookie sessions على الـhostين (ADR-0006/0008)؛ lockout لكل حساب + rate limit 5/min؛ OTP path جاهز، Google مؤجل |
| Tests | backend unit + integration (Testcontainers) + SQL/node regression في CI؛ frontend 31 ملف/89؛ لا Contract/Playwright |
| CI | 6 jobs في `.github/workflows/ci.yml`؛ لا deploy/rollback؛ أول run غير متحقق |
| Deployment | Ubuntu + Nginx + Certbot + systemd + PostgreSQL 17 + dar-meet-bot؛ Docker/Caddy متقاعد/محذوف |
| Live | `https://<deployment-host>` — آخر نشر `a823b32` (ledger 26/26)؛ `main` يحمل التحصين حتى `4166fd0`+ |

**Legacy tables (25):**
`app_users`, `roles`, `permissions`, `role_permissions`, `user_roles`, `user_permissions`, `students`, `teachers`, `circles`, `circle_enrollments`, `monthly_charges`, `payments`, `student_notes`, `teacher_notes`, `circle_schedule_slots`, `teacher_attendance`, `student_attendance`, `advertising_expenses`, `operating_expenses`, `school_settings`, `audit_log`, `trash_items`, `system_backups`, `collection_reports`, `schema_migrations`.

**Note:** `roles`, `role_permissions`, `user_roles` موجودة لكن الـlegacy API يستخدم `user_permissions` مباشرة؛ role templates = seed فقط. **الجداول الجديدة** (Meet 8 جداول + `notifications` + `notification_reads` + `attendance_requests` + `communication_log` + `payroll_locks` + `meet_oauth_states` + ...) تُدار من migrations 017→041.

---

## 11. Decisions & Open Questions

### Resolved

- **Frontend:** React 19 + Vite + TypeScript — نهائي (ADR-0001).
- **Backend:** .NET 10 — نهائي؛ لا TypeScript backend.
- **DB:** PostgreSQL 17 على نفس السيرفر؛ `public` schema.
- **Auth (current):** password + sessions؛ OTP path مُنفّذ؛ Google مؤجل؛ lockout لكل حساب.
- **Language:** العربية فقط الآن (ADR-0004).
- **Scope:** إداري/مالي فقط، ليس LMS.
- **Financial:** agreed fee بلا pro-rata؛ أجر بالدقيقة بلا تقريب؛ Reverse/Void (ADR-0002/0005). **Treasury:** الخزنة/الإيرادات/المصروفات/تقفيل الشهر الآن؛ القيد المزدوج مؤجل (ADR-0003).
- **Admin cookie:** slim + permissions from DB (ADR-0008)؛ Secure scheme-aware (B10).

### Open

1. المواعيد الثلاثة المتداخلة قديمًا (`00:07/00:10/00:11`) — تحتاج تحققًا إنتاجيًا موثقًا (التحقق المحلي 45/45 + 17/17 PASS).
2. مزود البريد/واتساب (SMTP provider) — مطلوب لتفعيل OTP فعليًا.
3. مدة/شروط خطوة step-up والتوقيع.
4. أولوية الإيصالات المرقّمة / مسير الرواتب / خصومات وخطط رسوم (backlog — بعد 2.6).
5. بوابة ولي الأمر/الطالبة — خارج العام الأول.
6. أكثر من فرع؟ / بيانات Excel/ورق قديمة تحتاج استيراد؟
7. نشر دفعة التحصين إلى staging ثم الإنتاج (بموافقة المالك) + rehearsal rollback؛ Turnstile: تفعيل مفاتيح Cloudflare (الكود جاهز) + step-up scope.
