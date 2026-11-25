# Asset retention after frontend deploys (P2-8)

Deployments merge the new build's `assets/` into the existing `wwwroot/assets/`. They do **not** delete old hashed JS/CSS chunks; still-open pages must be able to fetch their old dynamic chunks after a deploy.

## Required retention

- Keep old asset files for **at least 7 days** after each deploy.
- Never run a blanket `rm -rf wwwroot/assets` during a deploy.
- Normal `wwwroot.bak.<stamp>` backups remain unchanged.

## Cleanup (run only after the 7-day window)

```bash
APP=/opt/dar/app/legacy/wwwroot
# Review first; this deletes hashed asset files older than 7 days only.
find "$APP/assets" -maxdepth 1 -type f -mtime +7 -print
# Then, after confirming the current index.html references newer files:
find "$APP/assets" -maxdepth 1 -type f -mtime +7 -delete
```

Do not delete assets referenced by the current `index.html` or by the currently cached build. Keep the normal backup and the Cloudflare/service-worker cache behavior in mind before cleanup.
