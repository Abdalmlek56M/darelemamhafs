# Checkpoint: Historical Charge Correction + Charge Audit 1.0

Date: 18 Nov 2026

## Done

- Corrected the 9 live monthly charges created by the old mid-month proration:
  - All belonged to trial students (“تجربة طالب 1–4”) for **2026-11**.
  - Values were 125.00 or 116.67 against an agreed fee of 250.00.
  - Two charges already had 125.00 paid; they now show a 125.00 balance instead of an under-billed 0.00 balance.
  - The correction script refuses any charge whose payments exceed the agreed fee and writes one `audit_log` row per charge (`charge.correct`, actor “تصحيح استحقاقات معتمد”).
  - Script: `docs/operations/2026-11-charge-correction.sql`.
- Added a read-only admin audit endpoint `GET /api/admin/charge-audit?month=YYYY-MM`:
  - returns charges whose `amount_due` differs from `agreed_monthly_fee`.
  - includes paid amount, difference and balance after correction.
  - requires `finance.read`.
- Added the **مراجعة الاستحقاقات** panel to the admin payments page:
  - clean state when every charge matches the agreed fee;
  - mismatch table with a “فتح للتصحيح” action using the existing audited charge dialog;
  - warns instead of offering correction when payments exceed the agreed fee.

## Verified

- Live correction: `monthly_charges` mismatches = **0**; 9 `charge.correct` audit rows exist.
- Live pages `/`, `/management`, `/teacher`, `/supervisor` → 200.
- `GET /api/admin/charge-audit` returns 401 unauthenticated (route live).
- Legacy API + frontend build 0 warnings/0 errors.
- Pre-correction backup `dar-20261118-025410.dump`; post-deploy `dar-20261118-030401.dump`.
- Deployed commit `5938c4f`; legacy artifacts retained at `legacy.old.20261118-030316`.

## Next

- Review admin schedule + teacher attendance lists (dates, pay, filters, PC/mobile).
- Then admin requests review page, teacher calendar/history, offline queue, reports/finance, payroll lock.
