-- FINAL 2.1: proven query indexes for the hot paths. Every index here is exercised by
-- tests/regression/tier2-indexes with EXPLAIN (seqscan disabled).
CREATE INDEX IF NOT EXISTS ix_circle_enrollments_circle_status_live
    ON circle_enrollments(circle_id, status) WHERE NOT is_trashed;
CREATE INDEX IF NOT EXISTS ix_monthly_charges_billing_month
    ON monthly_charges(billing_month);
CREATE INDEX IF NOT EXISTS ix_audit_log_occurred_at
    ON audit_log(occurred_at);
CREATE INDEX IF NOT EXISTS ix_audit_log_actor
    ON audit_log(actor_user_id);
CREATE INDEX IF NOT EXISTS ix_meet_sessions_circle
    ON meet_sessions(circle_id);
CREATE INDEX IF NOT EXISTS ix_attendance_requests_circle
    ON attendance_requests(circle_id);
CREATE INDEX IF NOT EXISTS ix_notifications_teacher
    ON notifications(scope_teacher_id) WHERE scope_teacher_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_notifications_expires
    ON notifications(expires_at) WHERE expires_at IS NOT NULL;

-- The unique (session_id, kind, part_no) constraint already indexes session_id as a prefix.
DROP INDEX IF EXISTS idx_meet_media_assets_session;
