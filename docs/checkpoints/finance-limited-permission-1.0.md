# P1-7 — Finance re-test with a limited-permission account (1.0)

**Status:** Review pass complete; no production code change; **not marked Done** pending owner review.

## Environment

- App served from the exact deployed production artifacts (`/opt/dar/app/legacy` and `/opt/dar/app/api`) on ports 5099/5100.
- PostgreSQL: **disposable cloned schema**, fake ZZ-TEST data only.
- Legacy admin accounts: `p17_none`, `p17_create`, `p17_read`, `p17_reports`, `p17_control`.
- New-API supervisor accounts: `p17_supervisor_nofin` (no `finance.read`), `p17_supervisor_fin` (with `finance.read`).
- Sentinels: `987654.32`, `123456.78`, `444222.11`, `37.50`.
- Browser: Chromium headless through the existing Playwright bundle.

## Legacy API matrix (corrected paths)

Finance reads: collections, advertising expenses, operating expenses, collection reports list/detail, finance-entry-options, **`/api/admin/payroll/lock`**, **`/api/teachers/{id}/history`**, audit log, partial student detail, receipt download.

| Account | Finance reads | Write POST/PUT/void | Result |
|---|---|---|---|
| none | 403 on all finance reads (including payroll lock); payroll/teacher-history paths no longer 404; audit/student/teacher-history 200 with no numeric sentinel | POST charge/payment, PUT charge, void charge/payment all **403** | PASS |
| create | ledger/report/payroll reads **403**; `finance-entry-options` 200 with no numeric sentinel; audit/student/teacher-history 200 with no numeric sentinel | POST payment **201**, response `amount: null` | PASS |
| read | collections/ads/operating/report-detail **200 with numeric sentinels**; payroll lock 200 no amounts; teacher-history 200 with sentinels; audit/student with sentinels | POST charge/payment, PUT charge, void charge/payment all **403** | PASS |
| reports | all finance reads/payroll **403**; audit/student/teacher-history 200 with no numeric sentinel | not required by this row | PASS for its finance read scope |
| control | collections/ads/operating/report-detail **200 with numeric sentinels**; payroll lock 200; teacher-history/student/audit with sentinels | n/a | PASS (anti-blind control) |

Checks recorded as true: `controlCollectionsHasNumericAmount`, `controlReportHasNumericAmount`, `noneReadsDenied`, `reportsUserFinanceDenied`, `noneAuditHasNoNumericAmount`, `noneWritesDenied`, `readWritesDenied`, `createFinanceOptionsNoNumericAmount`, `createOnlyCreateStatus=201`, `createOnlyMaskedAmount=true`.

## New-API supervisor matrix

| Account | `/api/v1/supervisor/unpaid` | `/students/{id}` subscription | `/live` payableAmount | Result |
|---|---|---|---|---|
| nofin | 200, `canViewAmounts=false`, rows with `amountDue/paidAmount/balance = null` | 200, subscription rows with all amount fields `null` | 200, session with `payableAmount=null` | PASS |
| fin | 200, `canViewAmounts=true`, amounts 987654.32 / 123466.78 / 864187.54 | 200, amounts present | 200, `payableAmount=37.5` | PASS |

All eight supervisor assertions recorded true, including the anti-blind check for the finance account.

## UI matrix (headless Chromium)

| Account | Finance nav | Payment page sentinel | Report popup sentinel | Result |
|---|---|---|---|---|
| none | absent | absent | **popup opened; absent** | PASS |
| create | create-only access (no ledger amounts) | absent | **popup opened; absent** | PASS |
| read | visible | present (expected: finance.read) | **absent** (reports.finance off) | PASS |
| reports | absent | absent | **absent** | PASS |
| control | visible | present | **present** | PASS (anti-blind control) |

CSP violations during these UI runs: **none**. The previous "system nav timeout" for none/create was a **test login/rate-limit issue**, not a product behavior; unique test IPs plus an explicit dashboard assertion fixed it, and both report popups now open.

## What was found

No finance permission leak, amount leak, or write bypass was reproduced in the tested surfaces.

## Not verified / caveats

1. Other supervisor endpoints (absences, attendance, requests, WhatsApp, teacher detail) were not re-tested here; only unpaid/live/student detail were requested.
2. Supervisor write endpoints were not tested (out of this matrix's scope).
3. No production external test was performed: no new production accounts were created and no existing limited account was found/approved for use.
4. Production data was not used, and no production code or configuration was changed.

## Reproduction

See `tests/regression/finance-permission-matrix/README.md`. The test performs a payment-create probe and write-denial probes; use only a disposable database.
