# Checkpoint: Frontend Vitest Baseline

Date: 16 Nov 2026

## Done
- Added `vitest` to `frontend` dev dependencies.
- Added `npm test` (`vitest run`).
- Added `src/application/selectors.test.ts` with **7 tests**:
  - student text/status filtering;
  - teacher text/status filtering;
  - current-month due/paid/balance totals;
  - first-month proration (16/31 days → 154.84);
  - zero charge when the enrollment starts after the month;
  - dashboard profit/net + uncharged/unmarked counters;
  - per-circle estimated net.
- CI frontend job now runs `npm test` before `npm run build`.
- Corrected `docs/08-testing.md`: frontend Vitest section; integration tests use Dapper/PostgreSQL, not EF Core.

## Verification
- `npm test`: **7 passed**.
- `npm run build`: **passed** (722.81 KB JS / 202.39 KB gzip).

## Remaining
- More selector/hook tests (React Testing Library) when the Next.js UI starts.
- Playwright E2E after the UI sample gate.
- Testcontainers PostgreSQL for API integration tests.
