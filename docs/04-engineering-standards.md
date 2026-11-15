# RIGX Dar — Engineering Standards

**Status:** Baseline. Applies to every change.
**Scope:** C#/.NET, Next.js/TypeScript, API contract, tests, docs, review.

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

- EF Core configurations per entity.
- No lazy loading.
- `AsNoTracking()` for reads.
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

## 3. Next.js / TypeScript Standards

### 3.1 Platform

- Next.js 16 App Router.
- React 19.
- TypeScript strict.
- No `any` without a comment explaining why.
- Server Components by default; `"use client"` only when needed.
- No secrets in `NEXT_PUBLIC_*`.

### 3.2 Structure

```
apps/web/src/
  app/                  routes, layouts, loading/error
  components/ui/        shadcn/Radix primitives
  components/layout/    shell, sidebar, header
  features/<feature>/   components, hooks, schemas
  lib/api/              generated client + server fetch
  lib/auth/             session helpers (server-only)
  lib/format/           money/date/number
  i18n/                 next-intl config
  messages/             ar.json, en.json
  styles/               tokens/globals
```

- Feature code stays in `features/`.
- Shared UI in `components/ui/`.
- No business rules in components; use server or shared pure functions.
- `server-only` for server modules.
- No direct API URL in client components.

### 3.3 Data Fetching

- Server Components fetch via same-origin `/api`.
- Mutations: Server Actions or Route Handlers.
- TanStack Query for interactive client screens, through same-origin.
- No tokens in browser storage.
- Cache deliberately; revalidate after mutations.
- Handle loading/empty/error/unauthorized.

### 3.4 Forms

- React Hook Form + Zod.
- Server-side validation is mandatory; client validation is UX.
- Disable submit while pending.
- Show field errors + form error.
- Confirm destructive actions.
- Optimistic updates only with rollback.

### 3.5 Styling & RTL

- Tailwind CSS 4 + design tokens.
- **Arabic + English** via `next-intl`; Arabic default.
- Logical properties (`ms-`, `me-`, `ps-`, `pe-`).
- `dir="rtl"` for Arabic, `dir="ltr"` for English.
- No hardcoded `left/right` unless intentional.
- Font: IBM Plex Sans Arabic or Cairo.
- Dark mode optional; contrast checked.
- Print styles for receipts/payslips.

### 3.6 Accessibility

- WCAG 2.2 AA.
- Keyboard navigation.
- Focus visible.
- Labels and `aria-describedby` for errors.
- Contrast 4.5:1.
- Touch targets 44px.
- No motion-only information.
- `prefers-reduced-motion`.

### 3.7 Animation

- Motion (`motion/react`).
- 150–300ms micro-interactions.
- Transform/opacity only.
- No row-by-row table animation.
- Stagger small lists only.
- Skeleton → content.
- Respect reduced motion.
- Test on low-end mobile.

### 3.8 Performance

- RSC + streaming + Suspense.
- Code split charts/editors.
- Virtualize large tables.
- Bundle analyzer.
- No unnecessary client libraries.
- Budgets: LCP < 2.5s, INP < 200ms, CLS < 0.1.

### 3.9 Tests

- Vitest/React Testing Library for components/hooks.
- Playwright for E2E.
- Visual regression for key screens.
- axe for accessibility.
- No test panel/routes in production.

---

## 4. API Contract

- OpenAPI 3.1 generated from code.
- `packages/api-client/openapi.v1.json` committed.
- Contract test fails on diff.
- TypeScript types generated, not hand-written.
- `openapi-fetch` typed wrapper.
- Every change to an endpoint updates the contract in the same change.
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

**Known legacy exceptions (must shrink):**

| File | Lines | Action |
|---|---:|---|
| `backend/DarEltahfeez.Api/DomainEndpoints.cs` | 1,680 | split by domain before migration |
| `backend/DarEltahfeez.Api/SystemAdminEndpoints.cs` | 697 | split by admin area |
| `backend/DarEltahfeez.Api/AuthEndpoints.cs` | 352 | replace with Identity module |
| `frontend/src/application/useDarApplication.ts` | 874 | split by feature |
| `frontend/src/SystemAdminView.tsx` | 456 | split by tab |
| `frontend/src/components/ManagementReportBuilder.tsx` | 360 | split by report type |

The new `src/` and `tests/` files are all under 200 lines (largest: 152).

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

## 7. Definition of Done

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

## 8. Code Review Checklist

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
