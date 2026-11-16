# Checkpoint: Full Code Review 1.0

Date: 16 Nov 2026

## Done
- Full code review written in `docs/10-code-review.md`.
- Gap audit updated in `docs/07-gap-audit.md` with the new findings and fixed items.
- Fixed the P0 purge cascade:
  - `PurgeTrashAsync` rejects parents with financial/history descendants.
  - `PurgeRelatedTrashRecordsAsync` refuses financial child deletes.
  - `database/014_financial_fk_restrict.sql` restores `ON DELETE RESTRICT` for student → enrollment → charge → payment.
- Fixed review findings:
  - Teacher/circle numeric form payloads.
  - Inactive schedule reminders.
  - Logout clears all scoped data.
  - Circle roster stale-response race.
  - Attendance re-mark preserves corrected duration.
  - `--migrate` adopts the legacy `schema_migrations` ledger.
  - New-student default date uses local time.
  - Audit viewer falls back to raw keys for unknown fields.
- Updated stale migration counts in test runners and the catalog entrypoint.
- Corrected documentation contradictions:
  - `deepseek.md`: Npgsql/Dapper, temporary password fallback, final host+domain goal.
  - `docs/02-architecture.md`: target vs current auth.
  - `docs/03-security.md`: implementation status note.
  - `docs/04-engineering-standards.md`: no EF Core.
  - `docs/05-roadmap.md`: current status table.

## Build Gate
- Legacy API build: **0 warnings / 0 errors**.
- `Dar.slnx` build: **0 warnings / 0 errors**.
- Unit tests: **12 passed**.
- Integration tests: **3 passed**.
- Legacy frontend `npm run build`: **passed** (721.93 KB JS / 202.13 KB gzip).
- .NET vulnerable packages: **none**.
- npm production audits: **0 vulnerabilities**.

## Disposable PostgreSQL Verification
- Started a disposable PostgreSQL 17 container on port 55433.
- Applied all **14** migrations with `dotnet run --project src/Host/Dar.Api -- --migrate`: **passed**.
- Inserted a student → enrollment → charge → payment, then attempted physical deletes:
  - Student delete blocked by FK `RESTRICT`.
  - Charge delete blocked by payment FK `RESTRICT`.
- The container and test data were removed afterwards.
- API-level acceptance test passed in `DAR_ISOLATED_FUNCTIONAL_ACCEPTANCE=1` mode on a disposable database:
  - Created teacher → circle → student → enrollment → charge → payment.
  - Moved the student to trash.
  - `DELETE /api/admin/trash/{id}` returned **409**.
  - Database check afterwards: payment = **1**, charge = **1**, financial trash rows = **3** — nothing was purged.
- The API process and container were stopped/removed afterwards.

## Still Open
- P0: financial `restore-before` policy; append-only `audit_log`.
- P1: session revocation/deactivation; setup bootstrap token; CSRF/Origin; forwarded headers; trash permission split; Linux backups; Docker/Compose/Caddy; dead DELETE endpoints; OTP pepper; stale PowerShell source suite.
- Migration 014 and the purge guard still need a disposable-PostgreSQL acceptance test before production.

## Not Changed
- No production database was read or modified.
- No secrets were written.
- UI gate remains closed until the owner approves a visual sample.
