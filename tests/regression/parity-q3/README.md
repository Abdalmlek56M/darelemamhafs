# Q-3 backend parity runner

Runs the same scenarios against the legacy admin API and the new API, then compares:

- HTTP status
- normalized response body
- request/attendance/session/notification DB state

## Environment

- `DAR_TEST_DATABASE`: disposable PostgreSQL database containing the current schema. Refused if its name is `dareltahfeez`.
- `Q3_LEGACY_URL`: temporary legacy app URL. Loopback only.
- `Q3_NEW_URL`: temporary new API URL. Loopback only.
- `Q3_SETUP_TOKEN`: setup token configured on the temporary legacy app.
- `Q3_PASSWORD`: optional test password (default `Q3-StrongPass!`).
- `Q3_REPORT_PATH`: optional output path (default `parity-report.md`).

The runner uses one disposable database with isolated fixtures per path; IDs are unique and results are compared after normalization. It never reads production secrets.

## Scenarios

- absence approve
- cancellation approve
- correction absent→present
- correction present→absent
- absence reject
- already-reviewed (409)
- missing slot (400)
- absence/cancellation/correction on a locked payroll month (409)
- 403 outside supervisor scope
- direct attendance adjustment: legacy duration vs new adjust (DB effect compared; contracts differ)
- payroll lock/unlock and payments/void are reported as not comparable because the new API has no equivalent endpoints.

## Report

The runner writes `parity-report.md`. Differences are reported only; **no production code is changed by this task**.

```bash
DAR_TEST_DATABASE='Host=127.0.0.1;Port=5432;Database=q3_test;Username=q3;Password=...' \
Q3_LEGACY_URL=http://127.0.0.1:6030 Q3_NEW_URL=http://127.0.0.1:6031 \
Q3_SETUP_TOKEN=... ./run.sh
```
