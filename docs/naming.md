# Naming — repository, deploy and database names

**Status:** 27 Nov 2026 — every name below was verified in the tracked tree (path/line cited);
no name is invented. The purpose is to stop agents from mixing up the three spellings of the
product, the two API hosts, the OS users and the production/staging/disposable databases.

**Rule:** if a name is not in this file, do not introduce a new variant. Live hostnames/IPs/
credentials and the production database name are **not** in the repo — use the placeholders in
§4 and read the real values from the untracked `deploy/.env` on the host.

---

## 1. Product, repository and deploy names

| Name | Layer | Verified in the tree | Use / rule |
|---|---|---|---|
| `Dar Eltahfeez` | product (docs) | `../README.md:1` | English display name in prose only. |
| `RIGX Dar` | brand (docs) | `00-current-state.md:1`, `OVERNIGHT-REPORT.md`-style headings | Documentation/brand prefix only — not a code identifier. |
| `DarEltahfeez` | code (legacy) | `../backend/DarEltahfeez.Api/DarEltahfeez.Api.csproj`; log dir `/var/lib/dar/.local/share/DarEltahfeez/Logs` in `../deploy/bootstrap-server.sh:90` | Legacy C# project/namespace family. PascalCase, one word, no hyphen/space. |
| `DarEltahfeez.Api` | code + deploy (legacy host) | project + `DarEltahfeez.Api.dll` (`../deploy/preflight.sh:299`); service `dar-legacy.service` (`../deploy/setup-host-services.sh:236`) | Legacy API + SPA host on `127.0.0.1:5080`. |
| `Dar.Api` | code + deploy (new host) | `../src/Host/Dar.Api/Dar.Api.csproj`; `Dar.Api.dll` in `../deploy/rollback.sh:135`; service `dar-api.service` | New `/api/v1/*` host on `127.0.0.1:5081`. Never abbreviate both hosts to "the API". |
| `Dar.slnx` | code | `../Dar.slnx` (solution root) | `dotnet build Dar.slnx` / `dotnet test Dar.slnx`. |
| `darelemamhafs` | git remote | `../deepseek.md:75`; `../docs/11-deployment.md:54` | GitHub repository: lowercase, no separators (`…/Abdalmlek56M/darelemamhafs.git`). Only place this spelling is correct. |
| `dar-elemam-hafs` | deploy (Nginx) | `../deploy/nginx/dar-elemam-hafs.conf`; `SITE_NAME="dar-elemam-hafs"` in `../deploy/setup-nginx.sh:30`; `/etc/nginx/sites-available/dar-elemam-hafs` | Hyphenated vhost/site-file identifier. Deploy layer only. |
| `dar` | deploy/runtime prefix | OS user `dar` (`../deploy/bootstrap-server.sh:73`); dirs `/opt/dar`, `/var/lib/dar`, `/etc/dar`, `/var/log/dar`; units `dar-legacy`, `dar-api`, `dar-backup`, `dar-healthcheck`, `dar-restore-drill`; scripts `dar-backup`, `dar-healthcheck`, `dar-restore-drill` | Service account + host path/unit prefix. **Not** a database name. |
| `deploy` | deploy/runtime user | `../deploy/bootstrap-server.sh:60`; owns `/opt/dar` checkout and runs `deploy/*.sh` with sudo | Deployment user only — different from the `dar` service user. |
| `dar-staging-*` / `/srv/dar-staging` | deploy (staging) | `../docs/staging-environment.md:16-21` | Staging-only prefix on the same host. Never reuse for production. |
| `DarEltahfeez.Admin` | code (cookie) | `02-architecture.md` §6.4 | Legacy admin session cookie (PascalCase) — distinct from `dar_session`. |
| `dar_session` | code (cookie) | `02-architecture.md` §6.4 | New API session cookie. |
| `dar_admin_bridge` | code (auth) | ADR-0006, `03-security.md` §21 | Admin-to-new-API session bridge name. |
| `dar_*` SQL functions | code (database) | e.g. `dar_void_charge`, `dar_void_payment`, `dar_teacher_has_schedule_overlap` in `database/*.sql` | DB-object prefix uses an underscore (`dar_`), unlike units (`dar-`). |
| `dar-meet-bot.service` / `dar-meet.slice` | deploy (recorder) | `../deploy/systemd/dar-meet-bot.service`, `dar-meet.slice` | Recording bot unit/slice. |

**Do not conflate:** `darelemamhafs` (git) ≠ `dar-elemam-hafs` (Nginx) ≠ `DarEltahfeez` (C#).
They are intentionally different spellings for different layers.

---

## 2. Databases — production vs staging vs disposable

| Kind | Name / pattern | Configured / created by | Notes |
|---|---|---|---|
| **Production** | `<production-db>` (real value untracked) | `POSTGRES_DB` in untracked `deploy/.env`; `PGDATABASE` in `/etc/dar/backup.env`; example placeholder `change-me-db` in `../deploy/.env.example:15`; generic stand-in `dar_database` in `../deploy/setup-host-db.sh` comments/usage | The real name is scrubbed: `tests/regression/repo-secrets/run.mjs:15` fails if its literal appears in tracked files. Never write it in docs/code/tests. |
| DB roles | `dar_app` (runtime), `dar_migrator` (migrations/DDL), `dar_read_only` (diagnostics, forced read-only sessions) | `../deploy/.env.example:16`, `../deploy/sql/db-roles.sql`, `../deploy/setup-host-db-roles.sh`; documented in `runbooks/db-roles-and-tuning.md` | `dar_app` is the only role applied on the live host today. `dar_migrator`/`dar_read_only` exist **as scripts only, NOT applied** — applying them is an owner action. The older `app_rw` / `app_migrator` / `backup` / `readonly` names in `02-architecture.md` §5.6 are design labels, not live roles. |
| **Staging** | `dar_staging_20261127` (role/owner `dar_stg_app`) | `../docs/staging-environment.md:15` | Disposable copy on the same host; schema-only + `ZZ-TEST` rows, no production data. |
| Regression schema template | `dar_schema_template` | `DAR_BASELINE_DB` (`../tests/run-regression.sh:10,72`) | `pg_dump -s` source for every disposable regression DB. |
| Regression disposable DBs | `dar_reg_<suite>_<stamp>` + role `dar_reg_<suite>_role_<stamp>` | `../tests/run-regression.sh:124-125`; allow-list `dar_reg_*` at `:184` | Created/dropped per suite; never touches production. |
| CI database | `dar_ci` | `../.github/workflows/ci.yml:34`, `regression.yml:41` | Ephemeral PostgreSQL 17 service. |
| Restore-drill DBs | `dar_restore_s9_daily_<stamp>`, `dar_restore_s9_fresh_<stamp>`, role `dar_restore_s9_app_<stamp>` | `../deploy/scripts/restore-drill.sh:8,14-16` | Script **refuses** any DB name without the `dar_restore_s9_` prefix (`safe_db()`). |
| Manual restore check | `dar_restore_check` | `../docs/06-operations.md` §7.1, `../docs/11-deployment.md` §6 | Disposable verify database; stop services first, drop it afterwards. |
| `setup-host-db` restore pair | `dar_database_restore_<stamp>` (candidate) → `dar_database_pre_restore_<stamp>` (previous live) | `../deploy/setup-host-db.sh:20-23,252-293` | `dar_database` there is a **placeholder for the live name** read from `POSTGRES_DB`; only run with `--confirm-restore --force`. |
| Pre-deploy DB rollback | `dar_rollback_<stamp>` | `../deploy/rollback-db.sh`; runbook `runbooks/rollback-db.md` | Fresh database restored from the pre-deploy dump; the app env files are repointed at it and the previous DB is never dropped. Manual only — `update.sh` never calls it. |
| Historical disposable DBs (logs only) | `dar_p0_payroll_*`, `dar_p02_media_*`, `dar_audit_2` | `../docs/checkpoints/*`, `../docs/audits/schedule-overlap-audit.md` | Already dropped; never recreate for production. |
| Guard fixtures (fake by design) | `dar_live_prod`, `dar_prod_live`, `dar_reg_42`, `dar_ci_*` | `../tests/regression/test-lib-guard/run.mjs:96-107` | Deliberately fake names used to prove the test-safety guard refuses production-looking targets. |
| Planned, not created | `dar_test`, `dar_e2e` | `../docs/08-testing.md` §4 | Planned test/E2E database names; no such database exists yet. |

**Naming logic:** the prefix states the purpose — `dar_reg_` = regression, `dar_staging_` = staging,
`dar_restore_s9_` = restore drill, `dar_ci` = CI. Anything else is treated as production by the
test-safety guards (`tests/lib/`): a suite refuses to run unless its DB is loopback **and**
allow-listed (`DAR_TEST_DB_ALLOWLIST`) or not deny-listed.

---

## 3. Placeholders used in documents

Verified placeholders (never replace with real values in tracked files):

| Placeholder | Meaning | Used in |
|---|---|---|
| `<deployment-host>` | production hostname (from `DAR_DOMAIN`) | `../README.md`, `00`, `02`, `06`, `11`, `staging-environment.md` |
| `<server-ip>` | production server IPv4 | `../docs/11-deployment.md` |
| `<production-db>` | production database name (`POSTGRES_DB`) | `staging-environment.md`, `../docs/03-security.md` §19 |
| `<database>` | generic database name in prose | `../docs/06-operations.md`, `../docs/02-architecture.md` |
| `change-me-db` / `change-me-hex` / `change-me@example.invalid` | example-only values | `../deploy/.env.example`, `../deploy/backup.env.example` |
| `change-me.example.invalid` | example-only hostname (`DAR_DOMAIN`) | `../deploy/.env.example:6` |
| `<owner-ip>`, `<certbot-secrets-dir>` | owner/staging secrets location | `../docs/staging-environment.md` |
| `<deploy-user>@<server-address>` | SSH target example | `../deploy/scripts/meet-login.sh` |

The scrubbing rules and the guard that enforces them are documented in `03-security.md` §19;
the live values live only in the untracked `deploy/.env` and `/etc/dar/*.env`.
