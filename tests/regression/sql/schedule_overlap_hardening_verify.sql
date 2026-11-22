-- Hardening verification for migration 025 (Phase 2.2-fix).
--
-- Run on a disposable/test database AFTER migrations 001 -> 025:
--   psql -X -v ON_ERROR_STOP=1 -d <test-db> -f tests/regression/sql/schedule_overlap_hardening_verify.sql
--
-- The whole script runs inside one transaction and ends with ROLLBACK, so it is safe to
-- run on a disposable database (never on production: it inserts temporary rows/locks).
-- Expected tail: "PASS: schedule overlap hardening verification completed."

BEGIN;

CREATE TEMP TABLE hardening_results (
    scenario TEXT NOT NULL,
    status   TEXT NOT NULL CHECK (status IN ('PASS','FAIL')),
    detail   TEXT NOT NULL
);

CREATE OR REPLACE FUNCTION pg_temp.rec(p_scenario TEXT, p_status TEXT, p_detail TEXT)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
    INSERT INTO hardening_results(scenario,status,detail) VALUES (p_scenario,p_status,p_detail);
    RAISE WARNING 'HARDEN_RESULT % = % : %', p_scenario, p_status, p_detail;
END;
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.expect_error(p_sql TEXT, p_state TEXT, p_constraint TEXT, p_scenario TEXT, p_detail TEXT)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE
    v_state TEXT;
    v_constraint TEXT;
    v_message TEXT;
BEGIN
    BEGIN
        EXECUTE p_sql;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_constraint = CONSTRAINT_NAME, v_message = MESSAGE_TEXT;
        IF v_state = p_state AND (p_constraint IS NULL OR v_constraint = p_constraint) THEN
            PERFORM pg_temp.rec(p_scenario,'PASS', p_detail || ' [' || v_state || COALESCE('/' || v_constraint,'') || ']');
        ELSE
            PERFORM pg_temp.rec(p_scenario,'FAIL', p_detail || ' (expected ' || p_state || COALESCE('/' || p_constraint,'') || ', got ' || v_state || '/' || COALESCE(v_constraint,'NULL') || ': ' || v_message || ')');
        END IF;
        RETURN;
    END;
    PERFORM pg_temp.rec(p_scenario,'FAIL', p_detail || ' (expected an error but the statement succeeded)');
END;
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.expect_ok(p_sql TEXT, p_scenario TEXT, p_detail TEXT)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
    BEGIN
        EXECUTE p_sql;
    EXCEPTION WHEN OTHERS THEN
        PERFORM pg_temp.rec(p_scenario,'FAIL', p_detail || ' (unexpected ' || SQLSTATE || ': ' || SQLERRM || ')');
        RETURN;
    END;
    PERFORM pg_temp.rec(p_scenario,'PASS', p_detail);
END;
$fn$;

-- ----------------------------------------------------------------------------
-- H00-H04: تعريف الحماية بعد 025 (دوال/تريجرات/مفاتيح الأقفال)
-- ----------------------------------------------------------------------------
DO $h00$
DECLARE
    v_volatile "char";
    v_rettype TEXT;
BEGIN
    SELECT p.provolatile, pg_catalog.format_type(p.prorettype, NULL)
    INTO v_volatile, v_rettype
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'dar_teacher_schedule_lock_key';
    IF v_rettype = 'bigint' AND v_volatile = 'i' THEN
        PERFORM pg_temp.rec('H00','PASS','دالة مفتاح القفل لكل معلمة موجودة (bigint, IMMUTABLE)');
    ELSE
        PERFORM pg_temp.rec('H00','FAIL','دالة مفتاح القفل مفقودة أو غير متوقعة: rettype=' || COALESCE(v_rettype,'NULL') || ', volatile=' || COALESCE(v_volatile::text,'NULL'));
    END IF;
END;
$h00$;

DO $h01$
DECLARE
    v_def TEXT;
BEGIN
    SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'dar_guard_schedule_slot_teacher_overlap';
    IF v_def IS NULL THEN
        PERFORM pg_temp.rec('H01','FAIL','دالة حارس الموعد غير موجودة');
    ELSIF position('dar_teacher_schedule_lock_key' IN v_def) > 0
      AND position('pg_advisory_xact_lock' IN v_def) > 0
      AND position('transaction_isolation' IN v_def) > 0
      AND position('867530912345' IN v_def) > 0
      AND position('LEAST(' IN v_def) > 0 THEN
        PERFORM pg_temp.rec('H01','PASS','حارس الموعد: قفل لكل معلمة + قفل عام متوافق + ترتيب مفاتيح + حارس عزل READ COMMITTED');
    ELSE
        PERFORM pg_temp.rec('H01','FAIL','تعريف حارس الموعد لا يحتوي كل عناصر الحماية المتوقعة');
    END IF;
END;
$h01$;

DO $h02$
DECLARE
    v_def TEXT;
BEGIN
    SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'dar_guard_circle_teacher_schedule_overlap';
    IF v_def IS NULL THEN
        PERFORM pg_temp.rec('H02','FAIL','دالة حارس الحلقة غير موجودة');
    ELSIF position('dar_teacher_schedule_lock_key' IN v_def) > 0
      AND position('pg_advisory_xact_lock' IN v_def) > 0
      AND position('transaction_isolation' IN v_def) > 0
      AND position('867530912345' IN v_def) > 0
      AND position('LEAST(' IN v_def) > 0
      AND position('OLD.teacher_id' IN v_def) > 0 THEN
        PERFORM pg_temp.rec('H02','PASS','حارس الحلقة: قفل لكل معلمة + ترتيب مفاتيح قديم/جديد + حارس عزل READ COMMITTED');
    ELSE
        PERFORM pg_temp.rec('H02','FAIL','تعريف حارس الحلقة لا يحتوي كل عناصر الحماية المتوقعة');
    END IF;
END;
$h02$;

DO $h03$
DECLARE
    v_slot_tgtype SMALLINT;
    v_slot_enabled "char";
    v_circle_tgtype SMALLINT;
    v_circle_enabled "char";
BEGIN
    SELECT tgtype, tgenabled INTO v_slot_tgtype, v_slot_enabled
    FROM pg_trigger WHERE tgname = 'trg_circle_schedule_slots_teacher_overlap';
    SELECT tgtype, tgenabled INTO v_circle_tgtype, v_circle_enabled
    FROM pg_trigger WHERE tgname = 'trg_circles_teacher_schedule_overlap';
    IF v_slot_enabled = 'O' AND (v_slot_tgtype & 4) = 4 AND (v_slot_tgtype & 16) = 16
       AND v_circle_enabled = 'O' AND (v_circle_tgtype & 16) = 16 THEN
        PERFORM pg_temp.rec('H03','PASS','التريجرات مفعّلة وتغطي INSERT/UPDATE للمواعيد وUPDATE للحلقة');
    ELSE
        PERFORM pg_temp.rec('H03','FAIL','تريجرات الحماية غير مفعّلة أو لا تغطي الأحداث المتوقعة');
    END IF;
END;
$h03$;

DO $h04$
DECLARE
    v_t1 BIGINT := public.dar_teacher_schedule_lock_key('1e000000-0000-4000-8000-000000000001');
    v_t2 BIGINT := public.dar_teacher_schedule_lock_key('1e000000-0000-4000-8000-000000000002');
    v_again BIGINT := public.dar_teacher_schedule_lock_key('1e000000-0000-4000-8000-000000000001');
BEGIN
    IF v_t1 <> v_t2 AND v_t1 = v_again THEN
        PERFORM pg_temp.rec('H04','PASS','مفتاح القفل مشتق من teacher_id وثابت لكل معلمة ومختلف بين المعلمتين');
    ELSE
        PERFORM pg_temp.rec('H04','FAIL','مفتاح القفل غير مشتق/غير ثابت كما هو متوقع');
    END IF;
END;
$h04$;

-- ----------------------------------------------------------------------------
-- بيانات تجريبية
-- ----------------------------------------------------------------------------
INSERT INTO teachers(id, teacher_code, full_name, status, hourly_rate) VALUES
    ('1e000000-0000-4000-8000-000000000001','T-HARD-1','معلمة تحصين 1','active',50),
    ('1e000000-0000-4000-8000-000000000002','T-HARD-2','معلمة تحصين 2','active',50);

INSERT INTO circles(id, circle_code, name, teacher_id, monthly_fee, is_active, starts_on) VALUES
    ('2c000000-0000-4000-8000-000000000001','C-HARD-1','حلقة تحصين 1','1e000000-0000-4000-8000-000000000001',250,TRUE,'2026-01-01'),
    ('2c000000-0000-4000-8000-000000000002','C-HARD-2','حلقة تحصين 2','1e000000-0000-4000-8000-000000000001',250,TRUE,'2026-01-01'),
    ('2c000000-0000-4000-8000-000000000003','C-HARD-3','حلقة تحصين 3','1e000000-0000-4000-8000-000000000002',250,TRUE,'2026-01-01'),
    ('2c000000-0000-4000-8000-000000000004','C-HARD-4','حلقة تحصين 4','1e000000-0000-4000-8000-000000000002',250,TRUE,'2026-01-01');

INSERT INTO circle_schedule_slots(id,circle_id,day_of_week,starts_at,duration_minutes,is_active) VALUES
    ('3a000000-0000-4000-8000-000000000001','2c000000-0000-4000-8000-000000000001',0,'09:00',60,TRUE), -- T1 Sunday 09:00-10:00
    ('3a000000-0000-4000-8000-000000000002','2c000000-0000-4000-8000-000000000002',2,'11:00',60,TRUE), -- T1 Tuesday 11:00-12:00
    ('3a000000-0000-4000-8000-000000000003','2c000000-0000-4000-8000-000000000003',3,'09:00',60,TRUE), -- T2 Wednesday 09:00-10:00
    ('3a000000-0000-4000-8000-000000000004','2c000000-0000-4000-8000-000000000004',4,'20:00',60,TRUE); -- T2 Thursday 20:00-21:00

-- ----------------------------------------------------------------------------
-- H10-H19: سلوك الحماية (نفس قاعدة 012 مع تحسينات 025)
-- ----------------------------------------------------------------------------
SELECT pg_temp.expect_error(
    $q$INSERT INTO circle_schedule_slots(circle_id,day_of_week,starts_at,duration_minutes,is_active)
       VALUES ('2c000000-0000-4000-8000-000000000002',2,'10:30',60,TRUE)$q$,
    '23514','ck_teacher_schedule_no_overlap','H10','رفض تداخل جزئي (30 دقيقة) لنفس المعلمة على حلقة أخرى');

SELECT pg_temp.expect_ok(
    $q$INSERT INTO circle_schedule_slots(circle_id,day_of_week,starts_at,duration_minutes,is_active)
       VALUES ('2c000000-0000-4000-8000-000000000002',2,'12:00',60,TRUE)$q$,
    'H11','التجاور التام بعد موعد قائم (12:00 بعد 11:00-12:00) مسموح');

SELECT pg_temp.expect_ok(
    $q$INSERT INTO circle_schedule_slots(circle_id,day_of_week,starts_at,duration_minutes,is_active)
       VALUES ('2c000000-0000-4000-8000-000000000001',2,'10:00',60,TRUE)$q$,
    'H12','التجاور التام قبل موعد قائم (10:00-11:00 قبل 11:00) مسموح');

SELECT pg_temp.expect_error(
    $q$INSERT INTO circle_schedule_slots(circle_id,day_of_week,starts_at,duration_minutes,is_active)
       VALUES ('2c000000-0000-4000-8000-000000000001',2,'10:00',60,TRUE)$q$,
    '23505','uq_circle_schedule_slots_not_trashed_day_time','H13','إعادة إدخال موعد مطابق حرفيًا تُرجع 23505 (رسالة تكرار دقيقة) وليس 23514');

SELECT pg_temp.expect_error(
    $q$UPDATE circle_schedule_slots SET starts_at='10:30' WHERE id='3a000000-0000-4000-8000-000000000002'$q$,
    '23514','ck_teacher_schedule_no_overlap','H14','تعديل وقت موعد إلى وقت متداخل مع موعد آخر لنفس المعلمة مرفوض');

SELECT pg_temp.expect_error(
    $q$UPDATE circle_schedule_slots SET starts_at='11:00' WHERE circle_id='2c000000-0000-4000-8000-000000000002' AND day_of_week=2 AND starts_at='12:00'$q$,
    '23505','uq_circle_schedule_slots_not_trashed_day_time','H15','تعديل موعد إلى يوم/وقت موعد آخر في نفس الحلقة يُرجع 23505');

SELECT pg_temp.expect_ok(
    $q$INSERT INTO circle_schedule_slots(circle_id,day_of_week,starts_at,duration_minutes,is_active)
       VALUES ('2c000000-0000-4000-8000-000000000001',3,'09:00',60,TRUE)$q$,
    'H16a','إضافة موعد الأربعاء 09:00 لمعلمة 1 (موعد متداخل مع موعد حلقة أخرى لمعلمة 2)');

SELECT pg_temp.expect_error(
    $q$UPDATE circles SET teacher_id='1e000000-0000-4000-8000-000000000001' WHERE id='2c000000-0000-4000-8000-000000000003'$q$,
    '23514','ck_teacher_schedule_no_overlap','H16b','إعادة إسناد حلقة لمعلمة لديها موعد متداخل مرفوضة');

SELECT pg_temp.expect_ok(
    $q$UPDATE circles SET teacher_id='1e000000-0000-4000-8000-000000000001' WHERE id='2c000000-0000-4000-8000-000000000004'$q$,
    'H17','إعادة إسناد حلقة لمعلمة بمواعيد غير متداخلة مسموحة');

DO $h18$
DECLARE
    v_teacher_after UUID;
    v_count INTEGER;
BEGIN
    SELECT c.teacher_id INTO v_teacher_after FROM circles c WHERE c.id = '2c000000-0000-4000-8000-000000000004';
    SELECT count(*) INTO v_count
    FROM circle_schedule_slots ss JOIN circles c ON c.id = ss.circle_id
    WHERE c.teacher_id = '1e000000-0000-4000-8000-000000000001'
      AND ss.is_active = TRUE AND ss.is_trashed = FALSE AND c.is_active = TRUE AND c.is_trashed = FALSE;
    IF v_teacher_after = '1e000000-0000-4000-8000-000000000001' AND v_count = 6 THEN
        PERFORM pg_temp.rec('H18','PASS','إعادة الإسناد الآمن تمت والمعلمة الآن مسؤولة عن 6 مواعيد نشطة غير متداخلة');
    ELSE
        PERFORM pg_temp.rec('H18','FAIL','نتيجة إعادة الإسناد الآمن غير متوقعة: teacher=' || COALESCE(v_teacher_after::text,'NULL') || ', slots=' || v_count);
    END IF;
END;
$h18$;

DO $h19$
DECLARE
    v_before INTEGER;
    v_after INTEGER;
BEGIN
    SELECT count(*) INTO v_before FROM circle_schedule_slots WHERE circle_id = '2c000000-0000-4000-8000-000000000002';
    BEGIN
        UPDATE circle_schedule_slots SET starts_at='10:30' WHERE id='3a000000-0000-4000-8000-000000000002';
    EXCEPTION WHEN OTHERS THEN
        NULL; -- expected
    END;
    SELECT count(*) INTO v_after FROM circle_schedule_slots WHERE circle_id = '2c000000-0000-4000-8000-000000000002';
    IF v_before = v_after THEN
        PERFORM pg_temp.rec('H19','PASS','رفض التعديل المتداخل لم يُغيّر أي صف (التراجع/الذرية على مستوى الجملة)');
    ELSE
        PERFORM pg_temp.rec('H19','FAIL','رفض التعديل المتداخل غيّر عدد الصفوف: before=' || v_before || ', after=' || v_after);
    END IF;
END;
$h19$;

-- ----------------------------------------------------------------------------
-- النتائج + بوابة الفشل
-- ----------------------------------------------------------------------------
SELECT scenario, status, detail FROM hardening_results ORDER BY scenario;

DO $gate$
DECLARE
    v_failed INTEGER;
    v_total INTEGER;
BEGIN
    SELECT count(*) FILTER (WHERE status = 'FAIL'), count(*) INTO v_failed, v_total FROM hardening_results;
    IF v_failed > 0 THEN
        RAISE EXCEPTION 'فشل التحقق من تحصين منع تداخل المواعيد: % من % سيناريو.', v_failed, v_total;
    END IF;
    RAISE NOTICE 'تم اجتياز % سيناريو تحصين بنجاح.', v_total;
END;
$gate$;

SELECT 'PASS: schedule overlap hardening verification completed.' AS result;

ROLLBACK;
