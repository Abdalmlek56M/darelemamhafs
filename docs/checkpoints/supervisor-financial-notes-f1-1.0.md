# Checkpoint: Supervisor Financial Privacy + Notes F1 1.0

Date: 17 Nov 2026

## Done

- Pushed F1 as `22f55fb` (`fix: F1 financial privacy, teacher notes feed and notification drawer`).
- Pre-deploy backup: `dar-20261117-074409.dump`.
- Published the new API to `/opt/dar/app/api` (old retained at `api.old.20261117-074853`) and copied the new frontend into `/opt/dar/app/legacy/wwwroot`.
- Financial privacy:
  - `/api/v1/supervisor/unpaid` returns `amountDue/paidAmount/balance = null` and `canViewAmounts=false` without `finance.read`; the list still shows who is late and `unpaid/partial` status.
  - Payment notification bodies no longer contain amounts.
  - Student detail returns subscription status only (circle + `paid/partial/unpaid`) without amounts unless `finance.read`.
  - A supervisor with `finance.read` sees 250/125/125 in the same flow.
- Teacher notes:
  - `GET /api/v1/supervisor/teacher-notes` returns session notes and per-student notes scoped by circle/teacher.
  - New “ملاحظات المعلمات” supervisor section with filters and table/mobile cards.
- Notifications:
  - Supervisor bell/nav opens a PC right-side drawer (mobile full-screen sheet) with categories, status filters, read, read-all and resolve.
  - No more jump to the narrow teacher notifications page.
- Teacher portal:
  - Removed the “المشرفة” item from `TeacherNav`; ordinary teachers no longer see supervision navigation.
  - Added quick links to the teacher home (notifications/unread, refresh, roster, subscriptions when allowed).
- Phone columns: LTR phone cells are right-aligned under their headers; mini-grid phone values are right-aligned.
- Sidebar pointer focus no longer leaves a second highlighted item.

## Verified

- Disposable PostgreSQL 17 with a 250 charge and a 125 payment.
- No-finance supervisor: unpaid amounts null, status partial; student subscription status-only; teacher notes feed returns session + student notes; payment notification body has no amount.
- Finance supervisor: unpaid and student subscription return 250/125/125.
- Live:
  - `/health/ready`, `/`, `/teacher`, `/supervisor?demo=1` → 200.
  - Supervisor login → 200; `/unpaid` → `canViewAmounts=false`; `/teacher-notes` → 200; `/students` → 200.
  - Live teacher-notes page and notification drawer rendered at 1440×1000.
- **A3.1 WhatsApp follow-up links (commit `72e312d`):** `wa.me` links on supervisor absences (teacher + guardian), unpaid (guardian), student detail (guardian) and teacher detail (teacher). Phone normalization defaults to Egypt +20; no paid WhatsApp API. The unpaid endpoint now returns `guardianPhone`. A communication log and templates remain A3.2.

## Pending

1. Admin console still needs the teacher-notes feed and its own notification page.
2. Admin 250/125 charge creation + payment UI audit (DB/API model verified; admin UI path pending).
3. Admin-wide UI/data audit.
4. Subscription status in supervisor student list (detail is done).
5. A3: absence/cancellation/correction request workflow + WhatsApp sender.
6. Owner changes the supervisor password and deletes `/etc/dar/supervisor-initial-password`.

## Rollback

```bash
sudo systemctl stop dar-api
sudo mv /opt/dar/app/api /opt/dar/app/api.failed
sudo mv /opt/dar/app/api.old.20261117-074853 /opt/dar/app/api
sudo systemctl start dar-api
```

Frontend rollback: recopy the previous `frontend/dist` build (commit `1f1af90`) into `wwwroot` and restart `dar-legacy`. No schema change.
