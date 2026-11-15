BEGIN;

DO $dar_test$
DECLARE
    v_student uuid;
    v_circle uuid;
    v_month_old date := (date_trunc('month', CURRENT_DATE) - INTERVAL '3 months')::date;
    v_month_paused date := (date_trunc('month', CURRENT_DATE) - INTERVAL '2 months')::date;
    v_month_previous date := (date_trunc('month', CURRENT_DATE) - INTERVAL '1 month')::date;
    v_month_current date := date_trunc('month', CURRENT_DATE)::date;
    v_enrollment_resume uuid;
    v_enrollment_full_pause uuid;
    v_enrollment_ended uuid;
    v_enrollment_legacy_pause uuid;
    v_enrollment_legacy_end uuid;
    v_enrollment_future uuid;
    v_enrollment_active_legacy uuid;
    v_enrollment_paused_then_ended uuid;
    v_enrollment_one_day uuid;
    v_enrollment_future_circle uuid;
BEGIN
    INSERT INTO public.students(student_code, full_name, joined_on, status)
    VALUES ('LIFE-' || replace(gen_random_uuid()::text, '-', ''), 'Lifecycle regression student', v_month_old, 'active')
    RETURNING id INTO v_student;

    INSERT INTO public.circles(circle_code, name, monthly_fee, is_active, starts_on)
    VALUES ('LIFE-' || replace(gen_random_uuid()::text, '-', ''), 'Lifecycle regression circle', 100, TRUE, v_month_old)
    RETURNING id INTO v_circle;

    -- Active, then paused and resumed in the same billed month.
    INSERT INTO public.circle_enrollments(student_id, circle_id, starts_on, agreed_monthly_fee, status)
    VALUES (v_student, v_circle, v_month_old, 100, 'active') RETURNING id INTO v_enrollment_resume;
    INSERT INTO public.audit_log(action_code, entity_type, entity_id, details) VALUES
      ('enrollment.status.baseline','enrollment',v_enrollment_resume,jsonb_build_object('status','active','effectiveOn',v_month_old)),
      ('enrollment.pause','enrollment',v_enrollment_resume,jsonb_build_object('status','paused','effectiveOn',v_month_paused)),
      ('enrollment.resume','enrollment',v_enrollment_resume,jsonb_build_object('status','active','effectiveOn',v_month_paused + 14));

    -- Paused for every day in the month: no new monthly charge is eligible.
    INSERT INTO public.circles(circle_code, name, monthly_fee, is_active, starts_on)
    VALUES ('LIFE-' || replace(gen_random_uuid()::text, '-', ''), 'Lifecycle paused circle', 100, TRUE, v_month_old) RETURNING id INTO v_circle;
    INSERT INTO public.circle_enrollments(student_id, circle_id, starts_on, agreed_monthly_fee, status)
    VALUES (v_student, v_circle, v_month_old, 100, 'paused') RETURNING id INTO v_enrollment_full_pause;
    INSERT INTO public.audit_log(action_code, entity_type, entity_id, details) VALUES
      ('enrollment.status.baseline','enrollment',v_enrollment_full_pause,jsonb_build_object('status','active','effectiveOn',v_month_old)),
      ('enrollment.pause','enrollment',v_enrollment_full_pause,jsonb_build_object('status','paused','effectiveOn',v_month_paused));

    -- Ended partway through the previous month: previous month remains eligible; current month is not.
    INSERT INTO public.circles(circle_code, name, monthly_fee, is_active, starts_on)
    VALUES ('LIFE-' || replace(gen_random_uuid()::text, '-', ''), 'Lifecycle ended circle', 100, TRUE, v_month_old) RETURNING id INTO v_circle;
    INSERT INTO public.circle_enrollments(student_id, circle_id, starts_on, ends_on, agreed_monthly_fee, status)
    VALUES (v_student, v_circle, v_month_old, v_month_previous + 9, 100, 'ended') RETURNING id INTO v_enrollment_ended;
    INSERT INTO public.audit_log(action_code, entity_type, entity_id, details) VALUES
      ('enrollment.status.baseline','enrollment',v_enrollment_ended,jsonb_build_object('status','active','effectiveOn',v_month_old)),
      ('enrollment.end','enrollment',v_enrollment_ended,jsonb_build_object('status','ended','effectiveOn',v_month_previous + 9));

    -- Legacy paused row without a reliable event date: historical dates remain active; today is paused.
    INSERT INTO public.circles(circle_code, name, monthly_fee, is_active, starts_on)
    VALUES ('LIFE-' || replace(gen_random_uuid()::text, '-', ''), 'Lifecycle legacy pause circle', 100, TRUE, v_month_old) RETURNING id INTO v_circle;
    INSERT INTO public.circle_enrollments(student_id, circle_id, starts_on, agreed_monthly_fee, status)
    VALUES (v_student, v_circle, v_month_old, 100, 'paused') RETURNING id INTO v_enrollment_legacy_pause;

    -- Legacy ended row without lifecycle events uses ends_on as its reliable end date.
    INSERT INTO public.circles(circle_code, name, monthly_fee, is_active, starts_on)
    VALUES ('LIFE-' || replace(gen_random_uuid()::text, '-', ''), 'Lifecycle legacy end circle', 100, TRUE, v_month_old) RETURNING id INTO v_circle;
    INSERT INTO public.circle_enrollments(student_id, circle_id, starts_on, ends_on, agreed_monthly_fee, status)
    VALUES (v_student, v_circle, v_month_old, v_month_old + 14, 100, 'ended') RETURNING id INTO v_enrollment_legacy_end;

    -- Ending an enrollment that was already paused must not make its end date chargeable.
    INSERT INTO public.circles(circle_code, name, monthly_fee, is_active, starts_on)
    VALUES ('LIFE-' || replace(gen_random_uuid()::text, '-', ''), 'Lifecycle paused then ended circle', 100, TRUE, v_month_old) RETURNING id INTO v_circle;
    INSERT INTO public.circle_enrollments(student_id, circle_id, starts_on, ends_on, agreed_monthly_fee, status)
    VALUES (v_student, v_circle, v_month_old, v_month_previous + 9, 100, 'ended') RETURNING id INTO v_enrollment_paused_then_ended;
    INSERT INTO public.audit_log(action_code, entity_type, entity_id, details) VALUES
      ('enrollment.status.baseline','enrollment',v_enrollment_paused_then_ended,jsonb_build_object('status','active','effectiveOn',v_month_old)),
      ('enrollment.pause','enrollment',v_enrollment_paused_then_ended,jsonb_build_object('status','paused','effectiveOn',v_month_previous)),
      ('enrollment.end','enrollment',v_enrollment_paused_then_ended,jsonb_build_object('status','ended','effectiveOn',v_month_previous + 9));

    -- A genuinely active one-day enrollment remains eligible on its inclusive end date.
    INSERT INTO public.circles(circle_code, name, monthly_fee, is_active, starts_on)
    VALUES ('LIFE-' || replace(gen_random_uuid()::text, '-', ''), 'Lifecycle one-day circle', 100, TRUE, v_month_old) RETURNING id INTO v_circle;
    INSERT INTO public.circle_enrollments(student_id, circle_id, starts_on, ends_on, agreed_monthly_fee, status)
    VALUES (v_student, v_circle, v_month_previous + 20, v_month_previous + 20, 100, 'ended') RETURNING id INTO v_enrollment_one_day;
    INSERT INTO public.audit_log(action_code, entity_type, entity_id, details) VALUES
      ('enrollment.status.baseline','enrollment',v_enrollment_one_day,jsonb_build_object('status','active','effectiveOn',v_month_previous + 20)),
      ('enrollment.end','enrollment',v_enrollment_one_day,jsonb_build_object('status','ended','effectiveOn',v_month_previous + 20));

    -- A legacy active row without events is active throughout the overlapping month.
    INSERT INTO public.circles(circle_code, name, monthly_fee, is_active, starts_on)
    VALUES ('LIFE-' || replace(gen_random_uuid()::text, '-', ''), 'Lifecycle legacy active circle', 100, TRUE, v_month_old) RETURNING id INTO v_circle;
    INSERT INTO public.circle_enrollments(student_id, circle_id, starts_on, agreed_monthly_fee, status)
    VALUES (v_student, v_circle, v_month_old, 100, 'active') RETURNING id INTO v_enrollment_active_legacy;

    -- A future enrollment does not make an earlier billed month eligible.
    INSERT INTO public.circles(circle_code, name, monthly_fee, is_active, starts_on)
    VALUES ('LIFE-' || replace(gen_random_uuid()::text, '-', ''), 'Lifecycle future circle', 100, TRUE, v_month_old) RETURNING id INTO v_circle;
    INSERT INTO public.circle_enrollments(student_id, circle_id, starts_on, agreed_monthly_fee, status)
    VALUES (v_student, v_circle, (v_month_current + INTERVAL '1 month')::date, 100, 'active') RETURNING id INTO v_enrollment_future;

    -- An enrollment cannot be charged before its circle's own start date.
    INSERT INTO public.circles(circle_code, name, monthly_fee, is_active, starts_on)
    VALUES (
      'LIFE-' || replace(gen_random_uuid()::text, '-', ''),
      'Lifecycle future-start circle',
      100,
      TRUE,
      (v_month_current + INTERVAL '1 month')::date
    ) RETURNING id INTO v_circle;
    INSERT INTO public.circle_enrollments(student_id, circle_id, starts_on, agreed_monthly_fee, status)
    VALUES (v_student, v_circle, v_month_old, 100, 'active') RETURNING id INTO v_enrollment_future_circle;

    IF NOT public.dar_enrollment_has_active_day_in_month(v_enrollment_resume, v_month_paused) THEN
        RAISE EXCEPTION 'FAIL: resumed enrollment should be eligible when it had active days in the month';
    END IF;
    IF public.dar_enrollment_has_active_day_in_month(v_enrollment_full_pause, v_month_paused) THEN
        RAISE EXCEPTION 'FAIL: an enrollment paused for the entire month must not be eligible';
    END IF;
    IF NOT public.dar_enrollment_has_active_day_in_month(v_enrollment_ended, v_month_previous) THEN
        RAISE EXCEPTION 'FAIL: a historical month before a later withdrawal should remain eligible';
    END IF;
    IF NOT public.dar_enrollment_is_attendance_eligible_on_date(v_enrollment_ended, v_month_previous + 9) THEN
        RAISE EXCEPTION 'FAIL: an active enrollment remains attendance-eligible on its inclusive end date';
    END IF;
    IF public.dar_enrollment_has_active_day_in_month(v_enrollment_ended, v_month_current) THEN
        RAISE EXCEPTION 'FAIL: a month after withdrawal must not be eligible';
    END IF;
    IF public.dar_enrollment_status_at_date(v_enrollment_legacy_pause, v_month_previous + 10) <> 'active' THEN
        RAISE EXCEPTION 'FAIL: a legacy paused enrollment must preserve history before the first provable pause date';
    END IF;
    IF public.dar_enrollment_status_at_date(v_enrollment_legacy_pause, CURRENT_DATE) <> 'paused' THEN
        RAISE EXCEPTION 'FAIL: a legacy paused enrollment must be paused from the current provable date';
    END IF;
    IF public.dar_enrollment_status_at_date(v_enrollment_legacy_end, v_month_old + 10) <> 'active' THEN
        RAISE EXCEPTION 'FAIL: a legacy ended enrollment should remain active before ends_on';
    END IF;
    IF public.dar_enrollment_status_at_date(v_enrollment_legacy_end, v_month_paused + 1) <> 'ended' THEN
        RAISE EXCEPTION 'FAIL: a legacy ended enrollment should be ended after ends_on';
    END IF;
    IF NOT public.dar_enrollment_has_active_day_in_month(v_enrollment_active_legacy, v_month_old) THEN
        RAISE EXCEPTION 'FAIL: a legacy active enrollment without events should remain eligible';
    END IF;
    IF public.dar_enrollment_has_active_day_in_month(v_enrollment_future, v_month_current) THEN
        RAISE EXCEPTION 'FAIL: an enrollment starting after the billed month must not be eligible';
    END IF;
    IF public.dar_enrollment_has_active_day_in_month(v_enrollment_future_circle, v_month_current) THEN
        RAISE EXCEPTION 'FAIL: a circle starting after the billed month must not be eligible even when its enrollment starts earlier';
    END IF;
    IF public.dar_enrollment_has_active_day_in_month(v_enrollment_paused_then_ended, v_month_previous) THEN
        RAISE EXCEPTION 'FAIL: ending an already-paused enrollment must not make the end date chargeable';
    END IF;
    IF public.dar_enrollment_is_attendance_eligible_on_date(v_enrollment_paused_then_ended, v_month_previous + 9) THEN
        RAISE EXCEPTION 'FAIL: ending an already-paused enrollment must not make the end date attendance-eligible';
    END IF;
    IF public.dar_enrollment_is_attendance_eligible_on_date(v_enrollment_full_pause, v_month_paused + 5) THEN
        RAISE EXCEPTION 'FAIL: an enrollment paused on the selected date must not be attendance-eligible';
    END IF;
    IF NOT public.dar_enrollment_has_active_day_in_month(v_enrollment_one_day, v_month_previous) THEN
        RAISE EXCEPTION 'FAIL: an enrollment active on its inclusive end date must remain eligible for that month';
    END IF;

    RAISE NOTICE 'PASS: historical activity, pause/resume, full pause, withdrawal, end-date inclusivity, legacy fallbacks and future starts';
END;
$dar_test$;

SELECT 'ENROLLMENT_LIFECYCLE_REGRESSION_PASS';
ROLLBACK;
