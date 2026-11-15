-- Regression test for teacher_attendance hourly_rate_snapshot preservation.
-- Safe scope: TEMP table only. Run with psql against any PostgreSQL database; no permanent objects are created.
\set ON_ERROR_STOP on

CREATE TEMP TABLE teacher_attendance_snapshot_test (
    id UUID PRIMARY KEY,
    schedule_slot_id UUID NOT NULL,
    session_date DATE NOT NULL,
    teacher_id UUID NOT NULL,
    duration_minutes INTEGER NOT NULL,
    status TEXT NOT NULL,
    hourly_rate_snapshot NUMERIC(12,2) NOT NULL,
    payable_amount NUMERIC(12,2) NOT NULL,
    UNIQUE(schedule_slot_id, session_date)
);

\echo 'Test 1: initial attendance uses the current hourly rate (100)'
INSERT INTO teacher_attendance_snapshot_test(id,schedule_slot_id,session_date,teacher_id,duration_minutes,status,hourly_rate_snapshot,payable_amount)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','2026-10-01','11111111-1111-1111-1111-111111111111',60,'present',100,100);

\echo 'Test 2: re-saving same teacher after hourly rate becomes 150 must preserve historical snapshot 100'
INSERT INTO teacher_attendance_snapshot_test(id,schedule_slot_id,session_date,teacher_id,duration_minutes,status,hourly_rate_snapshot,payable_amount)
VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','2026-10-01','11111111-1111-1111-1111-111111111111',60,'present',150,150)
ON CONFLICT(schedule_slot_id,session_date) DO UPDATE SET
    teacher_id=EXCLUDED.teacher_id,
    hourly_rate_snapshot=CASE WHEN teacher_attendance_snapshot_test.teacher_id IS DISTINCT FROM EXCLUDED.teacher_id THEN EXCLUDED.hourly_rate_snapshot ELSE teacher_attendance_snapshot_test.hourly_rate_snapshot END,
    duration_minutes=EXCLUDED.duration_minutes,
    status=EXCLUDED.status,
    payable_amount=CASE WHEN EXCLUDED.status='present' THEN EXCLUDED.duration_minutes * CASE WHEN teacher_attendance_snapshot_test.teacher_id IS DISTINCT FROM EXCLUDED.teacher_id THEN EXCLUDED.hourly_rate_snapshot ELSE teacher_attendance_snapshot_test.hourly_rate_snapshot END / 60.0 ELSE 0 END;
DO $$ BEGIN
  IF (SELECT hourly_rate_snapshot FROM teacher_attendance_snapshot_test) <> 100 OR
     (SELECT payable_amount FROM teacher_attendance_snapshot_test) <> 100 THEN
    RAISE EXCEPTION 'FAIL: same-teacher re-save changed the historical rate/payable';
  END IF;
END $$;

\echo 'Test 3: duration correction uses the preserved historical snapshot'
INSERT INTO teacher_attendance_snapshot_test(id,schedule_slot_id,session_date,teacher_id,duration_minutes,status,hourly_rate_snapshot,payable_amount)
VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','2026-10-01','11111111-1111-1111-1111-111111111111',90,'present',150,225)
ON CONFLICT(schedule_slot_id,session_date) DO UPDATE SET
    teacher_id=EXCLUDED.teacher_id,
    hourly_rate_snapshot=CASE WHEN teacher_attendance_snapshot_test.teacher_id IS DISTINCT FROM EXCLUDED.teacher_id THEN EXCLUDED.hourly_rate_snapshot ELSE teacher_attendance_snapshot_test.hourly_rate_snapshot END,
    duration_minutes=EXCLUDED.duration_minutes,
    status=EXCLUDED.status,
    payable_amount=CASE WHEN EXCLUDED.status='present' THEN EXCLUDED.duration_minutes * CASE WHEN teacher_attendance_snapshot_test.teacher_id IS DISTINCT FROM EXCLUDED.teacher_id THEN EXCLUDED.hourly_rate_snapshot ELSE teacher_attendance_snapshot_test.hourly_rate_snapshot END / 60.0 ELSE 0 END;
DO $$ BEGIN
  IF (SELECT hourly_rate_snapshot FROM teacher_attendance_snapshot_test) <> 100 OR
     (SELECT payable_amount FROM teacher_attendance_snapshot_test) <> 150 THEN
    RAISE EXCEPTION 'FAIL: duration correction did not use historical rate';
  END IF;
END $$;

\echo 'Test 4: replacing the teacher updates snapshot to the substitute current rate (200)'
INSERT INTO teacher_attendance_snapshot_test(id,schedule_slot_id,session_date,teacher_id,duration_minutes,status,hourly_rate_snapshot,payable_amount)
VALUES ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','2026-10-01','22222222-2222-2222-2222-222222222222',60,'present',200,200)
ON CONFLICT(schedule_slot_id,session_date) DO UPDATE SET
    teacher_id=EXCLUDED.teacher_id,
    hourly_rate_snapshot=CASE WHEN teacher_attendance_snapshot_test.teacher_id IS DISTINCT FROM EXCLUDED.teacher_id THEN EXCLUDED.hourly_rate_snapshot ELSE teacher_attendance_snapshot_test.hourly_rate_snapshot END,
    duration_minutes=EXCLUDED.duration_minutes,
    status=EXCLUDED.status,
    payable_amount=CASE WHEN EXCLUDED.status='present' THEN EXCLUDED.duration_minutes * CASE WHEN teacher_attendance_snapshot_test.teacher_id IS DISTINCT FROM EXCLUDED.teacher_id THEN EXCLUDED.hourly_rate_snapshot ELSE teacher_attendance_snapshot_test.hourly_rate_snapshot END / 60.0 ELSE 0 END;
DO $$ BEGIN
  IF (SELECT hourly_rate_snapshot FROM teacher_attendance_snapshot_test) <> 200 OR
     (SELECT payable_amount FROM teacher_attendance_snapshot_test) <> 200 THEN
    RAISE EXCEPTION 'FAIL: substitute did not receive its own rate snapshot';
  END IF;
END $$;

\echo 'Test 5: absent status sets payable to zero but retains the substitute snapshot'
INSERT INTO teacher_attendance_snapshot_test(id,schedule_slot_id,session_date,teacher_id,duration_minutes,status,hourly_rate_snapshot,payable_amount)
VALUES ('ffffffff-ffff-ffff-ffff-ffffffffffff','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','2026-10-01','22222222-2222-2222-2222-222222222222',60,'absent',250,0)
ON CONFLICT(schedule_slot_id,session_date) DO UPDATE SET
    teacher_id=EXCLUDED.teacher_id,
    hourly_rate_snapshot=CASE WHEN teacher_attendance_snapshot_test.teacher_id IS DISTINCT FROM EXCLUDED.teacher_id THEN EXCLUDED.hourly_rate_snapshot ELSE teacher_attendance_snapshot_test.hourly_rate_snapshot END,
    duration_minutes=EXCLUDED.duration_minutes,
    status=EXCLUDED.status,
    payable_amount=CASE WHEN EXCLUDED.status='present' THEN EXCLUDED.duration_minutes * CASE WHEN teacher_attendance_snapshot_test.teacher_id IS DISTINCT FROM EXCLUDED.teacher_id THEN EXCLUDED.hourly_rate_snapshot ELSE teacher_attendance_snapshot_test.hourly_rate_snapshot END / 60.0 ELSE 0 END;
DO $$ BEGIN
  IF (SELECT hourly_rate_snapshot FROM teacher_attendance_snapshot_test) <> 200 OR
     (SELECT payable_amount FROM teacher_attendance_snapshot_test) <> 0 THEN
    RAISE EXCEPTION 'FAIL: absent status must be zero and retain the rate snapshot';
  END IF;
END $$;


\echo 'Test 6: returning the substitute to present keeps the substitute snapshot (200), not a later rate (250)'
INSERT INTO teacher_attendance_snapshot_test(id,schedule_slot_id,session_date,teacher_id,duration_minutes,status,hourly_rate_snapshot,payable_amount)
VALUES ('99999999-9999-9999-9999-999999999999','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','2026-10-01','22222222-2222-2222-2222-222222222222',60,'present',250,250)
ON CONFLICT(schedule_slot_id,session_date) DO UPDATE SET
    teacher_id=EXCLUDED.teacher_id,
    hourly_rate_snapshot=CASE WHEN teacher_attendance_snapshot_test.teacher_id IS DISTINCT FROM EXCLUDED.teacher_id THEN EXCLUDED.hourly_rate_snapshot ELSE teacher_attendance_snapshot_test.hourly_rate_snapshot END,
    duration_minutes=EXCLUDED.duration_minutes,
    status=EXCLUDED.status,
    payable_amount=CASE WHEN EXCLUDED.status='present' THEN EXCLUDED.duration_minutes * CASE WHEN teacher_attendance_snapshot_test.teacher_id IS DISTINCT FROM EXCLUDED.teacher_id THEN EXCLUDED.hourly_rate_snapshot ELSE teacher_attendance_snapshot_test.hourly_rate_snapshot END / 60.0 ELSE 0 END;
DO $$ BEGIN
  IF (SELECT hourly_rate_snapshot FROM teacher_attendance_snapshot_test) <> 200 OR
     (SELECT payable_amount FROM teacher_attendance_snapshot_test) <> 200 THEN
    RAISE EXCEPTION 'FAIL: restoring presence changed the substitute historical rate';
  END IF;
END $$;

\echo 'PASS: all teacher attendance snapshot regression checks passed.'
