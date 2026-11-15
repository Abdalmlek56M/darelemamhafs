# Checkpoint: Legacy Split 1.2 — SystemAdminEndpoints

Date: 16 Nov 2026

## Done
- Converted `SystemAdminEndpoints` to `partial`.
- Extracted:
  - `SystemAdminEndpoints.Export.cs` — 83 lines.
  - `SystemAdminEndpoints.Trash.cs` — 221 lines.
  - `SystemAdminEndpoints.Helpers.cs` — 121 lines.
- Main file: **304 lines** (under the 400 hard limit).
- No route/SQL/response changes.
- Legacy API build: **0 warnings / 0 errors**.
- New solution build: **0 warnings / 0 errors**.
- Unit + integration tests: **12 + 3 passing**.
- Legacy frontend `npm run build`: **passed**.

## Remaining
- Main `Map` still contains settings/profile/reset/audit/backups/export endpoint bodies.
  A deeper section split is deferred; the file is under the hard limit.
- `AuthEndpoints` (352) — under limit, can be split during Identity replacement.
- `Program.cs` (165) — under limit.
- `AuditMiddleware` (251) — under limit.
- `SystemAdminService` (303) — under limit.
- Next priority: frontend `useDarApplication` (874) and `SystemAdminView` (456).

## Decisions
- 400 lines is a hard limit; 200–300 is the target.
- Files under 400 can wait until their module is replaced, unless they are being edited.
- Frontend files over 400 are the next priority.
- Commit per phase; build both backend + frontend before commit.
