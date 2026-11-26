# Q-2 payroll and lock regression runner

HTTP matrix for payroll calculation and payroll locking on both live paths:

- Legacy: `PUT /api/teacher-attendance/{id}/duration`, `GET/POST /api/admin/payroll/lock`, `POST /api/admin/payroll/unlock`.
- New API: `POST /api/v1/supervisor/attendance/{id}/adjust`.

Both review paths' lock enforcement is covered by existing Q-1 cases and by the Q-2 linked fixtures.

## Coverage (22 tests)

- Payroll calculation: 60/45 minutes, fractional rounding (50.25 x 37 -> 30.99), invalid bounds.
- Manual amount: with `finance.read`, and 403 without it.
- Lock: read, lock with note, edit after lock (legacy and new), unlock, edit after unlock, missing-note validation, unlock without lock.
- Audit: duration update, lock/unlock, new-adjust audit rows.
- Concurrency: two parallel duration/adjust edits; no 500, final state is one of the submitted values, audit count equals successful actions.

## Requirements

- `DAR_TEST_DATABASE` — Npgsql connection string to a **disposable** PostgreSQL database with the current schema.
- `Q2_LEGACY_URL`, `Q2_NEW_URL` — temporary apps against that DB.
- `Q2_SETUP_TOKEN` — setup token for the temporary legacy app.
- `Q2_PASSWORD` — optional test password.

The runner fails with exit 2 when required env is missing, and fails if fewer than 22 cases execute. Never point it at `<database>` or production.
