# S-1a list baseline benchmark

Read-only HTTP baseline for the current list endpoints before pagination work.

## What it does

- Assumes a **disposable** PostgreSQL database already has the production schema and a `bench_admin` setup account.
- `seed.sql` inserts synthetic data proportional to `-v n=` (students, teachers, circles, schedules, enrollments, charges, payments, attendance, expenses, reports, requests, notifications, audit rows, extra app users).
- `benchmark.mjs` logs in as a synthetic reviewer, calls each list endpoint once for warmup and then `S1_ITERATIONS` times, and emits latency/bytes/status JSON plus the slowest 10 endpoints.

## Safety

- Refuses `<database>` and production/live URLs exactly like the other regression runners.
- No production env files or secrets. Run only against a disposable DB and temporary apps.

## Commands

```bash
# after creating the temp DB/schema and starting the temporary apps:
psql -v ON_ERROR_STOP=1 -v n=10000 -d <temp_db> -f seed.sql

DAR_TEST_DATABASE='Host=127.0.0.1;Port=5432;Database=<temp_db>;Username=<role>;Password=<pass>' \
S1_LEGACY_URL=http://127.0.0.1:5300 S1_NEW_URL=http://127.0.0.1:5301 \
S1_SETUP_TOKEN=<token> S1_PASSWORD='S1-BenchPass!' S1_LABEL=10000 S1_ITERATIONS=3 \
node benchmark.mjs
```

The output is JSON; the final `slowest` array is the report table used in the S-1a checkpoint.
