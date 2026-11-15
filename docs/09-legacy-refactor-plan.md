# Legacy Refactor & File Split Plan

**Status:** Started 15 Nov 2026.
**Goal:** Split the legacy monolith into small, safe files **without changing behavior**, then move the behavior into `src/Modules/*`.

---

## 1. Why Split This Way

- The legacy app is the only place with the full business rules.
- A blind rewrite would risk payroll, billing, attendance, and permissions.
- We use **characterization by behavior**: endpoints, SQL, routes, and responses stay identical while files move.
- The final architecture is a **modular monolith**. Partial files are an intermediate step, not the destination.

---

## 2. Rules

1. **No behavior change** during a split.
2. **No route/URL change.**
3. **No SQL change.**
4. **No response-shape change.**
5. Build after every slice; run the relevant tests.
6. One slice per commit; push after each.
7. Every slice gets a checkpoint.
8. Do not delete a test until its replacement exists.
9. Do not create a new feature in a legacy file; split it first.
10. If a file needs a new dependency, stop and ask.

---

## 3. Backend Split Map

### 3.1 `DomainEndpoints.cs` (1,680 lines)

Target: `public static partial class DomainEndpoints` split into:

| File | Contents | Approx. lines |
|---|---|---:|
| `DomainEndpoints.cs` | class + `Map()` + shared constants | 20 |
| `DomainEndpoints.Students.cs` | `MapStudents`, student projection, student helpers | 210 |
| `DomainEndpoints.Teachers.cs` | `MapTeachers` | 90 |
| `DomainEndpoints.Circles.cs` | `MapCircles` | 100 |
| `DomainEndpoints.Enrollments.cs` | `MapEnrollments` + lifecycle helpers | 160 |
| `DomainEndpoints.ScheduleAttendance.cs` | `MapScheduleAndAttendance` | 380 |
| `DomainEndpoints.Collections.cs` | `MapCollections` | 250 |
| `DomainEndpoints.Advertising.cs` | `MapAdvertisingExpenses` | 60 |
| `DomainEndpoints.OperatingExpenses.cs` | `MapOperatingExpenses` | 60 |
| `DomainEndpoints.Reports.cs` | `MapReports` | 40 |
| `DomainEndpoints.History.cs` | `StudentHistory`, `TeacherHistory`, `LoadStudent`, `LoadTeacher`, `LoadCircle` | 220 |
| `DomainEndpoints.Validation.cs` | validators, `TryMonth`, `AddNullable`, `NewCode`, actor helpers | 180 |

**Done:** `DomainEndpoints` is fully split into 13 partial files. The original file is 79 lines; the largest partial is 376 lines. Legacy build passes.

### 3.2 `SystemAdminEndpoints.cs` (697 lines)

Split into:

| File | Contents |
|---|---|
| `SystemAdminEndpoints.cs` | `Map` + shared constants |
| `SystemAdminEndpoints.Settings.cs` | branding/settings/profile |
| `SystemAdminEndpoints.Reset.cs` | reset candidates |
| `SystemAdminEndpoints.Audit.cs` | audit events/log/restore |
| `SystemAdminEndpoints.Trash.cs` | trash list/move/restore/purge |
| `SystemAdminEndpoints.Backups.cs` | backup list/create/download |
| `SystemAdminEndpoints.Export.cs` | export + predicates |
| `SystemAdminEndpoints.Helpers.cs` | snapshots, display names, audit helpers |

### 3.3 `AuthEndpoints.cs` (352 lines)

Split into:

| File | Contents |
|---|---|
| `AuthEndpoints.cs` | `Map` + shared |
| `AuthEndpoints.Setup.cs` | setup status/admin |
| `AuthEndpoints.Login.cs` | login/logout/me/change-password |
| `AuthEndpoints.Users.cs` | user CRUD + permissions |
| `AuthEndpoints.Validation.cs` | credentials/permission validators |

Then replace with `src/Modules/Identity`.

### 3.4 `Program.cs` (165 lines)

Extract:

- `Infrastructure/Configuration/ServiceRegistration.cs`
- `Infrastructure/Configuration/AuthenticationSetup.cs`
- `Infrastructure/Configuration/AuthorizationSetup.cs`
- `Infrastructure/Configuration/MiddlewarePipeline.cs`
- `Infrastructure/Configuration/EndpointMapping.cs`

### 3.5 `AuditMiddleware.cs` (251 lines)

Split into:

- `AuditMiddleware.cs`
- `AuditTargetResolver.cs`
- `AuditPayloadRedactor.cs`
- `AuditSnapshotReader.cs`

### 3.6 `SystemAdminService.cs` (303 lines)

Split into:

- `BackupService.cs`
- `TrashMaintenanceService.cs`
- `ExportService.cs`
- `RestoreColumns.cs`

---

## 4. Frontend Split Map

### 4.1 `useDarApplication.ts` (874 lines)

Split into feature hooks:

- `features/auth/use-auth.ts`
- `features/students/use-students.ts`
- `features/teachers/use-teachers.ts`
- `features/circles/use-circles.ts`
- `features/schedule/use-schedule.ts`
- `features/attendance/use-attendance.ts`
- `features/finance/use-finance.ts`
- `features/reports/use-reports.ts`
- `features/system/use-system.ts`
- `features/notifications/use-notifications.ts`
- `application/use-dar-application.ts` (composition only)

### 4.2 `SystemAdminView.tsx` (456 lines)

Split by tab:

- `features/system/settings-tab.tsx`
- `features/system/audit-tab.tsx`
- `features/system/trash-tab.tsx`
- `features/system/backups-tab.tsx`
- `features/system/export-tab.tsx`
- `features/system/reset-tab.tsx`

### 4.3 `ManagementReportBuilder.tsx` (360 lines)

Split by report type + shared form.

### 4.4 `App.tsx`

Split shell, sidebar, topbar, auth gate, theme, dialogs.

---

## 5. Tests

- **Test Center GUI archived.** No test panel in the product.
- Individual `Verify-*.ps1` runners remain in `tests/runners` for conversion.
- Valuable scenarios move to:
  - `tests/Dar.UnitTests` — calculations/rules.
  - `tests/Dar.IntegrationTests` — API/DB via Testcontainers.
  - `tests/Dar.E2ETests` — Playwright (later).
- SQL regression files remain in `tests/regression/sql` until ported.
- Never delete a test before its replacement passes.

---

## 6. Order

### L0 — Baseline
- [x] Build legacy API.
- [x] Build new solution/tests.
- [x] Inventory large files.
- [x] Archive Test Center GUI.
- [x] Start `DomainEndpoints` partial split (Reports).

### L1 — Backend partial split
- [x] `DomainEndpoints` fully split (13 files; max 376 lines).
- [~] `SystemAdminEndpoints` partial (4 files; main 304 lines).
- [ ] `AuthEndpoints`.
- [ ] `Program.cs` composition extraction.
- [ ] `AuditMiddleware`.
- [ ] `SystemAdminService`.
- [ ] Build + relevant tests after each file.

### L2 — Frontend feature split
- [ ] `useDarApplication` hooks.
- [ ] `SystemAdminView` tabs.
- [ ] `ManagementReportBuilder`.
- [ ] `App.tsx` shell.

### L3 — Test migration
- [ ] Port high-value PowerShell/SQL tests.
- [ ] Remove archived GUI references.
- [ ] Add Playwright E2E.

### L4 — Module extraction
- [ ] Move split legacy logic into `src/Modules/*` one use case at a time.
- [ ] Delete legacy endpoints only after parity.

---

## 7. Acceptance per Slice

- [ ] Legacy API builds: 0 warnings / 0 errors.
- [ ] New solution builds/tests.
- [ ] Routes unchanged.
- [ ] Response shape unchanged.
- [ ] Relevant tests pass.
- [ ] File < 400 lines.
- [ ] Checkpoint + commit + push.
