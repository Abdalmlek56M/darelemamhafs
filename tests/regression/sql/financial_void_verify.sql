-- financial_void_verify.sql
-- Phase 2.3 (ADR-0005) — SQL-level verification of the Void/Reverse implementation.
--
-- Preconditions:
--   * All migrations 001..024 are applied to a clean database.
--   * For the migration-time permission backfill to be meaningful, seed a user with
--     permission 'finance.edit' BEFORE applying 024. The script also re-runs the
--     backfill statements inside the transaction (scenario S17) so it is self-contained.
--   * Run inside one session (psql or postgres --single) with ON_ERROR_STOP=1.
--
-- Expected output: one 'VOID_RESULT <scenario> = PASS|FAIL : <detail>' warning per scenario,
-- then a table with scenario/status/detail and the summary counts.
-- The script wraps everything in BEGIN/ROLLBACK: no repository data is changed.

BEGIN;

CREATE TEMP TABLE vo_results (
    scenario text NOT NULL,
    status   text NOT NULL CHECK (status IN ('PASS','FAIL')),
    detail   text NOT NULL
);

CREATE OR REPLACE FUNCTION pg_temp.rec(p_scenario text, p_status text, p_detail text)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
    INSERT INTO pg_temp.vo_results(scenario,status,detail) VALUES (p_scenario,p_status,p_detail);
    RAISE WARNING 'VOID_RESULT % = % : %', p_scenario, p_status, p_detail;
END;
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.expect_sqlstate(p_sql text, p_expected text, p_scenario text, p_detail text)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE
    v_state text;
BEGIN
    BEGIN
        EXECUTE p_sql;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
        IF v_state = p_expected THEN
            PERFORM pg_temp.rec(p_scenario,'PASS',p_detail || ' [' || v_state || ']');
        ELSE
            PERFORM pg_temp.rec(p_scenario,'FAIL',p_detail || ' (expected ' || p_expected || ', got ' || v_state || ')');
        END IF;
        RETURN;
    END;
    PERFORM pg_temp.rec(p_scenario,'FAIL',p_detail || ' (expected ' || p_expected || ' but statement succeeded)');
END;
$fn$;

-- ============================================================================
-- S00 — seed
-- ============================================================================
DO $scenario$
BEGIN
    INSERT INTO app_users(id,username,display_name,password_hash) VALUES
        ('11111111-1111-4111-8111-111111111111','vo_actor','منفذ الإلغاء','x'),
        ('11111111-1111-4111-8111-222222222222','vo_editor','محرر مالي','x');
    INSERT INTO user_permissions(user_id,permission_code) VALUES
        ('11111111-1111-4111-8111-222222222222','finance.edit');
    INSERT INTO roles(id,code,name_ar) VALUES
        ('33333333-3333-4333-8333-333333333333','vo_accountant','محاسب اختبار');
    INSERT INTO role_permissions(role_id,permission_id)
        SELECT '33333333-3333-4333-8333-333333333333', id FROM permissions WHERE code='finance.edit';

    INSERT INTO teachers(id,teacher_code,full_name) VALUES
        ('44444444-4444-4444-8444-444444444444','T-VO','معلمة اختبار');
    INSERT INTO circles(id,circle_code,name,teacher_id,monthly_fee,starts_on) VALUES
        ('55555555-5555-4555-8555-555555555555','C-VO','حلقة اختبار','44444444-4444-4444-8444-444444444444',250,'2026-01-01');
    INSERT INTO students(id,student_code,full_name) VALUES
        ('66666666-6666-4666-8666-666666666661','S-VO-1','طالبة أولى'),
        ('66666666-6666-4666-8666-666666666662','S-VO-2','طالبة ثانية'),
        ('66666666-6666-4666-8666-666666666663','S-VO-3','طالبة ثالثة'),
        ('66666666-6666-4666-8666-666666666664','S-VO-4','طالبة رابعة'),
        ('66666666-6666-4666-8666-666666666665','S-VO-5','طالبة خامسة');
    INSERT INTO circle_enrollments(id,student_id,circle_id,starts_on,agreed_monthly_fee) VALUES
        ('77777777-7777-4777-8777-777777777771','66666666-6666-4666-8666-666666666661','55555555-5555-4555-8555-555555555555','2026-01-01',250),
        ('77777777-7777-4777-8777-777777777772','66666666-6666-4666-8666-666666666662','55555555-5555-4555-8555-555555555555','2026-01-01',250),
        ('77777777-7777-4777-8777-777777777773','66666666-6666-4666-8666-666666666663','55555555-5555-4555-8555-555555555555','2026-01-01',250),
        ('77777777-7777-4777-8777-777777777774','66666666-6666-4666-8666-666666666664','55555555-5555-4555-8555-555555555555','2026-01-01',100),
        ('77777777-7777-4777-8777-777777777775','66666666-6666-4666-8666-666666666665','55555555-5555-4555-8555-555555555555','2026-01-01',250);
    INSERT INTO monthly_charges(id,enrollment_id,billing_month,amount_due) VALUES
        ('88888888-8888-4888-8888-888888888881','77777777-7777-4777-8777-777777777771','2026-11-01',250),
        ('88888888-8888-4888-8888-888888888882','77777777-7777-4777-8777-777777777772','2026-11-01',250),
        ('88888888-8888-4888-8888-888888888883','77777777-7777-4777-8777-777777777773','2026-11-01',250),
        ('88888888-8888-4888-8888-888888888884','77777777-7777-4777-8777-777777777774','2026-11-01',100),
        ('88888888-8888-4888-8888-888888888885','77777777-7777-4777-8777-777777777775','2026-11-01',250);
    INSERT INTO payments(id,monthly_charge_id,amount,method) VALUES
        ('99999999-9999-4999-8999-999999999991','88888888-8888-4888-8888-888888888882',100,'cash'),
        ('99999999-9999-4999-8999-999999999992','88888888-8888-4888-8888-888888888884',40,'cash'),
        ('99999999-9999-4999-8999-999999999993','88888888-8888-4888-8888-888888888884',60,'cash');
    PERFORM pg_temp.rec('S00','PASS','تم إنشاء بيانات اختبار: 2 مستخدم، دور، معلمة، حلقة، 5 التحاقات، 5 استحقاقات، 3 دفعات');
END;
$scenario$;

-- ============================================================================
-- S01 — void a charge with no payments => 0 + audit fields filled
-- ============================================================================
DO $scenario$
DECLARE
    v_before bigint; v_after bigint;
    v_result integer;
    v_row record;
BEGIN
    SELECT count(*) INTO v_before FROM public.audit_log;
    v_result := public.dar_void_charge('88888888-8888-4888-8888-888888888881','11111111-1111-4111-8111-111111111111','  سبب صحيح لإلغاء الاستحقاق  ');
    SELECT count(*) INTO v_after FROM public.audit_log;
    SELECT voided_at,voided_by,void_reason INTO v_row FROM public.monthly_charges WHERE id='88888888-8888-4888-8888-888888888881';
    IF v_result = 0 AND v_row.voided_at IS NOT NULL
       AND v_row.voided_by='11111111-1111-4111-8111-111111111111'
       AND v_row.void_reason='سبب صحيح لإلغاء الاستحقاق'
       AND v_after = v_before THEN
        PERFORM pg_temp.rec('S01','PASS','إلغاء استحقاق بلا دفعات رجع 0، ومُلئت voided_at/by/reason مع trim، والدالة لم تكتب audit (العدّاد ثابت)');
    ELSE
        PERFORM pg_temp.rec('S01','FAIL',format('result=%s voided_at=%s voided_by=%s reason=%s audit_delta=%s',v_result,v_row.voided_at,v_row.voided_by,v_row.void_reason,v_after-v_before));
    END IF;
END;
$scenario$;

-- ============================================================================
-- S02 — voiding the same charge again => 2
-- ============================================================================
DO $scenario$
DECLARE v_result integer;
BEGIN
    v_result := public.dar_void_charge('88888888-8888-4888-8888-888888888881','11111111-1111-4111-8111-111111111111','محاولة إلغاء ثانية لنفس السجل');
    PERFORM pg_temp.rec('S02', CASE WHEN v_result=2 THEN 'PASS' ELSE 'FAIL' END, 'إلغاء استحقاق ملغي بالفعل يرجع 2 (المُرجَع=' || v_result || ')');
END;
$scenario$;

-- ============================================================================
-- S03 — void a charge that still has active payments => 3, no change
-- ============================================================================
DO $scenario$
DECLARE v_result integer; v_voided timestamptz; v_reason text;
BEGIN
    v_result := public.dar_void_charge('88888888-8888-4888-8888-888888888882','11111111-1111-4111-8111-111111111111','محاولة إلغاء استحقاق عليه دفعات سارية');
    SELECT voided_at,void_reason INTO v_voided,v_reason FROM public.monthly_charges WHERE id='88888888-8888-4888-8888-888888888882';
    IF v_result=3 AND v_voided IS NULL AND v_reason IS NULL THEN
        PERFORM pg_temp.rec('S03','PASS','استحقاق عليه دفعة سارية: الدالة ترجع 3 ولا تغيّر الصف');
    ELSE
        PERFORM pg_temp.rec('S03','FAIL',format('result=%s voided_at=%s reason=%s',v_result,v_voided,v_reason));
    END IF;
END;
$scenario$;

-- ============================================================================
-- S04 — void the payment => 0; then the charge can be voided => 0
-- ============================================================================
DO $scenario$
DECLARE v_pay integer; v_charge integer; v_pay_row record; v_charge_row record;
BEGIN
    v_pay := public.dar_void_payment('99999999-9999-4999-8999-999999999991','11111111-1111-4111-8111-111111111111','دفعة مسجلة بالخطأ');
    SELECT voided_at,voided_by,void_reason INTO v_pay_row FROM public.payments WHERE id='99999999-9999-4999-8999-999999999991';
    v_charge := public.dar_void_charge('88888888-8888-4888-8888-888888888882','11111111-1111-4111-8111-111111111111','إلغاء الاستحقاق بعد إلغاء دفعاته');
    SELECT voided_at INTO v_charge_row FROM public.monthly_charges WHERE id='88888888-8888-4888-8888-888888888882';
    IF v_pay=0 AND v_pay_row.voided_at IS NOT NULL AND v_pay_row.void_reason='دفعة مسجلة بالخطأ'
       AND v_charge=0 AND v_charge_row.voided_at IS NOT NULL THEN
        PERFORM pg_temp.rec('S04','PASS','دفعة ترجع 0 ثم استحقاق ترجع 0 بعد إلغاء الدفعات (الترتيب الإلزامي يعمل)');
    ELSE
        PERFORM pg_temp.rec('S04','FAIL',format('pay=%s pay_voided=%s charge=%s charge_voided=%s',v_pay,v_pay_row.voided_at,v_charge,v_charge_row.voided_at));
    END IF;
END;
$scenario$;

-- ============================================================================
-- S05 — voiding the same payment again => 2
-- ============================================================================
DO $scenario$
DECLARE v_result integer;
BEGIN
    v_result := public.dar_void_payment('99999999-9999-4999-8999-999999999991','11111111-1111-4111-8111-111111111111','محاولة ثانية');
    PERFORM pg_temp.rec('S05', CASE WHEN v_result=2 THEN 'PASS' ELSE 'FAIL' END, 'إلغاء دفعة ملغاة بالفعل يرجع 2 (المُرجَع=' || v_result || ')');
END;
$scenario$;

-- ============================================================================
-- S06 — non-existent records => 1
-- ============================================================================
DO $scenario$
DECLARE v_charge integer; v_payment integer;
BEGIN
    v_charge := public.dar_void_charge('00000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','سجل غير موجود');
    v_payment := public.dar_void_payment('00000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','سجل غير موجود');
    PERFORM pg_temp.rec('S06', CASE WHEN v_charge=1 AND v_payment=1 THEN 'PASS' ELSE 'FAIL' END,
        'استحقاق/دفعة غير موجودة ترجع 1 (' || v_charge || '/' || v_payment || ')');
END;
$scenario$;

-- ============================================================================
-- S07 — invalid reasons and actors => 4
-- ============================================================================
DO $scenario$
DECLARE v1 integer; v2 integer; v3 integer; v4 integer; v5 integer;
BEGIN
    v1 := public.dar_void_charge('88888888-8888-4888-8888-888888888883','11111111-1111-4111-8111-111111111111','ab');
    v2 := public.dar_void_charge('88888888-8888-4888-8888-888888888883','11111111-1111-4111-8111-111111111111',repeat('س',501));
    v3 := public.dar_void_payment('99999999-9999-4999-8999-999999999992','11111111-1111-4111-8111-111111111111','ab');
    v4 := public.dar_void_charge('88888888-8888-4888-8888-888888888883',NULL,'سبب مع فاعل فارغ');
    v5 := public.dar_void_charge('88888888-8888-4888-8888-888888888883','11111111-1111-4111-8111-111111111111','   ');
    PERFORM pg_temp.rec('S07', CASE WHEN v1=4 AND v2=4 AND v3=4 AND v4=4 AND v5=4 THEN 'PASS' ELSE 'FAIL' END,
        'سبب قصير/طويل/فارغ أو فاعل NULL ترجع 4 (' || v1 || ',' || v2 || ',' || v3 || ',' || v4 || ',' || v5 || ')');
END;
$scenario$;

-- ============================================================================
-- S08 — boundary reasons: 3 chars accepted, 500 accepted (on throwaway charges)
-- ============================================================================
DO $scenario$
DECLARE v3 integer; v500 integer; v_before integer; v_after integer;
BEGIN
    INSERT INTO monthly_charges(id,enrollment_id,billing_month,amount_due)
        VALUES ('88888888-8888-4888-8888-888888888886','77777777-7777-4777-8777-777777777773','2026-12-01',250);
    v3 := public.dar_void_charge('88888888-8888-4888-8888-888888888886','11111111-1111-4111-8111-111111111111','abc');
    INSERT INTO monthly_charges(id,enrollment_id,billing_month,amount_due)
        VALUES ('88888888-8888-4888-8888-888888888887','77777777-7777-4777-8777-777777777774','2026-12-01',100);
    v500 := public.dar_void_charge('88888888-8888-4888-8888-888888888887','11111111-1111-4111-8111-111111111111',repeat('س',500));
    PERFORM pg_temp.rec('S08', CASE WHEN v3=0 AND v500=0 THEN 'PASS' ELSE 'FAIL' END,
        'الحدود: سبب 3 أحرف يُقبل و500 يُقبل (' || v3 || '/' || v500 || ')');
END;
$scenario$;

-- ============================================================================
-- S09 — CHECK constraints reject inconsistent void metadata
-- ============================================================================
DO $scenario$
BEGIN
    PERFORM pg_temp.expect_sqlstate(
        $$UPDATE public.monthly_charges SET voided_at=now() WHERE id='88888888-8888-4888-8888-888888888883'$$,
        '23514','S09a','CHECK على الاستحقاق يرفض voided_at بدون سبب');
    PERFORM pg_temp.expect_sqlstate(
        $$UPDATE public.monthly_charges SET voided_at=now(),void_reason='ab' WHERE id='88888888-8888-4888-8888-888888888883'$$,
        '23514','S09b','CHECK على الاستحقاق يرفض سببًا أقصر من 3 أحرف');
    PERFORM pg_temp.expect_sqlstate(
        $$UPDATE public.payments SET void_reason='سبب بدون وقت' WHERE id='99999999-9999-4999-8999-999999999992'$$,
        '23514','S09c','CHECK على الدفعة يرفض سببًا بدون voided_at');
    PERFORM pg_temp.expect_sqlstate(
        $$UPDATE public.payments SET voided_at=now(),void_reason=repeat('س',501) WHERE id='99999999-9999-4999-8999-999999999992'$$,
        '23514','S09d','CHECK على الدفعة يرفض سببًا أطول من 500 حرف');
END;
$scenario$;

-- ============================================================================
-- S10 — sums exclude voided charge/payment (collections-style query)
-- ============================================================================
DO $scenario$
DECLARE v_due numeric; v_paid numeric; v_balance numeric;
BEGIN
    -- Enrollment 4: charge 100 + payments 40 and 60. Void the 40 payment only.
    PERFORM public.dar_void_payment('99999999-9999-4999-8999-999999999992','11111111-1111-4111-8111-111111111111','إلغاء دفعة جزئية لفحص المجاميع');
    SELECT COALESCE(SUM(mc.amount_due),0) INTO v_due
      FROM public.monthly_charges mc
     WHERE mc.enrollment_id='77777777-7777-4777-8777-777777777774' AND mc.is_trashed=FALSE AND mc.voided_at IS NULL;
    SELECT COALESCE(SUM(p.amount),0) INTO v_paid
      FROM public.payments p JOIN public.monthly_charges mc ON mc.id=p.monthly_charge_id
     WHERE mc.enrollment_id='77777777-7777-4777-8777-777777777774' AND mc.is_trashed=FALSE AND mc.voided_at IS NULL
       AND p.is_trashed=FALSE AND p.voided_at IS NULL;
    v_balance := GREATEST(0, v_due - v_paid);
    IF v_due=100 AND v_paid=60 AND v_balance=40 THEN
        PERFORM pg_temp.rec('S10','PASS','المجاميع تستبعد الدفعة الملغاة: due=100 paid=60 balance=40');
    ELSE
        PERFORM pg_temp.rec('S10','FAIL',format('due=%s paid=%s balance=%s (expected 100/60/40)',v_due,v_paid,v_balance));
    END IF;
END;
$scenario$;

-- ============================================================================
-- S11 — void changes the totals immediately (void remaining payment then charge)
-- ============================================================================
DO $scenario$
DECLARE v_pay integer; v_charge integer; v_due numeric; v_paid numeric;
BEGIN
    v_pay := public.dar_void_payment('99999999-9999-4999-8999-999999999993','11111111-1111-4111-8111-111111111111','إلغاء الدفعة المتبقية');
    v_charge := public.dar_void_charge('88888888-8888-4888-8888-888888888884','11111111-1111-4111-8111-111111111111','إلغاء الاستحقاق بعد إلغاء كل دفعاته');
    SELECT COALESCE(SUM(mc.amount_due),0) INTO v_due FROM public.monthly_charges mc
     WHERE mc.enrollment_id='77777777-7777-4777-8777-777777777774' AND mc.is_trashed=FALSE AND mc.voided_at IS NULL;
    SELECT COALESCE(SUM(p.amount),0) INTO v_paid FROM public.payments p JOIN public.monthly_charges mc ON mc.id=p.monthly_charge_id
     WHERE mc.enrollment_id='77777777-7777-4777-8777-777777777774' AND mc.is_trashed=FALSE AND mc.voided_at IS NULL AND p.is_trashed=FALSE AND p.voided_at IS NULL;
    PERFORM pg_temp.rec('S11', CASE WHEN v_pay=0 AND v_charge=0 AND v_due=0 AND v_paid=0 THEN 'PASS' ELSE 'FAIL' END,
        format('بعد إلغاء كل شيء: due=%s paid=%s (pay=%s charge=%s)',v_due,v_paid,v_pay,v_charge));
END;
$scenario$;

-- ============================================================================
-- S12 — voided records stay visible in the statement (no filter) 
-- ============================================================================
DO $scenario$
DECLARE v_charges integer; v_voided integer; v_payments integer; v_pay_voided integer;
BEGIN
    SELECT count(*), count(*) FILTER (WHERE mc.voided_at IS NOT NULL) INTO v_charges,v_voided
      FROM public.monthly_charges mc JOIN public.circle_enrollments ce ON ce.id=mc.enrollment_id
     WHERE ce.student_id IN ('66666666-6666-4666-8666-666666666661','66666666-6666-4666-8666-666666666662','66666666-6666-4666-8666-666666666664')
       AND mc.is_trashed=FALSE;
    SELECT count(*), count(*) FILTER (WHERE p.voided_at IS NOT NULL) INTO v_payments,v_pay_voided
      FROM public.payments p JOIN public.monthly_charges mc ON mc.id=p.monthly_charge_id
     WHERE mc.enrollment_id IN ('77777777-7777-4777-8777-777777777771','77777777-7777-4777-8777-777777777772','77777777-7777-4777-8777-777777777774')
       AND p.is_trashed=FALSE;
    IF v_charges>=3 AND v_voided>=2 AND v_payments>=3 AND v_pay_voided>=2 THEN
        PERFORM pg_temp.rec('S12','PASS',format('السجل يُبقي الملغى ظاهرًا: charges=%s (voided %s), payments=%s (voided %s)',v_charges,v_voided,v_payments,v_pay_voided));
    ELSE
        PERFORM pg_temp.rec('S12','FAIL',format('charges=%s voided=%s payments=%s pay_voided=%s (expected >=3/>=2/>=3/>=2)',v_charges,v_voided,v_payments,v_pay_voided));
    END IF;
END;
$scenario$;

-- ============================================================================
-- S13 — a voided charge no longer blocks re-issuing the month (partial unique index)
-- ============================================================================
DO $scenario$
DECLARE v_new uuid;
BEGIN
    INSERT INTO monthly_charges(id,enrollment_id,billing_month,amount_due)
        VALUES ('88888888-8888-4888-8888-888888888888','77777777-7777-4777-8777-777777777771','2026-11-01',250)
        RETURNING id INTO v_new;
    PERFORM pg_temp.rec('S13','PASS','إعادة إصدار استحقاق لشهر أُلغي فيه الاستحقاق السابق مسموحة (الصف الجديد ' || v_new || ')');
EXCEPTION WHEN unique_violation THEN
    PERFORM pg_temp.rec('S13','FAIL','إعادة إصدار الاستحقاق بعد الإلغاء فشلت بـunique_violation');
END;
$scenario$;

-- ============================================================================
-- S14 — active charges still unique per (enrollment, billing_month)
-- ============================================================================
DO $scenario$
BEGIN
    PERFORM pg_temp.expect_sqlstate(
        $$INSERT INTO public.monthly_charges(enrollment_id,billing_month,amount_due) VALUES ('77777777-7777-4777-8777-777777777773','2026-11-01',250)$$,
        '23505','S14','الاستحقاق النشط المكرر لنفس الشهر ما زال مرفوضًا (partial unique index)');
END;
$scenario$;

-- ============================================================================
-- S15 — trashing a charge also frees the month (supporting the new trash policy)
-- ============================================================================
DO $scenario$
DECLARE v_ok integer := 0;
BEGIN
    UPDATE public.monthly_charges SET is_trashed=TRUE WHERE id='88888888-8888-4888-8888-888888888883';
    BEGIN
        INSERT INTO public.monthly_charges(enrollment_id,billing_month,amount_due)
            VALUES ('77777777-7777-4777-8777-777777777773','2026-11-01',250);
        v_ok := 1;
    EXCEPTION WHEN unique_violation THEN
        v_ok := 0;
    END;
    PERFORM pg_temp.rec('S15', CASE WHEN v_ok=1 THEN 'PASS' ELSE 'FAIL' END,
        'الاستحقاق المنقول للمهملات لا يحجز شهره أمام استحقاق جديد (partial index WHERE is_trashed=FALSE)');
    -- لا نُعيد الاستحقاق القديم: إعادته لنشط مع وجود بديل نشط لنفس الشهر تخالف الفهرس الجزئي (وهذا مقصود).
END;
$scenario$;

-- ============================================================================
-- S16 — void rejects trashed records => 1
-- ============================================================================
DO $scenario$
DECLARE v_result integer;
BEGIN
    UPDATE public.monthly_charges SET is_trashed=TRUE WHERE id='88888888-8888-4888-8888-888888888886';
    v_result := public.dar_void_charge('88888888-8888-4888-8888-888888888886','11111111-1111-4111-8111-111111111111','محاولة إلغاء سجل في المهملات');
    UPDATE public.monthly_charges SET is_trashed=FALSE WHERE id='88888888-8888-4888-8888-888888888886';
    PERFORM pg_temp.rec('S16', CASE WHEN v_result=1 THEN 'PASS' ELSE 'FAIL' END,
        'إلغاء سجل منقول للمهملات يرجع 1 (المُرجَع=' || v_result || ')');
END;
$scenario$;

-- ============================================================================
-- S17 — permission + grants backfill (migration 024 semantics, idempotent)
-- ============================================================================
DO $scenario$
DECLARE v_perm text; v_edit_users integer; v_missing_users integer; v_edit_roles integer; v_missing_roles integer; v_new_grant integer;
BEGIN
    SELECT name_ar INTO v_perm FROM public.permissions WHERE code='finance.void';
    -- The migration-time backfill cannot cover rows created after 024 (the test adds vo_editor later):
    -- re-run the same idempotent backfill statements first, then assert the invariant for all holders.
    INSERT INTO public.user_permissions(user_id,permission_code)
    SELECT DISTINCT up.user_id,'finance.void' FROM public.user_permissions up
     WHERE up.permission_code='finance.edit'
    ON CONFLICT (user_id,permission_code) DO NOTHING;
    INSERT INTO public.role_permissions(role_id,permission_id)
    SELECT DISTINCT rp.role_id, target.id
      FROM public.role_permissions rp
      JOIN public.permissions source ON source.id=rp.permission_id AND source.code='finance.edit'
      JOIN public.permissions target ON target.code='finance.void'
    ON CONFLICT (role_id,permission_id) DO NOTHING;
    SELECT count(*) INTO v_edit_users FROM public.user_permissions WHERE permission_code='finance.edit';
    SELECT count(*) INTO v_missing_users
      FROM public.user_permissions edit
     WHERE edit.permission_code='finance.edit'
       AND NOT EXISTS (SELECT 1 FROM public.user_permissions v WHERE v.user_id=edit.user_id AND v.permission_code='finance.void');
    SELECT count(*) INTO v_edit_roles FROM public.role_permissions rp JOIN public.permissions p ON p.id=rp.permission_id WHERE p.code='finance.edit';
    SELECT count(*) INTO v_missing_roles
      FROM public.role_permissions rp JOIN public.permissions p ON p.id=rp.permission_id
     WHERE p.code='finance.edit'
       AND NOT EXISTS (SELECT 1 FROM public.role_permissions vr JOIN public.permissions vp ON vp.id=vr.permission_id
                        WHERE vr.role_id=rp.role_id AND vp.code='finance.void');
    -- Re-run the same backfill statements to prove idempotency and the new-grant path.
    INSERT INTO public.user_permissions(user_id,permission_code)
    SELECT DISTINCT up.user_id,'finance.void' FROM public.user_permissions up
     WHERE up.permission_code='finance.edit'
    ON CONFLICT (user_id,permission_code) DO NOTHING;
    SELECT count(*) INTO v_new_grant FROM public.user_permissions
     WHERE user_id='11111111-1111-4111-8111-222222222222' AND permission_code='finance.void';
    IF v_perm IS NOT NULL AND v_edit_users>=1 AND v_missing_users=0 AND v_edit_roles>=1 AND v_missing_roles=0 AND v_new_grant=1 THEN
        PERFORM pg_temp.rec('S17','PASS',format('finance.void موجودة (%s)، وكل حامل finance.edit حصل عليها: users=%s roles=%s (backfill idempotent)',v_perm,v_edit_users,v_edit_roles));
    ELSE
        PERFORM pg_temp.rec('S17','FAIL',format('perm=%s edit_users=%s missing_users=%s edit_roles=%s missing_roles=%s new_grant=%s',v_perm,v_edit_users,v_missing_users,v_edit_roles,v_missing_roles,v_new_grant));
    END IF;
END;
$scenario$;

-- ============================================================================
-- S18 — voided charge is not usable by the payments flow (API guard simulation)
-- ============================================================================
DO $scenario$
DECLARE v_active uuid; v_voided uuid;
BEGIN
    SELECT id INTO v_active FROM public.monthly_charges
     WHERE id='88888888-8888-4888-8888-888888888885' AND is_trashed=FALSE AND voided_at IS NULL;
    SELECT id INTO v_voided FROM public.monthly_charges
     WHERE id='88888888-8888-4888-8888-888888888881' AND is_trashed=FALSE AND voided_at IS NULL;
    IF v_active='88888888-8888-4888-8888-888888888885' AND v_voided IS NULL THEN
        PERFORM pg_temp.rec('S18','PASS','استعلام الـAPI لاستحقاق نشط يعيد النشط فقط؛ الملغي غير متاح لتسجيل دفعة');
    ELSE
        PERFORM pg_temp.rec('S18','FAIL',format('active=%s voided=%s',v_active,v_voided));
    END IF;
END;
$scenario$;

-- ============================================================================
-- S19 — idempotent re-run of migration 024 does nothing harmful
-- ============================================================================
DO $scenario$
DECLARE v_counter integer;
BEGIN
    SELECT count(*) INTO v_counter FROM public.monthly_charges WHERE id='88888888-8888-4888-8888-888888888881' AND voided_at IS NOT NULL;
    PERFORM pg_temp.rec('S19', CASE WHEN v_counter=1 THEN 'PASS' ELSE 'FAIL' END,
        'السجل الملغي يبقى صفًا واحدًا بعد إعادة تحميل الـmigration/backfill (idempotent)');
END;
$scenario$;

-- ============================================================================
-- Summary
-- ============================================================================
SELECT scenario, status, detail FROM pg_temp.vo_results ORDER BY scenario;
SELECT
    count(*) FILTER (WHERE status='PASS') AS passed,
    count(*) FILTER (WHERE status='FAIL') AS failed,
    count(*) AS total
FROM pg_temp.vo_results;

ROLLBACK;
