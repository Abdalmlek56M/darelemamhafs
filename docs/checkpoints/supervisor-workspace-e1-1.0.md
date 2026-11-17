# Checkpoint: Supervisor Workspace E1 1.0

Date: 17 Nov 2026

## Done

- Pushed E1 as `b2eac18` (`feat: E1 professional supervisor workspace with demo data`).
- Rebuilt the frontend on the host and copied it into the live legacy SPA (`/opt/dar/app/legacy/wwwroot`); only static assets changed, no API or database migration.
- Replaced the narrow supervisor board with:
  - Desktop shell at ≥1024px: right sidebar, topbar, KPI dashboard, two-column operation panels, quick actions and professional data tables.
  - Mobile shell: compact topbar with page title, five-item bottom navigation, and a “كل الأقسام” sheet for the rest.
  - Wider teacher pages on desktop (860px instead of 520px).
- Demo mode:
  - URL: `https://dar-elemam-hafs.rigxhardware.com/supervisor?demo=1`.
  - Or the in-app action “عرض نموذج بالبيانات”.
  - Uses built-in realistic sample data only; no database writes. A banner and a “العودة للبيانات الحقيقية” action are always visible.
  - Real empty state on the dashboard offers the demo preview instead of a blank page.
- Preserved the adjust-time sheet on the overview for live sessions.
- Live smoke:
  - `/health/ready` → 200; `/` → 200; `/teacher` → 200; `/supervisor?demo=1` → 200.
  - Supervisor login → dashboard with demo data at 1440×1000 and 390×844.
  - No console errors beyond the expected pre-login 401.
  - `/opt/dar/app/legacy/wwwroot/index.html` references the new `index-5rRX0nFH.js`.
- Rollback for static assets: re-copy the previous `frontend/dist` build from Git commit `6b850c3` (or the retained old assets in `wwwroot/assets`) into `wwwroot` and restart `dar-legacy`.

## Pending

1. Owner reviews the live demo and confirms the visual direction.
2. Owner changes the supervisor password and deletes `/etc/dar/supervisor-initial-password` (the temporary password was provided separately).
3. Owner creates real teacher records and links `asmaa`.
4. A3: requests, admin notification center, WhatsApp sender.

## Notes

- The demo data is code-only and cannot affect the live database. Disabling demo removes `?demo=1` from the URL and restores real API data.
- The old `SupervisorBoard.tsx` was removed; the current supervisor entry point is `SupervisorWorkspace.tsx`.
