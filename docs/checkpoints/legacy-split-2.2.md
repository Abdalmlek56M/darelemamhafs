# Checkpoint: Legacy Split 2.2 — Frontend Hook Split

Date: 16 Nov 2026

## Done
- `useDarApplication.ts`: **787 → 363 lines** (under the 400 hard limit).
- Extracted:
  - `useScheduleNotifications.ts` — 157 lines: clock tick, reminder preferences, local class alerts.
  - `useDarDataLoaders.ts` — 169 lines: permission-gated loaders + `refreshAll`.
  - `useDarAuth.ts` — 127 lines: setup, login, session bootstrap, logout.
  - `useStudentActions.ts` — 268 lines: student create/edit/status/delete + history drawer.
  - `useTeacherActions.ts` — 165 lines: teacher drawer/notes + teacher CRUD.
  - `useCircleActions.ts` — 227 lines: circle CRUD, schedule-draft validation, roster drawer.
  - `profitSummaryReport.ts` — 58 lines: operations-profit CSV export.
- Return object compacted without changing its shape.
- No route, payload, SQL, or response changes.
- Push notifications, localStorage keys, and alert keys preserved exactly.

## Build Gate
- Legacy API build: **0 warnings / 0 errors**.
- New solution build: **0 warnings / 0 errors**.
- Unit tests: **12 passed**.
- Integration tests: **3 passed**.
- Legacy frontend `npm run build`: **passed** (721.45 KB JS / 201.96 KB gzip).

## Remaining
- `SystemAdminView.tsx` — 456 lines → tabs.
- `ManagementReportBuilder.tsx` — 360 lines (under limit).
- Legacy backend files under 400 can wait until their module is replaced.
- UI work still blocked until the owner approves a visual sample.

## Decisions
- Transitional action hooks keep state in `useDarApplication` and move behavior only.
- Final architecture remains feature modules under `src/Modules/*` + Next.js `apps/web`.
- Build + tests before every commit/push.
