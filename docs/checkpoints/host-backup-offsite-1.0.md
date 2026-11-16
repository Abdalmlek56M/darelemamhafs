# Checkpoint: Host Backup + Offsite 1.0

Date: 16 Nov 2026

## Done

- **Admin bootstrap closed:** owner changed the password from the web UI; `/opt/dar/.initial-admin-password` is deleted.
- **Google Drive offsite configured:**
  - `/etc/dar/rclone.conf` installed (`dar:dar`, `600`) with the `gdrive:` remote.
  - `/etc/dar/backup.env` contains `RCLONE_CONFIG=/etc/dar/rclone.conf` and `RCLONE_REMOTE=gdrive:dar-backups`.
  - `rclone listremotes` on the host → `gdrive:`.
- **Backup retention:** local and offsite dumps kept for **30 days**.
  - `deploy/scripts/dar-backup.sh` copies the new dump to `${RCLONE_REMOTE}/dar/db/` and deletes remote dumps older than 30 days.
  - Local cleanup changed from 14 to 30 days.
- **Manual run:** `dar-20261116-095559.dump` (87,304 bytes) uploaded successfully.
- **Restore drill:** remote dump downloaded, compared byte-for-byte with the local copy, and restored to `dar_offsite_test`.
  - SHA-256 match: `e007e645b0f125e9358172d9676b6bc3d03f57f6e8f31109dd747a069dc6ed73`.
  - `pg_restore --list` → 184 TOC entries.
  - Restored counts: **1 user / 16 migrations**, matching live.
  - Disposable database dropped.
- **Retention dry-run:** `rclone delete --min-age 30d --include 'dar-*.dump' --dry-run` removed nothing.
- **Timer:** active; next run **17 Nov 2026 02:34 EET**.

## Verification Commands

```bash
sudo systemctl start dar-backup.service
ls -lh /var/lib/dar/backups/db
sudo -u dar rclone --config /etc/dar/rclone.conf ls gdrive:dar-backups/dar/db/
sudo journalctl -u dar-backup.service -n 15 --no-pager
systemctl list-timers dar-backup.timer --no-pager
```

## Security / Follow-up

- The Google Drive remote uses rclone's shared client ID, which is being retired during 2026. Create a **dedicated Google OAuth client ID** and re-authorize before then.
- Revoke the earlier Google OAuth grant if it predates the re-authorization.
- Rotate the Cloudflare API token that was pasted into chat, then re-run the Certbot DNS-01 dry-run.
- Keep the 30-day window; do not delete the retired Docker volumes until a separate retention decision.

## Files

- `deploy/scripts/dar-backup.sh`
- `deploy/setup-host-backup.sh`
- `docs/11-deployment.md`
- `docs/checkpoints/host-deployment-1.1.md`
- `docs/checkpoints/host-backup-offsite-1.0.md`
