# P1-5 — Cleanup of pre-fix stale request notifications (1.0)

**Status:** Executed with explicit owner approval; **not marked Done** pending owner review.
**Scope:** only notifications with `status='open'`, `dedupe_key LIKE 'request:%'`, linked request `status IN ('approved','rejected','cancelled')` or `is_trashed=TRUE`.

## Backup

- Table: `public.notifications`
- File: `/var/lib/dar/backups/db/notifications-pretidy-20261125-010723.dump`
- Size: 9,840 bytes; custom format; TOC 13 entries; created **2026-11-25 01:07:24 EET**.
- Owner/mode: `dar:dar 600`.
- Validated with `pg_restore --list` (exit 0).

## Selected rows (18)

| Notification id | Request status |
|---|---|
| `093354be-2b77-4bad-af10-48b4c9d44a1f` | approved |
| `0eeab24d-14d0-4114-8ff2-fa262f549da0` | rejected |
| `13478a15-cbab-4cf1-8c20-7b3d2ed8c82a` | approved |
| `1b0a1766-d8a8-4c63-a4d1-cbfcd308f418` | approved |
| `26b64d13-1e72-4766-bc53-c24dd4e85824` | rejected |
| `30ad6ef4-bb81-4455-99ee-4700cc936e4b` | approved |
| `3f5e075d-bf9e-46a9-b66e-3689ed4a60d7` | approved |
| `65491aab-a9f7-419c-82c6-a7694506b9ba` | approved |
| `7d570495-2bc5-4dbf-b72e-7aff7b9bee45` | approved |
| `8198019f-6d47-426d-9a8e-d030f6f349d9` | approved |
| `85066e1e-9b14-45de-96f4-c5315823d19f` | approved |
| `8725dc5f-aaf2-4bec-821c-0e938f9820ec` | approved |
| `8cac43a2-3dd4-40d1-af43-30c532e1deb3` | approved |
| `9447681a-2634-4d92-bc21-45279145e64d` | approved |
| `aead969b-bcb6-45ea-b59a-5a53bf42bdf3` | approved |
| `ce49f77f-ce34-4d2e-870c-2812b337627f` | approved |
| `e636ad54-da18-4fb6-8391-5572c03d5b31` | approved |
| `f711af76-352a-4111-b5a6-9b8659e695b2` | approved |

Count displayed before update: **18**. No deleted/pending rows were included.

## Update

Single transactional `UPDATE`:

```sql
status='resolved', resolved_at=now(),
resolution_note='تنظيف إشعار طلب محلول قبل P1-5'
```

A `DO` block verified `ROW_COUNT = 18`; a mismatch would raise and roll back the transaction. The transaction committed successfully.

## Counts

Before:
- Notifications total: 48
- Open request-notification rows (`dedupe_key LIKE 'request:%'`): **18**
- Open request notifications linked to pending requests: **0**

After:
- Notifications total: **48** (unchanged)
- Open request-notification rows: **0**
- Open notifications overall: 25
- Resolved notifications overall: 23
- Rows carrying the cleanup note: **18**
- Remaining matching stale rows: **0**
- Open request notifications linked to pending requests: **0** (none existed before or after)

Only the 18 selected rows changed; all other 30 notifications were untouched.

## Rollback

1. The table backup is at `/var/lib/dar/backups/db/notifications-pretidy-20261125-010723.dump`.
2. To inspect/restore it, use a disposable database first:
   ```bash
   sudo -u postgres createdb notif_restore_check
   sudo -u postgres pg_restore -a -t notifications --no-owner --no-privileges \
     -d notif_restore_check /var/lib/dar/backups/db/notifications-pretidy-20261125-010723.dump
   ```
   (If PostgreSQL cannot read the `dar:dar 600` file, copy it to a temporary path readable by postgres first.)
3. Row-level rollback for exactly the 18 ids: set `status='open'`, `resolved_at=NULL`, `resolved_by=NULL`, `resolution_note=NULL`; the backup holds the exact pre-change values.
4. No production rollback was performed; no further cleanup will run without separate approval.

## Notes

- No schema changes, no code deploy, no service restart.
- No other notification categories/rows were touched.
- Temporary SQL/verification scripts were removed after the run.
