-- FINAL 0.1: client-generated idempotency keys for money writes.
-- A replay of POST /api/payments or POST /api/charges with the same idempotency key
-- returns the row created by the first request instead of inserting a duplicate.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS client_key TEXT NULL;
ALTER TABLE monthly_charges ADD COLUMN IF NOT EXISTS client_key TEXT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_payments_client_key
    ON payments (client_key) WHERE client_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_monthly_charges_client_key
    ON monthly_charges (client_key) WHERE client_key IS NOT NULL;
