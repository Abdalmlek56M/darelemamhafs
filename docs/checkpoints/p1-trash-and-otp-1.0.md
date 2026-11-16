# Checkpoint: P1 Trash Permissions + OTP Pepper

Date: 16 Nov 2026

## Done
### 1. Trash permission separation
- Added `RequiredTrashPermission` / `CanManageTrashEntity` in `SystemAdminEndpoints.Helpers.cs`.
- Move / restore / purge now require **both** `trash.manage` and the owning domain permission:
  - students → `students.delete` (notes → `students.edit`)
  - teachers → `teachers.delete` (notes → `teachers.edit`)
  - circles → `circles.delete`; enrollments → `circles.edit`
  - schedule slots → `schedule.edit`
  - attendance → `attendance.edit`
  - charges/payments/reports/advertising/operating expenses → `finance.delete`
- Frontend mirrors the map in `system/constants.ts`.
- Trash table:
  - disables selection for rows the user cannot manage;
  - hides restore/purge buttons and shows a clear message instead;
  - bulk purge only includes manageable rows.
- The admin path is unchanged.

### 2. OTP pepper fail-closed
- `Dar.Api` now refuses to start outside Development if `Auth:Otp:Pepper` is empty.
- `OtpCodeHasher` also refuses to construct with a process-local key outside Development.
- Development keeps the process-local fallback with a warning.

## Disposable PostgreSQL 17 Verification
- Applied all **16** migrations.
- Created a limited user with only `trash.manage`.
- Limited user:
  - trash a payment → **403**;
  - trash a student → **403**;
  - purge a trashed student → **403**;
  - restore a trashed student → **403**.
- Admin:
  - created/trashed a student;
  - purged the non-financial student → **200**.
- API/container removed afterwards.

## Build Gate
- Legacy API: **0 warnings / 0 errors**.
- `Dar.slnx`: **0 warnings / 0 errors**.
- Unit tests: **12 passed**.
- Integration tests: **5 passed**.
- Frontend build: **passed** (722.81 KB JS / 202.39 KB gzip).

## Remaining P1
- Linux backup path + Docker/Compose/Caddy.
- Dead physical DELETE endpoints.
- Stale PowerShell source-test suite.
- Full antiforgery token.
- Per-email OTP throttle / resend timer.

## Notes
- No production database was read or modified.
- No secrets were written.
- UI gate remains closed until the owner approves a visual sample.
