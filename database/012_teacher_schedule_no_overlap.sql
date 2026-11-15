-- Enforce one non-overlapping active weekly timetable per teacher.
-- Exact adjacency is allowed. Intervals are evaluated on a circular 7-day timeline,
-- so sessions crossing midnight or the Saturday/Sunday boundary are handled too.

CREATE OR REPLACE FUNCTION public.dar_teacher_has_schedule_overlap(
    p_teacher_id UUID,
    p_day_of_week SMALLINT,
    p_starts_at TIME WITHOUT TIME ZONE,
    p_duration_minutes INTEGER,
    p_exclude_slot_id UUID DEFAULT NULL,
    p_exclude_circle_id UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE SQL
VOLATILE
AS $function$
    WITH candidate AS (
        SELECT
            p_day_of_week::NUMERIC * 86400 + EXTRACT(EPOCH FROM p_starts_at) AS starts_at_seconds,
            p_day_of_week::NUMERIC * 86400 + EXTRACT(EPOCH FROM p_starts_at)
                + p_duration_minutes::NUMERIC * 60 AS ends_at_seconds
    )
    SELECT EXISTS (
        SELECT 1
        FROM public.circle_schedule_slots existing_slot
        JOIN public.circles existing_circle ON existing_circle.id = existing_slot.circle_id
        CROSS JOIN candidate
        CROSS JOIN LATERAL (VALUES (-604800::NUMERIC), (0::NUMERIC), (604800::NUMERIC)) AS week_shift(offset_seconds)
        WHERE existing_circle.teacher_id = p_teacher_id
          AND existing_circle.is_active = TRUE
          AND existing_circle.is_trashed = FALSE
          AND existing_slot.is_active = TRUE
          AND existing_slot.is_trashed = FALSE
          AND (p_exclude_slot_id IS NULL OR existing_slot.id <> p_exclude_slot_id)
          AND (p_exclude_circle_id IS NULL OR existing_circle.id <> p_exclude_circle_id)
          AND candidate.starts_at_seconds < (
                existing_slot.day_of_week::NUMERIC * 86400
                + EXTRACT(EPOCH FROM existing_slot.starts_at)
                + existing_slot.duration_minutes::NUMERIC * 60
                + week_shift.offset_seconds
          )
          AND (
                existing_slot.day_of_week::NUMERIC * 86400
                + EXTRACT(EPOCH FROM existing_slot.starts_at)
                + week_shift.offset_seconds
          ) < candidate.ends_at_seconds
    );
$function$;

-- Refuse to adopt a timetable that already contains overlapping active sessions.
-- Resolve any reported legacy conflicts before applying this migration.
DO $migration$
DECLARE
    conflicting_slot RECORD;
BEGIN
    SELECT
        existing_circle.teacher_id,
        existing_circle.name AS circle_name,
        existing_slot.id AS slot_id,
        existing_slot.day_of_week,
        existing_slot.starts_at
    INTO conflicting_slot
    FROM public.circle_schedule_slots existing_slot
    JOIN public.circles existing_circle ON existing_circle.id = existing_slot.circle_id
    WHERE existing_circle.teacher_id IS NOT NULL
      AND existing_circle.is_active = TRUE
      AND existing_circle.is_trashed = FALSE
      AND existing_slot.is_active = TRUE
      AND existing_slot.is_trashed = FALSE
      AND public.dar_teacher_has_schedule_overlap(
            existing_circle.teacher_id,
            existing_slot.day_of_week,
            existing_slot.starts_at,
            existing_slot.duration_minutes,
            existing_slot.id,
            NULL
      )
    LIMIT 1;

    IF FOUND THEN
        RAISE EXCEPTION
            'Migration 012 stopped: teacher % has overlapping active schedule slots (circle %, slot %, day %, start %). Resolve the existing timetable conflict, then retry.',
            conflicting_slot.teacher_id,
            conflicting_slot.circle_name,
            conflicting_slot.slot_id,
            conflicting_slot.day_of_week,
            conflicting_slot.starts_at;
    END IF;
END;
$migration$;

-- Partial index narrows the active weekly timetable rows inspected by the guard.
CREATE INDEX IF NOT EXISTS ix_schedule_slots_active_day_lookup
    ON public.circle_schedule_slots(day_of_week, starts_at, circle_id, duration_minutes)
    WHERE is_active = TRUE AND is_trashed = FALSE;

CREATE OR REPLACE FUNCTION public.dar_guard_schedule_slot_teacher_overlap()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
    assigned_teacher_id UUID;
    circle_is_active BOOLEAN;
    circle_is_trashed BOOLEAN;
BEGIN
    IF NEW.is_active IS NOT TRUE OR NEW.is_trashed IS TRUE THEN
        RETURN NEW;
    END IF;

    -- One short global transaction lock serializes timetable mutations. The shared
    -- overlap helper is VOLATILE so its check gets a fresh READ COMMITTED snapshot
    -- after this lock is granted, avoiding stale-snapshot races between writers.
    PERFORM pg_advisory_xact_lock(867530912345::BIGINT);

    SELECT c.teacher_id, c.is_active, c.is_trashed
    INTO assigned_teacher_id, circle_is_active, circle_is_trashed
    FROM public.circles c
    WHERE c.id = NEW.circle_id;

    IF assigned_teacher_id IS NULL OR circle_is_active IS NOT TRUE OR circle_is_trashed IS TRUE THEN
        RETURN NEW;
    END IF;

    IF public.dar_teacher_has_schedule_overlap(
        assigned_teacher_id,
        NEW.day_of_week,
        NEW.starts_at,
        NEW.duration_minutes,
        NEW.id,
        NULL
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            CONSTRAINT = 'ck_teacher_schedule_no_overlap',
            MESSAGE = 'توجد حصة أخرى للمعلمة نفسها تتداخل مع هذا الموعد. اختر وقتًا غير متداخل؛ يُسمح بالمواعيد المتتالية.';
    END IF;

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.dar_guard_circle_teacher_schedule_overlap()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
    IF NEW.teacher_id IS NULL OR NEW.is_active IS NOT TRUE OR NEW.is_trashed IS TRUE THEN
        RETURN NEW;
    END IF;

    PERFORM pg_advisory_xact_lock(867530912345::BIGINT);

    IF EXISTS (
        SELECT 1
        FROM public.circle_schedule_slots own_slot
        WHERE own_slot.circle_id = NEW.id
          AND own_slot.is_active = TRUE
          AND own_slot.is_trashed = FALSE
          AND public.dar_teacher_has_schedule_overlap(
                NEW.teacher_id,
                own_slot.day_of_week,
                own_slot.starts_at,
                own_slot.duration_minutes,
                own_slot.id,
                NEW.id
          )
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            CONSTRAINT = 'ck_teacher_schedule_no_overlap',
            MESSAGE = 'لا يمكن إسناد هذه المعلمة للحلقة أو تفعيلها؛ لديها حصة أخرى تتداخل مع أحد مواعيد الحلقة. عدّل المواعيد أولًا.';
    END IF;

    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_circle_schedule_slots_teacher_overlap ON public.circle_schedule_slots;
CREATE TRIGGER trg_circle_schedule_slots_teacher_overlap
    BEFORE INSERT OR UPDATE ON public.circle_schedule_slots
    FOR EACH ROW
    EXECUTE FUNCTION public.dar_guard_schedule_slot_teacher_overlap();

DROP TRIGGER IF EXISTS trg_circles_teacher_schedule_overlap ON public.circles;
CREATE TRIGGER trg_circles_teacher_schedule_overlap
    BEFORE UPDATE OF teacher_id, is_active, is_trashed ON public.circles
    FOR EACH ROW
    EXECUTE FUNCTION public.dar_guard_circle_teacher_schedule_overlap();
