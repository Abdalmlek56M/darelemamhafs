-- FINAL 0.4: the unpaid-notification resolver listens to the real ledger.
-- 1) voided payments are excluded from the paid sum,
-- 2) the same resolver fires when monthly_charges.amount_due changes.
CREATE OR REPLACE FUNCTION dar_resolve_paid_notification() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    charge UUID;
    due NUMERIC(12,2);
    paid NUMERIC(12,2);
BEGIN
    IF TG_TABLE_NAME = 'monthly_charges' THEN
        charge := NEW.id;
    ELSIF TG_OP = 'DELETE' THEN
        charge := OLD.monthly_charge_id;
    ELSE
        charge := NEW.monthly_charge_id;
    END IF;

    SELECT amount_due INTO due FROM monthly_charges WHERE id = charge;
    SELECT COALESCE(SUM(amount), 0) INTO paid
    FROM payments
    WHERE monthly_charge_id = charge AND is_trashed = FALSE AND voided_at IS NULL;

    IF due IS NOT NULL AND paid >= due THEN
        UPDATE notifications
        SET status='resolved', resolved_at=now(), resolution_note='تم سداد الاشتراك بالكامل'
        WHERE dedupe_key = 'unpaid:' || charge AND status = 'open';
    ELSIF due IS NOT NULL THEN
        UPDATE notifications
        SET status='open', resolved_at=NULL, resolved_by=NULL, resolution_note=NULL
        WHERE dedupe_key = 'unpaid:' || charge AND status = 'resolved';
    END IF;

    RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_payments_resolve_notification ON payments;
CREATE TRIGGER trg_payments_resolve_notification
AFTER INSERT OR UPDATE OR DELETE ON payments
FOR EACH ROW EXECUTE FUNCTION dar_resolve_paid_notification();

DROP TRIGGER IF EXISTS trg_charges_resolve_notification ON monthly_charges;
CREATE TRIGGER trg_charges_resolve_notification
AFTER UPDATE OF amount_due, is_trashed, voided_at ON monthly_charges
FOR EACH ROW EXECUTE FUNCTION dar_resolve_paid_notification();
