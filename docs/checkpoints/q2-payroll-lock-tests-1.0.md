# Q-2 — Payroll and payroll-lock tests (1.0)

**Status:** Implemented and exercised on disposable DBs; **not marked Done** pending owner review.
**Production impact:** none. No production code, data, services, config, or deployment changed.

## Coverage (22 HTTP tests)

- Legacy payroll calculation via `PUT /api/teacher-attendance/{id}/duration`: 60/45 minutes, fractional rounding (50.25 x 37 = 30.99), invalid 14/361.
- Legacy lock/unlock: read state, lock with note, post-lock edit blocked, unlock, edit after unlock, missing-note validation, unlock without a lock row.
- Legacy audit: duration update, payroll lock, payroll unlock.
- Legacy concurrency: two parallel duration edits; no 500; final value is one of the submitted values; audit count equals successful actions.
- New API `POST /api/v1/supervisor/attendance/{id}/adjust`: 60/45, rounding, invalid 0/361, manual amount with finance.read, manual amount without finance.read = 403.
- New API lock enforcement: locked month = 409 and no change; after unlock = applies.
- New API audit: `supervisor.attendance.adjust`.
- New API concurrency: two parallel adjusts; same invariants as legacy.

## Final green run

- **22/22 passed, 0 failed.**
- Missing `DAR_TEST_DATABASE` guard: exit **2** with `Q2_FAIL` (verified separately).
- Runner asserts exactly 22 executed; fewer fails.

## Mutations — all 12 executed

Each mutation ran in a separate clone/worktree against rebuilt apps; full 22-case matrix executed each time.

| # | Mutation | Passed | Failed | Red cases |
|---:|---|---:|---:|---|
| 1 | New: bypass payroll lock in adjust | 21 | 1 | new_locked_adjust_blocked |
| 2 | Legacy: bypass payroll lock in duration edit | 21 | 1 | legacy_lock_flow_and_post_lock_edit |
| 3 | Legacy: unlock does not clear lock | 20 | 2 | legacy_lock_flow..., new_unlocked_adjust_applies |
| 4 | Legacy: lock does not set true | 19 | 3 | legacy_lock_flow..., legacy_unlock_requires_note, new_locked_adjust_blocked |
| 5 | Legacy: wrong payroll formula (/30) | 17 | 5 | salary 60/45/rounding, post-unlock pay, audit detail |
| 6 | New: wrong payroll formula (/30) | 18 | 4 | new salary 60/45/rounding, new post-unlock pay |
| 7 | Legacy: truncate rounding instead of AwayFromZero | 21 | 1 | legacy_rounding_away_from_zero (30.98 vs 30.99) |
| 8 | New: truncate rounding instead of AwayFromZero | 21 | 1 | new_rounding_away_from_zero (30.98 vs 30.99) |
| 9 | Legacy: audit action omitted | 20 | 2 | legacy_audit_duration_update, legacy_concurrent audit count |
| 10 | New: audit action omitted | 20 | 2 | new_audit_adjust, new_concurrent audit count |
| 11 | New: manual amount allowed without finance.read | 21 | 1 | new_manual_amount_without_finance |
| 12 | Legacy: empty lock/unlock note accepted | 20 | 2 | legacy_lock_requires_note, legacy_unlock_requires_note |

After all mutations: temp copies removed, original source rerun **22/22 green**, and the production working tree was not modified by mutations.

## Concurrency result

- Two parallel duration edits (legacy) and two parallel adjusts (new API) **passed**, with no 500 and consistent final state/audit count.
- **Lock-vs-adjust race: NOT VERIFIED** — not asserted as deterministic; outcomes depend on transaction order. This is explicitly not claimed as passing.

## Not verified / caveats

1. Lock/unlock endpoints exist only in legacy; the new API has no lock/unlock endpoints. The new path was tested for enforcement, not for lock management.
2. No browser UI test; runner is HTTP + DB assertions.
3. Audit tests assert action/entity/details for the tested paths; they do not cover every audit producer in the system.
4. Concurrent two-adjust tests passed once in the final run, but a lock-vs-adjust race is **NOT VERIFIED**.
5. No production external test; temporary apps ran in Development mode with disposable DB and no production env files/secrets.

## Tooling

- `tests/regression/payroll-lock/run.mjs`
- `tests/regression/payroll-lock/run.sh`
- `tests/regression/payroll-lock/mutate.py`
- `tests/regression/payroll-lock/README.md`
