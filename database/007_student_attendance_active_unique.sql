-- v0.8.8: keep trashed attendance history, while allowing a new active registration for the same lesson.
-- This migration does not delete or rewrite attendance records.
ALTER TABLE student_attendance
    DROP CONSTRAINT IF EXISTS student_attendance_schedule_slot_id_session_date_enrollment_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS ux_student_attendance_active_slot_date_enrollment
    ON student_attendance(schedule_slot_id, session_date, enrollment_id)
    WHERE is_trashed = FALSE;
