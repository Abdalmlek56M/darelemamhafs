-- FINAL Z0 (2.11): one read-only business-integrity report used by the healthcheck,
-- the restore drill and the regression suite. Ported from the retired Windows
-- HealthChecks.ps1 / PostgresMaintenance.ps1 so no desktop tooling is required.
BEGIN TRANSACTION READ ONLY;

WITH schema_health AS (
    SELECT json_build_object(
        'table_count', (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'),
        'foreign_key_count', (SELECT COUNT(*) FROM pg_constraint WHERE contype='f'),
        'unvalidated_constraints', (SELECT COUNT(*) FROM pg_constraint WHERE contype IN ('f','c') AND NOT convalidated),
        'invalid_indexes', (SELECT COUNT(*) FROM pg_index WHERE NOT indisvalid OR NOT indisready),
        'missing_tables', COALESCE((SELECT string_agg(required.table_name, ',') FROM (VALUES
            ('app_users'),('students'),('teachers'),('circles'),('circle_enrollments'),('monthly_charges'),
            ('payments'),('teacher_attendance'),('student_attendance'),('circle_schedule_slots')
        ) AS required(table_name) WHERE to_regclass('public.' || required.table_name) IS NULL), ''),
        'missing_indexes', COALESCE((SELECT string_agg(required.index_name, ',') FROM (VALUES
            ('uq_circle_enrollments_active_student_circle'),('uq_trash_active_entity'),
            ('uq_circle_schedule_slots_not_trashed_day_time'),('ux_student_attendance_active_slot_date_enrollment')
        ) AS required(index_name) WHERE NOT EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname='public' AND c.relkind='i' AND c.relname=required.index_name)), '')
    ) AS value
),
integrity_issues AS (
    SELECT json_build_object(
        'duplicate_active_enrollments', (SELECT COUNT(*) FROM (
            SELECT student_id,circle_id FROM circle_enrollments WHERE is_trashed=FALSE AND status='active'
            GROUP BY student_id,circle_id HAVING COUNT(*)>1) q),
        'duplicate_schedule_slots', (SELECT COUNT(*) FROM (
            SELECT circle_id,day_of_week,starts_at FROM circle_schedule_slots WHERE is_trashed=FALSE
            GROUP BY circle_id,day_of_week,starts_at HAVING COUNT(*)>1) q),
        'duplicate_student_attendance', (SELECT COUNT(*) FROM (
            SELECT schedule_slot_id,session_date,enrollment_id FROM student_attendance WHERE is_trashed=FALSE
            GROUP BY schedule_slot_id,session_date,enrollment_id HAVING COUNT(*)>1) q),
        'payments_exceed_charge', (SELECT COUNT(*) FROM (
            SELECT mc.id FROM monthly_charges mc
            LEFT JOIN payments p ON p.monthly_charge_id=mc.id AND p.is_trashed=FALSE
            WHERE mc.is_trashed=FALSE GROUP BY mc.id,mc.amount_due HAVING COALESCE(SUM(p.amount),0)>mc.amount_due) q),
        'teacher_payable_mismatch', (SELECT COUNT(*) FROM teacher_attendance ta
            WHERE ta.is_trashed=FALSE AND (
                (ta.status='present' AND ABS(ta.payable_amount-ROUND(ta.hourly_rate_snapshot*ta.duration_minutes/60.0,2))>0.005)
                OR (ta.status IN ('absent','cancelled') AND ta.payable_amount<>0))),
        'orphan_core_relationships', (SELECT COUNT(*) FROM (
            SELECT ce.id FROM circle_enrollments ce WHERE NOT EXISTS (SELECT 1 FROM students s WHERE s.id=ce.student_id)
            UNION ALL SELECT ce.id FROM circle_enrollments ce WHERE NOT EXISTS (SELECT 1 FROM circles c WHERE c.id=ce.circle_id)
            UNION ALL SELECT mc.id FROM monthly_charges mc WHERE NOT EXISTS (SELECT 1 FROM circle_enrollments ce WHERE ce.id=mc.enrollment_id)
            UNION ALL SELECT p.id FROM payments p WHERE NOT EXISTS (SELECT 1 FROM monthly_charges mc WHERE mc.id=p.monthly_charge_id)
            UNION ALL SELECT ss.id FROM circle_schedule_slots ss WHERE NOT EXISTS (SELECT 1 FROM circles c WHERE c.id=ss.circle_id)
            UNION ALL SELECT ta.id FROM teacher_attendance ta WHERE NOT EXISTS (SELECT 1 FROM circles c WHERE c.id=ta.circle_id)
            UNION ALL SELECT ta.id FROM teacher_attendance ta WHERE NOT EXISTS (SELECT 1 FROM teachers t WHERE t.id=ta.teacher_id)
            UNION ALL SELECT sa.id FROM student_attendance sa WHERE NOT EXISTS (SELECT 1 FROM circle_schedule_slots ss WHERE ss.id=sa.schedule_slot_id)
            UNION ALL SELECT sa.id FROM student_attendance sa WHERE NOT EXISTS (SELECT 1 FROM circle_enrollments ce WHERE ce.id=sa.enrollment_id)
        ) orphaned)
    ) AS value
),
wal_stats AS (
    SELECT json_build_object(
        'size_bytes', COALESCE(SUM(size),0),
        'file_count', COUNT(*)
    ) AS value
    FROM pg_ls_waldir()
),
dead_tables AS (
    SELECT COALESCE(json_agg(row_to_json(q) ORDER BY q.dead_tuple_percent DESC NULLS LAST, q.estimated_dead_tuples DESC, q.total_size_bytes DESC), '[]'::json) AS value
    FROM (
        SELECT s.schemaname AS schema_name, s.relname AS table_name,
               COALESCE(s.n_live_tup,0)::bigint AS estimated_live_tuples,
               COALESCE(s.n_dead_tup,0)::bigint AS estimated_dead_tuples,
               CASE WHEN (COALESCE(s.n_live_tup,0)+COALESCE(s.n_dead_tup,0))>0
                    THEN round(100.0*s.n_dead_tup::numeric/(s.n_live_tup+s.n_dead_tup),2) ELSE 0::numeric END AS dead_tuple_percent,
               s.last_autovacuum, s.last_vacuum, s.autovacuum_count,
               pg_total_relation_size(c.oid)::bigint AS total_size_bytes
        FROM pg_stat_user_tables s JOIN pg_class c ON c.oid=s.relid
        WHERE c.relkind IN ('r','m')
        ORDER BY s.n_dead_tup DESC, c.relname
        LIMIT 250
    ) q
),
autovacuum_settings AS (
    SELECT json_build_object(
        'enabled', current_setting('autovacuum') = 'on',
        'naptime', current_setting('autovacuum_naptime'),
        'max_workers', current_setting('autovacuum_max_workers')::integer,
        'vacuum_threshold', current_setting('autovacuum_vacuum_threshold')::integer,
        'vacuum_scale_factor', current_setting('autovacuum_vacuum_scale_factor')::numeric,
        'freeze_max_age', current_setting('autovacuum_freeze_max_age')::bigint,
        'active_workers', (SELECT count(*) FROM pg_stat_activity WHERE backend_type='autovacuum worker'),
        'max_dead_tuple_percent', COALESCE((SELECT max(CASE WHEN COALESCE(n_live_tup,0)+COALESCE(n_dead_tup,0)>0 THEN round(100.0*n_dead_tup::numeric/(n_live_tup+n_dead_tup),2) ELSE 0 END) FROM pg_stat_user_tables),0)
    ) AS value
)
SELECT json_build_object(
    'schema', (SELECT value FROM schema_health),
    'integrity', (SELECT value FROM integrity_issues),
    'wal', (SELECT value FROM wal_stats),
    'dead_tables', (SELECT value FROM dead_tables),
    'autovacuum', (SELECT value FROM autovacuum_settings)
)::text;

COMMIT;
