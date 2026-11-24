\set ON_ERROR_STOP on
BEGIN;
INSERT INTO teachers (id, teacher_code, full_name, phone, status, notes, hourly_rate, created_at, updated_at, is_trashed)
VALUES ('11111111-1111-4111-8111-111111111111', 'ZZ-P17-T', 'ZZ-TEST Teacher P17', '01000000001', 'active', NULL, 50.00, now(), now(), FALSE);

INSERT INTO students (id, student_code, full_name, phone, guardian_name, guardian_phone, joined_on, status, notes, created_at, updated_at, age_years, is_trashed)
VALUES ('22222222-2222-4222-8222-222222222222', 'ZZ-P17-S', 'ZZ-TEST Student P17', '01000000002', 'ZZ-TEST Guardian', '01000000003', '2026-01-01', 'active', NULL, now(), now(), 12, FALSE);

INSERT INTO circles (id, circle_code, name, teacher_id, monthly_fee, schedule_text, is_active, created_at, updated_at, is_trashed, starts_on)
VALUES ('33333333-3333-4333-8333-333333333333', 'ZZ-P17-C', 'ZZ-TEST Circle P17', '11111111-1111-4111-8111-111111111111', 987654.32, 'السبت 10:00', TRUE, now(), now(), FALSE, '2026-01-01');

INSERT INTO circle_enrollments (id, student_id, circle_id, starts_on, ends_on, agreed_monthly_fee, status, created_at, is_trashed)
VALUES ('44444444-4444-4444-8444-444444444444', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', '2026-01-01', NULL, 987654.32, 'active', now(), FALSE);

INSERT INTO monthly_charges (id, enrollment_id, billing_month, amount_due, note, created_at, is_trashed)
VALUES ('55555555-5555-4555-8555-555555555555', '44444444-4444-4444-8444-444444444444', '2026-11-01', 987654.32, 'P17-SENTINEL-CHARGE', now(), FALSE);

INSERT INTO payments (id, monthly_charge_id, amount, paid_at, method, reference, note, recorded_by, created_at, is_trashed)
VALUES ('66666666-6666-4666-8666-666666666666', '55555555-5555-4555-8555-555555555555', 123456.78, now(), 'cash', 'P17-SENTINEL-PAY', 'P17-SENTINEL-PAYMENT', (SELECT id FROM app_users WHERE username='p17_admin'), now(), FALSE);

INSERT INTO advertising_expenses (id, circle_id, platform, start_date, days_count, daily_cost, note, recorded_by, created_at, is_trashed)
VALUES ('77777777-7777-4777-8777-777777777777', '33333333-3333-4333-8333-333333333333', 'ZZ-TEST', '2026-11-01', 5, 11111.11, 'P17-SENTINEL-AD', (SELECT id FROM app_users WHERE username='p17_admin'), now(), FALSE);

INSERT INTO operating_expenses (id, expense_date, category, description, amount, circle_id, note, recorded_by, created_at, updated_at, is_trashed)
VALUES ('88888888-8888-4888-8888-888888888888', '2026-11-02', 'ZZ-TEST', 'P17-SENTINEL-OPERATING', 444222.11, NULL, 'P17-SENTINEL-OP', (SELECT id FROM app_users WHERE username='p17_admin'), now(), now(), FALSE);

INSERT INTO collection_reports (id, title, billing_month, snapshot, saved_by, created_at, is_trashed)
VALUES ('99999999-9999-4999-8999-999999999999', 'P17-SENTINEL-REPORT', '2026-11-01', '{"note":"P17-SENTINEL-SNAPSHOT","totalDue":987654.32}'::jsonb, (SELECT id FROM app_users WHERE username='p17_admin'), now(), FALSE);

INSERT INTO audit_log (actor_user_id, action_code, entity_type, entity_id, details, request_path, http_method, can_restore, actor_display_name)
VALUES ((SELECT id FROM app_users WHERE username='p17_admin'), 'charge.create', 'monthly_charge', '55555555-5555-4555-8555-555555555555', '{"amountDue":987654.32,"note":"P17-SENTINEL-AUDIT"}'::jsonb, '/p17-fixture', 'POST', FALSE, 'P17 Fixture');
COMMIT;