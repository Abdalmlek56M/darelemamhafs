# Checkpoint: Remove Dead Physical DELETE Endpoints

Date: 16 Nov 2026

## Done
- Removed all **10** legacy `MapDelete` endpoint blocks from `DomainEndpoints*`:
  - students (student + note)
  - teachers
  - circles
  - schedule slots
  - charges
  - payments
  - collection reports
  - advertising expenses
  - operating expenses
- `AuditMiddleware` still rejects every `/api` DELETE outside trash/users as a defense-in-depth layer, so existing clients that call these paths still receive `409` instead of a successful delete.
- No route, SQL, or response behavior is intentionally changed.

## Build Gate
- Legacy API: **0 warnings / 0 errors**.
- `Dar.slnx`: **0 warnings / 0 errors**.
- Unit tests: **12 passed**.
- Integration tests: **5 passed**.
- Frontend build: **passed** (722.81 KB JS / 202.39 KB gzip).

## Remaining P1
- Linux backup path + Docker/Compose/Caddy.
- Stale PowerShell source-test suite.
- Full antiforgery token.
- Per-email OTP throttle / resend timer.
