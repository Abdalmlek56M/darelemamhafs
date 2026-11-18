# Checkpoint: Subscriptions + Collections Review 1.0

Date: 18 Nov 2026

## Review scope

- Charge creation from the collections screen: the suggested amount is the enrollment’s agreed fee, not a mid-month proration.
- Charge editing: cannot go below already collected payments.
- Payments: partial payments, remaining balance, overpayment rejection, positive amount requirements.
- Data integrity: charge vs agreed fee, payments vs charge, orphan charges, non-positive payments.
- Reports/payment totals use the saved charge and payment amounts.
- Admin mobile stats grid (2 columns instead of 4 cramped cards).

## Results

- Live integrity checks:
  - charges not equal to the agreed fee: **0** (after correcting 9 historical trial charges).
  - charges with payments greater than the charge: **0**.
  - non-positive payments: **0**.
  - charges without an enrollment: **0**.
- The corrected 250.00 trial charge with a 125.00 payment now shows a 125.00 balance; the 9 correction audit rows are present.
- Collections UI pre-fills 250.00 for a 250 circle, shows the agreed fee, and offers “استخدام الرسوم المتفق عليها”.
- The **مراجعة الاستحقاقات** panel shows a clean state when no mismatch exists and flags future mismatches.
- Admin payments/collections and schedule pages use the shared mobile stats grid fix.

## Remaining review items

- Receipt upload/download and refund/void flows end-to-end (the API guards exist; a dedicated UI audit is still needed).
- A formal owner-approved PDF sample review: sample generated at `docs/samples/report-school-2026-11.pdf`.
- Full admin console parity (users, reports, dashboard, finance page edge cases).
- Production E2E and GitHub Actions first run.

## Deploy

- Mobile stats fix: commit `d4c67bb`, frontend-only, live.
- Payroll lock (migration 022) remains live and unchanged.
- Server restart check: `dar-api`, `dar-legacy`, PostgreSQL and Nginx active; `/`, `/management`, `/teacher`, `/supervisor` → 200; ledger 22.
