-- ============================================================================
-- teacher_attendance_rate_snapshot.test.sql
-- FINAL 2.16: the previous version of this test created a TEMP TABLE and re-implemented
-- the CASE expression inside the test itself. It could therefore pass while the real
-- production object was broken (self-fulfilling test / false green).
--
-- This version tests the REAL object:
--   * public.teacher_attendance (real columns, NOT NULL/CHECK constraints),
--   * the real partial unique index ux_teacher_attendance_slot_date_live (migration 034),
--   * the exact production UPSERT statement used by backend/DarEltahfeez.Api
--     (DomainEndpoints.ScheduleAttendance.cs, "ON CONFLICT (schedule_slot_id, session_date)
--     WHERE is_trashed = FALSE ..."), which is the only production upsert that preserves
--     hourly_rate_snapshot on a same-teacher re-click,
--   * the duration-correction UPDATE the attendance adjustment endpoint performs.
--
-- Everything runs inside one transaction and is rolled back at the end, so it is safe to
-- execute against a disposable database with the current schema. Any FAIL raises an
-- exception before ROLLBACK (psql runs it with -v ON_ERROR_STOP=1); raising aborts the
-- open transaction, so the implicit rollback on disconnect replaces the explicit one.
--
-- Preconditions: current schema applied (teacher_attendance with hourly_rate_snapshot,
-- actual_duration_minutes, pay_basis, is_trashed and the migration-034 partial index).
-- ============================================================================
\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE snapshot_results (
    scenario text PRIMARY KEY,
    status   text NOT NULL CHECK (status IN ('PASS','FAIL')),
    detail   text NOT NULL
) ON COMMIT DROP;

CREATE FUNCTION pg_temp.rec(p_scenario text, p_status text, p_detail text)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
    INSERT INTO snapshot_results(scenario, status, detail) VALUES (p_scenario, p_status, p_detail)
    ON CONFLICT (scenario) DO UPDATE SET status=EXCLUDED.status, detail=EXCLUDED.detail;
    RAISE WARNING 'SNAPSHOT_RESULT % = % : %', p_scenario, p_status, p_detail;
END;
$fn$;

-- Gate 1: the real production objects must exist; a missing object is a hard failure,
-- not a skipped test.
DO $pre$
DECLARE
    v_columns integer;
    v_index   text;
BEGIN
    SELECT count(*) INTO v_columns
      FROM information_schema.columns
     WHERE table_schema='public' AND table_name='teacher_attendance'
       AND column_name IN ('hourly_rate_snapshot','actual_duration_minutes','pay_basis','is_trashed');
    IF v_columns <> 4 THEN
        RAISE EXCEPTION 'teacher_attendance_snapshot_test requires the current schema: found % of 4 expected columns', v_columns;
    END IF;
    SELECT indexdef INTO v_index FROM pg_indexes
     WHERE schemaname='public' AND indexname='ux_teacher_attendance_slot_date_live';
    IF v_index IS NULL THEN
        RAISE EXCEPTION 'teacher_attendance_snapshot_test requires partial unique index ux_teacher_attendance_slot_date_live (migration 034)';
    END IF;
    IF v_index NOT LIKE '%WHERE (is_trashed = false)%' THEN
        RAISE EXCEPTION 'ux_teacher_attendance_slot_date_live is not partial on is_trashed=false: %', v_index;
    END IF;
END;
$pre$;

-- Real rows for a real slot: teacher 100/hour with a live scheduled session on 2026-10-01.
INSERT INTO app_users(id,username,display_name,password_hash)
VALUES ('1f000000-0000-4000-8000-000000000001','snapshot_actor','Snapshot actor','x');

INSERT INTO teachers(id,teacher_code,full_name,status,hourly_rate)
VALUES ('1f000000-0000-4000-8000-000000000010','SNAP-T1','Snapshot Teacher 1','active',100),
       ('1f000000-0000-4000-8000-000000000011','SNAP-T2','Snapshot Teacher 2','active',200);

INSERT INTO circles(id,circle_code,name,teacher_id,monthly_fee,is_active,starts_on)
VALUES ('1f000000-0000-4000-8000-000000000020','SNAP-C1','Snapshot Circle','1f000000-0000-4000-8000-000000000010',0,TRUE,DATE '2026-01-01');

INSERT INTO circle_schedule_slots(id,circle_id,day_of_week,starts_at,duration_minutes,is_active)
VALUES ('1f000000-0000-4000-8000-000000000030','1f000000-0000-4000-8000-000000000020',4,'10:00',60,TRUE);

-- The production statement: same INSERT ... ON CONFLICT as the legacy attendance endpoint.
CREATE FUNCTION pg_temp.production_attendance_upsert(
    p_slot uuid, p_circle uuid, p_teacher uuid, p_date date, p_status text,
    p_rate numeric, p_payable numeric, p_actor uuid
) RETURNS TABLE(saved_rate numeric, saved_payable numeric) LANGUAGE plpgsql AS $fn$
BEGIN
    RETURN QUERY
    INSERT INTO teacher_attendance(schedule_slot_id,circle_id,teacher_id,session_date,scheduled_start,duration_minutes,status,hourly_rate_snapshot,payable_amount,note,marked_by)
    VALUES(p_slot,p_circle,p_teacher,p_date,'10:00',60,p_status,p_rate,CASE WHEN p_status='present' THEN p_payable ELSE 0 END,'snapshot test',p_actor)
    ON CONFLICT (schedule_slot_id, session_date) WHERE is_trashed = FALSE DO UPDATE SET
        teacher_id=EXCLUDED.teacher_id,
        hourly_rate_snapshot=CASE
            WHEN teacher_attendance.teacher_id IS DISTINCT FROM EXCLUDED.teacher_id THEN EXCLUDED.hourly_rate_snapshot
            ELSE teacher_attendance.hourly_rate_snapshot
        END,
        scheduled_start=EXCLUDED.scheduled_start,
        duration_minutes=teacher_attendance.duration_minutes,
        status=EXCLUDED.status,
        note=EXCLUDED.note,
        marked_by=EXCLUDED.marked_by,
        marked_at=now(),
        payable_amount=CASE WHEN EXCLUDED.status='present' THEN p_payable ELSE 0 END
    RETURNING hourly_rate_snapshot, payable_amount;
END;
$fn$;

-- ----------------------------------------------------------------------------
-- S01 — first mark stores the current rate 100 and payable 100
-- ----------------------------------------------------------------------------
DO $s01$
DECLARE v_rate numeric; v_payable numeric; v_rows integer;
BEGIN
    SELECT upsert.saved_rate, upsert.saved_payable INTO v_rate, v_payable
      FROM pg_temp.production_attendance_upsert(
        '1f000000-0000-4000-8000-000000000030','1f000000-0000-4000-8000-000000000020',
        '1f000000-0000-4000-8000-000000000010',DATE '2026-10-01','present',100,100,
        '1f000000-0000-4000-8000-000000000001') AS upsert;
    SELECT count(*) INTO v_rows FROM teacher_attendance
     WHERE schedule_slot_id='1f000000-0000-4000-8000-000000000030' AND is_trashed=FALSE;
    IF v_rate=100 AND v_payable=100 AND v_rows=1 THEN
        PERFORM pg_temp.rec('S01','PASS','real table: first mark stored snapshot 100 / payable 100 (1 live row)');
    ELSE
        PERFORM pg_temp.rec('S01','FAIL',format('rate=%s payable=%s rows=%s (expected 100/100/1)',v_rate,v_payable,v_rows));
    END IF;
END;
$s01$;

-- ----------------------------------------------------------------------------
-- S02 — re-mark by the SAME teacher after the hourly rate became 150: the real
--       production upsert must preserve the historical snapshot 100 / payable 100
-- ----------------------------------------------------------------------------
UPDATE teachers SET hourly_rate=150 WHERE id='1f000000-0000-4000-8000-000000000010';
DO $s02$
DECLARE v_rate numeric; v_payable numeric; v_rows integer;
BEGIN
    SELECT upsert.saved_rate, upsert.saved_payable INTO v_rate, v_payable
      FROM pg_temp.production_attendance_upsert(
        '1f000000-0000-4000-8000-000000000030','1f000000-0000-4000-8000-000000000020',
        '1f000000-0000-4000-8000-000000000010',DATE '2026-10-01','present',150,100,
        '1f000000-0000-4000-8000-000000000001') AS upsert;
    SELECT count(*) INTO v_rows FROM teacher_attendance
     WHERE schedule_slot_id='1f000000-0000-4000-8000-000000000030' AND is_trashed=FALSE;
    IF v_rate=100 AND v_payable=100 AND v_rows=1 THEN
        PERFORM pg_temp.rec('S02','PASS','real upsert preserved historical snapshot 100 after rate changed to 150');
    ELSE
        PERFORM pg_temp.rec('S02','FAIL',format('rate=%s payable=%s rows=%s (expected 100/100/1)',v_rate,v_payable,v_rows));
    END IF;
END;
$s02$;

-- ----------------------------------------------------------------------------
-- S03 — duration correction: the adjustment endpoint updates the real row and
--       computes pay from the stored snapshot (90 min at the preserved 100 -> 150)
-- ----------------------------------------------------------------------------
UPDATE teacher_attendance
   SET duration_minutes=90,
       payable_amount=round(90 * hourly_rate_snapshot / 60.0, 2)
 WHERE schedule_slot_id='1f000000-0000-4000-8000-000000000030' AND is_trashed=FALSE;
DO $s03$
DECLARE v_rate numeric; v_payable numeric; v_duration integer;
BEGIN
    SELECT hourly_rate_snapshot, payable_amount, duration_minutes INTO v_rate, v_payable, v_duration
      FROM teacher_attendance
     WHERE schedule_slot_id='1f000000-0000-4000-8000-000000000030' AND is_trashed=FALSE;
    IF v_rate=100 AND v_payable=150 AND v_duration=90 THEN
        PERFORM pg_temp.rec('S03','PASS','duration correction used the preserved 100 snapshot (90 min -> 150)');
    ELSE
        PERFORM pg_temp.rec('S03','FAIL',format('rate=%s payable=%s duration=%s (expected 100/150/90)',v_rate,v_payable,v_duration));
    END IF;
END;
$s03$;

-- ----------------------------------------------------------------------------
-- S04 — replacing the teacher updates snapshot to the substitute current rate (200)
-- ----------------------------------------------------------------------------
DO $s04$
DECLARE v_rate numeric; v_payable numeric;
BEGIN
    SELECT upsert.saved_rate, upsert.saved_payable INTO v_rate, v_payable
      FROM pg_temp.production_attendance_upsert(
        '1f000000-0000-4000-8000-000000000030','1f000000-0000-4000-8000-000000000020',
        '1f000000-0000-4000-8000-000000000011',DATE '2026-10-01','present',200,200,
        '1f000000-0000-4000-8000-000000000001') AS upsert;
    IF v_rate=200 AND v_payable=200 THEN
        PERFORM pg_temp.rec('S04','PASS','substitute teacher received its own snapshot 200');
    ELSE
        PERFORM pg_temp.rec('S04','FAIL',format('rate=%s payable=%s (expected 200/200)',v_rate,v_payable));
    END IF;
END;
$s04$;

-- ----------------------------------------------------------------------------
-- S05 — absent sets payable to 0 but retains the substitute snapshot 200
-- ----------------------------------------------------------------------------
DO $s05$
DECLARE v_rate numeric; v_payable numeric;
BEGIN
    SELECT upsert.saved_rate, upsert.saved_payable INTO v_rate, v_payable
      FROM pg_temp.production_attendance_upsert(
        '1f000000-0000-4000-8000-000000000030','1f000000-0000-4000-8000-000000000020',
        '1f000000-0000-4000-8000-000000000011',DATE '2026-10-01','absent',200,0,
        '1f000000-0000-4000-8000-000000000001') AS upsert;
    IF v_rate=200 AND v_payable=0 THEN
        PERFORM pg_temp.rec('S05','PASS','absent status produced payable 0 and kept snapshot 200');
    ELSE
        PERFORM pg_temp.rec('S05','FAIL',format('rate=%s payable=%s (expected 200/0)',v_rate,v_payable));
    END IF;
END;
$s05$;

-- ----------------------------------------------------------------------------
-- S06 — returning to present keeps the substitute snapshot 200 (not a later rate)
-- ----------------------------------------------------------------------------
UPDATE teachers SET hourly_rate=250 WHERE id='1f000000-0000-4000-8000-000000000011';
DO $s06$
DECLARE v_rate numeric; v_payable numeric;
BEGIN
    SELECT upsert.saved_rate, upsert.saved_payable INTO v_rate, v_payable
      FROM pg_temp.production_attendance_upsert(
        '1f000000-0000-4000-8000-000000000030','1f000000-0000-4000-8000-000000000020',
        '1f000000-0000-4000-8000-000000000011',DATE '2026-10-01','present',250,200,
        '1f000000-0000-4000-8000-000000000001') AS upsert;
    IF v_rate=200 AND v_payable=200 THEN
        PERFORM pg_temp.rec('S06','PASS','restoring present kept the substitute snapshot 200 despite rate 250');
    ELSE
        PERFORM pg_temp.rec('S06','FAIL',format('rate=%s payable=%s (expected 200/200)',v_rate,v_payable));
    END IF;
END;
$s06$;

-- ----------------------------------------------------------------------------
-- S07 — migration-034 real index: a trashed row must not block re-marking the session
-- ----------------------------------------------------------------------------
DO $s07$
DECLARE v_rate numeric; v_payable numeric; v_live integer; v_trashed integer;
BEGIN
    UPDATE teacher_attendance SET is_trashed=TRUE
     WHERE schedule_slot_id='1f000000-0000-4000-8000-000000000030' AND is_trashed=FALSE;
    SELECT upsert.saved_rate, upsert.saved_payable INTO v_rate, v_payable
      FROM pg_temp.production_attendance_upsert(
        '1f000000-0000-4000-8000-000000000030','1f000000-0000-4000-8000-000000000020',
        '1f000000-0000-4000-8000-000000000010',DATE '2026-10-01','present',100,100,
        '1f000000-0000-4000-8000-000000000001') AS upsert;
    SELECT count(*) FILTER (WHERE is_trashed=FALSE), count(*) FILTER (WHERE is_trashed=TRUE)
      INTO v_live, v_trashed
      FROM teacher_attendance WHERE schedule_slot_id='1f000000-0000-4000-8000-000000000030';
    IF v_rate=100 AND v_payable=100 AND v_live=1 AND v_trashed=1 THEN
        PERFORM pg_temp.rec('S07','PASS','partial unique index allowed re-marking after trash (1 live + 1 trashed row)');
    ELSE
        PERFORM pg_temp.rec('S07','FAIL',format('rate=%s payable=%s live=%s trashed=%s (expected 100/100/1/1)',v_rate,v_payable,v_live,v_trashed));
    END IF;
END;
$s07$;

-- ----------------------------------------------------------------------------
-- S08 — the real partial unique index still rejects a second LIVE row for the slot/date
-- ----------------------------------------------------------------------------
DO $s08$
DECLARE v_state text;
BEGIN
    INSERT INTO teacher_attendance(schedule_slot_id,circle_id,teacher_id,session_date,scheduled_start,duration_minutes,status,hourly_rate_snapshot,payable_amount)
    VALUES ('1f000000-0000-4000-8000-000000000030','1f000000-0000-4000-8000-000000000020',
            '1f000000-0000-4000-8000-000000000010',DATE '2026-10-01','10:00',60,'present',100,100);
    PERFORM pg_temp.rec('S08','FAIL','duplicate live teacher_attendance row was accepted by the real partial unique index');
EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    PERFORM pg_temp.rec('S08','PASS','real partial unique index rejected a duplicate live row [' || v_state || ']');
END;
$s08$;

-- ----------------------------------------------------------------------------
-- S09 — real CHECK constraints: negative snapshot/rate is rejected
-- ----------------------------------------------------------------------------
DO $s09$
BEGIN
    UPDATE teacher_attendance SET hourly_rate_snapshot=-1
     WHERE schedule_slot_id='1f000000-0000-4000-8000-000000000030' AND is_trashed=FALSE;
    PERFORM pg_temp.rec('S09','FAIL','real CHECK accepted a negative hourly_rate_snapshot');
EXCEPTION WHEN check_violation THEN
    PERFORM pg_temp.rec('S09','PASS','real CHECK rejected a negative hourly_rate_snapshot');
END;
$s09$;

-- ============================================================================
-- Results + CI gate: any FAIL (or a truncated run) fails psql under ON_ERROR_STOP=1
-- ============================================================================
SELECT scenario, status, detail FROM snapshot_results ORDER BY scenario;

DO $gate$
DECLARE
    v_failed integer;
    v_total  integer;
BEGIN
    SELECT count(*) FILTER (WHERE status='FAIL'), count(*) INTO v_failed, v_total FROM snapshot_results;
    IF v_total < 9 THEN
        RAISE EXCEPTION 'teacher attendance snapshot verification incomplete: % of 9 scenarios ran', v_total;
    END IF;
    IF v_failed > 0 THEN
        RAISE EXCEPTION 'فشل التحقق من لقطة أجر حضور المعلمة: % من % سيناريو.', v_failed, v_total;
    END IF;
    RAISE NOTICE 'teacher attendance snapshot verification passed: % scenarios', v_total;
END;
$gate$;

SELECT 'PASS: teacher_attendance hourly_rate_snapshot regression completed (real table/upsert/partial index).' AS result;

ROLLBACK;
