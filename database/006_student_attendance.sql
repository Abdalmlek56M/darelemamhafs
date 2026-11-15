-- v0.8.8: student attendance per scheduled lesson, with reversible trash support.
CREATE TABLE IF NOT EXISTS student_attendance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    schedule_slot_id UUID NOT NULL REFERENCES circle_schedule_slots(id) ON DELETE RESTRICT,
    enrollment_id UUID NOT NULL REFERENCES circle_enrollments(id) ON DELETE RESTRICT,
    session_date DATE NOT NULL,
    status VARCHAR(20) NOT NULL CHECK (status IN ('present','absent','excused')),
    note TEXT,
    marked_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
    marked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    is_trashed BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE(schedule_slot_id, session_date, enrollment_id)
);
CREATE INDEX IF NOT EXISTS idx_student_attendance_date ON student_attendance(session_date, enrollment_id) WHERE is_trashed=FALSE;
CREATE INDEX IF NOT EXISTS idx_student_attendance_slot ON student_attendance(schedule_slot_id, session_date) WHERE is_trashed=FALSE;
