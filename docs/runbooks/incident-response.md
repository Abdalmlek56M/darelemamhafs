# Runbook — incident response

**Goal:** contain an incident without destroying evidence or data, restore service, and leave a
record. This is the short on-call card; detailed rules are in `../WORKFLOW.md` (Process Safety),
`../06-operations.md` §10 and `../03-security.md`.
**First rule:** do not improvise with destructive commands. In particular **never**
`pkill`/`killall`/`kill -f`, never restart PostgreSQL blindly, and never restore over the live DB.

## 1. Severity and first 5 minutes

| Severity | Examples | First action |
|---|---|---|
| **SEV1** | site down for all users, data loss/corruption, secret/credential exposure, financial wrong data | notify owner immediately; contain read-only; no destructive actions |
| **SEV2** | one portal/API down, deploys failing, backups failing, disk > 85 % | contain + fix or roll back; owner informed |
| **SEV3** | single page broken, notifications delayed, warnings | log + schedule fix in normal flow |

1. Note the time, who is on it, what users see, last deploy stamp/commit
   (`/var/lib/dar/deploy/last-deploy.env`, `/var/log/dar/update-*.log`).
2. Check what is actually running — do not guess:
   `systemctl status dar-legacy dar-api nginx postgresql --no-pager`
3. Open an incident note (timeline + commands + outputs). Every action gets a timestamp.
4. If a deploy caused it and the app is broken → binary rollback (`rollback.md` §1).
   If data is at risk → stop writes with `systemctl stop dar-legacy dar-api` and read
   `backup-restore.md` before touching anything.
5. Notify the owner with impact and the next decision; keep updates short.

## 2. Triage commands (read-only)

```bash
sudo systemctl status dar-legacy dar-api nginx postgresql --no-pager
sudo journalctl -u dar-legacy -n 120 --no-pager
sudo journalctl -u dar-api -n 120 --no-pager
sudo journalctl -u nginx -n 60 --no-pager; sudo tail -n 60 /var/log/nginx/error.log
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5080/health/ready
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5081/health/ready
sudo bash deploy/scripts/dar-healthcheck.sh --json     # exit 0 ok/warn, 1 critical
df -h; free -m; systemctl --failed
sudo -u postgres psql -tAc 'select now(), count(*) from pg_stat_activity;'
sudo bash deploy/preflight.sh                          # read-only host/deploy preconditions
sudo cat /var/lib/dar/deploy/last-deploy.env 2>/dev/null
ls -t /var/log/dar | head
```

## 3. Playbooks

**A. Site/API down after a deploy** → `rollback.md` §1 (binary rollback, database untouched). The
deploy script may already have rolled back; read the update log first.

**B. Service crash-loops / 502** → check `journalctl` for the exception, env-file permissions
(`/etc/dar/*.env` 640 `root:dar`; `/etc/dar/backup.env` 600 `dar:dar`), disk space, and
`nginx -t`. Fix config, then `systemctl restart <exact-service>`; don't edit code on the host.

**C. Database down/corrupted** → stop writes (`systemctl stop dar-legacy dar-api`), check
`systemctl status postgresql`, `journalctl -u postgresql`, disk. Restart PostgreSQL only if it is
safe. If corrupt: owner approval + `backup-restore.md` §5 (restore into a fresh DB, verify, swap).
Verify financial balances/invariants before reopening writes.

**D. Disk full** → `df -h`, `du -xh /var/lib/dar /var/log | sort -h | tail`; rotate/clean logs,
remove only expired backups per retention, never delete DB files/volumes; check
`journalctl --disk-usage`. If recurring, request more disk.

**E. Secret/credential exposure** → rotate the affected secret(s), revoke sessions/tokens
(`session_version` bump / cookie invalidation), check audit logs for misuse, remove the leak from
source, document; follow `../03-security.md` §19 for the list of values to rotate.

**F. Failed migration / schema mismatch during deploy** → the deploy aborts before the binary swap
when the ledger count ≠ `database/*.sql`; do not run destructive rollback. Inspect the migration,
fix forward with a new migration, retest on staging, redeploy with a fresh backup.

**G. Backup failure / offsite missing** → `journalctl -u dar-backup`, check
`/var/lib/dar/rclone/rclone.conf` ownership (600 `dar:dar` — see the 24 Nov incident), disk, then
rerun manually and verify the manifest + offsite (`backup-restore.md` §2). Escalate to owner.

## 4. Communication and recovery criteria

- Single incident owner (one voice) → owner; state impact, current state, next action, ETA.
- Recovered only when: 7-point smoke passes (`deploy.md` §3), `dar-healthcheck.sh --json` has no
  `critical`, `systemctl --failed` is empty, a fresh verified backup exists, and logs are clean.
- Do not close before the owner has the facts and any data loss is quantified.

## 5. After the incident

1. Write a checkpoint in `../checkpoints/` (timeline, root cause, impact, commands, evidence,
   follow-ups) and update `../00-current-state.md` if production revision/state changed.
2. Any behavior/process change → update the relevant doc (`../06-operations.md`,
   `../11-deployment.md`, `../runbooks/`) in the same change.
3. Never commit secrets, dumps or logs. Rotate anything that may have been exposed.
4. If the incident was caused by an agent action, record the exact rule to add to
   `../WORKFLOW.md` / `AGENTS.md`.
