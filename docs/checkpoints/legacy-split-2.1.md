# Checkpoint: Legacy Split 2.1 — Frontend Selectors

Date: 16 Nov 2026

## Done
- Created `frontend/src/application/selectors.ts`.
- Extracted pure selectors from `useDarApplication.ts`:
  - `getNextSessions`
  - `getMonthSessions`
  - `getMonthlyTeacherPay`
  - `getSuggestedFirstMonthCharge`
  - `getFilteredStudents`
  - `getFilteredTeachers`
  - `getCurrentMonthTotals`
  - `getMonthlyTeacherPayTotal`
  - `getMonthlyAdvertisingTotal`
  - `getMonthlyOperatingExpenseTotal`
  - `getDashboardProfit`
  - `getTeacherPaySummary`
  - `getCircleProfitSummary`
- `useDarApplication.ts`: **889 → 807 lines**.
- No behavior change intended; same calculations moved verbatim.
- `npm run build`: **passed** (714.51 KB JS / 200.46 KB gzip).
- Legacy API build: **0 warnings / 0 errors**.
- New solution build: **0 warnings / 0 errors**.
- Unit + integration tests: **12 + 3 passing**.

## Remaining
- Extract schedule-notification hook.
- Extract data loaders.
- Extract CRUD handlers by feature.
- Split `SystemAdminView.tsx` into tabs.
- Split `ManagementReportBuilder.tsx` by report type.
- Split `App.tsx` shell/layout.
- Add unit tests for selectors (Vitest) when the frontend test runner lands.

## Decisions
- Pure selectors first; hooks/handlers later.
- No behavior change; build before commit.
- Separate commit for this phase.
