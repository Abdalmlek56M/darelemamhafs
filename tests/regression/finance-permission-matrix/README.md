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
| supervisor-no-fin | `p17_supervisor_nofin` | `supervisor.portal`, `supervisor.live`, `supervisor.unpaid`, `supervisor.students.read` |
| supervisor-fin | `p17_supervisor_fin` | same supervisor set + `finance.read` |

All admin accounts also receive the same non-finance base set: dashboard, students, teachers, circles, schedule, attendance, audit, exports, settings.

## Layout

- `seed.sql` — fake teacher/student/circle/enrollment/charge/payment/expenses/report/audit row with decimal sentinels.
- `api-matrix.mjs` — legacy admin API read/write matrix, including `/api/admin/payroll/lock` and `/api/teachers/{id}/history`.
- `ui-matrix.js` — Playwright checks for finance nav, amount leakage, and report finance columns, including the `none`/`create` report popup.
- `supervisor-matrix.mjs` — new-API `/api/v1/supervisor/unpaid`, `/live`, and `/students/{id}` finance masking with/without `finance.read`.

`seed.sql` also seeds today's live teacher session/attendance so the supervisor `/live` payable amount can be asserted.

`seed.sql` assumes the `p17_admin` setup account and `app_users` already exist in the disposable DB.

## Running

1. Start the legacy app against a **disposable cloned schema** with `Auth__SetupToken` configured.
2. Create `p17_admin` via `POST /api/setup/admin`, then apply `seed.sql`.
3. Create the five admin accounts and both supervisor accounts with `POST /api/admin/users` using a setup-admin cookie.
4. Start the new API against the **same disposable DB** (Development mode, so the session cookie works over HTTP).
5. Then:

```bash
P17_BASE_URL=http://127.0.0.1:5099 P17_TEST_PASSWORD='P17-StrongPass!' node api-matrix.mjs
P17_BASE_URL=http://127.0.0.1:5099 P17_TEST_PASSWORD='P17-StrongPass!' node ui-matrix.js
P17_NEW_BASE_URL=http://127.0.0.1:5100 P17_TEST_PASSWORD='P17-StrongPass!' node supervisor-matrix.mjs
```

The scripts send distinct test-only `X-Forwarded-For` values on login so P1-1 login rate-limiting does not make concurrent test accounts flaky.

Playwright is expected to be available through `NODE_PATH` (the same bundled browser used for admin E2E checks).

Never point these scripts at production data. They perform a create-payment probe (safe only in the disposable DB) and test `POST/PUT/void` permission denials.
