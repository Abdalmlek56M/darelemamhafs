-- FINAL Tier 2.3 — lifecycle scenario seed for tests/regression/tier2-history.
--
-- Every shape the eligibility functions distinguish, with dates derived from the database's
-- CURRENT_DATE so the fallbacks ("paused is active before CURRENT_DATE", "ended is active up to
-- ends_on") are exercised against the same clock the functions use:
--   A resume in-month, B paused all month, C ended mid-previous-month, D legacy paused (no audit),
--   E legacy ended (no audit), F ending an already-paused enrollment, G one-day inclusive end date,
--   H legacy active (no audit), I same effective day/later occurred_at, J same effective day and
--   occurred_at (higher audit id wins), K valid effectiveOn but NULL status, L missing effectiveOn.
-- Fresh-trigger audit inserts are materialised by migration 039's trigger, exactly like production
-- writers; the suite then compares all functions against reference.sql on every day/month in range.
DROP TABLE IF EXISTS public.t23_suite_ids;
CREATE TABLE public.t23_suite_ids(kind text PRIMARY KEY, id uuid NOT NULL);

DO $t23$
DECLARE
    v_student uuid;
    v_circle uuid;
    e uuid;
    m0 date := (date_trunc('month', CURRENT_DATE) - INTERVAL '3 months')::date;
    m2 date := (date_trunc('month', CURRENT_DATE) - INTERVAL '1 month')::date;
BEGIN
    INSERT INTO students(student_code, full_name, joined_on, status)
    VALUES ('T23-S1', 'T23 eligibility student', m0, 'active') RETURNING id INTO v_student;

    -- A: active -> paused -> resumed in the same month.
    INSERT INTO circles(circle_code,name,monthly_fee,is_active,starts_on) VALUES ('T23-C1','T23 resume',100,TRUE,m0) RETURNING id INTO v_circle;
    INSERT INTO circle_enrollments(student_id,circle_id,starts_on,agreed_monthly_fee,status) VALUES (v_student,v_circle,m0,100,'active') RETURNING id INTO e;
    INSERT INTO audit_log(action_code,entity_type,entity_id,details,occurred_at) VALUES
      ('enrollment.status.baseline','enrollment',e,jsonb_build_object('status','active','effectiveOn',m0), now()-INTERVAL '10 days'),
      ('enrollment.pause','enrollment',e,jsonb_build_object('status','paused','effectiveOn',m2,'reason','r1'), now()-INTERVAL '9 days'),
      ('enrollment.resume','enrollment',e,jsonb_build_object('status','active','effectiveOn',m2+14,'reason','r2'), now()-INTERVAL '8 days');
    INSERT INTO public.t23_suite_ids VALUES ('A_resume',e);

    -- B: paused for every day of the billed month.
    INSERT INTO circles(circle_code,name,monthly_fee,is_active,starts_on) VALUES ('T23-C2','T23 full pause',100,TRUE,m0) RETURNING id INTO v_circle;
    INSERT INTO circle_enrollments(student_id,circle_id,starts_on,agreed_monthly_fee,status) VALUES (v_student,v_circle,m0,100,'paused') RETURNING id INTO e;
    INSERT INTO audit_log(action_code,entity_type,entity_id,details,occurred_at) VALUES
      ('enrollment.status.baseline','enrollment',e,jsonb_build_object('status','active','effectiveOn',m0), now()-INTERVAL '10 days'),
      ('enrollment.pause','enrollment',e,jsonb_build_object('status','paused','effectiveOn',m2), now()-INTERVAL '9 days');
    INSERT INTO public.t23_suite_ids VALUES ('B_full_pause',e);

    -- C: ended part-way through the previous month (inclusive end date).
    INSERT INTO circles(circle_code,name,monthly_fee,is_active,starts_on) VALUES ('T23-C3','T23 ended',100,TRUE,m0) RETURNING id INTO v_circle;
    INSERT INTO circle_enrollments(student_id,circle_id,starts_on,ends_on,agreed_monthly_fee,status) VALUES (v_student,v_circle,m0,m2+9,100,'ended') RETURNING id INTO e;
    INSERT INTO audit_log(action_code,entity_type,entity_id,details,occurred_at) VALUES
      ('enrollment.status.baseline','enrollment',e,jsonb_build_object('status','active','effectiveOn',m0), now()-INTERVAL '10 days'),
      ('enrollment.end','enrollment',e,jsonb_build_object('status','ended','effectiveOn',m2+9), now()-INTERVAL '7 days');
    INSERT INTO public.t23_suite_ids VALUES ('C_ended',e);

    -- D: legacy paused row with no audit evidence (fallback: active before CURRENT_DATE).
    INSERT INTO circles(circle_code,name,monthly_fee,is_active,starts_on) VALUES ('T23-C4','T23 legacy pause',100,TRUE,m0) RETURNING id INTO v_circle;
    INSERT INTO circle_enrollments(student_id,circle_id,starts_on,agreed_monthly_fee,status) VALUES (v_student,v_circle,m0,100,'paused') RETURNING id INTO e;
    INSERT INTO public.t23_suite_ids VALUES ('D_legacy_paused',e);

    -- E: legacy ended row with no audit evidence (fallback: active up to ends_on).
    INSERT INTO circles(circle_code,name,monthly_fee,is_active,starts_on) VALUES ('T23-C5','T23 legacy end',100,TRUE,m0) RETURNING id INTO v_circle;
    INSERT INTO circle_enrollments(student_id,circle_id,starts_on,ends_on,agreed_monthly_fee,status) VALUES (v_student,v_circle,m0,m0+14,100,'ended') RETURNING id INTO e;
    INSERT INTO public.t23_suite_ids VALUES ('E_legacy_ended',e);

    -- F: ending an already-paused enrollment must not create an attendance day.
    INSERT INTO circles(circle_code,name,monthly_fee,is_active,starts_on) VALUES ('T23-C6','T23 paused then ended',100,TRUE,m0) RETURNING id INTO v_circle;
    INSERT INTO circle_enrollments(student_id,circle_id,starts_on,ends_on,agreed_monthly_fee,status) VALUES (v_student,v_circle,m0,m2+9,100,'ended') RETURNING id INTO e;
    INSERT INTO audit_log(action_code,entity_type,entity_id,details,occurred_at) VALUES
      ('enrollment.status.baseline','enrollment',e,jsonb_build_object('status','active','effectiveOn',m0), now()-INTERVAL '10 days'),
      ('enrollment.pause','enrollment',e,jsonb_build_object('status','paused','effectiveOn',m2), now()-INTERVAL '9 days'),
      ('enrollment.end','enrollment',e,jsonb_build_object('status','ended','effectiveOn',m2+9), now()-INTERVAL '7 days');
    INSERT INTO public.t23_suite_ids VALUES ('F_paused_then_ended',e);

    -- G: genuinely active one-day enrollment stays eligible on its inclusive end date.
    INSERT INTO circles(circle_code,name,monthly_fee,is_active,starts_on) VALUES ('T23-C7','T23 one day',100,TRUE,m0) RETURNING id INTO v_circle;
    INSERT INTO circle_enrollments(student_id,circle_id,starts_on,ends_on,agreed_monthly_fee,status) VALUES (v_student,v_circle,m2+20,m2+20,100,'ended') RETURNING id INTO e;
    INSERT INTO audit_log(action_code,entity_type,entity_id,details,occurred_at) VALUES
      ('enrollment.status.baseline','enrollment',e,jsonb_build_object('status','active','effectiveOn',m2+20), now()-INTERVAL '6 days'),
      ('enrollment.end','enrollment',e,jsonb_build_object('status','ended','effectiveOn',m2+20), now()-INTERVAL '6 days');
    INSERT INTO public.t23_suite_ids VALUES ('G_one_day',e);

    -- H: legacy active row with no audit evidence.
    INSERT INTO circles(circle_code,name,monthly_fee,is_active,starts_on) VALUES ('T23-C8','T23 legacy active',100,TRUE,m0) RETURNING id INTO v_circle;
    INSERT INTO circle_enrollments(student_id,circle_id,starts_on,agreed_monthly_fee,status) VALUES (v_student,v_circle,m0,100,'active') RETURNING id INTO e;
    INSERT INTO public.t23_suite_ids VALUES ('H_legacy_active',e);

    -- I: two events on the same effective day; later occurred_at wins.
    INSERT INTO circles(circle_code,name,monthly_fee,is_active,starts_on) VALUES ('T23-C9','T23 same day occurred',100,TRUE,m0) RETURNING id INTO v_circle;
    INSERT INTO circle_enrollments(student_id,circle_id,starts_on,agreed_monthly_fee,status) VALUES (v_student,v_circle,m0,100,'active') RETURNING id INTO e;
    INSERT INTO audit_log(action_code,entity_type,entity_id,details,occurred_at) VALUES
      ('enrollment.status.baseline','enrollment',e,jsonb_build_object('status','active','effectiveOn',m0), now()-INTERVAL '10 days'),
      ('enrollment.pause','enrollment',e,jsonb_build_object('status','paused','effectiveOn',m2+5), now()-INTERVAL '9 days'),
      ('enrollment.resume','enrollment',e,jsonb_build_object('status','active','effectiveOn',m2+5), now()-INTERVAL '8 days');
    INSERT INTO public.t23_suite_ids VALUES ('I_same_day_occurred',e);

    -- J: same effective day AND same occurred_at; the higher audit id wins (pause inserted after resume).
    INSERT INTO circles(circle_code,name,monthly_fee,is_active,starts_on) VALUES ('T23-C10','T23 same day id',100,TRUE,m0) RETURNING id INTO v_circle;
    INSERT INTO circle_enrollments(student_id,circle_id,starts_on,agreed_monthly_fee,status) VALUES (v_student,v_circle,m0,100,'paused') RETURNING id INTO e;
    INSERT INTO audit_log(action_code,entity_type,entity_id,details,occurred_at) VALUES
      ('enrollment.status.baseline','enrollment',e,jsonb_build_object('status','active','effectiveOn',m0), now()-INTERVAL '10 days'),
      ('enrollment.resume','enrollment',e,jsonb_build_object('status','active','effectiveOn',m2+5), now()-INTERVAL '9 days'),
      ('enrollment.pause','enrollment',e,jsonb_build_object('status','paused','effectiveOn',m2+5), now()-INTERVAL '9 days');
    INSERT INTO public.t23_suite_ids VALUES ('J_same_day_id',e);

    -- K: valid effectiveOn but NULL status; the legacy COALESCE fell back to the live row.
    INSERT INTO circles(circle_code,name,monthly_fee,is_active,starts_on) VALUES ('T23-C11','T23 null status',100,TRUE,m0) RETURNING id INTO v_circle;
    INSERT INTO circle_enrollments(student_id,circle_id,starts_on,agreed_monthly_fee,status) VALUES (v_student,v_circle,m0,100,'active') RETURNING id INTO e;
    INSERT INTO audit_log(action_code,entity_type,entity_id,details,occurred_at) VALUES
      ('enrollment.status.baseline','enrollment',e,jsonb_build_object('status','active','effectiveOn',m0), now()-INTERVAL '10 days'),
      ('enrollment.pause','enrollment',e,jsonb_build_object('effectiveOn',m2), now()-INTERVAL '9 days');
    INSERT INTO public.t23_suite_ids VALUES ('K_null_status',e);

    -- L: lifecycle row without effectiveOn was ignored by the legacy WHERE clause.
    INSERT INTO circles(circle_code,name,monthly_fee,is_active,starts_on) VALUES ('T23-C12','T23 null effective',100,TRUE,m0) RETURNING id INTO v_circle;
    INSERT INTO circle_enrollments(student_id,circle_id,starts_on,agreed_monthly_fee,status) VALUES (v_student,v_circle,m0,100,'active') RETURNING id INTO e;
    INSERT INTO audit_log(action_code,entity_type,entity_id,details,occurred_at) VALUES
      ('enrollment.status.baseline','enrollment',e,jsonb_build_object('status','active','effectiveOn',m0), now()-INTERVAL '10 days'),
      ('enrollment.pause','enrollment',e,jsonb_build_object('status','paused'), now()-INTERVAL '9 days');
    INSERT INTO public.t23_suite_ids VALUES ('L_null_effective',e);
END $t23$;

SELECT 'seeded';
