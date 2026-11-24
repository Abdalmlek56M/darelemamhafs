# P1-7 — Finance re-test with a limited-permission account (1.0)

**Status:** Test complete; no production code change; **not marked Done** pending owner review.

## Environment

- App served from the exact deployed production artifacts (`/opt/dar/app/legacy`, deployed commit `dcb2d30`) on port 5099.
- PostgreSQL: **disposable cloned schema**, fake ZZ-TEST data only.
- Accounts: `p17_none`, `p17_create`, `p17_read`, `p17_reports`, `p17_control`.
- Sentinels: `987654.32`, `123456.78`, `444222.11`, `55555.55`, `11111.11`.
- Browser: Chromium headless through the existing Playwright bundle.

## API matrix

Finance read endpoints: collections, advertising expenses, operating expenses, collection reports list/detail, finance-entry-options, payroll lock, audit log, partial student detail, receipt download.

| Account | Finance reads | Write POST/PUT/void | Result |
|---|---|---|---|
| none | 403 on all finance reads; audit/student 200 with no numeric sentinel | POST charge/payment, PUT charge, void charge/payment all **403** | PASS |
| create | 403 on ledger/report reads; `finance-entry-options` 200 with no numeric sentinel; audit/student 200 with no numeric sentinel | POST payment **201**, response `amount: null` | PASS |
| read | collections/ads/operating/report-detail **200 with sentinels**; report list 200 (titles only); audit/student 200 with sentinels | POST charge/payment, PUT charge, void charge/payment all **403** | PASS |
| reports | 403 on collections/ads/operating/reports/finance-entry-options; audit/student 200 with no numeric sentinel | not required by this row | PASS for its finance read scope |
| control | collections/ads/operating/report-detail **200 with numeric sentinels** | n/a | PASS (anti-blind control) |

Checks recorded as true: `controlCollectionsHasNumericAmount`, `controlReportHasNumericAmount`, `noneReadsDenied`, `reportsUserFinanceDenied`, `noneAuditHasNoNumericAmount`, `noneWritesDenied`, `readWritesDenied`, `createFinanceOptionsNoNumericAmount`, `createOnlyCreateStatus=201`, `createOnlyMaskedAmount=true`.

## UI matrix (headless Chromium)

| Account | Finance nav | Payment page sentinel | Report popup sentinel | Notes |
|---|---|---|---|---|
| none | absent | absent | not exercised | system/report nav was not available in this fixture |
| create | absent | absent | not exercised | same |
| read | visible | present (expected: finance.read) | **absent** (reports.finance off) | PASS |
| reports | absent | absent | **absent** | PASS |
| control | visible | present | **present** | PASS (anti-blind control) |

CSP violations during these UI runs: **none**.

## What was found

No finance permission leak or write bypass was reproduced in the tested surfaces.

## Not verified / caveats

1. `GET /api/teachers/{id}` and the payroll-lock path returned **404** in this harness; these rows are **inconclusive for permissions**, because the test paths did not resolve.
2. Report UI for the `none` and `create` accounts was not exercised: the system/report navigation was unavailable with this fixture. Their API finance reads were still denied.
3. The new-API supervisor financial endpoints (`/api/v1/supervisor/*`) were not part of this harness; they require a separate supervisor/scope fixture and remain unverified here.
4. No production external test was performed: per owner condition, no new production accounts were created.
5. Production data was not used, and no production code or configuration was changed.

## Reproduction

See `tests/regression/finance-permission-matrix/README.md`. The test performs a payment-create probe and write-denial probes; use only a disposable database.
