-- P2-1: a payment can only be voided while the student's subscription is active.
-- Return contract for dar_void_payment:
--   0 = voided
--   1 = not found / trashed
--   2 = already voided
--   4 = invalid reason/actor
--   5 = subscription inactive or outside its enrollment period
-- Payroll locks do NOT lock payments or payment-based reports; they only gate
-- teacher attendance/payroll calculations, so no payroll-lock check belongs here.

CREATE OR REPLACE FUNCTION public.dar_void_payment(p_payment uuid, p_actor uuid, p_reason text)
RETURNS integer
LANGUAGE plpgsql
AS $function$
DECLARE
    v_reason text;
    v_voided timestamptz;
    v_trashed boolean;
    v_found boolean;
    v_enrollment_status text;
    v_student_status text;
    v_enrollment_starts date;
    v_enrollment_ends date;
    v_enrollment_trashed boolean;
    v_student_trashed boolean;
    v_charge_id uuid;
    v_today date := (now() AT TIME ZONE 'Africa/Cairo')::date;
BEGIN
    v_reason := btrim(COALESCE(p_reason, ''));
    IF p_payment IS NULL OR p_actor IS NULL
       OR length(v_reason) < 3 OR length(v_reason) > 500 THEN
        RETURN 4;
    END IF;

    SELECT p.voided_at, p.is_trashed
      INTO v_voided, v_trashed
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

    SELECT mc.id, ce.status, s.status, ce.starts_on, ce.ends_on,
           ce.is_trashed, s.is_trashed
      INTO v_charge_id, v_enrollment_status, v_student_status,
           v_enrollment_starts, v_enrollment_ends, v_enrollment_trashed, v_student_trashed
    FROM public.payments p
    JOIN public.monthly_charges mc ON mc.id = p.monthly_charge_id AND mc.is_trashed = FALSE
    JOIN public.circle_enrollments ce ON ce.id = mc.enrollment_id
    JOIN public.students s ON s.id = ce.student_id
    WHERE p.id = p_payment;

    IF v_charge_id IS NULL
       OR v_enrollment_trashed
       OR v_student_trashed
       OR v_enrollment_status <> 'active'
       OR v_student_status <> 'active'
       OR v_today < v_enrollment_starts
       OR (v_enrollment_ends IS NOT NULL AND v_today > v_enrollment_ends) THEN
        RETURN 5;
    END IF;

    UPDATE public.payments
    SET voided_at = now(), voided_by = p_actor, void_reason = v_reason
    WHERE id = p_payment;
    RETURN 0;
END;
$function$;
