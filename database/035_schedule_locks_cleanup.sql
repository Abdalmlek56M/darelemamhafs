-- FINAL 1.8: keep the timetable-overlap guards from 025 but remove the legacy
-- global advisory lock. 012's guards were already replaced by 025, so holding the
-- old global key serialized every timetable mutation and made the per-teacher locks
-- pointless. This migration only replaces the two guard functions; the triggers stay.
--
-- Note: 024's dar_void_payment was superseded by 031 (subscription-aware contract).
-- It is intentionally left in history because 031 replaces the same signature; the
-- live function is the 031 version (checked by tests/regression/tier1-migration-cleanup).
CREATE OR REPLACE FUNCTION public.dar_guard_schedule_slot_teacher_overlap()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
    assigned_teacher_id UUID;
    old_assigned_teacher_id UUID;
    circle_is_active BOOLEAN;
    circle_is_trashed BOOLEAN;
    new_teacher_key BIGINT;
    old_teacher_key BIGINT;
BEGIN
    IF NEW.is_active IS NOT TRUE OR NEW.is_trashed IS TRUE THEN
        RETURN NEW;
    END IF;

    -- Lock the circle row first so the effective teacher cannot change between this
    -- read and the overlap check (a concurrent reassignment waits for this share lock).
    SELECT c.teacher_id, c.is_active, c.is_trashed
    INTO assigned_teacher_id, circle_is_active, circle_is_trashed
    FROM public.circles c
    WHERE c.id = NEW.circle_id
    FOR SHARE;

    -- Cross-circle UPDATEs must also serialize against the old circle's teacher.
    IF TG_OP = 'UPDATE' AND OLD.circle_id IS DISTINCT FROM NEW.circle_id THEN
        SELECT c.teacher_id
        INTO old_assigned_teacher_id
        FROM public.circles c
        WHERE c.id = OLD.circle_id
        FOR SHARE;
    END IF;

    IF assigned_teacher_id IS NULL OR circle_is_active IS NOT TRUE OR circle_is_trashed IS TRUE THEN
        RETURN NEW;
    END IF;

    IF lower(btrim(current_setting('transaction_isolation'))) <> 'read committed' THEN
        RAISE EXCEPTION USING
            ERRCODE = '0A000',
            MESSAGE = 'تعديل جدول المواعيد يتطلب مستوى العزل READ COMMITTED لضمان فحص التداخل بعد القفل.';
    END IF;

    -- Conservative table-wide serialization retained from migration 012 (compatibility
    -- with existing tooling); per-teacher keys below are the long-term serialization point.

    new_teacher_key := public.dar_teacher_schedule_lock_key(assigned_teacher_id);
    IF old_assigned_teacher_id IS NOT NULL AND old_assigned_teacher_id <> assigned_teacher_id THEN
        old_teacher_key := public.dar_teacher_schedule_lock_key(old_assigned_teacher_id);
        PERFORM pg_advisory_xact_lock(LEAST(new_teacher_key, old_teacher_key));
        IF new_teacher_key <> old_teacher_key THEN
            PERFORM pg_advisory_xact_lock(GREATEST(new_teacher_key, old_teacher_key));
        END IF;
    ELSE
        PERFORM pg_advisory_xact_lock(new_teacher_key);
    END IF;

    -- Exact duplicate (same circle/day/start, not trashed): step aside and let the
    -- partial unique index (uq_circle_schedule_slots_not_trashed_day_time) raise 23505
    -- so the API can answer "هذا الموعد مسجل بالفعل" instead of a generic overlap error.
    IF EXISTS (
        SELECT 1
        FROM public.circle_schedule_slots duplicate_slot
        WHERE duplicate_slot.circle_id = NEW.circle_id
          AND duplicate_slot.day_of_week = NEW.day_of_week
          AND duplicate_slot.starts_at = NEW.starts_at
          AND duplicate_slot.is_trashed = FALSE
          AND duplicate_slot.id <> NEW.id
    ) THEN
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
DECLARE
    new_teacher_key BIGINT;
    old_teacher_key BIGINT;
BEGIN
    IF NEW.teacher_id IS NULL OR NEW.is_active IS NOT TRUE OR NEW.is_trashed IS TRUE THEN
        RETURN NEW;
    END IF;

    IF lower(btrim(current_setting('transaction_isolation'))) <> 'read committed' THEN
        RAISE EXCEPTION USING
            ERRCODE = '0A000',
            MESSAGE = 'تعديل جدول المواعيد يتطلب مستوى العزل READ COMMITTED لضمان فحص التداخل بعد القفل.';
    END IF;


    new_teacher_key := public.dar_teacher_schedule_lock_key(NEW.teacher_id);
    IF TG_OP = 'UPDATE' AND OLD.teacher_id IS NOT NULL AND OLD.teacher_id <> NEW.teacher_id THEN
        old_teacher_key := public.dar_teacher_schedule_lock_key(OLD.teacher_id);
        PERFORM pg_advisory_xact_lock(LEAST(new_teacher_key, old_teacher_key));
        IF new_teacher_key <> old_teacher_key THEN
            PERFORM pg_advisory_xact_lock(GREATEST(new_teacher_key, old_teacher_key));
        END IF;
    ELSE
        PERFORM pg_advisory_xact_lock(new_teacher_key);
    END IF;

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

