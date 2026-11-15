# RIGX Dar — Roadmap

**Status:** Current phase = **0.2 Intake**.
**Rule:** Work on the next unchecked step only. Update the checkpoint in the same change.

---

## Phase 0 — Foundation & Audit

### 0.1 Foundation docs + skill — ✅ Done
- [x] `deepseek.md`
- [x] `docs/01-business.md`
- [x] `docs/02-architecture.md`
- [x] `docs/03-security.md`
- [x] `docs/04-engineering-standards.md`
- [x] `docs/05-roadmap.md`
- [x] `docs/06-operations.md`
- [x] `docs/08-testing.md`
- [x] Skill `rigx-dar`

**Checkpoint:** `docs/checkpoints/0.1-foundation.md`

### 0.2 Intake existing project — ✅ Done
- [x] Receive project without `node_modules`, `.next`, `.env`, secrets, DB dumps.
- [x] Located at `DarEltahfeez/` (not moved to `existing/` yet).
- [x] Inventory: stack, versions, package manager, entry points.
- [x] Read `.bat` files and document what they do.
- [x] Map routes/screens.
- [x] Map DB schema/tables.
- [x] List known bugs/features.

**Checkpoint:** `docs/checkpoints/0.2-intake.md`

### 0.3 Baseline run + screenshots — ⚠️ Partial
- [x] Install/build.
- [x] Run locally (isolated Docker PostgreSQL).
- [ ] Screenshots: desktop/tablet/mobile, RTL, empty/loading/error (browser unavailable in this session).
- [x] Record build time, bundle size, warnings.
- [x] Isolated DB copy (no production data touched).

**Checkpoint:** `docs/checkpoints/0.3-baseline.md`

### 0.4 Audit report — ✅ Done (visual review pending)
- [x] Security audit.
- [x] Data integrity audit.
- [x] Financial correctness audit.
- [x] Architecture audit.
- [x] Performance audit (baseline only).
- [~] UX/accessibility audit (visual review pending).
- [x] Ops/deployment audit.
- [x] P0/P1/P2 report with evidence.

**Checkpoint:** `docs/checkpoints/0.4-audit.md`

### 0.5 Architecture confirmation
- [x] Auth model: Email OTP + Google.
- [x] Language: Arabic + English.
- [x] DB: PostgreSQL on the same server.
- [x] Test separation: test projects inside the solution.
- [ ] Confirm modules.
- [ ] Confirm DB schema plan.
- [ ] Confirm deployment topology.
- [ ] Sign off.

**Checkpoint:** `docs/checkpoints/0.5-architecture-signoff.md`

### 0.6 Legacy docs consolidation — ✅ Done
- [x] Read the key `DarEltahfeez/docs` references.
- [x] Extracted business rules, schema map, operations, UI acceptance checklist.
- [x] Archived the old `docs/` folder outside the project.
- [x] New `docs/` structure is the source of truth.

**Checkpoint:** `docs/checkpoints/0.6-legacy-docs.md`

### 0.7 Git baseline — ✅ Done
- [x] `git init -b main`.
- [x] `.gitignore` / `.gitattributes`.
- [x] Local baseline commit (`bac94fa`).
- [x] GitHub remote: `https://github.com/Abdalmlek56M/darelemamhafs.git`.
- [x] Push `main` (authenticated via cached Git credentials).
- [x] Subsequent commits pushed (`d8c7b29`).

**Checkpoint:** `docs/checkpoints/0.7-git-baseline.md`

---

## Phase 1 — Stabilize Existing Project

### 1.1 P0 fixes
- [x] No secrets found in repo; shared config stays outside the source tree.
- [~] Auth: rate limit + login audit done; Email OTP/Google + lockout pending.
- [~] Financial deletion: permanent purge of financial trash blocked; CASCADE/hard-delete cleanup pending.
- [x] Local DB is loopback-only; production ports handled in Phase 6.
- [x] Source backup created; production DB backup pending access.
- [~] Test data isolated; test modes inside API still pending removal.

**Checkpoint:** `docs/checkpoints/1.1-p0-fixes.md`

### 1.2 Remove `.bat` + proper web run
- [x] Document what each `.bat` does.
- [x] Replace with `dotnet`/`npm`/PowerShell commands.
- [x] Delete all 12 `.bat` files.
- [ ] Verify app runs as web app.
- [ ] Remove desktop-only assumptions.

**Checkpoint:** `docs/checkpoints/1.2-remove-bat.md`

### 1.3 Backup + restore
- [ ] PostgreSQL dump.
- [ ] Media/files.
- [ ] Manifest + checksum.
- [ ] Offsite copy.
- [ ] Restore drill.
- [ ] Document runbook.

**Checkpoint:** `docs/checkpoints/1.3-backup-restore.md`

### 1.4 Test baseline
- [ ] Domain unit tests for critical rules.
- [ ] Integration tests with Testcontainers.
- [ ] API contract test.
- [ ] Playwright smoke.
- [ ] Test DB isolation.
- [ ] Tests are projects inside the solution, not a separate app.
- [ ] CI runs tests.

**Checkpoint:** `docs/checkpoints/1.4-test-baseline.md`

---

## Phase 1.5 — Legacy File Split

> **Priority:** finish this before UI/features. No behavior change while splitting. Full map: `docs/09-legacy-refactor-plan.md`.

### 1.5.1 Backend split — 🟡 In progress
- [x] `DomainEndpoints` → 13 partial files; max 376 lines.
- [x] `DomainEndpoints.Students.cs`
- [x] `DomainEndpoints.Teachers.cs`
- [x] `DomainEndpoints.Circles.cs`
- [x] `DomainEndpoints.Enrollments.cs`
- [x] `DomainEndpoints.ScheduleAttendance.cs`
- [x] `DomainEndpoints.Collections.cs`
- [x] `DomainEndpoints.Advertising.cs`
- [x] `DomainEndpoints.OperatingExpenses.cs`
- [x] `DomainEndpoints.History.cs`
- [x] `DomainEndpoints.Validation.cs`
- [x] `DomainEndpoints.EnrollmentLifecycle.cs`
- [ ] `SystemAdminEndpoints` split.
- [ ] `AuthEndpoints` split.
- [ ] `Program.cs` composition extraction.
- [ ] `AuditMiddleware` split.
- [ ] `SystemAdminService` split.

**Checkpoint:** `docs/checkpoints/legacy-split-1.1.md`

### 1.5.2 Frontend split — ⏳ Pending
- [ ] `useDarApplication` → feature hooks.
- [ ] `SystemAdminView` → tabs.
- [ ] `ManagementReportBuilder` → report types.
- [ ] `App.tsx` → shell/sidebar/topbar.

### 1.5.3 Test migration — ⏳ Pending
- [ ] Port high-value PowerShell/SQL tests.
- [ ] Remove GUI Test Center references (archived).
- [ ] Add Playwright E2E.

### 1.5.4 UI sample gate — ⏳ Pending
- [ ] Produce a visual sample before any UI implementation.
- [ ] Owner approves the sample.
- [ ] Record approval in a checkpoint.

---

## Phase 2 — Backend Foundation (.NET)

> **Backend decision:** .NET is final. TypeScript/NestJS is rejected. Do not build a second backend.

### 2.1 Solution structure
- [x] `Dar.slnx`
- [x] `src/Host/Dar.Api`
- [x] `src/Common/Dar.Common`
- [x] `src/Modules` created with first feature only.
- [x] `tests/Dar.UnitTests` + `tests/Dar.IntegrationTests`
- [x] `.editorconfig`, `Directory.Build.props`.
- [x] Build 0 warnings / 0 errors; 9 unit + 3 integration tests passing.

**Checkpoint:** `docs/checkpoints/2.1-solution.md`

### 2.2 Common building blocks
- [x] `AppException` + ProblemDetails.
- [~] FluentValidation filter (package added; filter pending).
- [x] Paging (`PagedResult<T>`).
- [~] TimeProvider.
- [~] Audit interceptor.
- [~] Soft delete.
- [~] Concurrency.
- [ ] Outbox.
- [~] Correlation id.
- [x] Health endpoints (`/health/live`, `/health/ready`).

**Checkpoint:** `docs/checkpoints/2.2-common.md`

### 2.3 Identity/auth
- [x] Auth model: Email OTP + Google.
- [~] Users/roles/permissions (uses `app_users` + `user_permissions`; admin endpoints pending).
- [x] Email OTP + Google (Google configured path; client id pending).
- [x] Sessions + cookies + revocation.
- [~] CSRF/origin checks.
- [ ] Step-up codes.
- [x] Rate limits (10/min/IP on auth endpoints).
- [~] Negative tests (OTP reuse/expiry/attempts pending).

**Checkpoint:** `docs/checkpoints/2.3-identity.md`

### 2.4 PostgreSQL + Npgsql/Dapper
- [~] Database + roles (DB validated; separate migration/read roles pending).
- [x] One `public` schema initially; module boundaries in code.
- [x] Migration runner (`--migrate`, checksums, advisory lock, 13 SQL files, idempotent).
- [~] Seed permissions/settings (existing DB has them; new fresh seed pending).
- [ ] Backup script.

**Checkpoint:** `docs/checkpoints/2.4-database.md`

### 2.5 OpenAPI + client
- [x] OpenAPI 3.1.
- [x] Commit `openapi.v1.json`.
- [ ] Contract test.
- [x] Generate TS types (`openapi-typescript`).
- [x] `openapi-fetch` wrapper.
- [ ] Same-origin `/api` proxy (Next.js next).

**Checkpoint:** `docs/checkpoints/2.5-contract.md`

### 2.6 CI/CD
- [x] Build/test workflow.
- [ ] Contract diff.
- [x] Dependency audit.
- [x] Secret scan.
- [ ] Docker images.
- [ ] Deploy script.
- [ ] Rollback.

**Checkpoint:** `docs/checkpoints/2.6-ci-cd.md`

---

## Phase 3 — Core Domain

### 3.1 Secretariat
- [x] Students list/get/create (paged search).
- [ ] Students update/archive.
- [ ] Guardians.
- [ ] Teachers.
- [ ] Documents.
- [ ] Enrollment/withdrawal.
- [x] Search/filter.
- [x] Permissions.
- [x] Audit on create.

**Checkpoint:** `docs/checkpoints/3.1-secretariat.md`

### 3.2 Academic
- [ ] Groups.
- [ ] Levels.
- [ ] Schedules.
- [ ] Rooms.
- [ ] Holidays.
- [ ] Conflict detection.

**Checkpoint:** `docs/checkpoints/3.2-academic.md`

### 3.3 Attendance
- [ ] Student attendance.
- [ ] Teacher attendance.
- [ ] Statuses.
- [ ] Approval.
- [ ] Edit with reason/audit.
- [ ] Make-up sessions.
- [ ] Reports.

**Checkpoint:** `docs/checkpoints/3.3-attendance.md`

---

## Phase 4 — Money

### 4.1 Payroll
- [ ] Teacher rates (effective dates).
- [ ] Session pay rules.
- [ ] Payroll draft.
- [ ] Review/approve/lock.
- [ ] Payslips.
- [ ] Advances/deductions.
- [ ] Adjustments.
- [ ] Journal postings.
- [ ] 3 numeric scenarios.

**Checkpoint:** `docs/checkpoints/4.1-payroll.md`

### 4.2 Billing
- [ ] Fee plans.
- [ ] Charges (idempotent).
- [ ] Proration.
- [ ] Discounts.
- [ ] Payments/allocations.
- [ ] Receipts/sequences.
- [ ] Arrears/aging.
- [ ] Refunds/credit notes.
- [ ] Journal postings.

**Checkpoint:** `docs/checkpoints/4.2-billing.md`

### 4.3 Treasury + ledger
- [ ] Accounts.
- [ ] Expenses.
- [ ] Transfers.
- [ ] Reconciliation.
- [ ] Period close.
- [ ] Trial balance.
- [ ] Income statement.

**Checkpoint:** `docs/checkpoints/4.3-treasury.md`

### 4.4 Reports
- [ ] 12 reports.
- [ ] Filters.
- [ ] Excel/CSV.
- [ ] Print/PDF.
- [ ] Dashboard KPIs.
- [ ] Performance.

**Checkpoint:** `docs/checkpoints/4.4-reports.md`

---

## Phase 5 — Frontend

### 5.1 Design system
- [ ] Tokens.
- [ ] Fonts.
- [ ] Arabic + English (next-intl).
- [ ] RTL/LTR.
- [ ] UI primitives.
- [ ] States.
- [ ] Storybook optional.

**Checkpoint:** `docs/checkpoints/5.1-design-system.md`

### 5.2 Auth + layout
- [ ] Login.
- [ ] Session.
- [ ] Sidebar/header.
- [ ] Permissions-aware UI.
- [ ] Error/loading.

**Checkpoint:** `docs/checkpoints/5.2-auth-layout.md`

### 5.3 Secretariat screens
- [ ] Students list/detail/form.
- [ ] Guardians.
- [ ] Teachers.
- [ ] Documents.

**Checkpoint:** `docs/checkpoints/5.3-secretariat-ui.md`

### 5.4 Academic + attendance screens
- [ ] Groups.
- [ ] Schedule.
- [ ] Attendance (mobile-first).
- [ ] Approval.
- [ ] Edits.

**Checkpoint:** `docs/checkpoints/5.4-academic-attendance-ui.md`

### 5.5 Payroll + billing screens
- [ ] Rates.
- [ ] Payroll run.
- [ ] Payslip.
- [ ] Fees.
- [ ] Payments/receipts.
- [ ] Statement/arrears.

**Checkpoint:** `docs/checkpoints/5.5-money-ui.md`

### 5.6 Reports + print
- [ ] Reports list.
- [ ] Filters.
- [ ] Export.
- [ ] Print layouts.
- [ ] Dashboard.

**Checkpoint:** `docs/checkpoints/5.6-reports-ui.md`

### 5.7 Motion + visual QA
- [ ] Page transitions.
- [ ] Micro-interactions.
- [ ] Skeleton/optimistic.
- [ ] Reduced motion.
- [ ] Screenshots/visual regression.
- [ ] axe/Lighthouse.

**Checkpoint:** `docs/checkpoints/5.7-visual-qa.md`

---

## Phase 6 — Hardening & Launch

### 6.1 Security review
- [ ] Auth/RBAC negative tests.
- [ ] OWASP check.
- [ ] Dependency audit.
- [ ] Secret scan.
- [ ] Headers/CSP.
- [ ] External pen test (recommended).

**Checkpoint:** `docs/checkpoints/6.1-security-review.md`

### 6.2 Performance/load
- [ ] API latency.
- [ ] DB indexes.
- [ ] Bundle size.
- [ ] Load test attendance/payroll.
- [ ] Lighthouse.

**Checkpoint:** `docs/checkpoints/6.2-performance.md`

### 6.3 Backup/restore drill
- [ ] Restore to clean DB.
- [ ] Verify counts/checksums.
- [ ] Document time.
- [ ] Fix gaps.

**Checkpoint:** `docs/checkpoints/6.3-restore-drill.md`

### 6.4 Monitoring
- [ ] Health endpoints.
- [ ] Logs.
- [ ] Alerts.
- [ ] Uptime.
- [ ] DB metrics.

**Checkpoint:** `docs/checkpoints/6.4-monitoring.md`

### 6.5 Staging + production
- [ ] Staging deploy.
- [ ] Smoke tests.
- [ ] Production deploy.
- [ ] DNS/TLS.
- [ ] Rollback verified.

**Checkpoint:** `docs/checkpoints/6.5-launch.md`

### 6.6 Training + handover
- [ ] Admin guide.
- [ ] Teacher guide.
- [ ] Backup/restore runbook.
- [ ] Incident contacts.
- [ ] Sign-off.

**Checkpoint:** `docs/checkpoints/6.6-handover.md`

---

## Current Status

| Phase | Status |
|---|---|
| 0.1 Foundation | ✅ Done |
| 0.2 Intake | ⏳ Next |
| 0.3+ | Pending |

---

## Update Protocol

- Mark the step `[x]` only after acceptance criteria pass.
- Write/update the checkpoint in the same change.
- Update `deepseek.md` if the current phase or commands change.
- If a step reveals a missing business decision, stop and ask.
- Do not start a new phase before the current one is signed off.
