# Checkpoint: Legacy Split 0.1 — Baseline + First Backend Slice

Date: 15 Nov 2026

## Done
- Documented the full split map in `docs/09-legacy-refactor-plan.md`.
- Build baseline:
  - Legacy API builds (0 warnings / 0 errors).
  - New solution builds/tests.
- Archived the GUI Test Center:
  - `TestCenter.ps1`
  - `TestMenu.ps1`
  - `Start-TestCenter.ps1`
  - Archive: `C:\Users\Abdalmlek\AppData\Local\Temp\opencode\DarEltahfeez-test-ui-archive-2026-11-15`
- Individual `Verify-*.ps1` runners remain for conversion.
- First backend split:
  - `DomainEndpoints` converted to `partial`.
  - `MapReports` moved to `DomainEndpoints.Reports.cs` (44 lines).
  - `DomainEndpoints.cs`: 1,680 → 1,644 lines.
  - Legacy build passes.

## Uncommitted
- Domain split + docs + Test Center archive.

## Remaining
- Split the rest of `DomainEndpoints`:
  Students, Teachers, Circles, Enrollments, Schedule/Attendance, Collections, Advertising, OperatingExpenses, History, Validation.
- Then `SystemAdminEndpoints`, `AuthEndpoints`, `Program.cs`, `AuditMiddleware`, `SystemAdminService`.
- Then legacy frontend hooks/components.
- Then test migration.

## Decisions
- Split by partial class first; extract to modules later.
- No behavior/route/SQL/response change during a split.
- Build after every slice.
- No test deletion before a replacement passes.
- UI work is blocked until the owner approves a visual sample.
