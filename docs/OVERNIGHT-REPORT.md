# Overnight hardening report

Updated after every commit. Rules: no deploy, no production data, full regression PASS before every push.

## Already on main (`main` was `4f65a76` when the overnight run started)

Tier 0 complete (0.1–0.12; commits `79e9749`, `9895d35`, `da4af74`, `9113943`, `bc1217e`, `dfd8405`, `e6dcf66`, `fb0eaa1`, `63e723b`, `966ac8d`, `e334c76`), Z6 `8c99718`, Z0 `7176bdb`/`eb078da`/`4f65a76`. Last verified full regression on `4f65a76`: UNIT 51/51, frontend 68, all 20 suites PASS.

## Overnight Tier 1

| Item | Status | Commit | Tests added | NOT VERIFIED |
|---|---|---|---|---|
| 1.1 trash auto-purge never runs | done | `a28756f` | `tier1-trash-purge` (worker registered, manual trigger purges expired non-financial row) | live timer not observed |
| 1.2 backup download broken on Linux | done | `2e3b8e4` | `tier1-backup-download` (create via API → download 200 + bytes) | browser download not observed |
| 1.3 permission catalog drift / meet.bot.control | done | `17f723a` | `tier1-permission-catalog` (legacy/modular/frontend/served sets equal) | SQL seed vs code catalog still separate |
| 1.4 attendance non-partial unique | done | `0463c12`, `6c62c77` | `tier1-attendance-unique` + upsert alignment for partial index | production migration pending |
| 1.5 trashed expense edit + circle schedule PUT replace | done (audit labels/unpaid trigger were already fixed by 032/031) | `cefedff` | `tier1-circle-schedule`, `tier1-expense-trashed` | old attendance/history preserved by soft delete only |
| 1.6 audit outside money transaction | done | `4063425` | `tier1-money-audit` (rejected create writes no audit) | not run against production data |
| 1.7 pooled connection held per request | BLOCKED | — | — | broad cross-endpoint lifetime refactor, no safe harness test |
| 1.8 duplicate triggers/global lock/024 void | done | `94b17b2` | `tier1-migration-cleanup` (035 removes global lock, 031 live void) | production migration pending |
| 1.9 circle auto-link substring | done | `4acb564` | `MeetMatcherAmbiguityTests` | live calendar sync not run |
| 1.10 Telegram HTML unescaped | done | `0bcbc40` | `MeetTelegramEscapingTests` | live Telegram delivery not observed |
| 1.11 student joined date browser clock | done | `63c15ae`, `9d9ae6a` | `tier1-student-joined` | existing students unchanged |
| 1.12 unique race 500 | done | `6bc649b` | `tier1-unique-race` (parallel creates no 500, one row) | no production load test |
| 1.13 teacher end-session state machine | PARTIAL | `022e28a` | `tier1-notification-sync` (resolved item stays resolved) | end-session overwrite/absent list/correction state machine blocked on recorder contracts |
| 1.14 recording partial status | BLOCKED | — | — | `partial` state exists; artifact-loss on failure needs external recorder/upload contract |
| 1.15 OAuth replay/revoke, OTP race, SMTP queue | PARTIAL | `1ba3a48` | none (identity API not HTTP-testable offline) | OTP consume is atomic now; OAuth revoke/state and SMTP queue blocked (Google creds + queue design) |
| 1.16 migration checksum CRLF | done | `08ef3c8` | `MigrationChecksumTests` | production ledger not re-checked |
| 1.17 pagination envelopes/tie-break | PARTIAL | `e2b47bc` | deterministic `id` tie-break in Secretariat students | unifying two envelopes blocked on contract decision |
| 1.18–1.25 meet recorder/bot | BLOCKED | — | — | recorder repo/runtime outside this repo; offline |

Batch commits also include suite wiring/report: `7d0d8eb`, `47a9674`, report commits.

## NOT VERIFIED (all Tier-1 work)

- No deployment; production timers, systemd units, migration 034/035, real backups, real browser downloads and live Telegram/Google/recorder flows were not exercised.
- No production data was read or written by tests (harness uses disposable DB only).

## Remaining (not reached tonight)

- Tier 1 blocked items 1.7, 1.13 (remaining sub-items), 1.14, 1.15 (remaining), 1.17 (unification), 1.18–1.25.
- Z1 (split files >400 lines, de-duplicate application layer) and Z2 (characterization tests first, remove the frontend money-calculation fallback).
- Tier 2 (database/scale/deploy/CI), Tier 3 (frontend/CSS/UI), Z3 (docs/ADRs), Z4 (deepseek.md full rewrite), Z5 (meet README/env).

## BLOCKED summary

As listed in the table; no item was blocked without a reason. Overnight time/regression budget ended before Tier 2/3/Z1/Z2/Z3-5.
