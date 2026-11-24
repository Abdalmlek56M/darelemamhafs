# Q-1 approval-path regression runner

Runs the same approval matrix against both live review paths:

- legacy admin: `POST /api/admin/requests/{id}/review`
- new API: `POST /api/v1/supervisor/requests/{id}/review`

## Cases (10 x 2 paths = 20)

absence approve, cancellation approve, correction absent→present, correction present→absent, absence/cancellation/correction on a locked month, rejection, already-reviewed, missing slot/date.

## Requirements

- `DAR_TEST_DATABASE`: Npgsql connection string to a **disposable** PostgreSQL database already containing the current schema.
- `Q1_LEGACY_URL` and `Q1_NEW_URL`: temporary app URLs running against that database.
- `Q1_SETUP_TOKEN`: setup token configured on the temporary legacy app.
- `Q1_PASSWORD`: optional test password (default `Q1-StrongPass!`).

The runner creates the setup admin and a reviewer with only test permissions, seeds isolated fixtures, and asserts HTTP status plus DB state (attendance status/duration/pay, request status, session status).

It **fails** when `DAR_TEST_DATABASE` is missing, when executed tests are fewer than 20, or when any case fails. It never reads production secrets and must never be pointed at `dareltahfeez`.

```bash
DAR_TEST_DATABASE='Host=127.0.0.1;Port=5432;Database=q1_test;Username=q1;Password=...' \
Q1_LEGACY_URL=http://127.0.0.1:5200 Q1_NEW_URL=http://127.0.0.1:5201 \
Q1_SETUP_TOKEN=... ./run.sh
```
## Mutation testing

`mutate.py` is used only inside a disposable clone/worktree. It applies one deliberate bug at a time; the full matrix must produce the expected red cases, then the copy is discarded and the original source is rerun green.
