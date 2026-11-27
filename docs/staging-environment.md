# Staging environment on the shared host

> Staging is a **disposable** copy: no production data, no DNS subdomain, no certificate.
> Production (`/opt/dar`, `dar-api`, `dar-legacy`, database `<production-db>` from `$POSTGRES_DB`) is never touched.
> No credentials live in the repository. If Basic Auth is re-enabled, the owner-only credential
> file stays on the server at `<certbot-secrets-dir>/dar-staging-credentials.txt` (mode 0600).

## Shape (Nov 2026)

| Part | Value |
|---|---|
| URL | `http://<deployment-host>:8088/` (temporary plain HTTP; `staging.<domain>` is only a reserved `server_name`, DNS is not pointed and there is no certificate yet) |
| Access | **IP allow-list**: owner IP + `127.0.0.1` allowed, `deny all`. The owner IP does **not** need HTTP Basic Auth. Basic Auth is not the gate anymore; if it is re-enabled for a reviewer IP use `/etc/nginx/.htpasswd-dar-staging` (`satisfy any` + `allow` for the owner). |
| Edge hardening | `/internal/` returns **404** at the edge (bot control plane stays loopback-only); no `X-Setup-Token` header is injected by the vhost |
| Database | `dar_staging_20261127`, role `dar_stg_app`; schema only + `ZZ-TEST` rows |
| App dirs | `/srv/dar-staging/app/{legacy,api}`; source checkout `/srv/dar-staging/repo` |
| Ports | legacy `127.0.0.1:6180`, new API `127.0.0.1:6181` |
| Vhost | `/etc/nginx/sites-available/dar-staging` → linked in `sites-enabled`; listens on `8088` (IPv4 + IPv6) |
| Services | `dar-staging-legacy.service`, `dar-staging-api.service` (run as `deploy` from `/srv/dar-staging/app/*`) |
| Env files | `/etc/dar-staging/{legacy,api}.env` (root:deploy 0640) |
| Backups | `/srv/dar-staging/backups/` |
| Runbook on server | `/srv/dar-staging/STAGING.md` |

## Vhost requirements (keep these when rebuilding)

1. **IP allow-list first:** `allow <owner-ip>; allow 127.0.0.1; deny all;`. The earlier
   Basic-Auth-only shape was replaced because it leaked a shared password and still exposed
   staging to the Internet.
2. **`location ^~ /internal/ { return 404; }`** — the recorder/bot control plane is loopback
   only on both production and staging.
3. **Plain HTTP forwarding:** staging has no TLS, so both locations send
   `X-Forwarded-Proto http` (production sends `https`). The legacy admin cookie follows the
   request scheme (`CookieSecurePolicy.SameAsRequest`, ADR-0008/B10), so it is not marked
   `Secure` over staging HTTP and sessions survive.
4. **Cookie buffer requirements:** keep the production buffer set on both locations —
   `proxy_buffer_size 32k; proxy_buffers 8 32k; proxy_busy_buffers_size 64k;`. The legacy
   admin `Set-Cookie` used to exceed nginx's 4 KB default and produced
   `upstream sent too big header` → **502** on login/setup. ADR-0008 shrinks that cookie, but the
   buffers stay required for old cookies, large upstream headers and report responses.
5. **Staging-only `nosecure` shim:** `dar_session` (new API) is still issued `Secure` outside
   Development, so the staging vhost strips the flag on the `/api/v1/` location with
   `proxy_cookie_flags ~ nosecure;`. Remove the shim as soon as staging moves to HTTPS; never
   copy it to the production vhost.
6. **Security headers** (`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
   `Referrer-Policy`) and `client_max_body_size 12m`, matching production.
7. **Setup token:** `POST /api/setup/admin` needs `X-Setup-Token` matching `Auth__SetupToken`
   for remote callers (loopback is allowed without it). Send the header **manually once** to
   create the first admin; never bake it into the vhost. After the first admin exists,
   `/api/setup/status` reports `needsInitialAdmin=false` and the endpoint returns **403**.
   The staging vhost must contain no token header lines — verify with
   `grep -c X-Setup-Token /etc/nginx/sites-available/dar-staging` → `0`.

## Rebuild from scratch

1. Create the database and role with random credentials (do not reuse production names).
2. Apply `database/001→033` in order as the database owner, then take a schema-only backup:
   `pg_dump -Fc --schema-only -d dar_staging_20261127 > backups/staging-pre-deploy-<stamp>.dump`.
3. Apply `034→040` in order and verify after each (the `tier2-meet-cap`, `tier2-indexes`,
   `tier1-migration-034` regression suites encode the checks; 039/040 are the batch-2
   enrollment-history and pg_trgm search migrations).
4. Seed only rows prefixed `ZZ-TEST` (no production data).
5. Publish both APIs (`dotnet publish … -c Release`) and extract the frontend build into
   `app/legacy/wwwroot`; install env files and the two systemd units; restart the staging services.
6. Install the vhost with the requirements above, `nginx -t`, reload.
7. POST `/api/setup/admin` with the staging `Auth__SetupToken` from `/etc/dar-staging/legacy.env`,
   create the ZZ teacher account, then verify `/health/ready`, `/management`, `/teacher`,
   `/api/v1/ping`, and `/internal/` 404. Confirm `needsInitialAdmin=false` afterwards.

## Role ownership difference (important for production migrations)

- Production database `<production-db>` and its public tables are owned by the non-superuser
  role `dar_app`. Migrations `034→040` must run as `dar_app` (the owner) or an
  owner-capable role; running them as `postgres` would leave the app role without DML
  privileges and require explicit GRANTs.
- Staging's objects were created by `postgres` while the database owner is `dar_stg_app`;
  `dar_stg_app` therefore received DML/sequence/function grants plus default privileges.
  A from-scratch rebuild should either apply migrations as `dar_stg_app` or repeat those
  grants.
- `034`/`038` alter table definitions، و`039`/`040` (batch 2) تُنشئ objects (history/indexes)؛
  لذلك DML-only rights لا تكفي — نفّذها كـowner.

## Disabled outbound integrations on staging

SMTP host, Google OAuth client, Meet recording encryption/key, Telegram and WhatsApp are
blank; Meet calendar/recording is fail-closed.

## Rollback

- Stop staging: `systemctl disable --now dar-staging-legacy dar-staging-api`.
- Remove the vhost link `/etc/nginx/sites-enabled/dar-staging`, then `nginx -t && systemctl reload nginx`.
- App rollback: check out the previous commit in `/srv/dar-staging/repo`, re-publish, restart.
- DB rollback: create a fresh database and
  `sudo -u postgres pg_restore --clean --if-exists -d <fresh> backups/<dump>`; point env at it.
