-- v0.9.x (FINAL B3): zero actual minutes = zero pay (no 1-minute minimum).
-- Relaxes teacher_sessions.payable_duration_minutes and teacher_attendance.duration_minutes
-- from BETWEEN 1 AND 360 to BETWEEN 0 AND 360 so ending a session in under a minute
-- stores 0 payable minutes and 0.00 payable amount instead of failing with SQLSTATE 23514.
-- Scheduled slot/session durations remain >= 1. Idempotent.

DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT c.conname
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'teacher_sessions'
          AND c.contype = 'c'
          AND pg_get_constraintdef(c.oid) ILIKE '%payable_duration_minutes%'
    LOOP
        EXECUTE format('ALTER TABLE public.teacher_sessions DROP CONSTRAINT %I', r.conname);
    END LOOP;
END $$;

ALTER TABLE public.teacher_sessions
    ADD CONSTRAINT teacher_sessions_payable_duration_minutes_check
    CHECK (payable_duration_minutes IS NULL OR (payable_duration_minutes BETWEEN 0 AND 360));

ALTER TABLE public.teacher_attendance
    DROP CONSTRAINT IF EXISTS teacher_attendance_duration_minutes_check;

ALTER TABLE public.teacher_attendance
    ADD CONSTRAINT teacher_attendance_duration_minutes_check
    CHECK (duration_minutes BETWEEN 0 AND 360);
