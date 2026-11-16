-- v0.9.0: teacher/supervisor portal foundation.
-- Reuses students/circles/attendance/payroll/collections; adds only the scoped
-- session, notification, permission and account-link layer.

ALTER TABLE app_users ADD COLUMN IF NOT EXISTS teacher_id UUID NULL REFERENCES teachers(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_app_users_teacher_id
    ON app_users(teacher_id) WHERE teacher_id IS NOT NULL;

ALTER TABLE app_users ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ NULL;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS locked_by UUID NULL REFERENCES app_users(id) ON DELETE SET NULL;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS lock_reason TEXT NULL;

CREATE TABLE IF NOT EXISTS teacher_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    teacher_id UUID NOT NULL REFERENCES teachers(id) ON DELETE RESTRICT,
    circle_id UUID NOT NULL REFERENCES circles(id) ON DELETE RESTRICT,
    schedule_slot_id UUID NOT NULL REFERENCES circle_schedule_slots(id) ON DELETE RESTRICT,
    session_date DATE NOT NULL,
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'in_progress'
        CHECK (status IN ('in_progress', 'awaiting_attendance', 'completed', 'cancelled')),
    scheduled_duration_minutes INTEGER NOT NULL
        CHECK (scheduled_duration_minutes BETWEEN 1 AND 360),
    actual_duration_minutes INTEGER NULL
        CHECK (actual_duration_minutes BETWEEN 0 AND 1440),
    payable_duration_minutes INTEGER NULL
        CHECK (payable_duration_minutes BETWEEN 1 AND 360),
    pay_basis VARCHAR(20) NULL
        CHECK (pay_basis IN ('scheduled', 'actual', 'manual')),
    overtime_minutes INTEGER NOT NULL DEFAULT 0 CHECK (overtime_minutes >= 0),
    undertime_minutes INTEGER NOT NULL DEFAULT 0 CHECK (undertime_minutes >= 0),
    note TEXT NULL,
    created_by UUID NULL REFERENCES app_users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (schedule_slot_id, session_date)
);
CREATE INDEX IF NOT EXISTS idx_teacher_sessions_teacher_date
    ON teacher_sessions(teacher_id, session_date DESC);
CREATE INDEX IF NOT EXISTS idx_teacher_sessions_open
    ON teacher_sessions(teacher_id, status) WHERE status IN ('in_progress', 'awaiting_attendance');

ALTER TABLE teacher_attendance ADD COLUMN IF NOT EXISTS teacher_session_id UUID NULL
    REFERENCES teacher_sessions(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_teacher_attendance_session
    ON teacher_attendance(teacher_session_id) WHERE teacher_session_id IS NOT NULL;

ALTER TABLE teacher_attendance ADD COLUMN IF NOT EXISTS actual_duration_minutes INTEGER NULL;
ALTER TABLE teacher_attendance ADD COLUMN IF NOT EXISTS pay_basis VARCHAR(20) NOT NULL DEFAULT 'actual';
ALTER TABLE teacher_attendance ADD COLUMN IF NOT EXISTS overtime_minutes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE teacher_attendance ADD COLUMN IF NOT EXISTS undertime_minutes INTEGER NOT NULL DEFAULT 0;

UPDATE teacher_attendance
SET actual_duration_minutes = duration_minutes
WHERE actual_duration_minutes IS NULL;

-- The old 15-minute floor blocked short teacher sessions. The portal allows an
-- early end; pay is the actual whole minutes (minimum one minute).
ALTER TABLE teacher_attendance DROP CONSTRAINT IF EXISTS teacher_attendance_duration_minutes_check;
ALTER TABLE teacher_attendance ADD CONSTRAINT teacher_attendance_duration_minutes_check
    CHECK (duration_minutes BETWEEN 1 AND 360);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'teacher_attendance_pay_basis_check') THEN
        ALTER TABLE teacher_attendance ADD CONSTRAINT teacher_attendance_pay_basis_check
            CHECK (pay_basis IN ('scheduled', 'actual', 'manual'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'teacher_attendance_actual_duration_check') THEN
        ALTER TABLE teacher_attendance ADD CONSTRAINT teacher_attendance_actual_duration_check
            CHECK (actual_duration_minutes IS NULL OR (actual_duration_minutes BETWEEN 0 AND 1440));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'teacher_attendance_overtime_check') THEN
        ALTER TABLE teacher_attendance ADD CONSTRAINT teacher_attendance_overtime_check
            CHECK (overtime_minutes >= 0);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'teacher_attendance_undertime_check') THEN
        ALTER TABLE teacher_attendance ADD CONSTRAINT teacher_attendance_undertime_check
            CHECK (undertime_minutes >= 0);
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NULL REFERENCES app_users(id) ON DELETE CASCADE,
    role_scope VARCHAR(40) NULL
        CHECK (role_scope IN ('teacher', 'supervisor', 'admin')),
    category VARCHAR(40) NOT NULL
        CHECK (category IN ('session', 'attendance', 'payment', 'schedule', 'system')),
    status VARCHAR(20) NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'resolved')),
    severity VARCHAR(20) NOT NULL DEFAULT 'info'
        CHECK (severity IN ('info', 'warning', 'critical')),
    title VARCHAR(200) NOT NULL,
    body TEXT NOT NULL,
    entity_type VARCHAR(60) NULL,
    entity_id UUID NULL,
    action_url TEXT NULL,
    dedupe_key VARCHAR(240) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ NULL,
    resolved_by UUID NULL REFERENCES app_users(id) ON DELETE SET NULL,
    resolution_note TEXT NULL,
    expires_at TIMESTAMPTZ NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_open
    ON notifications(user_id, status, created_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_role_open
    ON notifications(role_scope, status, created_at DESC) WHERE role_scope IS NOT NULL;

CREATE TABLE IF NOT EXISTS notification_reads (
    notification_id UUID NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (notification_id, user_id)
);

-- Permission catalog. Names are Arabic for the admin UI; codes are stable.
INSERT INTO permissions (code, name_ar) VALUES
    ('teacher.portal', 'الدخول إلى بوابة المعلمة'),
    ('teacher.attendance', 'تسجيل حضور حلقتها وطالباتها'),
    ('teacher.earnings.self', 'عرض مستحقاتها فقط'),
    ('teacher.students.read', 'عرض طالباتها فقط'),
    ('teacher.subscriptions.read', 'عرض حالة اشتراكات طالباتها'),
    ('teacher.notes.write', 'إضافة ملاحظات الحلقة والطالبة'),
    ('supervisor.portal', 'الدخول إلى بوابة المشرفة'),
    ('supervisor.live', 'عرض الحلقات المباشرة'),
    ('supervisor.absences', 'عرض ومتابعة الغياب'),
    ('supervisor.unpaid', 'عرض المتأخرات والمتابعة'),
    ('supervisor.attendance.correct', 'تصحيح الحضور والوقت والأجر'),
    ('supervisor.teachers.read', 'متابعة المعلمات')
ON CONFLICT (code) DO UPDATE SET name_ar = EXCLUDED.name_ar;

INSERT INTO roles (code, name_ar) VALUES
    ('teacher', 'معلمة'),
    ('supervisor', 'مشرفة')
ON CONFLICT (code) DO UPDATE SET name_ar = EXCLUDED.name_ar;

-- Role templates. The admin may override every permission per user through
-- user_permissions; these rows document the safe defaults.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN (
    'teacher.portal', 'teacher.attendance', 'teacher.earnings.self',
    'teacher.students.read', 'teacher.notes.write'
)
WHERE r.code = 'teacher'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN (
    'supervisor.portal', 'supervisor.live', 'supervisor.absences',
    'supervisor.unpaid', 'supervisor.attendance.correct', 'supervisor.teachers.read'
)
WHERE r.code = 'supervisor'
ON CONFLICT DO NOTHING;

-- Payment notifications are resolved by the ledger, not by a read click.
CREATE OR REPLACE FUNCTION dar_resolve_paid_notification() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    charge UUID;
    due NUMERIC(12,2);
    paid NUMERIC(12,2);
BEGIN
    IF TG_OP = 'DELETE' THEN
        charge := OLD.monthly_charge_id;
    ELSE
        charge := NEW.monthly_charge_id;
    END IF;
    SELECT amount_due INTO due FROM monthly_charges WHERE id = charge;
    SELECT COALESCE(SUM(amount), 0) INTO paid FROM payments WHERE monthly_charge_id = charge AND is_trashed = FALSE;

    IF due IS NOT NULL AND paid >= due THEN
        UPDATE notifications
        SET status='resolved', resolved_at=now(), resolution_note='تم سداد الاشتراك بالكامل'
        WHERE dedupe_key = 'unpaid:' || charge AND status = 'open';
    ELSIF due IS NOT NULL THEN
        UPDATE notifications
        SET status='open', resolved_at=NULL, resolved_by=NULL, resolution_note=NULL
        WHERE dedupe_key = 'unpaid:' || charge AND status = 'resolved';
    END IF;

    RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_payments_resolve_notification ON payments;
CREATE TRIGGER trg_payments_resolve_notification
AFTER INSERT OR UPDATE OR DELETE ON payments
FOR EACH ROW EXECUTE FUNCTION dar_resolve_paid_notification();
