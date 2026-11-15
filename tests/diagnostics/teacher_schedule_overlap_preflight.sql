-- Read-only production-data preflight for Migration 012.
-- Lists every pair of overlapping active weekly slots assigned to the same teacher.
-- PostgreSQL base64 output is MIME-wrapped at 76 characters; strip CR/LF so
-- each conflict remains one complete psql row before PowerShell decodes it.
BEGIN TRANSACTION READ ONLY;

WITH active_slots AS (
    SELECT
        c.teacher_id,
        teacher.full_name AS teacher_name,
        c.id AS circle_id,
        c.name AS circle_name,
        slot.id AS slot_id,
        slot.day_of_week,
        slot.starts_at,
        slot.duration_minutes,
        slot.day_of_week::NUMERIC * 86400
            + EXTRACT(EPOCH FROM slot.starts_at) AS starts_at_seconds,
        slot.day_of_week::NUMERIC * 86400
            + EXTRACT(EPOCH FROM slot.starts_at)
            + slot.duration_minutes::NUMERIC * 60 AS ends_at_seconds
    FROM public.circle_schedule_slots slot
    JOIN public.circles c ON c.id = slot.circle_id
    JOIN public.teachers teacher ON teacher.id = c.teacher_id
    WHERE c.teacher_id IS NOT NULL
      AND c.is_active = TRUE
      AND c.is_trashed = FALSE
      AND slot.is_active = TRUE
      AND slot.is_trashed = FALSE
), conflicts AS (
    SELECT
        a.teacher_id,
        a.teacher_name,
        a.circle_id AS circle_a_id,
        a.circle_name AS circle_a_name,
        a.slot_id AS slot_a_id,
        a.day_of_week AS day_a,
        a.starts_at AS start_a,
        a.duration_minutes AS duration_a,
        b.circle_id AS circle_b_id,
        b.circle_name AS circle_b_name,
        b.slot_id AS slot_b_id,
        b.day_of_week AS day_b,
        b.starts_at AS start_b,
        b.duration_minutes AS duration_b
    FROM active_slots a
    JOIN active_slots b
      ON b.teacher_id = a.teacher_id
     AND a.slot_id < b.slot_id
    CROSS JOIN LATERAL (VALUES
        (-604800::NUMERIC),
        (0::NUMERIC),
        (604800::NUMERIC)
    ) AS week_shift(offset_seconds)
    WHERE a.starts_at_seconds < b.ends_at_seconds + week_shift.offset_seconds
      AND b.starts_at_seconds + week_shift.offset_seconds < a.ends_at_seconds
)
SELECT translate(encode(convert_to(json_build_object(
    'teacherId', teacher_id::TEXT,
    'teacherName', teacher_name,
    'circleA', circle_a_name,
    'circleAId', circle_a_id::TEXT,
    'slotAId', slot_a_id::TEXT,
    'dayA', day_a,
    'startA', to_char(start_a, 'HH24:MI'),
    'durationA', duration_a,
    'circleB', circle_b_name,
    'circleBId', circle_b_id::TEXT,
    'slotBId', slot_b_id::TEXT,
    'dayB', day_b,
    'startB', to_char(start_b, 'HH24:MI'),
    'durationB', duration_b
)::TEXT, 'UTF8'), 'base64'), E'\n\r', '')
FROM conflicts
ORDER BY teacher_name, day_a, start_a, day_b, start_b;

COMMIT;
