-- 025: Harden teacher-timetable overlap guards (Phase 2.2-fix).
--
-- Motivation (docs/audits/schedule-overlap-audit.md §8-9):
--   * The 012 guards serialized every timetable mutation through one global advisory
--     key (867530912345). That is correct under READ COMMITTED but the safety margin
--     depended on an implicit assumption; a higher isolation level could observe a
--     stale snapshot after waiting for the lock and let two overlapping writes pass.
--   * Per-teacher advisory locks remove the single global contention point and make
--     the serialization intent explicit and future-proof.
--   * Exact-duplicate inserts (same circle/day/start) used to surface as an overlap
--     (23514) because the BEFORE trigger ran before the partial unique index. The
--     guard now steps aside for exact duplicates so the unique index raises 23505 and
--     the API can return a precise, actionable message.
--
-- Design:
--   * Key helper: dar_teacher_schedule_lock_key(teacher) = hashtextextended(
--       'dar:teacher_timetable:' || teacher::text, 0) :: bigint — stable 64-bit key.
--   * Both guards keep the legacy global key first (conservative full serialization,
--     also keeps the pre-025 guards' behavior for any external tooling), then take
--     the per-teacher key(s). All lock acquisitions use a deterministic order:
--       1) circle row (FOR SHARE in the slot guard; the circle UPDATE already holds it
--          exclusively in the circle guard),
--       2) legacy global advisory key,
--       3) teacher keys sorted numerically (LEAST/GREATEST) when a reassignment
--          involves two different teachers.
--   * Isolation guard: both guards refuse to run outside READ COMMITTED, because the
--     VOLATILE overlap helper must take a fresh snapshot after the lock is granted.
--   * The slot guard now locks the circle row FOR SHARE while reading the effective
--     teacher, so a concurrent teacher reassignment cannot slip between the read and
--     the overlap check.
--   * Trigger and function names are unchanged (CREATE OR REPLACE) so existing API
--     error handling (SQLSTATE 23514 + CONSTRAINT ck_teacher_schedule_no_overlap)
--     keeps working.

CREATE OR REPLACE FUNCTION public.dar_teacher_schedule_lock_key(p_teacher UUID)
RETURNS BIGINT
LANGUAGE sql
IMMUTABLE
STRICT
AS $function$
    SELECT hashtextextended('dar:teacher_timetable:' || p_teacher::text, 0);
$function$;

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
    PERFORM pg_advisory_xact_lock(867530912345::BIGINT);

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

    PERFORM pg_advisory_xact_lock(867530912345::BIGINT);

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

-- Re-create the triggers so a partially failed 025 run still ends in a consistent state.
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
