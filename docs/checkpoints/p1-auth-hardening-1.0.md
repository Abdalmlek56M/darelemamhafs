# Checkpoint: P1 Auth Hardening 1.0

Date: 16 Nov 2026

## Done
### 1. Session revocation
- Added `database/016_session_version.sql` (`app_users.session_version`).
- Legacy cookie now carries `session_version`; `ValidatePrincipalAsync` rejects a mismatch.
- `Dar.Api` cookie now has an `OnValidatePrincipal` handler that:
  - rejects missing/deactivated users;
  - rejects a stale `session_version`;
  - refreshes permission claims when `user_permissions` changes.
- Password change, admin password reset, deactivation, and email change bump the version.

### 2. First-run setup
- `/api/setup/admin` now requires `Auth:SetupToken` for remote callers.
- If no token is configured, setup is **loopback-only**.
- Constant-time token comparison.

### 3. Same-origin guard
- Added `SameOriginGuardMiddleware` to both hosts.
- Rejects unsafe browser requests (`POST/PUT/PATCH/DELETE`) whose `Origin`/`Referer` does not match the request origin.
- Non-browser clients with no origin remain allowed.
- Added integration tests for cross-origin and `Origin: null`.

### 4. Forwarded headers
- Both hosts now call `UseForwardedHeaders`.
- Trusted proxies: loopback by default + `ForwardedHeaders:KnownProxies` config.
- This fixes real client IP, rate-limit partitioning, audit IPs, and HSTS detection behind Caddy.

### 5. Auth file split
- `AuthEndpoints.cs`: **416 → 325 lines**.
- New `AuthEndpoints.Helpers.cs`: audit/login helpers, validation, permissions, sign-in, session conversion.
- New `AuthContracts.cs`: request/response records.

## Verification
- Legacy **0 warnings / 0 errors**.
- `Dar.slnx` **0 warnings / 0 errors**.
- Unit tests: **12 passed**.
- Integration tests: **5 passed** (2 new same-origin tests).
- Frontend build: **passed** (721.93 KB JS / 202.13 KB gzip).
- Disposable PostgreSQL 17:
  - applied **16 migrations**;
  - legacy: login → `me` 200; change password → old cookie `401`; new login → `me` 200;
  - `Dar.Api`: login → `me` 200; version bump → `401`; permission removal reflected in `/me`;
  - setup: `X-Forwarded-For: 203.0.113.5` → `403`; loopback → `409` (already initialized);
  - cross-origin login on both hosts → `403`.
- Test API processes and container removed afterwards.

## Remaining P1
- Trash permission separation by entity.
- Linux backup path + Docker/Compose/Caddy.
- Dead physical DELETE endpoints.
- OTP pepper configuration.
- Stale PowerShell source-test suite.
- Full antiforgery token (same-origin guard is the baseline).
- Per-email OTP throttle / resend timer.

## Notes
- No production database was read or modified.
- No secrets were written.
- UI gate remains closed until the owner approves a visual sample.
