# P1-5 — Close request notifications when the request is resolved (1.0)

**Status:** Implemented, tested, deployed; **not marked Done** pending owner review.
**Deployment commit:** `7738728`

## Root cause

- Teacher request creation opens a supervisor notification with dedupe key `request:{requestId}`.
- New-API supervisor review and legacy admin review changed the request state but never resolved that notification.
- Teacher cancellation also left it open.
- Legacy reopen had no path to re-open the notification.

## Change

- New API `SupervisorRequestEndpoints.Review`: resolves `request:{id}` inside the review transaction for approve/reject.
- New API `TeacherRequestEndpoints.Cancel`: resolves it inside the cancellation transaction.
- Legacy `/api/admin/requests/{id}/review`: updates the notification inside the same transaction.
- Legacy `/reopen`: re-opens the same notification with `ON CONFLICT(dedupe_key)`.
- Legacy `/delete`: resolves the notification in the same transaction.
- Frontend `SupervisorRequests`: refreshes notifications after a successful review so the badge/drawer does not stay stale.
- If the notification update fails, the exception is not swallowed; the request transaction rolls back (no partial review).

## Test result

- Disposable DB + temporary apps + ZZ-TEST accounts.
- **10/10 passed**, including:
  - new approve/reject close notification;
  - teacher cancel closes;
  - locked/failed review keeps it open;
  - legacy approve/reject close;
  - legacy reopen reopens;
  - legacy delete closes;
  - unrelated notification unaffected;
  - already-reviewed action leaves it resolved.

## Deployment

- Commit: **`7738728`**
- Start: **2026-11-25 00:36:36 EET**
- Services active: **00:37:49 EET**
- Backups:
  - DB: `/var/lib/dar/backups/db/predeploy-P15-20261125-003636.dump`
  - API: `/opt/dar/app/api.bak.20261125-003636`
  - Legacy/frontend: `/opt/dar/app/legacy.bak.20261125-003636`
- Smoke: local health 200 for API/legacy; public `/`، `/management`، `/teacher` = 200.
- Deployed API DLL SHA: `4f4eb568628567ce33d19b99b624f0cda99193be633c3e1a2fa5209fe616ff9d`
- Deployed legacy DLL SHA: `55d1257fe6c7a81d8a8e777c824c17310a8212a2a54338f2122d028f7e527a84`

## Stale production notifications (not modified)

Read-only count after deployment:

- Open notifications with dedupe `request:%` whose request is already `approved`/`rejected`/`cancelled`: **18**.

**No backfill or modification was performed.** Cleaning these requires explicit owner approval in a separate step.

## Not verified

1. No production UI browser test with a real supervisor account; frontend refresh was type-checked/deployed, but end-to-end UI remains owner-tested.
2. No concurrent-review stress test beyond the single-session tests.
3. No backfill of the 18 historical stale notifications (intentionally).
