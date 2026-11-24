\pset tuples_only on
\pset format unaligned
\pset fieldsep '|'
BEGIN TRANSACTION READ ONLY;
SELECT 'schema|tables|' || count(*)::text FROM pg_tables WHERE schemaname='public';
SELECT 'schema|columns|' || count(*)::text FROM information_schema.columns WHERE table_schema='public';
SELECT 'schema|constraints|' || count(*)::text FROM pg_constraint WHERE connamespace='public'::regnamespace;
SELECT 'schema|indexes|' || count(*)::text FROM pg_indexes WHERE schemaname='public';
SELECT format('SELECT %L || count(*)::text FROM public.%I;', 'schema|migrations|', tablename)
FROM pg_tables WHERE schemaname='public' AND tablename IN ('web_schema_migrations','schema_migrations') ORDER BY tablename \gexec
SELECT format('SELECT %L || count(*)::text FROM public.%I;', 'table|'||tablename||'|', tablename)
FROM pg_tables WHERE schemaname='public' ORDER BY tablename \gexec
SELECT 'sum|monthly_charges_due|' || COALESCE(SUM(amount_due),0)::text FROM monthly_charges WHERE is_trashed=FALSE AND voided_at IS NULL;
SELECT 'sum|monthly_charges_due_all|' || COALESCE(SUM(amount_due),0)::text FROM monthly_charges;
SELECT 'sum|payments_amount|' || COALESCE(SUM(amount),0)::text FROM payments WHERE is_trashed=FALSE AND voided_at IS NULL;
SELECT 'sum|payments_amount_all|' || COALESCE(SUM(amount),0)::text FROM payments;
SELECT 'sum|advertising_total|' || COALESCE(SUM(total_amount),0)::text FROM advertising_expenses WHERE is_trashed=FALSE;
SELECT 'sum|operating_amount|' || COALESCE(SUM(amount),0)::text FROM operating_expenses WHERE is_trashed=FALSE;
SELECT 'sum|teacher_attendance_payable|' || COALESCE(SUM(payable_amount),0)::text FROM teacher_attendance WHERE is_trashed=FALSE;
SELECT 'sum|student_attendance_present|' || count(*)::text FROM student_attendance WHERE status='present' AND is_trashed=FALSE;
SELECT 'sum|audit_rows|' || count(*)::text FROM audit_log;
SELECT 'hash|students|' || COALESCE(md5(string_agg(id::text||'|'||student_code||'|'||status, E'\n' ORDER BY id)),'empty') FROM students;
SELECT 'hash|teachers|' || COALESCE(md5(string_agg(id::text||'|'||teacher_code||'|'||status||'|'||hourly_rate::text, E'\n' ORDER BY id)),'empty') FROM teachers;
SELECT 'hash|monthly_charges|' || COALESCE(md5(string_agg(id::text||'|'||enrollment_id::text||'|'||billing_month::text||'|'||amount_due::text, E'\n' ORDER BY id)),'empty') FROM monthly_charges;
SELECT 'hash|payments|' || COALESCE(md5(string_agg(id::text||'|'||monthly_charge_id::text||'|'||amount::text, E'\n' ORDER BY id)),'empty') FROM payments;
SELECT 'orphan|charges_without_enrollment|' || count(*)::text FROM monthly_charges mc LEFT JOIN circle_enrollments ce ON ce.id=mc.enrollment_id WHERE mc.enrollment_id IS NOT NULL AND ce.id IS NULL;
SELECT 'orphan|payments_without_charge|' || count(*)::text FROM payments p LEFT JOIN monthly_charges mc ON mc.id=p.monthly_charge_id WHERE p.monthly_charge_id IS NOT NULL AND mc.id IS NULL;
SELECT 'negative|monthly_charges|' || count(*)::text FROM monthly_charges WHERE amount_due < 0;
SELECT 'negative|payments|' || count(*)::text FROM payments WHERE amount < 0;
ROLLBACK;
