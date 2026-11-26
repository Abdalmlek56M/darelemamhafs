# Overnight hardening report

Updated after every commit. Owner rules: no deploy, no production data, full regression PASS before every push.

## Completed before this overnight batch (already on main)

| Item | Commit | Evidence |
|---|---|---|
| Tier 0 0.1 idempotency | `79e9749` | `tier0-idempotency` |
| Tier 0 0.2/0.8/0.14 | `9895d35` | `tier0-money` |
| Tier 0 0.3 profit summary | `da4af74` | `tier0-profit` |
| Tier 0 0.4 ledger trigger | `9113943` | `tier0-trigger` |
| Tier 0 0.5 telegram token | `bc1217e` | `tier0-meet-settings` |
| Tier 0 0.6 scope fail-closed | `dfd8405` | `scope-enforcement` |
| Tier 0 0.7 new-backend scope holes | `e6dcf66` | `scope-enforcement` |
| Tier 0 0.9 backup coverage/retention | `fb0eaa1` | `backup-source` |
| Tier 0 0.10 repo leak scrub | `63e723b` | `repo-secrets` |
| Tier 0 0.11 Cloudflare real IP | `966ac8d` | `tier0-money` |
| Tier 0 0.12 portal session identity | `e334c76` | `tier0-sessions` |
| Z6 skills cleanup | `8c99718` | full regression PASS |
| Z0 port integrity/restore drill | `7176bdb` | `integrity-sql`, `backup-source` |
| Z0 delete Windows edition/version | `eb078da` | full regression PASS |
| Z0 fixes | `4f65a76` | full regression PASS |

Last verified main: `4f65a76` (full regression PASS, unit 51/51, frontend 68 tests).

## Overnight batch — Tier 1

| Item | Status | Commit | Tests added | NOT VERIFIED / BLOCKED |
|---|---|---|---|---|
| 1.1 trash auto-purge never runs | done | `a28756f` | `tier1-trash-purge` (scheduled worker registration + manual trigger purges expired non-financial row) | live systemd timer not observed |
| 1.2 backup download broken on Linux | done | `2e3b8e4` | `tier1-backup-download` (create backup through API then download 200 with bytes) | real browser download not observed |
| 1.3 permission catalog single source | done | `17f723a` | `tier1-permission-catalog` (legacy/modular/frontend/served code sets equal; meet.bot.control grantable) | SQL seed list vs code catalog still separate |
| 1.4 attendance non-partial unique | done | `0463c12` | `tier1-attendance-unique` (trashed + live row coexist; live duplicate rejected) | migration not applied to production |

| 1.9 circle auto-link substring | in progress | pending | `MeetMatcherAmbiguityTests` | live calendar sync not run |
| 1.16 migration checksum CRLF | in progress | pending | `MigrationChecksumTests` | production ledger not re-checked |
| 1.17 pagination determinism/unify envelopes | partial | pending | Deterministic tie-break in Secretariat students | **BLOCKED** full envelope unify: requires contract-wide change; not attempted tonight |
`n## Remaining

Tier 1 items 1.5–1.25, then Z1/Z2 (including removing the frontend money fallback), Tier 2, Tier 3, Z3/Z4/Z5.

## BLOCKED

- None yet in this batch.
