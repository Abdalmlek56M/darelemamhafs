# Checkpoint: Final Local Hardening 1.0

Date: 16 Nov 2026

## Done
### 1. Legacy health parity
- Added `/health/live` and `/health/ready` to the legacy API.
- Existing `/health` kept for compatibility.
- Docker healthcheck + Compose healthcheck now use `/health/ready`.

### 2. Last-admin lockout guard
- `PUT /api/admin/users/{id}` refuses to deactivate the last active `users.manage` account or remove its `users.manage` permission.
- `DELETE /api/admin/users/{id}` refuses the same.
- Self-deactivation/self-demotion remains blocked.

### 3. Per-email OTP throttle
- `IIdentityRepository.IsOtpRequestThrottledAsync` enforces:
  - 1 request/minute per email;
  - 5 requests/hour per email.
- Throttled requests still return the generic `202` shape, so account existence is not revealed.
- The existing IP rate limit remains as an outer layer.

## Build Gate
- Legacy API: **0 warnings / 0 errors**.
- `Dar.slnx`: **0 warnings / 0 errors**.
- Unit tests: **12 passed**.
- Integration tests: **5 passed**.
- Frontend build: **passed** (722.81 KB JS / 202.39 KB gzip).

## Remaining
- Real staging/production deploy (host/DNS/TLS access needed).
- Offsite backup + restore drill.
- Full antiforgery token.
- Stale PowerShell source guards tied to the archived Test Center.
- First GitHub Actions run verification.
- UI sample gate before Next.js UI work.

## Notes
- No production database was read or modified.
- No secrets were written.
