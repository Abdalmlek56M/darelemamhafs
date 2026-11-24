# S-1a — List baseline without pagination (1.0)

**Status:** Baseline measured; no production code changes; **not marked Done** pending owner review.
**Scope:** measure only. No S-1 endpoint/UI changes, no deployment, no production DB/app access.

## Dataset

Synthetic disposable PostgreSQL data, proportional sizes:

| Dataset | students | teachers | circles | charges/payments | audit rows | extra users |
|---|---:|---:|---:|---:|---:|---:|
| n=10,000 | 10,000 | 200 | 500 | 10,000 | 20,001 | 1,000 |
| n=50,000 | 50,000 | 1,000 | 2,500 | 50,000 | 100,001 | 5,000 |

Temporary legacy + new-API apps, loopback HTTP, Development mode. 3 measured iterations per endpoint after one warm-up.

## Slowest endpoints — 50k dataset (and corresponding 10k)

| # | Endpoint | 10k median | 10k bytes | 50k median | 50k bytes | 50k status |
|---:|---|---:|---:|---:|---:|---|
| 1 | `/api/student-attendance/session-summary?month=2026-11` | 30,041 ms | 4.7 KB | 30,152 ms | 4.7 KB | **500** |
| 2 | `/api/finance-entry-options?month=2026-11` | 6,774 ms | 1.92 MB | 30,058 ms | 4.6 KB | **500** |
| 3 | `/api/circles` | 591 ms | 202 KB | 10,473 ms | 1.01 MB | 200 |
| 4 | `/api/v1/supervisor/teachers` | 493 ms | 40.9 KB | 9,678 ms | 61.5 KB | 200 |
| 5 | `/api/admin/users` | 1,745 ms | 289 KB | 7,883 ms | 1.44 MB | 200 |
| 6 | `/api/students` | 1,985 ms | 4.66 MB | 4,382 ms | 23.4 MB | 200 |
| 7 | `/api/v1/supervisor/circles` | 618 ms | 93.6 KB | 1,613 ms | 93.9 KB | 200 |
| 8 | `/api/collections?month=2026-11` | 146 ms | 5.89 MB | 1,057 ms | 29.5 MB | 200 |
| 9 | `/api/teachers` | 53 ms | 71 KB | 597 ms | 357.8 KB | 200 |
| 10 | `/api/admin/teacher-notes` | 33 ms | 81 KB | 493 ms | 150.8 KB | 200 |

Every endpoint was measured; this table is the 50k slowest-10. At 10k the slowest set was: attendance summary, finance options, students, admin users, new circles, legacy circles, new teachers, audit, collections, student attendance.

## Important baseline findings

1. `/api/student-attendance/session-summary` returns **500 at both 10k and 50k** after ~30s (not just slow — failing at baseline).
2. `/api/finance-entry-options` is 6.8s at 10k and **500 after ~30s at 50k**.
3. `/api/admin/users` is **N+1-like**: 1.7s at 1k users, 7.9s at 5k users; response is only 1.4 MB.
4. `/api/circles` is 10.5s at 2.5k circles; `/api/v1/supervisor/teachers` is 9.7s at 1k teachers.
5. Full-list payloads: students 23.4 MB, collections 29.5 MB, teacher attendance 11.8 MB, student attendance 14.5 MB.

These are baseline observations only; no bug was fixed and no S-1b work was started.

## Limits of this baseline

- Synthetic data, not owner data; query plans can differ with real distributions.
- Loopback, Development mode, no Nginx/TLS; absolute milliseconds will differ in production.
- 3 iterations; medians are directional, not a rigorous SLA benchmark.
- The 500 responses were not root-caused in S-1a; they are recorded as baseline failures.

## Reproduction

`tests/benchmarks/list-baseline/` contains `seed.sql`, `benchmark.mjs`, and `README.md`. The temporary-orchestration used deployed artifacts and disposable DBs; no production service/DB was written to.
