# Checkpoint: Legacy Split 1.1 — DomainEndpoints

Date: 16 Nov 2026

## Done
- Fully split `DomainEndpoints` into 13 partial files.
- Original `DomainEndpoints.cs`: **79 lines**.
- Largest file: `DomainEndpoints.ScheduleAttendance.cs` — **376 lines**.
- No route, SQL, or response-shape changes.
- Legacy API build: **0 warnings / 0 errors**.
- New solution build: **0 warnings / 0 errors**.
- Unit + integration tests: **12 + 3 passing**.
- Legacy frontend `npm run build`: **passed** (713.91 KB JS, 200.42 KB gzip).

## File Inventory

| File | Lines |
|---|---:|
| `DomainEndpoints.cs` | 79 |
| `DomainEndpoints.Students.cs` | 206 |
| `DomainEndpoints.Teachers.cs` | 87 |
| `DomainEndpoints.Circles.cs` | 102 |
| `DomainEndpoints.Enrollments.cs` | 155 |
| `DomainEndpoints.ScheduleAttendance.cs` | 376 |
| `DomainEndpoints.Collections.cs` | 260 |
| `DomainEndpoints.Advertising.cs` | 62 |
| `DomainEndpoints.OperatingExpenses.cs` | 136 |
| `DomainEndpoints.Reports.cs` | 44 |
| `DomainEndpoints.History.cs` | 171 |
| `DomainEndpoints.Validation.cs` | 61 |
| `DomainEndpoints.EnrollmentLifecycle.cs` | 37 |

## Uncommitted
- Code split + docs; commit follows.

## Remaining
- `SystemAdminEndpoints` split.
- `AuthEndpoints` split.
- `Program.cs` composition extraction.
- `AuditMiddleware` split.
- `SystemAdminService` split.
- Then frontend feature split.
- Then test migration.

## Decisions
- Partial classes are an intermediate step; final target is `src/Modules/*`.
- Build + frontend build + tests after each split.
- No behavior change.
- Separate commit per phase; push every time.
