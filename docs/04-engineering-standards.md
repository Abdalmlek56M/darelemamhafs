# RIGX Dar — Engineering Standards

**Status:** Baseline (updated 22 Nov 2026 — Docs Reset). Applies to every change.
**Scope:** C#/.NET, React 19 + Vite + TypeScript, API contract, tests, docs, review.

---

## 1. General Principles

- **Production-grade, not demo.**
- **Small files, clear boundaries.** Every use case in its own folder, every responsibility in its own file.
- **Tests live in `tests/` projects**, not in a separate test application and not in the product UI.
- **No duplication.** If the same rule appears twice, extract it.
- **No dead code.** Delete or don't add.
- **Explicit over clever.** Readable code beats clever code.
- **Domain rules in Domain.** No Npgsql/Dapper/HTTP/ASP.NET in Domain.
- **Errors are explicit.** No silent catch, no empty catch.
- **Security is a constraint, not a phase.**
- **Work in roadmap order.** One vertical slice at a time; no random branching or unrelated refactors.
- **If a business decision is missing, stop and ask.**

---

## 2. .NET Standards

### 2.1 Platform

- .NET 10 LTS.
- C# latest supported.
- Nullable enabled.
- Treat warnings seriously; no new warnings in changed files.
- `TimeProvider` instead of `DateTime.UtcNow`.
- `CancellationToken` on async I/O.
- `async` all the way; no `.Result`/`.Wait()`.

### 2.2 Structure

```
src/Host/Dar.Api/              composition root, middleware, OpenAPI, health
src/Modules/<Module>/
  Domain/                      entities, value objects, rules, exceptions
  Features/<UseCase>/          Request, Handler, Validator, Endpoint
  Persistence/                 DbContext, configurations, migrations
  Contracts/                   DTOs/interfaces for other modules
  <Module>Module.cs            DI + endpoint mapping
src/Common/
  Domain/                      AppException, Paging, Time, Money, PublicCode
  Infrastructure/              audit interceptor, soft delete, outbox, storage
  Web/                         ProblemDetails, endpoint filters, auth helpers
tests/
  Unit/                        domain rules
  Integration/                 API + PostgreSQL (Testcontainers)
  Contract/                    OpenAPI diff
```

### 2.3 Naming

- One public type per file, file name matches type.
- File-scoped namespaces.
- `sealed` by default for classes not designed for inheritance.
- Async methods end with `Async`.
- Request/Handler/Validator/Endpoint names match the use case.
- No abbreviations except common (`Id`, `Dto`, `Api`).

### 2.4 Domain

- Entities have behavior, not just properties.
- Status transitions in methods, not scattered setters.
- Money uses `decimal`; never `double`.
- Dates use `DateTimeOffset`/`DateOnly` appropriately.
- Domain throws `AppException` subclasses for expected failures.
- No EF attributes in Domain if avoidable.
- Pure rules are unit-tested without DB.

### 2.5 Features

Each use case:

```
Features/ApprovePayroll/
  ApprovePayrollRequest.cs
  ApprovePayrollHandler.cs
  ApprovePayrollValidator.cs
  ApprovePayrollEndpoint.cs
```

- Endpoint is thin: auth, validate, call handler, return typed result.
- Handler orchestrates; no HTTP.
- Validator covers shape/range; domain covers business rules.
- No service with 20 methods.
- No cross-module DbContext.

### 2.6 Persistence

- Dapper repositories with explicit SQL; **no EF Core** in the target path.
- No lazy loading or implicit graph loading.
- Project to DTOs; don't load graphs unnecessarily.
- Transactions for multi-step writes.
- Row locks for money/stock-like races.
- Migrations per module; reviewed.
- No raw SQL without parameters.
- No `ExecuteUpdate`/`ExecuteDelete` in audited paths (bypasses audit).

### 2.7 Errors

- Expected failures: `AppException` subclass with status code + message + optional fields.
- Global `ProblemDetailsExceptionHandler`.
- No try/catch in endpoints for business errors.
- Log unexpected exceptions with correlation id.
- Never return stack traces/DB details.

### 2.8 Validation

- FluentValidation per request.
- One endpoint filter runs validators.
- Whitelist fields.
- Max lengths/ranges/enums.
- Cross-field rules in validator or domain, not UI.

### 2.9 Authorization

- Permission constants, grouped by area.
- `RequirePermission(...)` on every admin endpoint.
- Resource policies for row-level access.
- Tests for positive and negative.
- Never trust client-side role checks.

### 2.10 Logging

- Serilog structured logs.
- Correlation id from request.
- No PII/secrets.
- Log business events at Information; failures at Warning/Error.
- No `Console.WriteLine`.

### 2.11 Tests

- xUnit.
- Tests are projects inside the solution (`tests/Unit`, `tests/Integration`, `tests/Contract`), not a separate application.
- Domain unit tests: no DB.
- Integration: real PostgreSQL via Testcontainers.
- API contract test: OpenAPI file matches code.
- Naming: `Method_State_Expected`.
- One behavior per test.
- No test data in production.
- No test panel/routes in the product.

---

## 3. React 19 + Vite / TypeScript Standards

> الواجهة النهائية: React 19 + Vite + TypeScript (ADR-0001). لا Next.js، لا `apps/web`، لا Server Components/BFF.

### 3.1 Platform

- React 19 + Vite 6 + TypeScript strict (`tsc -b` في البناء).
- No `any` without a comment explaining why.
- DOM client-only؛ لا SSR/RSC؛ الواجهة SPA واحدة تُبنى إلى `frontend/dist`.
- No secrets in client code أو `import.meta.env` العام.

### 3.2 Structure (الموجود فعليًا)

```
frontend/src/
  main.tsx              route switch حسب location.pathname (home / teacher / supervisor / admin)
  App.tsx               admin shell: sidebar, topbar, theme, login gate
  SystemAdminView.tsx   لوحة النظام (backup/export/trash/audit/settings)
  home/                 الصفحة العامة
  pages/                صفحات الإدارة (dashboard, students, teachers, circles, schedule, ...)
  application/          app state hooks + selectors (useDarApplication, useDarAuth, ...)
  components/           shared UI + dialogs + ManagementReportBuilder
  domain/               types + defaults
  services/             apiClient (fetch فقط — لا desktop bridges؛ نسخة WPF/WebView2 أُزيلت)
  system/               ثوابت/تنسيق لوحة النظام
  teacher/              TeacherApp + SupervisorWorkspace + teacherApi/teacherTypes
  styles/               CSS tokens + styles لكل منطقة
```

- التوجيه يدوي (لا router library) — أي صفحة جديدة تُضاف في `main.tsx`/`App.tsx`.
- Shared UI في `components/`؛ لا business rules في المكوّنات — القواعد في الخادم أو دوال/selectors نقية.
- استدعاء API عبر `services/apiClient.ts` (admin → legacy `/api`) أو `teacher/teacherApi.ts` (teacher/supervisor → `/api/v1`).
- لا تكرر منطق التنسيق المالي/التاريخي؛ استخدم `lib/formatters.ts` و`lib/dates.ts`.
- الملفات > 400 سطر تُقسَّم قبل إضافة أي feature جديد (انظر §6).

### 3.3 Data Fetching

- `fetch` + `credentials: 'include'` + `cache: 'no-store'`؛ same-origin فقط.
- No tokens in browser storage (لا localStorage إلا لتفضيلات غير حساسة مثل username profiles/theme).
- Handle loading/empty/error/no-permission في كل صفحة.
- عند تغيير mutation: أعد تحميل القوائم المتأثرة صراحةً (لا cache invalidation library).

### 3.4 Forms

- نماذج خاضعة للتحكم (`useState`) مع تحقق بسيط في الواجهة؛ **التحقق النهائي إلزامي على الخادم**.
- Disable submit while pending.
- Show field errors + form error، وأكد العمليات الحساسة بحوار مناسب للموبايل.
- Optimistic updates فقط مع rollback — الافتراضي: انتظر استجابة الخادم.

### 3.5 Styling & RTL

- CSS tokens في `frontend/src/styles/`؛ لا Tailwind.
- **العربية فقط الآن** (RTL)؛ الإنجليزية مؤجلة (ADR-0004) — لا تُضِف نصوصًا مختلطة اللغة.
- استخدم خصائص منطقية وحقول `dir="ltr"` للأرقام/الهواتف/الأكواد فقط.
- Font: Cairo؛ navy/teal + glass cards؛ dark/light عبر `data-theme`.
- Print styles للتقارير/الإيصالات عبر `window.print()`.

### 3.6 Accessibility

- WCAG 2.2 AA كهدف.
- Keyboard navigation.
- Focus visible.
- Labels and `aria-describedby` for errors.
- Contrast 4.5:1.
- Touch targets 44px على الموبايل.
- No motion-only information.
- `prefers-reduced-motion`.

### 3.7 Animation

- framer-motion.
- 150–250ms micro-interactions.
- Transform/opacity only.
- No row-by-row table animation.
- Stagger small lists only.
- Skeleton → content.
- Respect reduced motion.
- Test on low-end mobile.

### 3.8 Performance

- Route-level lazy loading (مثل `TeacherApp` عبر `lazy()`).
- Code split charts/editors.
- Virtualize large tables (هدف).
- Bundle analyzer عند الحاجة.
- No unnecessary client libraries.
- Budgets: LCP < 2.5s, INP < 200ms, CLS < 0.1.

### 3.9 Tests

- Vitest لـ pure selectors/functions (`npm test`) — 6 اختبارات حالية.
- React Testing Library لسلوك المكوّنات = هدف.
- Playwright E2E + visual regression = هدف: smoke في Phase 2.5، وE2E كامل في Phase 2.9 (غير موجودة بعد).
- axe for accessibility = هدف.
- No test panel/routes in production.

---

## 4. API Contract

> **الحالة (27 Nov 2026):** العقد موجود لكنه ناقص (27 path مقابل 82 route mapping في `src/`) و**غير مستخدم** في الواجهة، ولا يوجد contract test. القواعد التالية هي الهدف الملزم حتى يُنجَز Phase 2.5.

- OpenAPI 3.1 generated from code (`/api/openapi/v1.json` من `src/Host/Dar.Api`).
- `packages/api-client/openapi.v1.json` committed.
- Contract test fails on diff.
- TypeScript types generated, not hand-written (حاليًا مكتوبة يدويًا مؤقتًا).
- `openapi-fetch` typed wrapper.
- كل تغيير endpoint يحدّث الـspec (و/أو الأنواع اليدوية مؤقتًا) في نفس الـcommit.
- Breaking changes need a version or a migration plan.

---

## 5. Database Standards

- Schema per module.
- Migrations per module.
- Expand/contract.
- No destructive change without backup.
- Constraints in DB.
- Indexes for filters/sorts used by reports.
- Money `numeric(14,2)`.
- Timestamps UTC.
- Soft delete for master data.
- Audit for business writes.
- No `SELECT *` in production queries.

---

## 6. File Size Budget

- **Target:** 200–300 lines per new file.
- **Hard maximum:** 400 lines for hand-written code.
- **Exceptions:** generated code/schema, or a legacy file explicitly listed below.
- A legacy file over the limit must be split before adding a new feature to it.
- One use case per folder; do not create a "god service".
- If a file grows beyond 300 lines, split by responsibility before committing.

**الحالة الفعلية (27 Nov 2026 — بعد Z1 splits):**

| File | Lines | Action |
|---|---:|---|
| `frontend/src/SystemAdminView.tsx` | 401 | **يتجاوز الحد بقليل** — يحتاج تقسيمًا (أعلى ملف واجهة) |
| `frontend/src/teacher/useTeacherAppState.ts` | 378 | مراقبة — قرب الحد |
| `frontend/src/components/ManagementReportBuilder.tsx` | 382 | مراقبة — قرب الحد |
| `frontend/src/meet/MeetPage.tsx` | 387 | مراقبة — قرب الحد |
| `backend/DarEltahfeez.Api/DomainEndpoints.ScheduleAttendance.cs` | 319 | مراقبة |
| `src/Modules/Teaching/.../Supervisor/StudentsEndpoint.cs` | 358 | أعلى ملف في `src/` |

**تم تقسيمها (Z1) — لم تبقَ ملفات فوق 400:**

- `AuthEndpoints.cs` 472 → 72 + `SignIn` 258 / `AdminUsers` 244 / `Helpers` 168 / `Session` 70.
- `SystemAdminEndpoints.cs` 401 → 38 + 12 partial (`Insights` 345، `Trash` 253، `AuditTrash` 182، ...).
- `SystemAdminEndpoints.Requests.cs` 408 → 117 + `RequestsReview` 150 / `RequestsEdit` 178.
- `TeacherApp.tsx` 532 → 8 + `TeacherAppView` 222 + `useTeacherAppState` 378.
- `teacherTypes.ts` 406 → 4 + `teacherTypesCore` 152 / `Live` 97 / `Supervisor` 200.
- `useDarApplication.ts` 570 → 12 + `useDarApplicationState` 241 / `useDarActionsA` 276 / `useDarActionsB` 275.
- `MeetCalendarRepository.cs` 424 → 236 + `Events` 200؛ `MeetBotJobRepository.cs` → 193/168/151.
- `DomainEndpoints` الأصلي (1,680) مقسّم إلى 13 partial تحت 400 سطر.

- أكبر ملف في `tests/` = **360 سطر** (`tests/Dar.IntegrationTests/Identity/LoginLockoutTests.cs`).
- أكبر ملف npm code في `frontend/src/` = 401 (`SystemAdminView.tsx`)؛ `useTeacherAppState` 378.
- سكربتات النشر ليست ضمن حد الملفات البرمجية لكن `deploy/update.sh` يبقى نقطة الدخول الواحدة (انظر `docs/11-deployment.md`)، وأي split له أجزاء مساعدة لا يغيّر ترتيب العمليات.
- أي ملف يتجاوز 400 سطر لا تُضاف إليه ميزة جديدة قبل تقسيمه.

---

## 7. Git & Docs

- Small, focused changes.
- Commit message: `area: imperative summary`.
- No secrets/archives/logs/screenshots in Git.
- Update docs + checkpoint in the same change.
- ADR for architectural decisions.
- **Git repo creation only by explicit owner request.**
- No `.bat` files.
- Push only after `gh auth login` and a confirmed remote.
- Never force-push or rewrite shared history.

---

## 8. Definition of Done

- [ ] Build passes.
- [ ] Tests pass.
- [ ] No new warnings.
- [ ] No secrets.
- [ ] Auth/RBAC negative tests.
- [ ] Financial rules match `docs/01-business.md`.
- [ ] Audit log.
- [ ] Loading/empty/error states.
- [ ] RTL + accessibility.
- [ ] Docs + checkpoint updated.
- [ ] No P0/P1.

---

## 9. Code Review Checklist

- [ ] Does it belong to the current roadmap step?
- [ ] Is the domain rule in Domain, not endpoint/component?
- [ ] Is authorization enforced server-side?
- [ ] Is money decimal and rounded explicitly?
- [ ] Is the operation transactional/idempotent where needed?
- [ ] Are errors mapped to ProblemDetails?
- [ ] Are inputs validated?
- [ ] Is there an audit entry?
- [ ] Are tests meaningful (not just coverage)?
- [ ] Is the UI RTL and accessible?
- [ ] Are loading/empty/error states handled?
- [ ] Are docs/checkpoint updated?
- [ ] Any secret/dead code/duplication?
