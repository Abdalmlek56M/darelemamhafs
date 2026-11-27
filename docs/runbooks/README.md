# Runbooks — operational index

Short, concrete procedures for the deploy host (`/opt/dar`, Ubuntu + Nginx + systemd +
PostgreSQL 17). All scripts referenced here exist in this repo; the deploy-time entry points are
`deploy/*.sh` and `deploy/scripts/*.sh`.

**Rules that apply to every runbook**

- Production changes need **owner approval** and a documented reason; if in doubt, stop and ask.
- Never run tests, migrations, restores or destructive SQL against production data.
- Never `pkill`/`killall`/`kill -f`; stop services with `systemctl stop <exact-service>` and stop
  test processes by a saved PID (see `../WORKFLOW.md`).
- Record what you did: deploy/rollback state files are under `/var/lib/dar/deploy/`, logs under
  `/var/log/dar/`, and every completed step gets a checkpoint in `../checkpoints/`.
- Real hostnames/IPs/DB names are placeholders here — read them from the untracked `deploy/.env`
  and `/etc/dar/*.env` on the host. Naming rules: `../naming.md`.

| Runbook | Use when | Main scripts | Detail |
|---|---|---|---|
| [deploy.md](deploy.md) | shipping `origin/main` to production | `deploy/preflight.sh`, `deploy/update.sh` | `../11-deployment.md` §7.1–7.2 |
| [rollback.md](rollback.md) | a deploy broke the app (binary rollback) | `deploy/rollback.sh` | `../11-deployment.md` §7.3 |
| [rollback-db.md](rollback-db.md) | pre-deploy snapshot must be restored into a **fresh** DB, app pointed at it | `deploy/rollback-db.sh` | `../11-deployment.md` §7.3 |
| [backup-restore.md](backup-restore.md) | verifying backups, restore drills, restoring data | `deploy/scripts/dar-backup.sh`, `deploy/scripts/restore-drill.sh`, `deploy/setup-host-db.sh` | `../06-operations.md` §7, `../11-deployment.md` §6 |
| [incident-response.md](incident-response.md) | outage, data loss, disk full, secret exposure, failed migration | `deploy/scripts/dar-healthcheck.sh` | `../06-operations.md` §10, `../03-security.md` §19 |
| [db-roles-and-tuning.md](db-roles-and-tuning.md) | separate DB roles (`dar_migrator`/`dar_app`/`dar_read_only`) + PostgreSQL tuning — scripts ready, **not applied** | `deploy/setup-host-db-roles.sh`, `deploy/sql/db-roles.sql` | `../02-architecture.md` §5.6 |
| [livekit-m0.md](livekit-m0.md) | LiveKit M0 audio spike — **BLOCKED on the live host** (owner action) | `deploy/livekit/install-livekit-test.sh` | `../22-inhouse-meetings-design.md` |
| [asset-retention.md](asset-retention.md) | cleaning old hashed frontend assets (>7 days) | — | P2-8 |
