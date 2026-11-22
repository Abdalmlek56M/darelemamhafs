-- 024: Financial Void/Reverse (ADR-0005).
-- Financial records are never deleted. A charge or payment is cancelled in place:
-- the row stays visible in history/statements, but is excluded from every balance
-- and collection total. A mandatory reason (3-500 chars), the acting user and the
-- timestamp are stored. Audit is written by the API endpoint in the same transaction.
--
-- Contract of the helper functions (used by the API to map HTTP results):
--   0 = voided successfully
--   1 = record not found (or soft-deleted / in trash)
--   2 = already voided
--   3 = charge still has active (non-voided) payments; void them first
--   4 = invalid input (reason shorter than 3 or longer than 500, or missing actor)

ALTER TABLE monthly_charges ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ NULL;
ALTER TABLE monthly_charges ADD COLUMN IF NOT EXISTS voided_by UUID NULL REFERENCES app_users(id) ON DELETE SET NULL;
ALTER TABLE monthly_charges ADD COLUMN IF NOT EXISTS void_reason TEXT NULL;

ALTER TABLE payments ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ NULL;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS voided_by UUID NULL REFERENCES app_users(id) ON DELETE SET NULL;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS void_reason TEXT NULL;

DO $migration$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'monthly_charges_void_check') THEN
        ALTER TABLE monthly_charges ADD CONSTRAINT monthly_charges_void_check CHECK (
            (voided_at IS NULL AND void_reason IS NULL AND voided_by IS NULL)
            OR (voided_at IS NOT NULL AND void_reason IS NOT NULL
                AND length(btrim(void_reason)) BETWEEN 3 AND 500)
        );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_void_check') THEN
        ALTER TABLE payments ADD CONSTRAINT payments_void_check CHECK (
            (voided_at IS NULL AND void_reason IS NULL AND voided_by IS NULL)
            OR (voided_at IS NOT NULL AND void_reason IS NOT NULL
                AND length(btrim(void_reason)) BETWEEN 3 AND 500)
        );
    END IF;
END $migration$;

-- A voided (or trashed) charge must not keep occupying the
-- (enrollment, billing_month) unique slot: after a void the manager can create the
-- corrected charge for the same month. Active rows stay unique.
ALTER TABLE monthly_charges DROP CONSTRAINT IF EXISTS monthly_charges_enrollment_id_billing_month_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_monthly_charges_active_enrollment_month
    ON monthly_charges (enrollment_id, billing_month)
    WHERE voided_at IS NULL AND is_trashed = FALSE;

-- Partial indexes: every money read filters on voided_at IS NULL.
CREATE INDEX IF NOT EXISTS ix_monthly_charges_active_void
    ON monthly_charges (enrollment_id, billing_month)
    WHERE voided_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_payments_active_void
    ON payments (monthly_charge_id, paid_at)
    WHERE voided_at IS NULL;

CREATE OR REPLACE FUNCTION public.dar_void_charge(p_charge uuid, p_actor uuid, p_reason text)
RETURNS integer
LANGUAGE plpgsql
AS $function$
DECLARE
    v_reason  text;
    v_voided  timestamptz;
    v_trashed boolean;
    v_found   boolean;
BEGIN
    v_reason := btrim(COALESCE(p_reason, ''));
    IF p_charge IS NULL OR p_actor IS NULL
       OR length(v_reason) < 3 OR length(v_reason) > 500 THEN
        RETURN 4;
    END IF;

    SELECT mc.voided_at, mc.is_trashed INTO v_voided, v_trashed
    FROM public.monthly_charges mc
    WHERE mc.id = p_charge
    FOR UPDATE;
    v_found := FOUND;
    IF NOT v_found OR v_trashed THEN
        RETURN 1;
    END IF;
    IF v_voided IS NOT NULL THEN
        RETURN 2;
    END IF;
    IF EXISTS (SELECT 1 FROM public.payments p
               WHERE p.monthly_charge_id = p_charge
                 AND p.is_trashed = FALSE
                 AND p.voided_at IS NULL) THEN
        RETURN 3;
    END IF;

    UPDATE public.monthly_charges
    SET voided_at = now(), voided_by = p_actor, void_reason = v_reason
    WHERE id = p_charge;
    RETURN 0;
END;
$function$;

CREATE OR REPLACE FUNCTION public.dar_void_payment(p_payment uuid, p_actor uuid, p_reason text)
RETURNS integer
LANGUAGE plpgsql
AS $function$
DECLARE
    v_reason  text;
    v_voided  timestamptz;
    v_trashed boolean;
    v_found   boolean;
BEGIN
    v_reason := btrim(COALESCE(p_reason, ''));
    IF p_payment IS NULL OR p_actor IS NULL
       OR length(v_reason) < 3 OR length(v_reason) > 500 THEN
        RETURN 4;
    END IF;

    SELECT p.voided_at, p.is_trashed INTO v_voided, v_trashed
    FROM public.payments p
    WHERE p.id = p_payment
    FOR UPDATE;
    v_found := FOUND;
    IF NOT v_found OR v_trashed THEN
        RETURN 1;
    END IF;
    IF v_voided IS NOT NULL THEN
        RETURN 2;
    END IF;

    UPDATE public.payments
    SET voided_at = now(), voided_by = p_actor, void_reason = v_reason
    WHERE id = p_payment;
    RETURN 0;
END;
$function$;

-- New permission: voiding needs an explicit reason and is separate from edit/delete.
INSERT INTO permissions (code, name_ar) VALUES
    ('finance.void', 'إلغاء السجلات المالية بسبب موثق')
ON CONFLICT (code) DO UPDATE SET name_ar = EXCLUDED.name_ar;

-- Backfill: whoever could edit charges (finance.edit) can void them.
INSERT INTO user_permissions (user_id, permission_code)
SELECT DISTINCT up.user_id, 'finance.void'
FROM user_permissions up
WHERE up.permission_code = 'finance.edit'
ON CONFLICT (user_id, permission_code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT DISTINCT rp.role_id, target.id
FROM role_permissions rp
JOIN permissions source ON source.id = rp.permission_id AND source.code = 'finance.edit'
JOIN permissions target ON target.code = 'finance.void'
ON CONFLICT (role_id, permission_id) DO NOTHING;
