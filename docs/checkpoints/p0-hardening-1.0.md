# Checkpoint: P0 Hardening 1.0 — Purge, Audit, Restore

Date: 16 Nov 2026

## Done
### 1. Financial purge cascade — closed and verified end-to-end
- `PurgeTrashAsync` rejects a parent that has financial/history children.
- `PurgeRelatedTrashRecordsAsync` refuses financial child deletes.
- `database/014_financial_fk_restrict.sql` restores `ON DELETE RESTRICT` for:
  - student → enrollment
  - enrollment → monthly charge
  - monthly charge → payment

**Disposable PostgreSQL 17 test:**
- Applied all 14 migrations.
- Physical student delete blocked by FK.
- Physical charge delete blocked by payment FK.
- Full API flow: teacher → circle → student → enrollment → charge → payment → trash student → purge.
- `DELETE /api/admin/trash/{id}` returned **409**.
- Payment = **1**, charge = **1**, financial trash rows = **3** after the rejected purge.
- Test API and container removed afterwards.

### 2. Audit log append-only
- Added `database/015_audit_log_append_only.sql`.
- `DELETE` is always rejected.
- Substantive `UPDATE` is rejected.
- Only allowed updates:
  - `AuditMiddleware` enrichment of a just-created placeholder row.
  - `restored_at` / `can_restore` restore metadata.
- Tested on disposable PostgreSQL 17:
  - direct `details` update → blocked.
  - delete → blocked.
  - placeholder enrichment → allowed.
  - restore metadata → allowed.
  - `action_code` rewrite → blocked.

### 3. Financial restore removed
- `SystemAdminService.RestoreColumns` now contains only descriptive fields:
  - students: code, name, age, phone, guardian fields, joined date, status, notes.
  - teachers: code, name, phone, status, notes.
  - circles: code, name, schedule text.
  - student/teacher notes: note text.
- Money, attendance, enrollment lifecycle, schedule assignments, and trash flags are no longer restorable via audit.
- `can_restore` is derived from this dictionary, so the UI button disappears for excluded tables.

## Build Gate
- Legacy API: **0 warnings / 0 errors**.
- `Dar.slnx`: **0 warnings / 0 errors**.
- Unit tests: **12 passed**.
- Integration tests: **3 passed**.
- Frontend build: **passed** (721.93 KB JS / 202.13 KB gzip).

## Remaining P1
- Session revocation/deactivation in both hosts.
- Setup bootstrap token.
- CSRF/Origin validation.
- Forwarded headers behind Caddy.
- Trash permission separation by entity.
- Linux backup path + Docker/Compose/Caddy.
- Dead DELETE endpoints.
- OTP pepper configuration.
- Stale PowerShell source-test suite.

## Notes
- No production database was read or modified.
- No secrets were written.
- UI gate remains closed until the owner approves a visual sample.
