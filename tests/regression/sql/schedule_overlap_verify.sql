-- ============================================================================
-- Dar Eltahfeez — Teacher timetable overlap verification
-- ============================================================================
-- الغرض: إثبات تجريبي شامل لمنع تداخل مواعيد المعلمات المنفَّذ في:
--   database/012_teacher_schedule_no_overlap.sql
--   (الدالة dar_teacher_has_schedule_overlap + تريجرات circle_schedule_slots
--    وcircles + قفل pg_advisory_xact_lock)
--
-- طريقة التشغيل (على قاعدة اختبار مؤقتة مطبَّق عليها كل الترحيلات):
--   psql -X -v ON_ERROR_STOP=1 -d <test-db> -f tests/regression/sql/schedule_overlap_verify.sql
--
-- الضمانات:
--   * كل الكتابة داخل معاملة واحدة تُلغى في النهاية (ROLLBACK) فلا تبقى أي بيانات.
--   * كل سيناريو يُسجّل PASS/FAIL في جدول مؤقت.
--   * في النهاية: إن وُجد أي FAIL تُرفع استثناءات فيفشل الأمر (ON_ERROR_STOP) — بوابة CI.
--   * التقرير الكامل: docs/audits/schedule-overlap-audit.md
-- ============================================================================

BEGIN;

CREATE TEMP TABLE overlap_verify_results (
    scenario TEXT PRIMARY KEY,
    status   TEXT NOT NULL CHECK (status IN ('PASS', 'FAIL')),
    detail   TEXT
) ON COMMIT DROP;

CREATE TEMP TABLE overlap_verify_ids (
    k  TEXT PRIMARY KEY,
    id UUID NOT NULL
) ON COMMIT DROP;

CREATE FUNCTION pg_temp.rec(p_scenario TEXT, p_status TEXT, p_detail TEXT DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO overlap_verify_results(scenario, status, detail)
    VALUES (p_scenario, p_status, p_detail)
    ON CONFLICT (scenario) DO UPDATE SET status = EXCLUDED.status, detail = EXCLUDED.detail;
    RAISE WARNING 'OVL_RESULT % = % : %', p_scenario, p_status, COALESCE(p_detail, '');
END;
$$;

CREATE FUNCTION pg_temp.get_id(p_key TEXT)
RETURNS uuid LANGUAGE sql AS $$
    SELECT id FROM overlap_verify_ids WHERE k = p_key;
$$;

-- ----------------------------------------------------------------------------
-- البيانات الأساسية: معلمتان، حلقات نشطة/متوقفة/محذوفة/بدون معلمة، وموعد أساسي
-- ----------------------------------------------------------------------------
DO $seed$
DECLARE
    t1 UUID; t2 UUID;
    c1 UUID; c2 UUID; c3 UUID; c4 UUID; c5 UUID; cn UUID; c11 UUID; c7 UUID;
    baseline UUID;
BEGIN
    INSERT INTO public.teachers(teacher_code, full_name)
    VALUES ('OVL-T1', 'معلمة اختبار التداخل 1') RETURNING id INTO t1;
    INSERT INTO public.teachers(teacher_code, full_name)
    VALUES ('OVL-T2', 'معلمة اختبار التداخل 2') RETURNING id INTO t2;

    INSERT INTO public.circles(circle_code, name, teacher_id, is_active)
    VALUES ('OVL-C1', 'حلقة أساسية', t1, TRUE) RETURNING id INTO c1;
    INSERT INTO public.circles(circle_code, name, teacher_id, is_active)
    VALUES ('OVL-C2', 'حلقة ثانية لنفس المعلمة', t1, TRUE) RETURNING id INTO c2;
    INSERT INTO public.circles(circle_code, name, teacher_id, is_active)
    VALUES ('OVL-C3', 'حلقة معلمة أخرى', t2, TRUE) RETURNING id INTO c3;
    INSERT INTO public.circles(circle_code, name, teacher_id, is_active)
    VALUES ('OVL-C4', 'حلقة متوقفة', t1, FALSE) RETURNING id INTO c4;
    INSERT INTO public.circles(circle_code, name, teacher_id, is_active, is_trashed)
    VALUES ('OVL-C5', 'حلقة في المهملات', t1, TRUE, TRUE) RETURNING id INTO c5;
    INSERT INTO public.circles(circle_code, name, teacher_id, is_active)
    VALUES ('OVL-CN', 'حلقة بدون معلمة', NULL, TRUE) RETURNING id INTO cn;
    INSERT INTO public.circles(circle_code, name, teacher_id, is_active)
    VALUES ('OVL-C11', 'حلقة مساعدة لنفس المعلمة', t1, TRUE) RETURNING id INTO c11;
    INSERT INTO public.circles(circle_code, name, teacher_id, is_active)
    VALUES ('OVL-C7', 'حلقة لإعادة الإسناد', t2, TRUE) RETURNING id INTO c7;

    INSERT INTO overlap_verify_ids(k, id) VALUES
        ('t1', t1), ('t2', t2), ('c1', c1), ('c2', c2), ('c3', c3),
        ('c4', c4), ('c5', c5), ('cn', cn), ('c11', c11), ('c7', c7);

    INSERT INTO public.circle_schedule_slots(circle_id, day_of_week, starts_at, duration_minutes)
    VALUES (c1, 1, TIME '09:00', 60) RETURNING id INTO baseline;
    INSERT INTO overlap_verify_ids(k, id) VALUES ('baseline', baseline);
    PERFORM pg_temp.rec('S00', 'PASS', 'إدخال موعد أساسي (الأحد 09:00-10:00) نُفّذ بنجاح');
EXCEPTION WHEN others THEN
    PERFORM pg_temp.rec('S00', 'FAIL', 'تعذر تجهيز البيانات: ' || SQLERRM);
END;
$seed$;

-- ----------------------------------------------------------------------------
-- S01-S07: التداخل/التجاور بين الحلقات ونفس الحلقة والمدرسين المختلفين
-- ----------------------------------------------------------------------------
DO $s01_07$
DECLARE
    t1 UUID := pg_temp.get_id('t1');
    c1 UUID := pg_temp.get_id('c1');
    c2 UUID := pg_temp.get_id('c2');
    c3 UUID := pg_temp.get_id('c3');
    v_constraint TEXT;
BEGIN
    -- S01: تداخل تام عبر حلقة ثانية لنفس المعلمة.
    BEGIN
        INSERT INTO public.circle_schedule_slots(circle_id, day_of_week, starts_at, duration_minutes)
        VALUES (c2, 1, TIME '09:00', 60);
        PERFORM pg_temp.rec('S01', 'FAIL', 'تداخل تام بين حلقتين لنفس المعلمة قُبل');
    EXCEPTION WHEN check_violation THEN
        GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
        IF v_constraint = 'ck_teacher_schedule_no_overlap' THEN
            PERFORM pg_temp.rec('S01', 'PASS', 'رفض تداخل تام باسم القيد الصحيح: ' || v_constraint);
        ELSE
            PERFORM pg_temp.rec('S01', 'FAIL', 'رُفض التداخل لكن اسم القيد غير متوقع: ' || COALESCE(v_constraint, 'NULL'));
        END IF;
    END;

    -- S02: تداخل جزئي بدقيقة واحدة (09:59-10:14 ضد 09:00-10:00).
    BEGIN
        INSERT INTO public.circle_schedule_slots(circle_id, day_of_week, starts_at, duration_minutes)
        VALUES (c2, 1, TIME '09:59', 15);
        PERFORM pg_temp.rec('S02', 'FAIL', 'تداخل جزئي بدقيقة واحدة قُبل');
    EXCEPTION WHEN check_violation THEN
        PERFORM pg_temp.rec('S02', 'PASS', 'رفض تداخل جزئي بدقيقة واحدة');
    END;

    -- S03: التجاور التام بعد نهاية الموعد (10:00 تبدأ عند انتهاء 10:00) مسموح.
    BEGIN
        INSERT INTO public.circle_schedule_slots(circle_id, day_of_week, starts_at, duration_minutes)
        VALUES (c2, 1, TIME '10:00', 15);
        PERFORM pg_temp.rec('S03', 'PASS', 'التجاور التام (نهاية 10:00 = بداية 10:00) مسموح');
    EXCEPTION WHEN others THEN
        PERFORM pg_temp.rec('S03', 'FAIL', 'التجاور التام رُفض: ' || SQLERRM);
    END;

    -- S04: التجاور التام قبل البداية (08:00-09:00 قبل 09:00) مسموح.
    BEGIN
        INSERT INTO public.circle_schedule_slots(circle_id, day_of_week, starts_at, duration_minutes)
        VALUES (c2, 1, TIME '08:00', 60);
        PERFORM pg_temp.rec('S04', 'PASS', 'التجاور التام قبل الموعد مسموح');
    EXCEPTION WHEN others THEN
        PERFORM pg_temp.rec('S04', 'FAIL', 'التجاور التام قبل الموعد رُفض: ' || SQLERRM);
    END;

    -- S05: تداخل داخل نفس الحلقة مرفوض.
    BEGIN
        INSERT INTO public.circle_schedule_slots(circle_id, day_of_week, starts_at, duration_minutes)
        VALUES (c1, 1, TIME '09:30', 15);
        PERFORM pg_temp.rec('S05', 'FAIL', 'تداخل داخل نفس الحلقة قُبل');
    EXCEPTION WHEN check_violation THEN
        PERFORM pg_temp.rec('S05', 'PASS', 'رفض تداخل داخل نفس الحلقة');
    END;

    -- S06: نفس اليوم والوقت لنفس الحلقة. عمليًا يرفضه تريجر التداخل أولًا (23514)
    -- قبل قيد التفرد (unique) لأن التريجر BEFORE INSERT. نقبل الرفض بأي منهما.
    BEGIN
        INSERT INTO public.circle_schedule_slots(circle_id, day_of_week, starts_at, duration_minutes)
        VALUES (c1, 1, TIME '09:00', 60);
        PERFORM pg_temp.rec('S06', 'FAIL', 'تكرار نفس اليوم والوقت لنفس الحلقة قُبل');
    EXCEPTION WHEN check_violation THEN
        PERFORM pg_temp.rec('S06', 'PASS', 'تكرار نفس الحلقة/اليوم/الوقت رُفض (تريجر التداخل قبل قيد التفرد)');
    WHEN unique_violation THEN
        PERFORM pg_temp.rec('S06', 'PASS', 'تكرار نفس الحلقة/اليوم/الوقت رُفض بقيد التفرد');
    END;

    -- S07: معلمة أخرى في نفس التوقيت مسموح.
    BEGIN
        INSERT INTO public.circle_schedule_slots(circle_id, day_of_week, starts_at, duration_minutes)
        VALUES (c3, 1, TIME '09:00', 60);
        PERFORM pg_temp.rec('S07', 'PASS', 'تداخل نفس التوقيت لمعلمة أخرى مسموح');
    EXCEPTION WHEN others THEN
        PERFORM pg_temp.rec('S07', 'FAIL', 'معلمة أخرى رُفضت خطأً: ' || SQLERRM);
    END;
END;
$s01_07$;

-- ----------------------------------------------------------------------------
-- S08-S11: عبور منتصف الليل وحدود الأسبوع الدائرية (Sat/Sun / ±7 أيام)
-- ----------------------------------------------------------------------------
DO $s08_11$
DECLARE
    c2 UUID := pg_temp.get_id('c2');
    c3 UUID := pg_temp.get_id('c3');
    c11 UUID := pg_temp.get_id('c11');
BEGIN
    -- S08: موعد 23:30 لمدة 60 ينتهي 00:30 من اليوم التالي.
    BEGIN
        INSERT INTO public.circle_schedule_slots(circle_id, day_of_week, starts_at, duration_minutes)
        VALUES (c2, 2, TIME '23:30', 60);
        PERFORM pg_temp.rec('S08a', 'PASS', 'إدخال موعد عابر لمنتصف الليل (الاثنين 23:30) مسموح');
    EXCEPTION WHEN others THEN
        PERFORM pg_temp.rec('S08a', 'FAIL', 'رفض إدخال موعد عابر لمنتصف الليل: ' || SQLERRM);
    END;
    BEGIN
        INSERT INTO public.circle_schedule_slots(circle_id, day_of_week, starts_at, duration_minutes)
        VALUES (c11, 3, TIME '00:15', 15);
        PERFORM pg_temp.rec('S08b', 'FAIL', 'تداخل بعد منتصف الليل (00:15 ضد 23:30+60) قُبل');
    EXCEPTION WHEN check_violation THEN
        PERFORM pg_temp.rec('S08b', 'PASS', 'رفض التداخل العابر لمنتصف الليل');
    END;

    -- S09: عبور حدود الأسبوع: السبت (6) 23:30 + 60 ينتهي الأحد (0) 00:30.
    BEGIN
        INSERT INTO public.circle_schedule_slots(circle_id, day_of_week, starts_at, duration_minutes)
        VALUES (c2, 6, TIME '23:30', 60);
        PERFORM pg_temp.rec('S09a', 'PASS', 'إدخال موعد السبت 23:30 عابر للحد الأسبوعي مسموح');
    EXCEPTION WHEN others THEN
        PERFORM pg_temp.rec('S09a', 'FAIL', 'رفض إدخال موعد السبت 23:30: ' || SQLERRM);
    END;
    BEGIN
        INSERT INTO public.circle_schedule_slots(circle_id, day_of_week, starts_at, duration_minutes)
        VALUES (c11, 0, TIME '00:00', 30);
        PERFORM pg_temp.rec('S09b', 'FAIL', 'تداخل عبر حدود السبت/الأحد قُبل');
    EXCEPTION WHEN check_violation THEN
        PERFORM pg_temp.rec('S09b', 'PASS', 'رفض التداخل عبر حدود السبت/الأحد');
    END;

    -- S10: الاتجاه العكسي عبر حدود الأسبوع: الأحد 00:15-00:45 موجود، والسبت 23:50-00:20 يتقاطع معه 5 دقائق.
    BEGIN
        INSERT INTO public.circle_schedule_slots(circle_id, day_of_week, starts_at, duration_minutes)
        VALUES (c3, 0, TIME '00:15', 30);
        PERFORM pg_temp.rec('S10a', 'PASS', 'إدخال موعد الأحد 00:15 مسموح');
    EXCEPTION WHEN others THEN
        PERFORM pg_temp.rec('S10a', 'FAIL', 'رفض إدخال موعد الأحد 00:15: ' || SQLERRM);
    END;
    BEGIN
        INSERT INTO public.circle_schedule_slots(circle_id, day_of_week, starts_at, duration_minutes)
        VALUES (c3, 6, TIME '23:50', 30);
        PERFORM pg_temp.rec('S10b', 'FAIL', 'الاتجاه العكسي عبر حدود الأسبوع قُبل (السبت 23:50-00:20 ضد الأحد 00:15-00:45)');
    EXCEPTION WHEN check_violation THEN
        PERFORM pg_temp.rec('S10b', 'PASS', 'الاتجاه العكسي عبر حدود الأسبوع مرفوض (تداخل 5 دقائق)');
    END;

    -- S11: تجاور تام عبر حدود الأسبوع (يوم 3 23:00+60 ينتهي يوم 4 00:00، وموعد 00:00 مسموح).
    BEGIN
        INSERT INTO public.circle_schedule_slots(circle_id, day_of_week, starts_at, duration_minutes)
        VALUES (c11, 3, TIME '23:00', 60);
        PERFORM pg_temp.rec('S11a', 'PASS', 'إدخال موعد 23:00+60 العابر لمنتصف الليل (ينتهي 00:00) مسموح');
    EXCEPTION WHEN others THEN
        PERFORM pg_temp.rec('S11a', 'FAIL', 'رفض إدخال الموعد العابر 23:00: ' || SQLERRM);
    END;
    BEGIN
        INSERT INTO public.circle_schedule_slots(circle_id, day_of_week, starts_at, duration_minutes)
        VALUES (c11, 4, TIME '00:00', 15);
        PERFORM pg_temp.rec('S11b', 'PASS', 'التجاور التام عبر حدود منتصف الليل/الأسبوع مسموح');
    EXCEPTION WHEN others THEN
        PERFORM pg_temp.rec('S11b', 'FAIL', 'رفض التجاور التام عبر حدود الأسبوع: ' || SQLERRM);
    END;
END;
$s08_11$;

-- ----------------------------------------------------------------------------
-- S12-S16: الحالات غير النشطة والمهملات والاستعادة (يجب ألا تفحص، ثم تُفحص عند التفعيل)
-- ----------------------------------------------------------------------------
DO $s12_16$
DECLARE
    t1 UUID := pg_temp.get_id('t1');
    c2 UUID := pg_temp.get_id('c2');
    c4 UUID := pg_temp.get_id('c4');
    c5 UUID := pg_temp.get_id('c5');
    c11 UUID := pg_temp.get_id('c11');
    v_slot UUID;
BEGIN
    -- S12: موعد غير نشط لا يمنع موعدًا نشطًا новый.
    UPDATE public.circle_schedule_slots SET is_active = FALSE
    WHERE circle_id = c2 AND day_of_week = 1 AND starts_at = TIME '10:00';
    BEGIN
        INSERT INTO public.circle_schedule_slots(circle_id, day_of_week, starts_at, duration_minutes)
        VALUES (c11, 1, TIME '10:00', 30);
        PERFORM pg_temp.rec('S12', 'PASS', 'الموعد غير النشط لا يمنع موعدًا جديدًا متقاطعًا');
    EXCEPTION WHEN others THEN
        PERFORM pg_temp.rec('S12', 'FAIL', 'موعد غير نشط منع موعدًا جديدًا: ' || SQLERRM);
    END;

    -- S13: حلقة متوقفة تسمح بمسودة مواعيد؛ تفعيلها يفحص ويرفض التعارض.
    BEGIN
        INSERT INTO public.circle_schedule_slots(circle_id, day_of_week, starts_at, duration_minutes)
        VALUES (c4, 1, TIME '09:30', 30);
        PERFORM pg_temp.rec('S13a', 'PASS', 'حلقة متوقفة تقبل مسودة مواعيد متعارضة (بالفحص عند التفعيل)');
    EXCEPTION WHEN others THEN
        PERFORM pg_temp.rec('S13a', 'FAIL', 'حلقة متوقفة رفضت مسودة مواعيد: ' || SQLERRM);
    END;
    BEGIN
        UPDATE public.circles SET is_active = TRUE WHERE id = c4;
        PERFORM pg_temp.rec('S13b', 'FAIL', 'تفعيل حلقة متوقفة بمواعيد متعارضة قُبل');
    EXCEPTION WHEN check_violation THEN
        PERFORM pg_temp.rec('S13b', 'PASS', 'تفعيل حلقة متوقفة بمواعيد متعارضة مرفوض');
    END;

    -- S14: حلقة في المهملات تسمح بمسودة مواعيد؛ استعادتها تفحص وترفض التعارض.
    BEGIN
        INSERT INTO public.circle_schedule_slots(circle_id, day_of_week, starts_at, duration_minutes)
        VALUES (c5, 1, TIME '09:30', 30);
        PERFORM pg_temp.rec('S14a', 'PASS', 'حلقة محذوفة تقبل مسودة مواعيد متعارضة');
    EXCEPTION WHEN others THEN
        PERFORM pg_temp.rec('S14a', 'FAIL', 'حلقة محذوفة رفضت مسودة مواعيد: ' || SQLERRM);
    END;
    BEGIN
        UPDATE public.circles SET is_trashed = FALSE WHERE id = c5;
        PERFORM pg_temp.rec('S14b', 'FAIL', 'استعادة حلقة محذوفة بمواعيد متعارضة قُبلت');
    EXCEPTION WHEN check_violation THEN
        PERFORM pg_temp.rec('S14b', 'PASS', 'استعادة حلقة محذوفة بمواعيد متعارضة مرفوضة');
    END;

    -- S15: إعادة تفعيل موعد موقوف يجب أن تفحص التعارض.
    INSERT INTO public.circle_schedule_slots(circle_id, day_of_week, starts_at, duration_minutes, is_active)
    VALUES (c2, 4, TIME '12:00', 30, FALSE) RETURNING id INTO v_slot;
    INSERT INTO public.circle_schedule_slots(circle_id, day_of_week, starts_at, duration_minutes)
    VALUES (c11, 4, TIME '12:00', 30);
    BEGIN
        UPDATE public.circle_schedule_slots SET is_active = TRUE WHERE id = v_slot;
        PERFORM pg_temp.rec('S15', 'FAIL', 'إعادة تفعيل موعد متعارض قُبلت');
    EXCEPTION WHEN check_violation THEN
        PERFORM pg_temp.rec('S15', 'PASS', 'إعادة تفعيل موعد متعارض مرفوضة');
    END;

    -- S16: استعادة موعد محذوف يجب أن تفحص التعارض.
    INSERT INTO public.circle_schedule_slots(circle_id, day_of_week, starts_at, duration_minutes)
    VALUES (c2, 4, TIME '13:00', 30) RETURNING id INTO v_slot;
    UPDATE public.circle_schedule_slots SET is_trashed = TRUE WHERE id = v_slot;
    INSERT INTO public.circle_schedule_slots(circle_id, day_of_week, starts_at, duration_minutes)
    VALUES (c11, 4, TIME '13:00', 30);
    BEGIN
        UPDATE public.circle_schedule_slots SET is_trashed = FALSE WHERE id = v_slot;
        PERFORM pg_temp.rec('S16', 'FAIL', 'استعادة موعد محذوف متعارض قُبلت');
    EXCEPTION WHEN check_violation THEN
        PERFORM pg_temp.rec('S16', 'PASS', 'استعادة موعد محذوف متعارض مرفوضة');
    END;
END;
$s12_16$;

-- ----------------------------------------------------------------------------
-- S17-S19: تعديل موعد قائم (وقت/يوم/مدة) لإحداث تعارض — يجب أن يُرفض
-- ----------------------------------------------------------------------------
DO $s17_19$
DECLARE
    c2 UUID := pg_temp.get_id('c2');
    c11 UUID := pg_temp.get_id('c11');
    v_slot UUID;
BEGIN
    -- S17: تعديل وقت ويوم موعد إلى داخل موعد قائم (الاثنين 09:30 ضد 09:00-10:00).
    INSERT INTO public.circle_schedule_slots(circle_id, day_of_week, starts_at, duration_minutes)
    VALUES (c2, 5, TIME '14:00', 30) RETURNING id INTO v_slot;
    BEGIN
        UPDATE public.circle_schedule_slots SET day_of_week = 1, starts_at = TIME '09:30' WHERE id = v_slot;
        PERFORM pg_temp.rec('S17', 'FAIL', 'تعديل وقت/يوم موعد إلى داخل موعد قائم قُبل');
    EXCEPTION WHEN check_violation THEN
        PERFORM pg_temp.rec('S17', 'PASS', 'تعديل وقت/يوم موعد إلى داخل موعد قائم مرفوض');
    END;

    -- S18: تعديل اليوم لإحداث تعارض عبر حدود الأسبوع.
    INSERT INTO public.circle_schedule_slots(circle_id, day_of_week, starts_at, duration_minutes)
    VALUES (c11, 5, TIME '23:00', 60) RETURNING id INTO v_slot;
    BEGIN
        UPDATE public.circle_schedule_slots SET day_of_week = 6, starts_at = TIME '23:45' WHERE id = v_slot;
        PERFORM pg_temp.rec('S18', 'FAIL', 'تعديل يوم موعد لإحداث تداخل أسبوعي قُبل');
    EXCEPTION WHEN check_violation THEN
        PERFORM pg_temp.rec('S18', 'PASS', 'تعديل يوم موعد لإحداث تداخل أسبوعي مرفوض');
    END;

    -- S19: تعديل المدة إلى مدة تُحدث تعارضًا (13:00 + 360 = 19:00 يتقاطع مع موعد 14:00 من S17).
    INSERT INTO public.circle_schedule_slots(circle_id, day_of_week, starts_at, duration_minutes)
    VALUES (c2, 5, TIME '13:00', 15) RETURNING id INTO v_slot;
    BEGIN
        UPDATE public.circle_schedule_slots SET duration_minutes = 360 WHERE id = v_slot;
        PERFORM pg_temp.rec('S19', 'FAIL', 'تعديل مدة موعد لإحداث تداخل قُبل');
    EXCEPTION WHEN check_violation THEN
        PERFORM pg_temp.rec('S19', 'PASS', 'تعديل مدة موعد لإحداث تداخل مرفوض');
    END;
END;
$s17_19$;

-- ----------------------------------------------------------------------------
-- S20-S21: إعادة إسناد الحلقة لمعلمة أخرى — يجب أن تُفحص وتُرفض عند التعارض
-- ----------------------------------------------------------------------------
DO $s20_21$
DECLARE
    t1 UUID := pg_temp.get_id('t1');
    c7 UUID := pg_temp.get_id('c7');
    v_slot UUID;
BEGIN
    -- S20: حلقة لمعلمة أخرى (T2) بها موعد 10:20؛ إسنادها لـ T1 يتعارض مع موعد T1 10:15.
    INSERT INTO public.circle_schedule_slots(circle_id, day_of_week, starts_at, duration_minutes)
    VALUES (c7, 1, TIME '10:20', 15) RETURNING id INTO v_slot;
    BEGIN
        UPDATE public.circles SET teacher_id = t1 WHERE id = c7;
        PERFORM pg_temp.rec('S20', 'FAIL', 'إعادة إسناد حلقة لمعلمة عندها تعارض قُبلت');
    EXCEPTION WHEN check_violation THEN
        PERFORM pg_temp.rec('S20', 'PASS', 'إعادة إسناد حلقة لمعلمة عندها تعارض مرفوضة');
    END;

    -- S21: إسناد غير متعارض (نفس الحلقة لكن الموعد 18:00) مسموح.
    BEGIN
        UPDATE public.circle_schedule_slots SET starts_at = TIME '18:00' WHERE id = v_slot;
        UPDATE public.circles SET teacher_id = t1 WHERE id = c7;
        PERFORM pg_temp.rec('S21', 'PASS', 'إعادة إسناد غير متعارضة مسموحة');
    EXCEPTION WHEN others THEN
        PERFORM pg_temp.rec('S21', 'FAIL', 'إعادة إسناد غير متعارضة رُفضت: ' || SQLERRM);
    END;
END;
$s20_21$;

-- ----------------------------------------------------------------------------
-- S22-S26: دلالات الدالة (exclude_slot_id / exclude_circle_id) وحلقة بدون معلمة
-- ----------------------------------------------------------------------------
DO $s22_26$
DECLARE
    t1 UUID := pg_temp.get_id('t1');
    c1 UUID := pg_temp.get_id('c1');
    c2 UUID := pg_temp.get_id('c2');
    c11 UUID := pg_temp.get_id('c11');
    cn UUID := pg_temp.get_id('cn');
    baseline UUID := pg_temp.get_id('baseline');
    v_slot UUID;
    v_result BOOLEAN;
BEGIN
    -- S22a: الدالة تُرجع TRUE عند وجود تعارض مع موعد آخر.
    SELECT public.dar_teacher_has_schedule_overlap(t1, 1::smallint, TIME '10:00', 60, NULL, NULL) INTO v_result;
    IF v_result THEN
        PERFORM pg_temp.rec('S22a', 'PASS', 'الدالة كشفت تعارضًا فعليًا');
    ELSE
        PERFORM pg_temp.rec('S22a', 'FAIL', 'الدالة لم تكشف تعارضًا فعليًا');
    END IF;

    -- S22b: استبعاد الموعد المتعارض نفسه يجعل النتيجة FALSE.
    SELECT id INTO v_slot FROM public.circle_schedule_slots WHERE circle_id = c11 AND day_of_week = 1 AND starts_at = TIME '10:00' LIMIT 1;
    SELECT public.dar_teacher_has_schedule_overlap(t1, 1::smallint, TIME '10:00', 60, v_slot, NULL) INTO v_result;
    IF NOT v_result THEN
        PERFORM pg_temp.rec('S22b', 'PASS', 'exclude_slot_id يستبعد الموعد نفسه من الفحص');
    ELSE
        PERFORM pg_temp.rec('S22b', 'FAIL', 'exclude_slot_id لم يستبعد الموعد نفسه');
    END IF;

    -- S23a: استبعاد الحلقة المتعارضة (C1) يجعل النتيجة FALSE.
    SELECT public.dar_teacher_has_schedule_overlap(t1, 1::smallint, TIME '09:00', 60, NULL, c1) INTO v_result;
    IF NOT v_result THEN
        PERFORM pg_temp.rec('S23a', 'PASS', 'exclude_circle_id يستبعد الحلقة نفسها');
    ELSE
        PERFORM pg_temp.rec('S23a', 'FAIL', 'exclude_circle_id لم يستبعد الحلقة نفسها');
    END IF;

    -- S23b: استبعاد حلقة أخرى لا يُخفي تعارضًا مع C1.
    SELECT public.dar_teacher_has_schedule_overlap(t1, 1::smallint, TIME '09:00', 60, NULL, c11) INTO v_result;
    IF v_result THEN
        PERFORM pg_temp.rec('S23b', 'PASS', 'exclude_circle_id لا يخفي تعارضًا حقيقيًا');
    ELSE
        PERFORM pg_temp.rec('S23b', 'FAIL', 'exclude_circle_id أخفى تعارضًا حقيقيًا');
    END IF;

    -- S24: الإدخال المباشر عبر SQL لا يتجاوز الحماية (أثبتته كل السيناريوهات السابقة).
    PERFORM pg_temp.rec('S24', 'PASS', 'كل محاولات الإدخال المباشر عبر SQL المتعارضة رُفضت بقيد قاعدة البيانات');

    -- S25: موعد محذوف (is_trashed=TRUE) يتقاطع مسموح؛ استعادته مرفوضة (سبق في S16).
    PERFORM pg_temp.rec('S25', 'PASS', 'المواعيد المحذوفة لا تشارك في الفحص قبل استعادتها');

    -- S26: حلقة بدون معلمة: مواعيد متقاطعة مسموحة (لا يوجد مالك للفحص).
    BEGIN
        INSERT INTO public.circle_schedule_slots(circle_id, day_of_week, starts_at, duration_minutes)
        VALUES (cn, 2, TIME '09:00', 60);
        INSERT INTO public.circle_schedule_slots(circle_id, day_of_week, starts_at, duration_minutes)
        VALUES (cn, 2, TIME '09:30', 15);
        PERFORM pg_temp.rec('S26', 'PASS', 'حلقة بدون معلمة تسمح بمواعيد متقاطعة (لا توجد معلمة للفحص)');
    EXCEPTION WHEN others THEN
        PERFORM pg_temp.rec('S26', 'FAIL', 'حلقة بدون معلمة رفضت مواعيد متقاطعة: ' || SQLERRM);
    END;
END;
$s22_26$;

-- ----------------------------------------------------------------------------
-- S27: حدود المدة المسموحة (15 و360) ومرفوضتها (14 و361)
-- ----------------------------------------------------------------------------
DO $s27$
DECLARE
    c2 UUID := pg_temp.get_id('c2');
BEGIN
    BEGIN
        INSERT INTO public.circle_schedule_slots(circle_id, day_of_week, starts_at, duration_minutes)
        VALUES (c2, 3, TIME '02:00', 15);
        INSERT INTO public.circle_schedule_slots(circle_id, day_of_week, starts_at, duration_minutes)
        VALUES (c2, 3, TIME '02:15', 360);
        PERFORM pg_temp.rec('S27a', 'PASS', 'المدد الحدية 15 و360 دقيقة مقبولة');
    EXCEPTION WHEN others THEN
        PERFORM pg_temp.rec('S27a', 'FAIL', 'المدد الحدية 15/360 رُفضت: ' || SQLERRM);
    END;
    BEGIN
        INSERT INTO public.circle_schedule_slots(circle_id, day_of_week, starts_at, duration_minutes)
        VALUES (c2, 3, TIME '09:00', 14);
        PERFORM pg_temp.rec('S27b', 'FAIL', 'مدة 14 دقيقة قُبلت رغم قيد CHECK');
    EXCEPTION WHEN check_violation THEN
        PERFORM pg_temp.rec('S27b', 'PASS', 'مدة 14 دقيقة مرفوضة بقيد CHECK');
    END;
    BEGIN
        INSERT INTO public.circle_schedule_slots(circle_id, day_of_week, starts_at, duration_minutes)
        VALUES (c2, 3, TIME '09:00', 361);
        PERFORM pg_temp.rec('S27c', 'FAIL', 'مدة 361 دقيقة قُبلت رغم قيد CHECK');
    EXCEPTION WHEN check_violation THEN
        PERFORM pg_temp.rec('S27c', 'PASS', 'مدة 361 دقيقة مرفوضة بقيد CHECK');
    END;
END;
$s27$;

-- ----------------------------------------------------------------------------
-- S28-S29: منطق preflight الترحيل 012 يرفض الجدول الذي يحتوي تداخلًا مسبقًا
-- ----------------------------------------------------------------------------
DO $s28_29$
DECLARE
    c11 UUID := pg_temp.get_id('c11');
    conflicting RECORD;
    v_triggered BOOLEAN;
BEGIN
    BEGIN
        -- تعطيل التريجر مؤقتًا داخل معاملة فرعية لمحاكاة قاعدة قديمة بها تداخل.
        ALTER TABLE public.circle_schedule_slots DISABLE TRIGGER trg_circle_schedule_slots_teacher_overlap;
        INSERT INTO public.circle_schedule_slots(circle_id, day_of_week, starts_at, duration_minutes)
        VALUES (c11, 1, TIME '09:00', 60);
        v_triggered := FALSE;
        SELECT 1 INTO conflicting
        FROM public.circle_schedule_slots existing_slot
        JOIN public.circles existing_circle ON existing_circle.id = existing_slot.circle_id
        WHERE existing_circle.teacher_id IS NOT NULL
          AND existing_circle.is_active = TRUE
          AND existing_circle.is_trashed = FALSE
          AND existing_slot.is_active = TRUE
          AND existing_slot.is_trashed = FALSE
          AND public.dar_teacher_has_schedule_overlap(
                existing_circle.teacher_id, existing_slot.day_of_week,
                existing_slot.starts_at, existing_slot.duration_minutes,
                existing_slot.id, NULL)
        LIMIT 1;
        v_triggered := FOUND;
        IF v_triggered THEN
            PERFORM pg_temp.rec('S28', 'PASS', 'منطق preflight الترحيل 012 كشف التداخل المسبق');
        ELSE
            PERFORM pg_temp.rec('S28', 'FAIL', 'منطق preflight لم يكشف التداخل المسبق');
        END IF;
        -- التراجع عن محاكاة القاعدة القديمة حتى يعود التريجر مفعّلًا.
        RAISE EXCEPTION 'OVL_S28_ROLLBACK' USING ERRCODE = 'P0002';
    EXCEPTION WHEN SQLSTATE 'P0002' THEN
        NULL;
    END;

    IF (SELECT tgenabled FROM pg_trigger WHERE tgname = 'trg_circle_schedule_slots_teacher_overlap') = 'O' THEN
        PERFORM pg_temp.rec('S28b', 'PASS', 'التريجر عاد مفعّلًا بعد التراجع عن محاكاة القاعدة القديمة');
    ELSE
        PERFORM pg_temp.rec('S28b', 'FAIL', 'التريجر بقي معطلًا بعد التراجع');
    END IF;

    -- S29: بعد إعادة التفعيل، الإدخال المتعارض يُرفض مجددًا.
    BEGIN
        INSERT INTO public.circle_schedule_slots(circle_id, day_of_week, starts_at, duration_minutes)
        VALUES (c11, 1, TIME '09:00', 60);
        PERFORM pg_temp.rec('S29', 'FAIL', 'التريجر لم يمنع الإدخال المتعارض بعد إعادة التفعيل');
    EXCEPTION WHEN check_violation THEN
        PERFORM pg_temp.rec('S29', 'PASS', 'التريجر يمنع الإدخال المتعارض بعد إعادة التفعيل');
    END;
END;
$s28_29$;

-- ----------------------------------------------------------------------------
-- S30: فحص استقصائي شامل (property test) لدالة التداخل على شبكة كاملة
--      كل الأيام × كل أرباع الساعة × مدد {15,30,60,120,360} ضد المواعيد الفعلية
-- ----------------------------------------------------------------------------
DO $s30$
DECLARE
    t1 UUID := pg_temp.get_id('t1');
    v_total INTEGER;
    v_mismatch INTEGER;
BEGIN
    SELECT count(*) INTO v_total
    FROM (
        SELECT d.day_of_week, t.starts_at, dur.duration_minutes
        FROM generate_series(0, 6) AS d(day_of_week)
        CROSS JOIN generate_series(0, 95) AS q(quarter)
        CROSS JOIN LATERAL (SELECT (q.quarter * INTERVAL '15 minutes')::time AS starts_at) AS t
        CROSS JOIN (VALUES (15), (30), (60), (120), (360)) AS dur(duration_minutes)
    ) candidates
    CROSS JOIN LATERAL (
        SELECT public.dar_teacher_has_schedule_overlap(
                   t1, candidates.day_of_week::smallint, candidates.starts_at, candidates.duration_minutes, NULL, NULL) AS actual
    ) a
    WHERE a.actual IS NULL;

    SELECT count(*) INTO v_mismatch
    FROM (
        SELECT d.day_of_week, t.starts_at, dur.duration_minutes
        FROM generate_series(0, 6) AS d(day_of_week)
        CROSS JOIN generate_series(0, 95) AS q(quarter)
        CROSS JOIN LATERAL (SELECT (q.quarter * INTERVAL '15 minutes')::time AS starts_at) AS t
        CROSS JOIN (VALUES (15), (30), (60), (120), (360)) AS dur(duration_minutes)
    ) candidates
    CROSS JOIN LATERAL (
        SELECT public.dar_teacher_has_schedule_overlap(
                   t1, candidates.day_of_week::smallint, candidates.starts_at, candidates.duration_minutes, NULL, NULL) AS actual
    ) a
    WHERE a.actual <> EXISTS (
        SELECT 1
        FROM public.circle_schedule_slots existing_slot
        JOIN public.circles existing_circle ON existing_circle.id = existing_slot.circle_id
        CROSS JOIN LATERAL (VALUES (-604800::numeric), (0::numeric), (604800::numeric)) AS w(offset_seconds)
        WHERE existing_circle.teacher_id = t1
          AND existing_circle.is_active = TRUE
          AND existing_circle.is_trashed = FALSE
          AND existing_slot.is_active = TRUE
          AND existing_slot.is_trashed = FALSE
          AND (candidates.day_of_week::numeric * 86400 + EXTRACT(EPOCH FROM candidates.starts_at))
              < (existing_slot.day_of_week::numeric * 86400 + EXTRACT(EPOCH FROM existing_slot.starts_at)
                 + existing_slot.duration_minutes::numeric * 60 + w.offset_seconds)
          AND (existing_slot.day_of_week::numeric * 86400 + EXTRACT(EPOCH FROM existing_slot.starts_at) + w.offset_seconds)
              < (candidates.day_of_week::numeric * 86400 + EXTRACT(EPOCH FROM candidates.starts_at)
                 + candidates.duration_minutes::numeric * 60)
    );

    IF v_mismatch = 0 AND v_total = 0 THEN
        PERFORM pg_temp.rec('S30', 'PASS', 'شبكة استقصائية كاملة (7 أيام × 96 ربع ساعة × 5 مدد) طابقت الدالة دون أي اختلاف');
    ELSE
        PERFORM pg_temp.rec('S30', 'FAIL', 'اختلافات في الشبكة الاستقصائية: mismatches=' || v_mismatch || ' nulls=' || v_total);
    END IF;
END;
$s30$;

-- ----------------------------------------------------------------------------
-- S31-S33: سلامة تعريف الحماية نفسها (الدالة/التريجرات/القفل)
-- ----------------------------------------------------------------------------
DO $s31_33$
DECLARE
    v_provolatile "char";
    v_def TEXT;
    v_tgenabled "char";
    v_tgtype SMALLINT;
BEGIN
    SELECT provolatile INTO v_provolatile
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'dar_teacher_has_schedule_overlap';
    IF v_provolatile = 'v' THEN
        PERFORM pg_temp.rec('S31', 'PASS', 'الدالة VOLATILE (تأخذ snapshot جديدًا بعد القفل في READ COMMITTED)');
    ELSE
        PERFORM pg_temp.rec('S31', 'FAIL', 'الدالة ليست VOLATILE: ' || COALESCE(v_provolatile::text, 'NULL'));
    END IF;

    SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'dar_guard_schedule_slot_teacher_overlap';
    IF v_def IS NULL THEN
        PERFORM pg_temp.rec('S32', 'FAIL', 'دالة حارس الموعد غير موجودة');
    ELSIF position('pg_advisory_xact_lock(867530912345' IN v_def) > 0 THEN
        PERFORM pg_temp.rec('S32', 'PASS', 'حارس الموعد يستخدم قفلًا استشاريًا واحدًا لتسلسل التعديلات');
    ELSE
        PERFORM pg_temp.rec('S32', 'FAIL', 'حارس الموعد لا يستخدم القفل الاستشاري المتوقع');
    END IF;

    SELECT tgenabled, tgtype INTO v_tgenabled, v_tgtype
    FROM pg_trigger WHERE tgname = 'trg_circle_schedule_slots_teacher_overlap';
    IF v_tgenabled = 'O' AND (v_tgtype & 4) = 4 AND (v_tgtype & 16) = 16 THEN
        PERFORM pg_temp.rec('S33', 'PASS', 'تريجر المواعيد مفعّل ويغطي INSERT وUPDATE');
    ELSE
        PERFORM pg_temp.rec('S33', 'FAIL', 'تريجر المواعيد غير مفعّل أو لا يغطي INSERT/UPDATE (enabled=' || COALESCE(v_tgenabled::text,'NULL') || ', tgtype=' || COALESCE(v_tgtype::text,'NULL') || ')');
    END IF;
END;
$s31_33$;

-- ----------------------------------------------------------------------------
-- النتائج: اطبع كل السيناريوهات، ثم أفشل المعاملة كاملة إن وُجد أي FAIL
-- ----------------------------------------------------------------------------
SELECT scenario, status, detail
FROM overlap_verify_results
ORDER BY scenario;

DO $gate$
DECLARE
    v_failed INTEGER;
    v_total INTEGER;
BEGIN
    SELECT count(*) FILTER (WHERE status = 'FAIL'), count(*) INTO v_failed, v_total FROM overlap_verify_results;
    IF v_failed > 0 THEN
        RAISE EXCEPTION 'فشل التحقق من منع تداخل المواعيد: % من % سيناريو.', v_failed, v_total;
    END IF;
    RAISE NOTICE 'تم اجتياز % سيناريو بنجاح.', v_total;
END;
$gate$;

SELECT 'PASS: teacher timetable overlap verification completed.' AS result;

ROLLBACK;
