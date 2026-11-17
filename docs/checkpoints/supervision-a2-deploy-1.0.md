# Checkpoint: Supervision A2 Live Deploy 1.0

Date: 17 Nov 2026

## Done

- Pushed A2 as `f27a3f9` (`feat: A2 scoped supervision read models and admin scope picker`).
- Pre-migration backup: `dar-20261117-023459.dump` (214 TOC entries).
- Applied **migration 019** (`019_app_user_scopes`) with the new migration runner; live ledger is now **19**.
- Published and swapped:
  - New API: scoped student/circle/teacher read models, notes, attendance, absences, scope endpoints.
  - Legacy API + SPA: admin scope picker, scoped access save, A2 frontend build.
- Old artifacts retained for rollback:
  - `/opt/dar/app/api.old.20261117-024350`
  - `/opt/dar/app/legacy.old.20261117-024350`
- No live scope rows: the existing `supervisor` account remains **all circles/teachers** (backward compatible). The admin can now narrow it from **إدارة الحسابات → تعديل الحساب → نطاق الإشراف**.
- Public smoke:
  - `/health/ready`, `/api/v1/ping`, `/`, `/teacher`, `/supervisor` → 200.
  - `/api/v1/supervisor/students` and `/scopes` → 401 without a session.
  - Supervisor login → 200; students/circles/teachers/attendance/absences → 200.
  - Scope API as supervisor → 403; change password without permission → 403.
  - Admin user list query returns `scope_circles`/`scope_teachers` arrays for all 3 live users (empty = all).
- Post-deploy backup: `dar-20261117-024931.dump` (220 TOC entries; includes `app_user_scopes`).

## Verified Before Deploy

- All 19 migrations on a disposable PostgreSQL 17 database.
- Scope resolution: all-scope supervisor saw 2 students/2 circles/2 teachers; circle-scoped saw 1/1/1; teacher-scoped saw only that teacher’s circle. Out-of-scope detail and note writes returned 404.
- Teacher detail: scheduled 8, present 2, rate 25%, 1.8 hours, 15 undertime; pay and hourly rate null without `finance.read`.
- Absences returned the missing teacher + student absences; teacher/student attendance returned expected rows.
- Student/teacher notes created and audited; admin scope PUT set all and restored a circle; non-admin 403.
- Mobile (390×844) and desktop (1280×900) screenshots reviewed; no unexpected console errors.
- Tests: 16 unit + 6 integration; frontend build passes.

## Pending

1. Owner reviews the admin scope picker on live and sets the supervisor scope if needed (default all).
2. Owner changes the `supervisor` password and deletes `/etc/dar/supervisor-initial-password` (still present; CRLF file).
3. Owner creates real teacher records and links accounts (`asmaa` still unlinked).
4. A3: requests, admin notification center, WhatsApp sender.
5. Payroll lock/approval, production E2E, GitHub Actions verification.

## Rollback

```bash
sudo systemctl stop dar-api dar-legacy
sudo mv /opt/dar/app/api /opt/dar/app/api.failed
sudo mv /opt/dar/app/api.old.20261117-024350 /opt/dar/app/api
sudo mv /opt/dar/app/legacy /opt/dar/app/legacy.failed
sudo mv /opt/dar/app/legacy.old.20261117-024350 /opt/dar/app/legacy
sudo systemctl start dar-api dar-legacy
```

Migration 019 is additive. Old binaries ignore `app_user_scopes`; do not drop the table as a rollback step.
