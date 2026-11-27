# Regression test provisioning contract

Two layers run the regression tests:

| Layer | Where | What | Entry point |
|---|---|---|---|
| CI (DB subset) | GitHub Actions, PostgreSQL 17 service | every `tests/regression/sql/*.sql` verification script, the DB-only Node suites, the shared guard contract, syntax gates, and a negative "missing `DAR_TEST_DATABASE` fails" check | `.github/workflows/regression.yml` |
| Full harness | deploy host, as **root** | unit tests, both API publishes, disposable PostgreSQL DB, API/E2E suites, SQL suites, opt-in browser suites | `tests/run-regression.sh` |

## Full harness prerequisites (deploy host)

`tests/run-regression.sh` exists because several suites need the two published apps and
`sudo` provisioning that a GitHub runner cannot provide. The host must have:

1. **Root shell** — the harness creates/drops databases with `sudo -u postgres` and publishes
   the apps with `sudo -u deploy`. A non-root shell fails immediately (`PREFLIGHT_FAIL`).
2. **`deploy` OS user** + `.NET 10` SDK on its login PATH.
3. **PostgreSQL** reachable as the `postgres` OS user (`sudo -u postgres psql`), with the
   `postgresql-contrib` package (`pg_trgm`) installed — database/040_search_trgm.sql creates the
   extension and the Tier-2 search suite asserts the GIN trigram indexes exist.
4. **`DAR_BASELINE_DB`** — name of a disposable **schema-template** database. The harness clones
   its schema (`pg_dump -s -O -x`) into a fresh database named
   `dar_reg_<suite>_<unix-stamp>`, applies the post-Deploy migrations
   `database/03[2-9]_*.sql` and `database/04[0-9]_*.sql`, and drops it afterwards.
   A missing `DAR_BASELINE_DB` fails the harness with exit 2 before the build starts — it never
   silently skips the DB-backed suites.
5. **`node`** on the `deploy` login PATH (suites shell out to `psql` and use global `fetch`).
6. Optional: `psql` client (the harness runs SQL suites via `sudo -u postgres psql`).

```bash
# on the host
DAR_BASELINE_DB=dar_schema_template sudo -E bash tests/run-regression.sh
# only some suites
DAR_ONLY_SUITE=q1,b10-cookie-secure DAR_BASELINE_DB=... sudo -E bash tests/run-regression.sh
# list what is wired
bash tests/run-regression.sh --list
```

## Database safety guard (`tests/lib/index.mjs`, `tests/lib/guard.sh`)

Every suite calls the **single** shared guard before touching a target:

- test URLs must be loopback (and never in `DAR_FORBIDDEN_HOSTS`);
- database names are decided by `DAR_TEST_DB_ALLOWLIST` (comma list, `*` globs) when it is set,
  otherwise by the legacy `DAR_FORBIDDEN_DB` / `DAR_FORBIDDEN_DB_NAMES` deny-list;
- database hosts must be loopback;
- DB-backed suites call `assertSafeTargets({ requireDb: true })`, so an unset
  `DAR_TEST_DATABASE` exits non-zero with a clear message.

The harness sets `DAR_TEST_DB_ALLOWLIST=dar_reg_*` for every suite. CI sets
`DAR_TEST_DB_ALLOWLIST=dar_ci`. `tests/regression/test-lib-guard/run.mjs` and
`tests/regression/safety-guard-test.sh` prove the contract (allow loopback, refuse a
non-loopback URL, refuse a DB name outside the allow-list, refuse a missing DB env).

## .NET integration tests (no silent skips)

`tests/Dar.IntegrationTests/**` contains database-backed integration tests. They used to
`return` when `DAR_TEST_DATABASE` was unset, so `dotnet test Dar.slnx` went green without ever
touching PostgreSQL. They now call `IntegrationDatabase.Require()` (tests/Dar.IntegrationTests/
IntegrationDatabase.cs): a missing `DAR_TEST_DATABASE` **fails** the test with a clear message.
CI's `backend` job therefore provisions a PostgreSQL service, applies `database/*.sql`, and sets
`DAR_TEST_DATABASE` before `dotnet test`. Local runs without PostgreSQL can explicitly opt out
with `DAR_INTEGRATION_DB_OPTIONAL=1` (documented, never the CI default).

## Browser / UI suites

The Playwright suites need a built SPA (`frontend/dist` copied into the legacy publish) and
per-suite seeded fixtures. They are wired but **opt-in**:

```bash
DAR_UI_SUITES=1 DAR_BASELINE_DB=... sudo -E bash tests/run-regression.sh
```

Without `DAR_UI_SUITES=1` the harness prints one `UI_SUITE <name> NOT_RUN` line per suite and
lists them in the final `RESULT` line (`UI_SUITES_NOT_RUN=…`) — they are never reported as
green.
