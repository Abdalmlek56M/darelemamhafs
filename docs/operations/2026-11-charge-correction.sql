-- One-off correction: charges created by the old mid-month proration.
-- Approved by the owner on 18 Nov 2026. The script only raises under-billed
-- charges to the enrollment's agreed monthly fee, refuses any charge whose
-- recorded payments already exceed that fee, and writes an audit row per charge.
--
-- Run inside a transaction with a fresh backup available:
--   psql -d dareltahfeez -v ON_ERROR_STOP=1 -f 2026-11-charge-correction.sql
DO $$
DECLARE
    r RECORD;
    v_paid NUMERIC;
BEGIN
    FOR r IN
        SELECT mc.id, mc.amount_due, ce.agreed_monthly_fee,
               s.full_name, c.name AS circle_name
        FROM monthly_charges mc
        JOIN circle_enrollments ce ON ce.id = mc.enrollment_id
        JOIN students s ON s.id = ce.student_id
        JOIN circles c ON c.id = ce.circle_id
        WHERE mc.is_trashed = FALSE
          AND ce.is_trashed = FALSE
          AND mc.amount_due <> ce.agreed_monthly_fee
        FOR UPDATE OF mc
    LOOP
        SELECT COALESCE(SUM(p.amount), 0)
        INTO v_paid
        FROM payments p
        WHERE p.monthly_charge_id = r.id AND p.is_trashed = FALSE;

        IF v_paid > r.agreed_monthly_fee THEN
            RAISE EXCEPTION 'Charge % has paid % which exceeds agreed fee %',
                r.id, v_paid, r.agreed_monthly_fee;
        END IF;

        INSERT INTO audit_log(
            actor_user_id, actor_display_name, action_code, entity_type, entity_id,
            details, before_data, after_data, request_path, http_method, can_restore)
        VALUES (
            NULL,
            'تصحيح استحقاقات معتمد',
            'charge.correct',
            'monthly_charge',
            r.id,
            jsonb_build_object(
                'reason', 'تصحيح استحقاق مبني على تقسيم أيام الشهر',
                'student', r.full_name,
                'circle', r.circle_name,
                'paid', v_paid),
            jsonb_build_object('amount_due', r.amount_due),
            jsonb_build_object('amount_due', r.agreed_monthly_fee),
            '/ops/charge-correction-2026-11',
            'SQL',
            FALSE);

        UPDATE monthly_charges
        SET amount_due = r.agreed_monthly_fee
        WHERE id = r.id;
    END LOOP;
END $$;
