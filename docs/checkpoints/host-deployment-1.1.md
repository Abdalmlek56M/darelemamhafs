# Checkpoint: Host Deployment 1.1 — DNS-01, GitHub, Fail2ban

Date: 16 Nov 2026

## Done
- **Fail2ban:** current client IP `102.45.255.243` unbanned and added to `ignoreip`; 3 unrelated attacker IPs remain banned.
- **Cloudflare DNS-01:** scoped API token stored at `/root/.secrets/cloudflare.ini` (`600 root:root`).
  - Forced certificate renewal through DNS-01 succeeded.
  - `certbot renew --dry-run --no-random-sleep-on-renew` → **all simulated renewals succeeded**.
  - Nginx reloaded; HTTPS still valid.
- **GitHub:** deploy key added to the repository.
  - `ssh-keyscan github.com` added to `deploy` known_hosts.
  - `git fetch origin` succeeded.
  - `git reset --hard origin/main` → `c5676ad`.
  - Upstream set: `main` tracks `origin/main`.
  - `git pull --ff-only` → **Already up to date**.
  - `/opt/dar` is now a Git checkout. `app/`, `backups/`, `.initial-admin-password`, `deploy/.env` remain untracked/ignored.
- **Admin:** password changed by the owner; `/opt/dar/.initial-admin-password` deleted.
- **Offsite backup:** `gdrive:` remote copied to `/etc/dar/rclone.conf` (`dar:dar`, `600`); `RCLONE_CONFIG` + `RCLONE_REMOTE=gdrive:dar-backups` added to `/etc/dar/backup.env`.
  - Manual run: `dar-20261116-095559.dump` (87,304 bytes) uploaded to `gdrive:dar-backups/dar/db/`.
  - Local and remote SHA-256 identical; `pg_restore --list` → 184 TOC entries.
  - Offsite dump restored to a disposable DB: 1 user / 16 migrations; DB dropped.
  - Local and offsite retention set to 30 days.
  - Timer active; next run 17 Nov 2026 02:34 EET.
- See `host-backup-offsite-1.0.md` for the backup checkpoint.

## Security Notes
- The Cloudflare token was pasted into chat. It should be rotated after the renewal setup is confirmed. Replace the value in `/root/.secrets/cloudflare.ini` and run the dry-run again.
- The earlier Google OAuth/rclone tokens were exposed in chat. The Drive remote was re-authorized, but revoke the old grant and move to a dedicated OAuth client ID (the shared rclone client ID is being retired during 2026).
- The admin temporary password was shared in chat; it has been changed and the file deleted.
- The `deploy` user has passwordless sudo for automation. Review/remove later if not needed.

## Pending
1. Create a dedicated Google OAuth client ID for rclone and re-authorize `gdrive:`.
2. Rotate the Cloudflare API token.
3. Deploy the two hardware stores and Quran site later.
4. Teacher portal UI awaits owner approval of the 5-screen sample.

## Verification
- `https://dar-elemam-hafs.rigxhardware.com/health/ready` → ready.
- `https://dar-elemam-hafs.rigxhardware.com/api/v1/ping` → ok.
- Certificate: Let's Encrypt ECDSA, valid to 2027-02-14.
- Services active: nginx, postgresql, dar-legacy, dar-api.
- Latest verified local backup: `/var/lib/dar/backups/db/dar-20261116-095559.dump`.
- Remote backup: `gdrive:dar-backups/dar/db/dar-20261116-095559.dump`.
- Restore drill: 1 user / 16 migrations, matching live.
