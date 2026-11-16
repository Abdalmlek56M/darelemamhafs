# RIGX Dar — Full Code Review

**Date:** 16 Nov 2026
**Scope:** Legacy API/front-end, new `.NET` solution, Identity/Secretariat modules, migrations, CI, tests, deployment paths.
**Method:** static read of the changed and security-sensitive paths; `dotnet build` (legacy + `Dar.slnx`), `dotnet test` (12 unit + 3 integration), `npm run build`, `dotnet list package --vulnerable`, `npm audit --omit=dev`. No production data or `.env`/secret files were read.

---

## 1. Verification Snapshot

| Check | Result |
|---|---|
| Legacy API build | ✅ 0 warnings / 0 errors |
| `Dar.slnx` build | ✅ 0 warnings / 0 errors |
| Unit tests | ✅ 12 passed |
| Integration tests | ✅ 3 passed |
| Legacy frontend build | ✅ passed (721.93 KB JS / 202.13 KB gzip) |
| .NET vulnerable packages | ✅ none reported |
| Frontend production audit | ✅ 0 vulnerabilities |
| API-client production audit | ✅ 0 vulnerabilities |
| Frontend files > 400 lines | ✅ none |
| Backend legacy files > 400 lines | ✅ none (largest 376) |

**Important:** the PowerShell source-guard suite is **not green**; several runners still require the archived Test Center or old file paths. This is tracked as P1-36.

---

## 2. P0 — Must Fix Before Production

### P0-1. Parent purge permanently deleted financial/history children

**Status:** fixed and verified end-to-end. Migration 014 was applied to a disposable PostgreSQL 17 container; FK `RESTRICT` blocked physical student/charge deletes. The legacy API then created a full student→enrollment→charge→payment chain, moved the student to trash, and `DELETE /api/admin/trash/{id}` returned **409**; the payment and charge still existed afterwards (1 each). The test API/container were removed.

**Evidence (before fix):**
- `SystemAdminEndpoints.Trash.cs` — `PurgeTrashAsync` checked `FinancialTrashTypes` only for the selected row.
- `PurgeRelatedTrashRecordsAsync` then issued `DELETE` for every child trash row without a financial check.
- `SystemAdminService.FinancialTrashTypes` includes payments, charges, attendance, enrollments, reports, and expenses.
- `database/002_management_security.sql` had changed the student→enrollment→charge→payment chain to `ON DELETE CASCADE`.

**Impact:** a `trash.manage` user could move a student/circle to trash and purge the parent, permanently deleting payments, charges, attendance, and reports. This directly violates the owner's "no hard delete of financial/history records" rule.

**Fix applied:**
- `PurgeTrashAsync` now rejects a parent with any financial/history descendant.
- `PurgeRelatedTrashRecordsAsync` refuses financial child deletes.
- `database/014_financial_fk_restrict.sql` restores `ON DELETE RESTRICT` for the three FKs relaxed by 002.

**Remaining test:** create a disposable DB, apply all 14 migrations, trash a student with a payment, attempt purge → expect `409` and unchanged payment/charge rows.

### P0-2. `restore-before` can rewrite financial and attendance history

**Status:** fixed — restore is now limited to descriptive fields.

**Evidence:** `SystemAdminService.RestoreColumns` includes `hourly_rate`, `amount_due`, `paid_at`, `payable_amount`, payment/attendance tables, and relationship IDs. `SystemAdminEndpoints.cs` allows the restore with `audit.restore` + a field-name heuristic; `ContainsFinancialJsonFields` only checks a hard-coded key list.

**Impact:** an `audit.restore` holder can alter historical money/attendance values (and enrollment dates/status) instead of using a reversal entry. This is a history rewrite, not a correction trail.

**Fix applied:** `SystemAdminService.RestoreColumns` now contains only:
- `students`: code, name, age, phone, guardian fields, joined date, status, notes.
- `teachers`: code, name, phone, status, notes.
- `circles`: code, name, schedule text.
- `student_notes` / `teacher_notes`: note text.

All financial, attendance, enrollment-lifecycle, schedule-assignment, and trash-flag restores are disabled; the UI button disappears because `can_restore` is derived from this dictionary. If the owner later wants a financial correction workflow, it must be a separate reversal/void action with a mandatory reason.

### P0-3. Audit log is not append-only

**Status:** fixed and verified.

**Evidence:** no `CREATE TRIGGER` on `audit_log` in `database/*.sql`; the table can be updated/deleted by anyone with DB access. The app itself updates `restored_at`/`can_restore` (expected metadata), but there is no DB-level protection against tampering.

**Impact:** the audit trail is not reliable evidence in a dispute or security incident.

**Fix applied:** `database/015_audit_log_append_only.sql` adds `trg_audit_log_append_only`, which:
- rejects all `DELETE`;
- allows only `restored_at` / `can_restore` changes on a finalized row;
- allows the `AuditMiddleware` enrichment of a just-created placeholder row (`request_path`/`http_method` were null).
Tested on disposable PostgreSQL 17: direct `details` update blocked, delete blocked, enrichment allowed, restore metadata allowed, `action_code` rewrite blocked.

---

## 3. P1 — High Priority

| ID | Finding | Evidence | Impact | Fix |
|---|---|---|---|---|
| **P1-1** | Sessions survive password change, permission removal, and deactivation. | Fixed: migration `016_session_version.sql`; legacy cookie + `ValidatePrincipalAsync`; new `OnValidatePrincipal` refreshes active user/permissions. | A stolen 30-day cookie is now rejected after a credential change. | Verified: legacy old cookie → 401 after password change; new login → 200; `Dar.Api` version bump → 401; removed permission reflected in `/me`. |
| **P1-2** | First-run setup is anonymous and claimable. | Fixed: `AuthEndpoints` requires `Auth:SetupToken` for remote callers, otherwise loopback-only. | The first network caller can no longer claim a public instance. | Verified: `X-Forwarded-For: 203.0.113.5` → 403; loopback → 409 (already initialized). |
| **P1-3** | No CSRF token/Origin validation; cookie modes differ. | Fixed baseline: `SameOriginGuardMiddleware` rejects unsafe cross-origin browser requests on both hosts. | Cross-site POST/PUT/PATCH/DELETE from another origin is blocked. | Verified: `Origin: https://evil.example` → 403 on both hosts; integration tests added. A full antiforgery token remains a later hardening step. |
| **P1-4** | No forwarded-header handling. | Fixed: `UseForwardedHeaders` with loopback + configurable known proxies on both hosts. | Rate limiting/audit/HSTS now see the real client IP and scheme behind Caddy. | Verified indirectly: `X-Forwarded-For` changed the setup remote-IP decision; full Caddy smoke test remains for staging. |
| **P1-5** | Trash API bypasses domain permissions. | Fixed: move/restore/purge now require the owning permission as well as `trash.manage`; frontend hides/disables unauthorized rows. | A trash manager can no longer hide/restore financial records without `finance.delete`. | Verified on disposable PostgreSQL 17: limited `trash.manage` user got 403 for payment/student trash, purge, and restore; admin purge still 200. |
| **P1-6** | Backup/restore is Windows-only. | `SystemAdminService.cs` looks for `pg_dump.exe`, validates drive-letter paths, writes to `%LOCALAPPDATA%`. | The final Ubuntu host cannot create or restore backups; container restarts may lose files. | Linux `pg_dump`, mounted backup volume, Compose service, restore drill. |
| **P1-7** | No Docker/Compose/Caddy deployment yet. | Repo root; roadmap 6.5 pending. | Final host+domain goal is not achievable yet. | Add deployment stack, staging smoke test, TLS/DNS, rollback. |
| **P1-8** | Dead physical DELETE endpoints remain. | Fixed: all 10 `MapDelete` blocks removed from `DomainEndpoints*`; `AuditMiddleware` still blocks DELETE as defense in depth. | No code path can physically delete a business record. | Fixed. |
| **P1-9** | OTP pepper is empty by default. | Fixed: `Dar.Api` refuses to start outside Development without `Auth:Otp:Pepper`; the hasher also fails closed. | No process-local key in production; multi-instance OTP verification is safe once the secret is configured. | Fixed. |
| **P1-10** | Test suite is partly stale. | Runners require `TestCenter.ps1`/`Start-TestCenter.ps1`; some count/path assertions were updated but the suite is not green. | “No behavior change” claims are not actually verified by the old suite. | Move active checks to xUnit/source tests; archive obsolete runners; keep CI green. |
| **P1-11** | Teacher/circle save payload sent numeric strings. | Fixed: `useTeacherActions.ts`, `useCircleActions.ts` now build explicit payloads and omit financial fields without `finance.edit`. | Non-finance users could not save teachers/circles (400). | Fixed. |
| **P1-12** | Inactive/historical slots kept firing reminders. | Fixed: `useScheduleNotifications.ts` skips `!slot.isActive`. | Weekly false alerts at old times. | Fixed. |
| **P1-13** | Logout left previous account's data in memory. | Fixed: `useDarAuth.ts` `onSessionCleared`; `useDarApplication.ts` clears all lists/details. | Cross-account data exposure in the same tab. | Fixed. |
| **P1-14** | Circle roster race/stale rows. | Fixed: `useCircleActions.ts` request id + clear before load. | Wrong roster shown for a circle. | Fixed. |
| **P1-15** | Attendance re-mark reset corrected duration. | Fixed: `DomainEndpoints.ScheduleAttendance.cs` preserves `teacher_attendance.duration_minutes` on conflict. | Payroll drift. | Fixed. |
| **P1-16** | `--migrate` ignored the legacy ledger. | Fixed: `MigrationRunner.cs` adopts `schema_migrations` before applying. | Replaying 012 on live timetable data; checksum guard blind. | Fixed. |

---

## 4. P2 — Improvements

| ID | Finding | Evidence | Fix |
|---|---|---|---|
| **P2-1** | Username enumeration via login timing. | Unknown user returns before PBKDF2; existing user runs 210k iterations. | Dummy PBKDF2 verify for unknown users. |
| **P2-2** | Reset-all can report success with zero records. | `SystemAdminView.tsx` builds `all` targets from `reportData`; loaders no-op without read permissions. | Block reset-all or load IDs server-side. |
| **P2-3** | Duplicate month loads on login/navigation. | Effect loads + `changePage` loads. | Keep one loading path. |
| **P2-4** | Historical rows show actions the API rejects. | `SchedulePage.tsx` row actions; API requires active slot. | Gate on `slot.isActive` or add a historical path. |
| **P2-5** | Audit viewer dropped unknown fields. | Fixed: `system/formatting.tsx` falls back to the raw key. | Fixed. |
| **P2-6** | New student `joined_on` used UTC. | Fixed: `CreateStudent.cs` uses `DateTime.Today`. | Fixed. |
| **P2-7** | OTP request has no per-email throttle. | `RequestEmailOtp` uses the shared IP policy. | Add per-email 1/min + 5/hour and a resend timer. |
| **P2-8** | OTP email is invalidated by every new request. | `CreateOtpAsync` consumes all previous codes. | Key OTPs to `user_id` and keep a short grace window for the last code. |
| **P2-9** | Audit `restore-before` can change identity/relationships. | Fixed: `RestoreColumns` now excludes relationship IDs, financial fields, attendance, and trash flags. | Fixed. |
| **P2-10** | Client can inject audit entries. | `POST /api/admin/audit-events` accepts client `entityType`/`details` from any authenticated user. | Log from server handlers; validate/ignore client fields. |
| **P2-11** | Backup failure leaks exception text. | `SystemAdminEndpoints.cs` returns `ex.Message` in `Results.Problem`. | Log server-side; return a fixed message + backup id. |
| **P2-12** | Last-admin lockout possible. | `users.manage` allows deactivating every other admin; self only is protected. | Refuse the change if it leaves zero active `users.manage` holders. |
| **P2-13** | Auth sessions/OTP tables grow forever. | `auth_sessions`, `auth_email_otps` have no cleanup job. | Add retention job/indexes. |
| **P2-14** | Legacy `DatabaseInitializer` and new runner use different ledgers. | `schema_migrations` vs `web_schema_migrations`. | Adopt legacy ledger (done in new runner); retire the legacy initializer. |
| **P2-15** | File storage in BYTEA (receipts/logo/avatar). | Schema. | Object storage + signed URLs later. |
| **P2-16** | No pagination on legacy list endpoints. | `DomainEndpoints*` list queries return all rows. | Paged endpoints + indexes. |
| **P2-17** | No optimistic concurrency/row version. | Schema. | `row_version` + `If-Match`. |
| **P2-18** | No receipt number / idempotency key. | `payments` schema; payment POST. | Atomic receipt sequence + idempotency table. |
| **P2-19** | No payroll run/lock/payslip. | On-the-fly attendance sums. | Payroll run → review → approve → lock. |
| **P2-20** | No double-entry ledger/period close. | Dashboard “net” is accrual, not cash. | Treasury + journal + close. |

---

## 5. Contradictions Fixed / Remaining

**Fixed in docs:**
- `deepseek.md` said EF Core and “OTP + Google only, no passwords”; corrected to Npgsql/Dapper and the temporary password fallback.
- `docs/02-architecture.md` auth decision now distinguishes target vs current.
- `docs/04-engineering-standards.md` no longer says EF Core configurations.
- `docs/05-roadmap.md` current-status table no longer says “0.2 Next / 0.3+ Pending”.
- `docs/03-security.md` now marks the target model vs implemented controls.
- `tests/catalog.json` no longer points to the removed `RUN_TESTS.bat`.

**Still inconsistent:**
- `docs/03-security.md` target says `__Host-` cookies, 12h sessions, CSRF tokens, and revocation on password change; code does not fully implement these. The new status note explains this, but the target section should eventually be split into “implemented”/“planned”.
- `docs/07-gap-audit.md` P0-03 and P1-18 remain open.
- Checkpoint `legacy-split-2.2.md` says “no behavior change”; the source-guard suite was not run, and several runners are stale. The code split itself is behavior-preserving, but the claim needs the test-suite caveat.

---

## 6. Recommended Order

1. ✅ Apply migration 014 + purge-guard test on a disposable PostgreSQL database.
2. ✅ Restrict `restore-before` to descriptive fields (no financial/attendance history).
3. ✅ Add `audit_log` append-only trigger; optional DB-role hardening remains.
4. Add session revalidation/revocation in both hosts.
5. Add setup token, CSRF/Origin checks, forwarded headers.
6. ✅ Remove dead DELETE endpoints.
7. Build the Linux/Docker deployment stack and a restore drill.
8. Migrate the active PowerShell source guards to xUnit or a single maintained source-test project.
9. Continue module replacement (Students → Teachers → Circles → Schedule → Finance) behind the OpenAPI contract.
10. Only then start the Next.js UI sample gate.

---

## 7. What Is Solid

- Financial calculations use `decimal`, explicit rounding, `FOR UPDATE` on charge rows, overpayment rejection, and historical teacher-rate snapshots.
- OTPs are HMAC-hashed with a pepper, 6 digits, 5 minutes, 5 attempts, single-use, generic responses.
- Passwords use PBKDF2-SHA256 with 210k iterations, per-hash salt, and fixed-time comparison.
- Backup creation uses `ArgumentList` (no shell), `FileMode.CreateNew` ownership tracking, SHA-256 manifest, and `pg_restore --list` validation.
- Export/trash SQL identifiers come from fixed allow-lists; values are parameterized.
- Security headers, HttpOnly/Secure cookies, no CORS, and no tokens in `localStorage`.
- The new migration runner has checksums, an advisory lock, and now adopts the legacy ledger.
