# Finance permission-matrix regression (P1-7)

Read-only permission test for the legacy admin finance surfaces. It uses a **disposable PostgreSQL database** and fake ZZ-TEST data only.

## What it proves

- A user with no financial permission cannot read finance ledgers/reports or use finance write endpoints.
- `finance.create` alone can create a payment but receives a masked amount in the response and cannot read the ledger.
- `finance.read` allows reads but not `POST/PUT/void` writes unless those permissions are also granted.
- `reports.finance` alone does not grant access to finance APIs.
- The control account (`finance.read` + `reports.finance`) must receive the numeric sentinel amounts; this is the anti-blind-test check.

## Fixture accounts

| Key | Username | Finance permissions |
|---|---|---|
| none | `p17_none` | none |
| create | `p17_create` | `finance.create` |
| read | `p17_read` | `finance.read` |
| reports | `p17_reports` | `reports.finance` |
| control | `p17_control` | `finance.read` + `reports.finance` |

All accounts also receive the same non-finance base set: dashboard, students, teachers, circles, schedule, attendance, audit, exports, settings.

## Layout

- `seed.sql` — fake teacher/student/circle/enrollment/charge/payment/expenses/report/audit row with decimal sentinels.
- `api-matrix.mjs` — direct API read/write matrix.
- `ui-matrix.js` — Playwright checks for finance nav, amount leakage, and report finance columns.

`seed.sql` assumes the `p17_admin` setup account and `app_users` already exist in the disposable DB.

## Running

1. Start the app against a **disposable cloned schema** with `Auth__SetupToken` configured.
2. Create `p17_admin` via `POST /api/setup/admin`.
3. Apply `seed.sql`.
4. Create the five accounts above with `POST /api/admin/users` using a setup-admin cookie.
5. Then:

```bash
P17_BASE_URL=http://127.0.0.1:5099 P17_TEST_PASSWORD='P17-StrongPass!' node api-matrix.mjs
P17_BASE_URL=http://127.0.0.1:5099 P17_TEST_PASSWORD='P17-StrongPass!' node ui-matrix.js
```

Playwright is expected to be available through `NODE_PATH` (the same bundled browser used for admin E2E checks).

Never point these scripts at production data. They perform a create-payment probe (safe only in the disposable DB) and test `POST/PUT/void` permission denials.
