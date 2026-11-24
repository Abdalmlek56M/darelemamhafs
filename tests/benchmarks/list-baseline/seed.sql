\set ON_ERROR_STOP on
-- Synthetic benchmark data only. Requires setup admin 'bench_admin'.
SET session_replication_role = replica;
BEGIN;
INSERT INTO students (id, student_code, full_name, phone, guardian_name, guardian_phone, joined_on, status, notes, created_at, updated_at, age_years, is_trashed)
SELECT gen_random_uuid(), 'BN-S-' || lpad(g::text, 8, '0'), 'Synthetic Student ' || g, NULL, 'Guardian ' || g, NULL,
       DATE '2026-01-01', 'active', NULL, now(), now(), 12, FALSE
FROM generate_series(1, :n) g;

INSERT INTO teachers (id, teacher_code, full_name, phone, status, notes, hourly_rate, created_at, updated_at, is_trashed)
SELECT gen_random_uuid(), 'BN-T-' || lpad(g::text, 6, '0'), 'Synthetic Teacher ' || g, NULL, 'active', NULL, 60, now(), now(), FALSE
FROM generate_series(1, GREATEST(100, :n / 50)) g;

INSERT INTO circles (id, circle_code, name, teacher_id, monthly_fee, schedule_text, is_active, created_at, updated_at, is_trashed, starts_on)
SELECT gen_random_uuid(), 'BN-C-' || lpad(g::text, 6, '0'), 'Synthetic Circle ' || g,
       (SELECT id FROM teachers ORDER BY id LIMIT 1), 250, 'السبت 10:00', TRUE, now(), now(), FALSE, DATE '2026-01-01'
FROM generate_series(1, GREATEST(500, :n / 20)) g;

INSERT INTO circle_schedule_slots (id, circle_id, day_of_week, starts_at, duration_minutes, is_active, created_at, is_trashed)
SELECT gen_random_uuid(), c.id, 1, TIME '10:00', 60, TRUE, now(), FALSE FROM circles c;

WITH s AS (SELECT id, row_number() OVER (ORDER BY id) AS rn FROM students),
     c AS (SELECT id, row_number() OVER (ORDER BY id) AS rn, count(*) OVER () AS cnt FROM circles)
INSERT INTO circle_enrollments (id, student_id, circle_id, starts_on, ends_on, agreed_monthly_fee, status, created_at, is_trashed)
SELECT gen_random_uuid(), s.id, c.id, DATE '2026-01-01', NULL, 250, 'active', now(), FALSE
FROM s JOIN c ON c.rn = ((s.rn - 1) % c.cnt) + 1;

INSERT INTO monthly_charges (id, enrollment_id, billing_month, amount_due, note, created_at, is_trashed)
SELECT gen_random_uuid(), ce.id, DATE '2026-11-01', 250, 'BENCH', now(), FALSE
FROM circle_enrollments ce;

INSERT INTO payments (id, monthly_charge_id, amount, paid_at, method, reference, note, recorded_by, created_at, is_trashed)
SELECT gen_random_uuid(), mc.id, 100, now(), 'cash', 'BENCH', 'BENCH', (SELECT id FROM app_users WHERE username='bench_admin'), now(), FALSE
FROM monthly_charges mc;

WITH slots AS (SELECT ss.id, ss.circle_id, c.teacher_id, row_number() OVER (ORDER BY ss.id) AS rn FROM circle_schedule_slots ss JOIN circles c ON c.id=ss.circle_id),
     total AS (SELECT count(*) AS cnt FROM slots)
INSERT INTO teacher_attendance (id, schedule_slot_id, circle_id, teacher_id, session_date, scheduled_start, duration_minutes, status, hourly_rate_snapshot, payable_amount, note, marked_by, marked_at, actual_duration_minutes, pay_basis, overtime_minutes, undertime_minutes, is_trashed)
SELECT gen_random_uuid(), s.id, s.circle_id, s.teacher_id, DATE '2026-11-01' + ((((g - 1) / (SELECT cnt FROM total)) % 28)::int), TIME '10:00', 60, 'present', 60, 60, 'BENCH', (SELECT id FROM app_users WHERE username='bench_admin'), now(), 60, 'actual', 0, 0, FALSE
FROM generate_series(1, (:n)/2) g JOIN slots s ON s.rn = ((g - 1) % (SELECT cnt FROM total)) + 1;

WITH e AS (SELECT ce.id, ce.circle_id, row_number() OVER (ORDER BY ce.id) AS rn FROM circle_enrollments ce),
     total AS (SELECT count(*) AS cnt FROM e),
     slots AS (SELECT id, circle_id FROM circle_schedule_slots)
INSERT INTO student_attendance (id, schedule_slot_id, enrollment_id, session_date, status, note, marked_by, marked_at, is_trashed)
SELECT gen_random_uuid(), ss.id, e.id, DATE '2026-11-01' + ((((g - 1) / 1000) % 28)::int), 'present', 'BENCH', (SELECT id FROM app_users WHERE username='bench_admin'), now(), FALSE
FROM generate_series(1, (:n)/2) g JOIN e ON e.rn = ((g - 1) % (SELECT cnt FROM total)) + 1 JOIN slots ss ON ss.circle_id=e.circle_id;

INSERT INTO advertising_expenses (id, circle_id, platform, start_date, days_count, daily_cost, note, recorded_by, created_at, is_trashed)
SELECT gen_random_uuid(), (SELECT id FROM circles ORDER BY id LIMIT 1), 'BENCH', DATE '2026-11-01', 5, 10, 'BENCH', (SELECT id FROM app_users WHERE username='bench_admin'), now(), FALSE
FROM generate_series(1, GREATEST(100, :n / 10)) g;

INSERT INTO operating_expenses (id, expense_date, category, description, amount, note, recorded_by, created_at, updated_at, is_trashed)
SELECT gen_random_uuid(), DATE '2026-11-02', 'BENCH', 'Synthetic expense', 100, 'BENCH', (SELECT id FROM app_users WHERE username='bench_admin'), now(), now(), FALSE
FROM generate_series(1, GREATEST(100, :n / 10)) g;

INSERT INTO collection_reports (id, title, billing_month, snapshot, saved_by, created_at, is_trashed)
SELECT gen_random_uuid(), 'BENCH REPORT ' || g, DATE '2026-11-01', '{"total":250}'::jsonb, (SELECT id FROM app_users WHERE username='bench_admin'), now(), FALSE
FROM generate_series(1, GREATEST(100, :n / 10)) g;

INSERT INTO attendance_requests (id, request_type, teacher_id, circle_id, schedule_slot_id, attendance_id, request_date, requested_by, reason, requested_payload, status, created_at, updated_at, is_trashed)
SELECT gen_random_uuid(), 'absence', (SELECT id FROM teachers ORDER BY id LIMIT 1), (SELECT id FROM circles ORDER BY id LIMIT 1),
       (SELECT id FROM circle_schedule_slots ORDER BY id LIMIT 1), NULL, DATE '2026-11-05',
       (SELECT id FROM app_users WHERE username='bench_admin'), 'BENCH', '{}'::jsonb, 'pending', now(), now(), FALSE
FROM generate_series(1, GREATEST(100, :n / 10)) g;

INSERT INTO notifications (id, user_id, role_scope, category, status, severity, title, body, entity_type, dedupe_key, created_at, scope_circle_id)
SELECT gen_random_uuid(), (SELECT id FROM app_users WHERE username='bench_admin'), 'admin', 'attendance', 'open', 'info', 'BENCH', 'Synthetic notification', 'attendance_request', 'BENCH-NOTIF-' || g, now(), NULL
FROM generate_series(1, GREATEST(100, :n / 10)) g;

INSERT INTO audit_log (actor_user_id, action_code, entity_type, actor_display_name, details, request_path, http_method, can_restore)
SELECT (SELECT id FROM app_users WHERE username='bench_admin'), 'benchmark', 'bench', 'Benchmark', '{}'::jsonb, '/benchmark', 'GET', FALSE
FROM generate_series(1, (:n)*2) g;

INSERT INTO app_users (id, username, display_name, password_hash, is_active, session_version, created_at, updated_at)
SELECT gen_random_uuid(), 'bench_u_' || lpad(g::text, 7, '0'), 'Benchmark User ' || g, 'not-a-real-hash', TRUE, 1, now(), now()
FROM generate_series(1, GREATEST(100, :n / 10)) g;

COMMIT;
SET session_replication_role = origin;
ANALYZE;