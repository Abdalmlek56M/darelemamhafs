-- v0.9.3: attendance requests, notification scope, and WhatsApp communication log.

CREATE TABLE IF NOT EXISTS attendance_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_type VARCHAR(24) NOT NULL CHECK (request_type IN ('absence', 'cancellation', 'correction')),
    teacher_id UUID NOT NULL REFERENCES teachers(id) ON DELETE RESTRICT,
    circle_id UUID NOT NULL REFERENCES circles(id) ON DELETE RESTRICT,
    schedule_slot_id UUID NULL REFERENCES circle_schedule_slots(id) ON DELETE SET NULL,
    attendance_id UUID NULL REFERENCES teacher_attendance(id) ON DELETE SET NULL,
    request_date DATE NULL,
    requested_by UUID NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
    reason TEXT NOT NULL CHECK (length(trim(reason)) >= 3),
    requested_payload JSONB NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
    reviewed_by UUID NULL REFERENCES app_users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ NULL,
    review_note TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_attendance_requests_teacher_date
    ON attendance_requests(teacher_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_requests_status
    ON attendance_requests(status, created_at DESC);

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS scope_circle_id UUID NULL;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS scope_teacher_id UUID NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_scope
    ON notifications(scope_circle_id, scope_teacher_id) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS communication_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id UUID NULL REFERENCES app_users(id) ON DELETE SET NULL,
    recipient_type VARCHAR(24) NOT NULL CHECK (recipient_type IN ('teacher', 'student_guardian')),
    recipient_id UUID NOT NULL,
    phone VARCHAR(40) NOT NULL,
    template_key VARCHAR(60) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_communication_log_created
    ON communication_log(created_at DESC);

-- Default grants for the new request workflow, matching the role templates.
INSERT INTO user_permissions(user_id, permission_code)
SELECT u.id, 'teacher.requests'
FROM app_users u
WHERE EXISTS (SELECT 1 FROM user_permissions p WHERE p.user_id = u.id AND p.permission_code = 'teacher.portal')
ON CONFLICT DO NOTHING;

INSERT INTO user_permissions(user_id, permission_code)
SELECT u.id, 'supervisor.attendance.requests'
FROM app_users u
WHERE EXISTS (SELECT 1 FROM user_permissions p WHERE p.user_id = u.id AND p.permission_code = 'supervisor.portal')
ON CONFLICT DO NOTHING;
