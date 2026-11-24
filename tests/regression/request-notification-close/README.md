# P1-5 request-notification closure tests

Verifies that supervisor notifications for attendance requests close when the request is resolved.

## Coverage (10 tests)

- New API supervisor approve/reject.
- Teacher cancellation.
- Locked-month failed review leaves the notification open.
- Legacy admin approve/reject.
- Legacy reopen re-opens the notification.
- Legacy delete resolves it.
- Unrelated notification stays open.
- Second review (409) does not disturb the resolved notification.

## Requirements

- Disposable PostgreSQL DB with the current schema.
- Temporary legacy + new-API apps.
- `DAR_TEST_DATABASE`, `P15_LEGACY_URL`, `P15_NEW_URL`, `P15_SETUP_TOKEN`; optional `P15_PASSWORD`.
- The runner refuses `dareltahfeez` and production/live URLs.

```bash
DAR_TEST_DATABASE='Host=127.0.0.1;Port=5432;Database=p15_test;Username=p15;Password=...' \
P15_LEGACY_URL=http://127.0.0.1:5400 P15_NEW_URL=http://127.0.0.1:5401 \
P15_SETUP_TOKEN=... ./run.sh
```
