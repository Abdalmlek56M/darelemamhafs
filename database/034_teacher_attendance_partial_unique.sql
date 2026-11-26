-- FINAL 1.4: teacher_attendance had a non-partial UNIQUE(schedule_slot_id, session_date)
-- from 003, so a trashed (undone) attendance row blocked re-marking the same session.
-- Replace it with a partial unique index over live rows only.
DO $$
DECLARE
    constraint_name text;
BEGIN
    FOR constraint_name IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'public.teacher_attendance'::regclass AND contype = 'u'
    LOOP
        EXECUTE format('ALTER TABLE public.teacher_attendance DROP CONSTRAINT %I', constraint_name);
    END LOOP;
END $$;

DROP INDEX IF EXISTS ux_teacher_attendance_slot_date_live;
CREATE UNIQUE INDEX ux_teacher_attendance_slot_date_live
    ON public.teacher_attendance (schedule_slot_id, session_date)
    WHERE is_trashed = FALSE;
