-- Allow re-creating a weekly schedule after an old schedule is moved to Trash.
-- Existing schedule slots and all attendance records are preserved.
ALTER TABLE circle_schedule_slots
    DROP CONSTRAINT IF EXISTS circle_schedule_slots_circle_id_day_of_week_starts_at_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_circle_schedule_slots_not_trashed_day_time
    ON circle_schedule_slots(circle_id, day_of_week, starts_at)
    WHERE is_trashed = FALSE;
