# Staging environment on the shared host

> No credentials live in the repository. The owner-only file is on the server at
> `/root/dar-staging-credentials.txt` (mode 0600).

## Shape

| Part | Value |
|---|---|
| URL | `http://<deployment-host>:8088/` (temporary; no DNS subdomain/certificate yet) |
| Access | HTTP Basic Auth only (no IP allow-list); `/internal/` returns 404 |
| Database | `dar_staging_20261127`, role `dar_stg_app`, schema only + ZZ-TEST rows |
| App dirs | `/srv/dar-staging/app/{legacy,api}`, source `/srv/dar-staging/repo` |
| Ports | legacy `127.0.0.1:6180`, new API `127.0.0.1:6181` |
| Services | `dar-staging-legacy`, `dar-staging-api` |
| Env files | `/etc/dar-staging/{legacy,api}.env` (root:deploy 0640) |
| Backups | `/srv/dar-staging/backups/` |
| Runbook on server | `/srv/dar-staging/STAGING.md` |

Production (`/opt/dar`, `dar-api`, `dar-legacy`, database `dareltahfeez`) is never touched by
this environment.

## Rebuild from scratch

1. Create the database and role with random credentials (do not reuse production names).
2. Apply `database/001→033` in order as the database owner, then take a schema-only backup:
   `pg_dump -Fc --schema-only -d dar_staging_20261127 > backups/staging-pre-deploy-<stamp>.dump`.
3. Apply `034→038` in order and verify after each (the `tier2-meet-cap`, `tier2-indexes`,
   `tier1-migration-034` regression suites encode the checks).
4. Seed only rows prefixed `ZZ-TEST` (no production data).
5. Publish both APIs (`dotnet publish … -c Release`) and extract the frontend build into
   `app/legacy/wwwroot`; install env files and systemd units; restart the staging services.
6. POST `/api/setup/admin` with the staging `Auth__SetupToken`, create the ZZ teacher account,
   then verify `/health/ready`, `/management`, `/teacher`, `/api/v1/ping`, and `/internal/` 404.

## Rollback

- Stop staging: `systemctl disable --now dar-staging-legacy dar-staging-api`.
- Remove the vhost link `/etc/nginx/sites-enabled/dar-staging`, then `nginx -t && systemctl reload nginx`.
- App rollback: check out the previous commit in `/srv/dar-staging/repo`, re-publish, restart.
- DB rollback: create a fresh database and
  `sudo -u postgres pg_restore --clean --if-exists -d <fresh> backups/<dump>`; point env at it.

## Role ownership difference (important for production migrations)

- Production database `dareltahfeez` and its public tables are owned by the non-superuser
  role `dar_app`. Migrations `034→038` must run as `dar_app` (the owner) or an
  owner-capable role; running them as `postgres` would leave the app role without DML
  privileges and require explicit GRANTs.
- Staging's objects were created by `postgres` while the database owner is `dar_stg_app`;
  `dar_stg_app` therefore received DML/sequence/function grants plus default privileges.
  A from-scratch rebuild should either apply migrations as `dar_stg_app` or repeat those
  grants.
- `034`/`038` alter table definitions, so DML-only rights are not enough for them.

## Disabled outbound integrations on staging

SMTP host, Google OAuth client, Meet recording encryption/key, Telegram and WhatsApp are
blank; Meet calendar/recording is fail-closed.
