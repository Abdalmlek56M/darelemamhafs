-- Dar Eltahfeez v0.4: recurring timetable, teacher attendance/pay, ad campaigns, and payment receipts.
CREATE TABLE IF NOT EXISTS circle_schedule_slots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    circle_id UUID NOT NULL REFERENCES circles(id) ON DELETE RESTRICT,
    day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- JS/.NET: Sunday=0
    starts_at TIME NOT NULL,
    duration_minutes INTEGER NOT NULL DEFAULT 60 CHECK (duration_minutes BETWEEN 15 AND 360),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(circle_id, day_of_week, starts_at)
);
CREATE INDEX IF NOT EXISTS idx_schedule_slots_active_day_time ON circle_schedule_slots(is_active, day_of_week, starts_at);

CREATE TABLE IF NOT EXISTS teacher_attendance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    schedule_slot_id UUID REFERENCES circle_schedule_slots(id) ON DELETE SET NULL,
    circle_id UUID NOT NULL REFERENCES circles(id) ON DELETE RESTRICT,
    teacher_id UUID NOT NULL REFERENCES teachers(id) ON DELETE RESTRICT,
    session_date DATE NOT NULL,
    scheduled_start TIME NOT NULL,
    duration_minutes INTEGER NOT NULL CHECK (duration_minutes BETWEEN 15 AND 360),
    status VARCHAR(20) NOT NULL CHECK (status IN ('present','absent','cancelled')),
    hourly_rate_snapshot NUMERIC(12,2) NOT NULL CHECK (hourly_rate_snapshot >= 0),
    payable_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (payable_amount >= 0),
    note TEXT,
    marked_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
    marked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(schedule_slot_id, session_date)
);
CREATE INDEX IF NOT EXISTS idx_teacher_attendance_date_teacher ON teacher_attendance(session_date, teacher_id);

ALTER TABLE payments ADD COLUMN IF NOT EXISTS receipt_file_name VARCHAR(255);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS receipt_content_type VARCHAR(100);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS receipt_data BYTEA;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS receipt_uploaded_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS advertising_expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    circle_id UUID NOT NULL REFERENCES circles(id) ON DELETE RESTRICT,
    platform VARCHAR(120),
    start_date DATE NOT NULL,
    days_count INTEGER NOT NULL CHECK (days_count BETWEEN 1 AND 3650),
    daily_cost NUMERIC(12,2) NOT NULL CHECK (daily_cost >= 0),
    total_amount NUMERIC(14,2) GENERATED ALWAYS AS (daily_cost * days_count) STORED,
    note TEXT,
    recorded_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_advertising_expenses_dates ON advertising_expenses(start_date DESC);

INSERT INTO permissions(code, name_ar) VALUES
 ('schedule.read', 'عرض جدول الحلقات'),
 ('schedule.edit', 'إدارة مواعيد الحلقات'),
 ('attendance.read', 'عرض سجل حضور المعلمات ومستحقاتهن'),
 ('attendance.edit', 'تسجيل وتعديل حضور المعلمات')
ON CONFLICT (code) DO UPDATE SET name_ar = EXCLUDED.name_ar;

-- Preserve full-access administrator behavior for existing v0.3 accounts only.
-- Narrower accounts keep their previous access and must be granted schedule/attendance permissions explicitly.
INSERT INTO user_permissions(user_id, permission_code)
SELECT u.id, p.code
FROM app_users u
CROSS JOIN (VALUES ('schedule.read'), ('schedule.edit'), ('attendance.read'), ('attendance.edit')) AS p(code)
WHERE (SELECT COUNT(DISTINCT up.permission_code) FROM user_permissions up
       WHERE up.user_id=u.id AND up.permission_code IN (
        'dashboard.read','students.read','students.create','students.edit','students.delete',
        'teachers.read','teachers.create','teachers.edit','teachers.delete',
        'circles.read','circles.create','circles.edit','circles.delete',
        'finance.read','finance.create','finance.edit','finance.delete','users.manage','settings.manage'
       )) = 19
ON CONFLICT (user_id, permission_code) DO NOTHING;
