# Checkpoint: Admin Notifications + Teacher Notes + Desktop Teacher Layout 1.0

Date: 18 Nov 2026

## Done

- Commit `ba7b1d4`; legacy API + frontend deployed. No migration.
- Admin console:
  - New **الإشعارات** page: open/resolved/all filters, counts, unread state, mark-read, mark-all-read, resolve with a note, category labels, PC cards and mobile layout.
  - New **ملاحظات المعلمات** page: kind filter, teacher filter, PC table, mobile cards, and the active notes banner.
  - New legacy endpoints: `GET /api/admin/notifications`, `POST /api/admin/notifications/{id}/read`, `POST /api/admin/notifications/read-all`, `POST /api/admin/notifications/{id}/resolve`, `GET /api/admin/teacher-notes`.
  - Admin visibility covers `supervisor`/`admin` notifications plus the user's own; payment notifications stay finance-gated; resolve requires `attendance.correct` or `users.manage` and is audited.
  - Mobile admin navigation is now a horizontal strip with every section reachable; account/footer rows are hidden on mobile to save vertical space.
- Teacher portal:
  - Removed the centered 520/860px “tablet frame” and side borders on desktop.
  - PC (≥1024px) uses a full-width shell with a right sidebar, wider pages, a two-column home grid, larger typography and desktop grids for notes/roster.
  - Mobile keeps the bottom navigation and the existing mobile-first cards.
- Charge suggestion:
  - Monthly charge now defaults to the enrollment’s agreed fee (`agreed_monthly_fee`), never an automatic mid-month proration. The dialog shows the agreed fee and a “use agreed fee” reset link.
  - This fixes the 108.33 / 116.67 / 125 results observed for a 250 circle.
- Admin settings: “إعادة القوالب الافتراضية” restores the four WhatsApp templates in the form before saving.

## Verified

- Frontend `tsc -b && vite build` passed; Vitest **6/6** passed.
- `dotnet build` legacy + `Dar.slnx` 0 warnings/0 errors; `dotnet test Dar.slnx` → **16 unit + 15 integration**.
- Local QA against disposable PostgreSQL 17 + legacy API + new API + Vite:
  - Admin dashboard, notifications and teacher-notes pages at 1440×1000.
  - Admin notifications and notes at 390×844; mobile nav strip reachable.
  - Teacher home at 1440×1000 (right sidebar, full-width PC shell) and 390×844 (bottom nav).
  - API smoke: admin notifications list/counts, mark-read, resolve, teacher-notes list with teacher options and banner.
- Live:
  - `/`, `/management`, `/teacher`, `/supervisor` → 200.
  - `/api/admin/notifications` and `/api/admin/teacher-notes` return 401 unauthenticated (routes live, not 404/502).
  - Pre-deploy backup `dar-20261118-021510.dump`; post-deploy `dar-20261118-022142.dump`.
  - Legacy artifacts retained at `legacy.old.20261118-021929`.

## Pending

1. Owner visual check of the new admin pages and the desktop teacher layout after login.
2. Audit historical monthly charges created with the old prorated suggestion; produce a report before corrections.
3. Full subscriptions/collections review and admin schedule/teacher-attendance list review.
4. Admin console UI/functional parity and the file/folder/OOP refactor.
5. Admin permissions save re-test after the Nginx buffer fix.
6. Owner changes the supervisor password and deletes `/etc/dar/supervisor-initial-password`.
