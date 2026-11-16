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
- **Admin:** temporary password retrieved by the owner. Pending password change and file deletion.

## Security Notes
- The Cloudflare token was pasted into chat. It should be rotated after the renewal setup is confirmed. Replace the value in `/root/.secrets/cloudflare.ini` and run the dry-run again.
- The admin temporary password was also shared in chat; change it immediately from the UI, then delete `/opt/dar/.initial-admin-password`.
- The `deploy` user has passwordless sudo for automation. Review/remove later if not needed.

## Pending
1. Change the admin password and delete the temporary file.
2. Configure rclone with Google Drive (offsite backup).
3. Run the first offsite backup and verify the remote copy.
4. Restore drill.
5. Deploy the two hardware stores and Quran site later.

## Verification
- `https://dar-elemam-hafs.rigxhardware.com/health/ready` → ready.
- `https://dar-elemam-hafs.rigxhardware.com/api/v1/ping` → ok.
- Certificate: Let's Encrypt ECDSA, valid to 2027-02-14.
- Services active: nginx, postgresql, dar-legacy, dar-api.
- Local backup: `/var/lib/dar/backups/db/dar-20261116-080533.dump`.
