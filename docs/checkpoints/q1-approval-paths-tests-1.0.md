# Q-1 — Automated approval-path tests (1.0)

**Status:** Implemented and exercised on disposable DBs; **not marked Done** pending owner review.
**Production impact:** none. No production code, data, services, configuration, or deployment were changed.

## Scope

The same matrix runs against both live review paths:

- legacy admin: `POST /api/admin/requests/{id}/review`
- new API: `POST /api/v1/supervisor/requests/{id}/review`

Fixture reviewer has only test permissions: `attendance.read`, `attendance.edit`, `users.manage`. Temporary apps run in Development mode against a disposable PostgreSQL database; **no production env files or secrets are loaded**.

## Matrix — 10 cases x 2 paths = 20

| Case | Expected |
|---|---|
| absence approve (unlocked) | 200; attendance absent/pay 0; request approved; session cancelled |
| cancellation approve (unlocked) | 200; attendance cancelled/pay 0; request approved; session cancelled |
| correction absent→present | 200; present, duration 30, pay 30; request approved; session updated |
| correction present→absent | 200; absent, duration 45, pay 0; request approved; session updated |
| absence approve (locked) | 409; request pending; attendance/session unchanged |
| cancellation approve (locked) | 409; request pending; attendance/session unchanged |
| correction approve (locked) | 409; attendance 60/pay 60 unchanged; request pending |
| absence reject | 200; request rejected; attendance/session unchanged |
| already reviewed | 409; no effect |
| absence missing slot | 400; request pending; no attendance |

## Results

- **Final green run: 20/20 passed, 0 failed.**
- Missing-`DAR_TEST_DATABASE` guard: runner exits **2** with `Q1_FAIL`.
- Runner asserts `executed === 20`; fewer executions fail the run.
- Every case was run against both paths; legacy and new API results matched the expected DB state.

## Mutation tests (separate copy, never production)

Each mutation was applied to a clone of the repo at `/tmp/q1-mut-src`, both apps were rebuilt, and the full 20-case matrix was run. The production working tree was not modified.

| Mutation | Passed | Failed | Red cases (expected) |
|---|---:|---:|---|
| New API: bypass payroll lock | 17 | **3** | new absence/cancellation/correction locked |
| Legacy: bypass payroll lock | 17 | **3** | legacy absence/cancellation/correction locked |
| New API: absence/cancellation writes `present` | 18 | **2** | new absence/cancellation approve |
| Legacy: absence/cancellation writes `present` | 18 | **2** | legacy absence/cancellation approve |
| New API: correction ignores proposed status | 18 | **2** | new correction absent→present / present→absent |
| Legacy: correction ignores proposed status | 18 | **2** | legacy correction absent→present / present→absent |

After mutations: source copies/temp DBs removed, production working tree clean of mutation changes, and the unmutated matrix was rerun **20/20 green**.

## Test tooling

- `tests/regression/approval-paths/run.mjs` — HTTP + psql matrix runner.
- `tests/regression/approval-paths/run.sh` — env-required wrapper.
- `tests/regression/approval-paths/mutate.py` — mutation helper for the separate copy.
- `tests/regression/approval-paths/README.md` — setup and expected environment.

## Not verified / caveats

1. The reviewer fixture uses `users.manage` (to bypass scope) for the new API path and `attendance.edit` for legacy; **out-of-scope/403 behavior is not part of this suite** (existing Supervision access tests cover scope generally).
2. Tests are HTTP + DB assertions, not browser UI tests.
3. Audit-log and notification side effects are not asserted; only request/attendance/session state.
4. Concurrency (two reviewers at once) is not tested; the existing row-lock/FOR UPDATE behavior is not under concurrent load here.
5. The legacy app and new API are run in Development mode against a disposable DB with no production Turnstile/secrets; that is intentional for isolation, but it is not a production-environment test.
6. No production external test was performed.
