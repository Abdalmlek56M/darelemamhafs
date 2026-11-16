# RIGX Dar — Gap Audit

**Status:** Intake + baseline audit complete (15 Nov 2026).
**Scope:** Existing project at `DarEltahfeez/`.
**Rule:** Every finding has evidence. No claim without a file/line, API response, build result, or measurement.

---

## 1. Executive Summary

المشروع الحالي **ليس نموذجًا أوليًا فارغًا**. فيه منطق عمل حقيقي، وواجهة مصممة بعناية، واختبارات يدوية كثيرة. لكنه:

- **Desktop-first**: WPF/WebView2 + PostgreSQL محلي + `.bat` + PowerShell.
- **Monolith**: 1,680 سطر Endpoints، 874 سطر Hook، SQL داخل الـEndpoints.
- **Test Center منفصل**: 39 سكربت PowerShell + مشروعان C# صغيران.
- **ناقص ماليًا**: لا Payroll Run، لا Receipt Number، لا Ledger، لا Period Close.
- **فيه مخاطر P0**: حذف تاريخ مالي عبر Trash/Purge، Audit Log قابل للتعديل، تعارضات جدول تمنع Migration 012، وغياب Rate Limit/Lockout.

**القرار:** لا إعادة كتابة عمياء. ننقل السلوك الحالي إلى **Modular Monolith** جديد، ونبني واجهة **Next.js**، ونستبدل Desktop/Test Center تدريجيًا.

---

## 2. Baseline

| Metric | Result |
|---|---|
| .NET SDK | 10.0.401 |
| API build | ✅ 0 warnings, 0 errors |
| Node | v24.22.1 |
| npm | 11.19.1 |
| Frontend build | ✅ 713.91 KB JS (200.42 KB gzip), 94.40 KB CSS |
| DB (fresh) | ✅ 12 migrations, 25 tables |
| API health | ✅ `{"status":"ok","database":"connected"}` |
| API auth negative test | ✅ `GET /api/students` without cookie → 401 |
| Sample flow | ✅ teacher → circle → student → enrollment → schedule → charge → payment → attendance |
| Teacher rate snapshot | ✅ re-save after rate change kept 120 EGP |
| Substitute | ✅ substitute teacher got 100 EGP, original 0 |
| Delete guard | ✅ `DELETE /api/students/{id}` → 409 |
| Audit log | ⚠️ 14 rows, 0 append-only triggers |
| Login audit | ❌ 0 `auth.*` rows |
| Git | ❌ no repository |
| Tests | 39 `.ps1` (467 KB), 2 C# regression projects, SQL regressions |
| Desktop | WPF/WebView2 + local PostgreSQL 55432 + 10 `.bat` + 2 test `.bat` |

**Test data:** created in an isolated Docker PostgreSQL container; no production data touched.

---

## 3. Current Architecture

```
START_DAR.bat
  → tools/run-desktop.ps1
    → build React (Vite) → copy dist to API wwwroot
    → build .NET 10 API + WPF
    → start local PostgreSQL 17 on 55432
    → start API on 127.0.0.1:5080
    → WPF WebView2 opens http://127.0.0.1:5080
      → React SPA calls /api/*
        → ASP.NET Core Minimal API
          → Npgsql (raw SQL) → PostgreSQL
```

- **Presentation:** React 19 + TypeScript + Vite + framer-motion + custom CSS.
- **API:** ASP.NET Core Minimal API, one project, 11 C# files.
- **Data:** PostgreSQL 17, raw SQL, 12 SQL migrations.
- **Desktop:** WPF/WebView2, credential vault, theme sync, auto-start.
- **Ops:** PowerShell scripts, Windows Task Scheduler, Test Center/System Center WinForms.
- **Tests:** PowerShell runners + 2 C# console regression projects + SQL scripts.

---

## 4.0 P0 Progress — 15 Nov 2026

| ID | Status | What changed |
|---|---|---|
| P0-01 | 🟡 Partial | Added legacy auth rate limit (10/min/IP) + `auth.login`/`auth.login.failed` audit. Email OTP/Google and lockout still pending. |
| P0-02 | ✅ Fixed and verified end-to-end | Parent purge rejects financial descendants; child purge refuses financial tables; migration `014_financial_fk_restrict.sql` restores `RESTRICT` for student→enrollment→charge→payment. Disposable-DB test: all 14 migrations applied; FK blocked physical deletes; API created a full payment chain, trashed the student, and purge returned **409** with payment/charge still present. Hard-delete endpoints remain (P1-18). |
| P0-03 | ✅ Fixed and verified | Migration `015_audit_log_append_only.sql` blocks DELETE and substantive UPDATE; only request enrichment and restore metadata are allowed. `RestoreColumns` now excludes money, attendance, enrollment lifecycle, schedule assignments, and trash flags; only descriptive profile/note fields can be restored. Tested on disposable PostgreSQL 17: direct details update blocked, delete blocked, enrichment allowed, restore metadata allowed, substantive rewrite blocked. |
| P0-04 | 🔴 Pending | Windows/desktop deployment still present; Linux/Docker migration not started. |
| P0-05 | 🔴 Pending | Need owner approval for the 3 conflicting schedule times. |
| P0-06 | 🟡 Partial | Added `X-Frame-Options`, CSP `frame-ancestors`, Permissions-Policy, HSTS on HTTPS. CSRF token and web BFF still pending. |
| P0-07 | 🔴 Pending | Test modes still inside `Program.cs`. |

Verified: build 0 warnings/errors; login rate limit returned `401×9, 429×3`; audit recorded `auth.login.failed=9` and `auth.login=1`.

---

## 4.1 Code Review — 16 Nov 2026

**Method:** full read of legacy/admin/auth/backup paths, new Identity/Secretariat modules, frontend hooks, CI, migrations, and source tests; plus `dotnet build` (legacy + `Dar.slnx`), `dotnet test` (12 unit + 3 integration), `npm run build`, `dotnet list package --vulnerable`, and `npm audit --omit=dev`. No production data was read or changed.

### Fixed in this pass (code)

| ID | Fix | Evidence |
|---|---|---|
| **P0-02a** | Parent purge can no longer delete financial children. `PurgeTrashAsync` rejects a parent with any financial descendant; the child purge loop refuses financial types. | `SystemAdminEndpoints.Trash.cs` (`PurgeTrashAsync`, `PurgeRelatedTrashRecordsAsync`) |
| **P0-02b** | Migration `014_financial_fk_restrict.sql` restores `ON DELETE RESTRICT` for student→enrollment→charge→payment, undoing the CASCADE added by `002`. | `database/014_financial_fk_restrict.sql` |
| **P1-21** | Teacher/circle saves no longer send numeric form fields as JSON strings, and omit financial fields for users without `finance.edit`. | `useTeacherActions.ts`, `useCircleActions.ts` |
| **P1-22** | Inactive/historical schedule slots no longer fire reminders. | `useScheduleNotifications.ts` |
| **P1-23** | Logout clears all scoped lists/details, so the next account cannot see the previous account's rows. | `useDarAuth.ts`, `useDarApplication.ts` |
| **P1-24** | Circle roster requests are guarded against stale responses and cleared before loading. | `useCircleActions.ts`, `useDarApplication.ts` |
| **P1-25** | Re-marking attendance preserves an explicitly corrected duration instead of resetting payroll to the scheduled length. | `DomainEndpoints.ScheduleAttendance.cs` |
| **P1-26** | `--migrate` adopts the legacy `schema_migrations` ledger before applying files, so migrations are not replayed on the existing database. | `MigrationRunner.cs` |
| **P1-27** | Session revocation: `session_version` added (migration 016). Legacy cookie carries the version and `ValidatePrincipalAsync` rejects mismatches; `Dar.Api` adds `OnValidatePrincipal` with active-user/permission refresh. Password change/reset/deactivation/email change bump the version. | `AuthEndpoints.cs`, `AuthEndpoints.Helpers.cs`, `IdentityModule.cs`, `IdentityRepository.cs`, `016_session_version.sql` |
| **P1-28** | First-run setup: requires `Auth:SetupToken` for remote callers; without a token it is loopback-only. | `AuthEndpoints.cs` |
| **P1-29** | Baseline CSRF: `SameOriginGuardMiddleware` rejects unsafe cross-origin browser requests (Origin/Referer) on both hosts. | `SameOriginGuardMiddleware.cs`, both `Program.cs` |
| **P1-30** | Forwarded headers: `UseForwardedHeaders` + configurable known proxies, so Caddy supplies the real client IP/scheme. | both `Program.cs`, `appsettings.json` |
| **P1-31** | Trash move/restore/purge now requires the owning domain permission as well as `trash.manage`; frontend hides/disables unauthorized rows. | `SystemAdminEndpoints.Helpers.cs`, `SystemAdminEndpoints.Trash.cs`, `system/constants.ts`, `SystemAdminView.tsx` |
| **P1-35** | OTP pepper now fails closed outside Development; no process-local key in production. | `IdentityModule.cs`, `OtpCodeHasher.cs` |
| **P2-15** | New students default to the local date, not the UTC date. | `CreateStudent.cs` |
| **P2-16** | Audit viewer shows unknown non-sensitive fields instead of silently dropping them. | `system/formatting.tsx` |

**Verification:** legacy API 0/0, `Dar.slnx` 0/0, 12 unit + 3 integration pass, frontend build pass. Migration 014 and the purge guard still need a disposable-PostgreSQL test before production.

### Still open (priority order)

| ID | Severity | Finding | Evidence | Required fix |
|---|---|---|---|---|
| **P1-32** | P1 | Backup/Restore is Windows-only (`pg_dump.exe`, drive-letter path validation) and has no Linux/Docker path. | `SystemAdminService.cs` | Linux `pg_dump`, mounted backup volume, Compose service |
| **P1-33** | P1 | No Dockerfile/Compose/Caddy deployment yet, despite the final host+domain goal. | repo root | Add deployment stack + staging smoke test |
| **P1-34** | P1 | Dead physical DELETE endpoints remain in `DomainEndpoints*`; only `AuditMiddleware` blocks them. | `DomainEndpoints*.cs` `MapDelete` | Remove or convert to trash-only |
| **P1-35** | P1 | OTP pepper is not configured in `appsettings.json`; a process restart invalidates codes and multi-instance deployments fail. | `appsettings.json` `Auth:Otp:Pepper` empty; `OtpCodeHasher.cs` fallback | Require env/file pepper in production; fail closed |
| **P1-36** | P1 | Source-guard PowerShell suite is partly stale: several runners require the archived Test Center; some path/count assertions were updated but the suite is not green. | `tests/runners/*`, `tests/catalog.json` | Migrate active guards to xUnit/source tests; archive obsolete runners |
| **P2-17** | P2 | Login timing reveals whether a username exists. | `AuthEndpoints.cs` login path | Dummy PBKDF2 verify for unknown users |
| **P2-18** | P2 | Reset-all can report success with zero records when the operator lacks read permissions. | `SystemAdminView.tsx` reset flow, `useDarDataLoaders.ts` permission gates | Block reset-all or load IDs server-side |
| **P2-19** | P2 | Duplicate month loads on login/navigation (effect + `changePage`). | `useDarApplication.ts` | Single loading path |
| **P2-20** | P2 | Historical session rows still show attendance actions that the API rejects for inactive slots. | `SchedulePage.tsx`, `DomainEndpoints.ScheduleAttendance.cs` | Gate actions on `slot.isActive` or add server historical path |

---

## 4. P0 Findings — Blockers

| ID | Area | Finding | Evidence | Impact | Required fix |
|---|---|---|---|---|---|
| **P0-01** | Auth | لا Rate Limit، لا Lockout، لا Audit لتسجيل الدخول/الفشل. Password login فقط، بخلاف الهدف (Email OTP + Google). | `AuthEndpoints.cs:122-147`؛ `Program.cs:85-105`؛ `AuditMiddleware.cs:28-31`؛ `audit_log` query = 0 `auth.*` | تخمين كلمات المرور، عدم معرفة من دخل/فشل، ومخالفة قرار المصادقة | Identity module: Email OTP + Google، rate limit، lockout، login audit، session revocation |
| **P0-02** | Data/Money | يمكن حذف تاريخ مالي نهائيًا عبر Trash/Purge. `payments` و`monthly_charges` داخل `TrashTables`، و`PurgeExpiredTrashAsync` ينفذ `DELETE`. | `SystemAdminService.cs:17-25, 276-306`؛ `SystemAdminEndpoints.cs:451-469`؛ `002_management_security.sql:18-26` (CASCADE) | فقدان إيصالات/استحقاقات/تاريخ مالي لا يمكن استرجاعه | منع Purge للكيانات المالية؛ أرشفة بدل الحذف؛ إزالة CASCADE المالي |
| **P0-03** | Audit | `audit_log` قابل للتعديل/الحذف؛ لا Trigger يمنع ذلك. `restore-before` يستعيد حقولًا مالية (`hourly_rate`, `amount_due`, `payments`, attendance). | `pg_trigger` count = 0؛ `SystemAdminEndpoints.cs:222-242`؛ `SystemAdminService.cs:37-53` | تلاعب/إعادة كتابة تاريخ مالي وحضور دون أثر موثوق | Append-only trigger؛ منع استعادة الحقول المالية/الحضور/الصلاحيات؛ allowlist وصفي فقط |
| **P0-04** | Deployment | المشروع Windows-only: PostgreSQL محلي 55432، `%LOCALAPPDATA%`، `pg_dump.exe`، WPF/WebView2، Task Scheduler، `.bat`. | `Program.cs:12-15, 71-72`؛ `SystemAdminService.cs:55-90, 191-230`؛ `desktop-host/`؛ `tools/`؛ 10 `.bat` | لا يمكن نشره كموقع على Ubuntu 24.04 | نشر Docker/Linux؛ إزالة WPF/Desktop/`.bat`؛ Backup/Restore جديد |
| **P0-05** | Data/Schedule | Migration 012 تفشل إذا وُجد تداخل قديم. الموجود فعليًا 3 مواعيد متداخلة `00:07/00:10/00:11` في حلقة «جزء تبارك». | `PROJECT_STATUS_AND_TASKS_AR.md:50-54, 164-173, 226-238`؛ `012_teacher_schedule_no_overlap.sql:52-90` | التطبيق الجديد لا يبدأ على قاعدة الإنتاج | اعتماد الأوقات الصحيحة، Backup، تصحيح بيانات فقط، إعادة Preflight ثم 012 |
| **P0-06** | Web Security | لا CSRF token، لا HSTS، لا CSP، لا X-Frame-Options. Cookie بلا `Secure` على HTTP. | `Program.cs:85-129`؛ response headers في الاختبار | CSRF/Clickjacking/MITM عند النشر | Same-origin BFF، CSRF/Origin checks، TLS/HSTS، CSP، Secure cookies |
| **P0-07** | Tests/Prod | Test modes داخل API الإنتاج: `DAR_ISOLATED_REHEARSAL` و`DAR_ISOLATED_FUNCTIONAL_ACCEPTANCE` وconnection overrides. | `Program.cs:17-69` | سطح هجوم/سلوك خاص بالإنتاج | نقل Test harness إلى `tests/` + CI؛ حذف الفروع من Production |

---

## 5. P1 Findings — High Priority

| ID | Area | Finding | Evidence | Required fix |
|---|---|---|---|---|
| **P1-01** | Architecture | Endpoints عملاقة: `DomainEndpoints.cs` 1,680 سطر، `SystemAdminEndpoints.cs` 697، `AuthEndpoints.cs` 352؛ SQL داخل الـEndpoints. | ملفات API | Modular Monolith + Vertical Slices + Repositories |
| **P1-02** | Payroll | لا `payroll_runs`/`payslips`/lock/approval. الأجر يُحسب on-the-fly من الحضور. | schema؛ `DomainEndpoints.cs:903-974`؛ Dashboard sums | Payroll Run → Review → Approve → Lock → Payslip → Payment |
| **P1-03** | Treasury | لا Accounts/Journal/Period Close. “Net” الحالي استحقاقي وليس نقديًا. | `FINANCIAL_WORKFLOW_AND_RULES_AR.md:7-9, 145-149`؛ schema | Treasury + double-entry ledger + period close |
| **P1-04** | Receipts | لا Receipt Number/Document Sequence؛ الإيصال صورة اختيارية أو لا شيء. | `payments` schema `001:101-111`؛ `003:32-35` | `receipt_no` ذري + إيصال غير قابل للتعديل |
| **P1-05** | Money | لا Idempotency-Key؛ الاعتماد على `FOR UPDATE` + sum فقط. | `DomainEndpoints.cs:1313-1386` | Idempotency table + header |
| **P1-06** | API Contract | لا OpenAPI؛ أنواع TS مكتوبة يدويًا وقد تنحرف. | `frontend/src/domain/types.ts` | OpenAPI 3.1 + generated client + contract test |
| **P1-07** | Frontend | SPA Vite، Hook مركزي 874 سطر، لا Router، عربي فقط. | `useDarApplication.ts`؛ `App.tsx` | Next.js 16 + feature modules + ar/en + BFF |
| **P1-08** | Tests | Test Center تطبيق PowerShell منفصل؛ 39 `.ps1`، 2 C# regression فقط، لا xUnit/Testcontainers/Playwright. | `tests/` | xUnit + Testcontainers + Playwright داخل الحل؛ حذف Test Center |
| **P1-09** | Ops | لا Dockerfile/Compose/CI/CD؛ لا Linux deploy. | المشروع | Docker Compose + GitHub Actions + staging |
| **P1-10** | Lists | لا Pagination/Server search؛ القوائم تُرجع كل الصفوف. | `DomainEndpoints.cs` list queries؛ `PROJECT_STATUS...:102` | PagedResult + indexes |
| **P1-11** | Migrations | Legacy `DatabaseInitializer` بلا checksum/advisory lock. New `MigrationRunner` يملك checksums + lock + legacy-ledger adoption؛ legacy auto-migrate مقيّد بـDevelopment/desktop. يتبقى توحيد الـledger وإزالة الـinitializer القديم. | `DatabaseInitializer.cs:7-78`؛ `MigrationRunner.cs`؛ `Program.cs:164-173` | Retire legacy initializer؛ single ledger |
| **P1-12** | Billing | خصم أيام الإيقاف داخل الشهر غير مطبق في API؛ الاقتراح في الواجهة فقط. | `FINANCIAL_WORKFLOW...:40-46, 260-267`؛ `DomainEndpoints.cs:1222-1251` | سياسة مالية + حساب خادمي + اختبارات |
| **P1-13** | Substitution | البديلة تستبدل صف الحضور؛ لا سجل صريح للأصلية/البديلة خارج Note/Audit. | `DomainEndpoints.cs:931-973` | `session_teacher_assignment` أو Original/Substitute columns |
| **P1-14** | Backup | 🟡 Cross-platform backup path + Linux `pg_dump`/`pg_restore` and Docker volume are now implemented. Offsite automation and a real restore drill remain. | `SystemAdminService.cs`؛ `deploy/legacy.Dockerfile`؛ `docs/11-deployment.md` | Offsite copy + restore drill |
| **P1-15** | Errors | لا Global ProblemDetails؛ بعض المسارات ترجع `ex.Message`. | `SystemAdminEndpoints.cs:275`؛ `Program.cs` | Global handler + RFC 9457 |
| **P1-16** | Concurrency | لا `row_version`؛ بعض المسارات تعتمد `FOR UPDATE` فقط. | schema؛ endpoints | Optimistic concurrency |
| **P1-17** | Permissions | جداول `roles`/`role_permissions`/`user_roles` غير مستخدمة؛ `user_permissions` مسطحة. | `001:12-35`؛ `Security.cs` | Roles/Permissions model أو إزالة الجداول الميتة |
| **P1-18** | Dead Code | ✅ تم حذف كل مسارات `MapDelete` القديمة من `DomainEndpoints*` (10 مسارات). `AuditMiddleware` يحتفظ بحجب DELETE كطبقة دفاع إضافية. | `DomainEndpoints*.cs`؛ `AuditMiddleware.cs:20-27` | Done |
| **P1-19** | Health | ✅ `Dar.Api` and legacy both expose live/ready endpoints; Docker/Compose healthchecks use `/health/ready`. | `Program.cs`؛ `HealthEndpoints.cs`؛ `deploy/*` | Done |
| **P1-20** | CI | ✅ GitHub Actions now builds legacy + new solution, runs tests, frontend build, API-client typecheck, .NET/npm vulnerability audits, gitleaks, and Compose validation. First run still needs verification on GitHub. | `.github/workflows/ci.yml` | Verify first run |

---

## 6. P2 Findings — Improvements

| ID | Finding | Evidence | Fix |
|---|---|---|---|
| **P2-01** | لا Design System/shadcn؛ CSS مخصص 94 KB وInline Styles كثيرة. | `frontend/src/styles/*`؛ الصفحات | Tokens + shadcn/Radix + Storybook اختياري |
| **P2-02** | لا English/i18n. | `index.html` عربي فقط | next-intl + ar/en |
| **P2-03** | لا Accessibility audit. | لا axe/Lighthouse | WCAG 2.2 AA + فحص |
| **P2-04** | PDF عبر `window.print()` فقط. | `REPORTS_CATALOG_AR.md:5-12` | HTML print + server PDF للتقارير الكبيرة |
| **P2-05** | لا Teacher Rate History screen. | `FINANCIAL_WORKFLOW...:109-111` | Timeline من Audit أو جدول Rates |
| **P2-06** | Guardian inline فقط؛ لا Multiple Guardians. | `students` schema `001:37-50` | Guardians table |
| **P2-07** | لا Discounts/Fee Plans. | `circle_enrollments.agreed_monthly_fee` فقط | Fee Plans + Discounts |
| **P2-08** | لا Parent/Student Portal/Notifications. | خارج النطاق الحالي | Phase later |
| **P2-09** | لا Index على `monthly_charges.billing_month`. | old docs | قياس ثم Index |
| **P2-10** | Logs JSONL محلية؛ لا Metrics/Tracing. | `DarFileLoggerProvider.cs` | Serilog + OpenTelemetry اختياري |
| **P2-11** | Audit details قد تحتوي PII/مبالغ؛ Redaction مالي فقط. | `AuditMiddleware.cs:206-218` | Redaction شامل + اختبارات |
| **P2-12** | الصور/الشعار/الأفاتار BYTEA داخل DB. | `payments.receipt_data`, `school_settings.logo_data`, `app_users.avatar_data` | Object storage + signed URLs |
| **P2-13** | Docs تاريخية/handoff كثيرة؛ لا مصدر حقيقة واحد. | `docs/` | استبدالها بهيكل `docs/` الجديد |
| **P2-14** | لا Git history؛ لا rollback/review. | `Test-Path .git` = False | Git repo بقرار المالك (لا إنشاء تلقائي) |

---

## 7. What Works — Preserve

- **Business rules** in `FINANCIAL_WORKFLOW_AND_RULES_AR.md`: student charges, teacher hourly pay, snapshot, ads allocation, accrued net distinction.
- **Schema and migrations**: 12 migrations, constraints, partial unique indexes, historical eligibility functions.
- **Financial safeguards**:
  - `FOR UPDATE` on charge during payment.
  - Overpayment rejection after rounding.
  - `hourly_rate_snapshot` preservation on re-save.
  - Substitute uses new teacher’s rate.
  - `MoneyRules` decimal rounding.
- **Trash/Audit concepts**: soft delete, before/after, restore allowlist (needs hardening).
- **UI**: polished RTL, Cairo font, dark/light, responsive, framer-motion, empty/error states, permission-aware screens.
- **Tests**: 36 scenarios and SQL regressions encode real business behavior; convert, don’t discard.

---

## 8. Remove / Replace

| Item | Action | When |
|---|---|---|
| `desktop-host/` WPF/WebView2 | Remove | After web UI reaches parity |
| `*.bat` (10 + 2 test) | Remove | Phase 1.2 after documenting direct commands |
| `tools/launch-hidden.vbs` | Remove | Phase 1.2 |
| `tools/LocalPostgres.ps1`, `Prepare-PostgresRuntime.ps1`, `run-desktop.ps1` | Remove | After Docker/Linux run |
| `tools/SystemCenter.ps1`, `TestCenter.ps1`, `DatabaseStudio.ps1`, `HealthChecks.ps1` | Replace with web admin + tests | Phase 2–6 |
| `tests/runners/*.ps1` | Convert to xUnit/Playwright | Phase 1.4–2 |
| `frontend/` Vite SPA | Replace with `apps/web` Next.js | Phase 2–5 |
| `Program.cs` isolated test modes | Remove | Phase 1.1 |
| Old `docs/` handoffs | Replace with `docs/` structure | Phase 0.2 |

**Do not delete** `database/` SQL, current `backend/` API, or `frontend/` until the replacement passes the same flows.

---

## 9. Target Architecture Delta

| Area | Current | Target |
|---|---|---|
| Backend | 1 project, 3 giant endpoint files | `src/Host/Dar.Api` + `src/Modules/*` + `src/Common/*` |
| Data access | Npgsql raw SQL inside endpoints | Npgsql + Dapper repositories; SQL in Persistence |
| Schema | `public` only | Keep `public` initially; module boundaries in code; schemas optional later |
| Auth | Username/password | Email OTP + Google (temporary password fallback during migration) |
| Frontend | React/Vite SPA | Next.js 16 App Router + BFF + ar/en |
| Tests | PowerShell Test Center | xUnit + Testcontainers + Playwright inside solution |
| Ops | Windows/WPF/Task Scheduler | Docker Compose + Caddy + Cloudflare on Ubuntu 24.04 |
| Payroll | On-the-fly | Payroll Runs + Payslips + Lock |
| Billing | Charges/payments | Receipt sequence + discounts + allocations + ledger |
| Reports | Client print | HTML print + Excel + server PDF when needed |

**Data access decision:** keep **Npgsql + Dapper** rather than rewriting to EF Core. The existing SQL is the proven behavior; a full EF Core rewrite adds risk without business value. New modules use the same repository pattern.

---

## 10. Remediation Plan

### Phase 1.0 — Safety (now)
- [ ] Backup project files + a DB dump (if production DB is accessible).
- [ ] Freeze features.
- [ ] Close the 3 business decisions below.
- [ ] Create `legacy/` copy or separate branch (no Git repo currently → folder copy).

### Phase 1.1 — P0 guards
- [ ] Block Trash purge for financial entities (`payment`, `monthly-charge`, `teacher-attendance`, `student-attendance`, `enrollment`).
- [ ] Add `audit_log` append-only trigger; restrict restore allowlist.
- [ ] Remove hard-delete endpoints.
- [ ] Add login rate limit/lockout + login audit.
- [ ] Add security headers/HSTS/CSP; CSRF/Origin checks.
- [ ] Disable `ApplyMigrationsOnStartup` in Production.
- [ ] Remove `DAR_ISOLATED_*` from production API.

### Phase 1.2 — Remove desktop/.bat
- [ ] Document direct PowerShell commands.
- [ ] Delete `.bat` files.
- [ ] Remove `launch-hidden.vbs`.
- [ ] Keep `run-desktop.ps1` temporarily for local legacy runs, then remove.

### Phase 1.3 — Schedule data fix
- [ ] Owner approves correct times for `00:07/00:10/00:11`.
- [ ] Backup.
- [ ] Data-only update with audit.
- [ ] Run preflight; apply Migration 012.
- [ ] Re-run attendance/payroll regression.

### Phase 2 — Web Foundation
- [ ] `Dar.slnx` + `src/Host/Dar.Api` + `src/Common` + first module.
- [ ] `apps/web` Next.js shell + design tokens + login.
- [ ] Email OTP + Google identity module.
- [ ] OpenAPI + generated TS client.
- [ ] Same-origin `/api` proxy.
- [ ] xUnit/Testcontainers/Playwright baseline.
- [ ] Docker Compose + CI.

### Phase 3 — Core Migration
- [ ] Secretariat (students/guardians/teachers).
- [ ] Academic (groups/schedules/enrollment).
- [ ] Attendance.
- [ ] Port UI screens.

### Phase 4 — Money
- [ ] Payroll runs/payslips/lock.
- [ ] Receipt numbers/discounts/fee plans.
- [ ] Treasury/ledger/period close.
- [ ] Reports/exports.

### Phase 5 — UI/UX
- [ ] Design system + shadcn.
- [ ] Arabic + English.
- [ ] Motion + visual QA + accessibility.
- [ ] Print/PDF.

### Phase 6 — Launch
- [ ] Ubuntu 24.04 + Docker + Caddy + Cloudflare.
- [ ] Backups/offsite/restore drill.
- [ ] Monitoring/alerts.
- [ ] Staging → production.
- [ ] Training/handover.

---

## 11. Decisions Required

| ID | Decision | Owner answer / default | Blocks |
|---|---|---|---|
| **D-01** | Correct times for the 3 conflicting slots (`00:07/00:10/00:11`) | Owner does not know the Dar times personally. Do **not** invent. Legacy UI acceptance doc records intended Sunday times `07:00/10:00/11:00`; verify production with preflight + backup before any update. Default: no production change; build/test on a copy. | Migration 012 / production startup |
| **D-02** | Mid-month pause billing: prorate by active days, full month, or manual? | Prorate by active days, editable before save (pending explicit approval) | Billing rules |
| **D-03** | Financial history retention: never purge, or archive after N years? | Never purge; archive only | Trash/Purge design |
| **D-04** | Emails for existing users/teachers (OTP/Google) | Resolved: manual emails + Google; temporary password fallback until emails are collected. Credentials are never stored in docs/repo. | Auth migration |
| **D-05** | Keep any desktop features? | No; web only | Remove desktop |
| **D-06** | Launch priority after core: payroll, billing, or reports? | Payroll first | Roadmap |
| **D-07** | Backend stack: .NET or TypeScript/NestJS? | .NET final; TypeScript rejected | Architecture |
| **D-08** | Google login now or later? | Deferred; password + sessions now | Auth |

---

## 12. Evidence Log

Commands run:

```bash
dotnet --list-sdks          # 10.0.401
dotnet build backend/...    # 0 warnings, 0 errors
npm install                 # 74 packages
npm run build               # 713.91 KB JS, 94.40 KB CSS
docker run postgres:17      # isolated audit DB on 55432
dotnet run --project ...    # API on 5080
```

API checks:

- `GET /health` → 200, database connected.
- `GET /api/students` without cookie → 401.
- `DELETE /api/students/{id}` → 409 (middleware guard).
- `POST /api/setup/admin` → 200.
- `POST /api/teachers`, `/students`, `/circles`, `/enrollments`, `/schedule-slots`, `/charges`, `/payments`, `/teacher-attendance`, `/student-attendance` → 200/201.
- `GET /api/collections?month=2026-11` → amountDue 600, paid 300, balance 300.
- `GET /api/teachers/{id}/history` → payable 120 for 60 min at 120/h.
- Rate change 120→150 + re-save → snapshot remained 120.
- Substitute teacher 100/h → payable 100, original 0.
- `pg_trigger` on `audit_log` → 0.
- `auth.*` audit rows → 0.

---

## 13. Sign-off

- [ ] P0 findings reviewed by owner.
- [ ] D-01/D-04 answered.
- [ ] Backup verified.
- [ ] Phase 1.1 approved.
- [ ] Phase 2 skeleton approved.
