-- One-time, guarded correction of three confirmed Sunday schedule entries.
-- Maps 00:07 -> 07:00, 00:10 -> 10:00, 00:11 -> 11:00.
-- Updates ONLY starts_at on the three exact slot IDs. Attendance/pay snapshots are never updated.
-- Every change gets before/after snapshots in audit_log inside the same transaction.
BEGIN;

DO $repair$
DECLARE
    item RECORD;
    actual_count INTEGER;
    before_row JSONB;
    after_row JSONB;
    conflict_found BOOLEAN;
BEGIN
    PERFORM pg_advisory_xact_lock(867530912345::BIGINT);

    -- Refuse to run against a different database state or any different target rows.
    SELECT COUNT(*) INTO actual_count
    FROM public.circle_schedule_slots ss
    JOIN public.circles c ON c.id = ss.circle_id
    JOIN (VALUES
        ('5e3581db-6aef-48fa-9abb-e1d9b0f8f474'::UUID, TIME '00:07', TIME '07:00'),
        ('78189952-a897-4a6d-b838-42e0037e5ccb'::UUID, TIME '00:10', TIME '10:00'),
        ('4e0823c4-5667-4526-9038-47fdf8602e83'::UUID, TIME '00:11', TIME '11:00')
    ) AS expected(slot_id, old_time, new_time) ON expected.slot_id = ss.id
    WHERE ss.circle_id = '01a6c471-d6a3-4bc2-83d6-af9379d214de'::UUID
      AND c.teacher_id = '86f8e5af-19e8-4403-9431-3a6d6bf701ca'::UUID
      AND ss.day_of_week = 0
      AND ss.starts_at = expected.old_time
      AND ss.duration_minutes = 60
      AND ss.is_active = TRUE
      AND ss.is_trashed = FALSE
      AND c.is_active = TRUE
      AND c.is_trashed = FALSE;

    IF actual_count <> 3 THEN
        RAISE EXCEPTION 'Repair stopped safely: expected exactly 3 unchanged active target slots, found %.', actual_count;
    END IF;

    -- Do not collide with another schedule in the same circle/day (the table's unique key).
    IF EXISTS (
        SELECT 1
        FROM public.circle_schedule_slots ss
        JOIN (VALUES
            ('5e3581db-6aef-48fa-9abb-e1d9b0f8f474'::UUID, TIME '07:00'),
            ('78189952-a897-4a6d-b838-42e0037e5ccb'::UUID, TIME '10:00'),
            ('4e0823c4-5667-4526-9038-47fdf8602e83'::UUID, TIME '11:00')
        ) AS proposed(slot_id, new_time) ON TRUE
        WHERE ss.circle_id = '01a6c471-d6a3-4bc2-83d6-af9379d214de'::UUID
          AND ss.day_of_week = 0
          AND ss.id <> proposed.slot_id
          AND ss.starts_at = proposed.new_time
    ) THEN
        RAISE EXCEPTION 'Repair stopped safely: one of the proposed times already exists in this circle.';
    END IF;

    -- Confirm the proposed times will not collide with any other active slot assigned to this teacher.
    WITH proposed AS (
        SELECT * FROM (VALUES
            ('5e3581db-6aef-48fa-9abb-e1d9b0f8f474'::UUID, TIME '07:00', 60),
            ('78189952-a897-4a6d-b838-42e0037e5ccb'::UUID, TIME '10:00', 60),
            ('4e0823c4-5667-4526-9038-47fdf8602e83'::UUID, TIME '11:00', 60)
        ) AS p(slot_id, starts_at, duration_minutes)
    ), proposed_seconds AS (
        SELECT slot_id, EXTRACT(EPOCH FROM starts_at)::NUMERIC AS start_seconds,
               EXTRACT(EPOCH FROM starts_at)::NUMERIC + duration_minutes * 60 AS end_seconds
        FROM proposed
    )
    SELECT EXISTS (
        SELECT 1
        FROM proposed_seconds p
        JOIN public.circle_schedule_slots existing_slot ON TRUE
        JOIN public.circles existing_circle ON existing_circle.id = existing_slot.circle_id
        CROSS JOIN LATERAL (VALUES (-604800::NUMERIC), (0::NUMERIC), (604800::NUMERIC)) AS shift(offset_seconds)
        WHERE existing_circle.teacher_id = '86f8e5af-19e8-4403-9431-3a6d6bf701ca'::UUID
          AND existing_circle.is_active = TRUE AND existing_circle.is_trashed = FALSE
          AND existing_slot.is_active = TRUE AND existing_slot.is_trashed = FALSE
          AND existing_slot.id NOT IN (
              '5e3581db-6aef-48fa-9abb-e1d9b0f8f474'::UUID,
              '78189952-a897-4a6d-b838-42e0037e5ccb'::UUID,
              '4e0823c4-5667-4526-9038-47fdf8602e83'::UUID
          )
          AND p.start_seconds < existing_slot.day_of_week::NUMERIC * 86400
                + EXTRACT(EPOCH FROM existing_slot.starts_at)
                + existing_slot.duration_minutes::NUMERIC * 60 + shift.offset_seconds
          AND existing_slot.day_of_week::NUMERIC * 86400
                + EXTRACT(EPOCH FROM existing_slot.starts_at) + shift.offset_seconds < p.end_seconds
    ) INTO conflict_found;

    IF conflict_found THEN
        RAISE EXCEPTION 'Repair stopped safely: one of the proposed times conflicts with another active schedule for this teacher.';
    END IF;

    -- Update rows one at a time, retaining their primary keys and all attendance links.
    FOR item IN
        SELECT * FROM (VALUES
            ('5e3581db-6aef-48fa-9abb-e1d9b0f8f474'::UUID, TIME '00:07', TIME '07:00'),
            ('78189952-a897-4a6d-b838-42e0037e5ccb'::UUID, TIME '00:10', TIME '10:00'),
            ('4e0823c4-5667-4526-9038-47fdf8602e83'::UUID, TIME '00:11', TIME '11:00')
        ) AS correction(slot_id, old_time, new_time)
    LOOP
        SELECT to_jsonb(ss) INTO before_row
        FROM public.circle_schedule_slots ss
        WHERE ss.id = item.slot_id
        FOR UPDATE;

        UPDATE public.circle_schedule_slots
        SET starts_at = item.new_time
        WHERE id = item.slot_id AND starts_at = item.old_time;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Repair stopped safely: slot % changed while applying the correction.', item.slot_id;
        END IF;

        SELECT to_jsonb(ss) INTO after_row
        FROM public.circle_schedule_slots ss
        WHERE ss.id = item.slot_id;

        INSERT INTO public.audit_log(
            actor_user_id, actor_display_name, action_code, entity_type, entity_id,
            details, before_data, after_data, request_path, http_method, can_restore
        ) VALUES (
            NULL,
            'إصلاح آمن لجدول المواعيد',
            'schedule.time.correct',
            'circle_schedule_slot',
            item.slot_id,
            jsonb_build_object(
                'reason', 'Corrected hour/minute order in legacy RTL time entry',
                'oldStartsAt', item.old_time::TEXT,
                'newStartsAt', item.new_time::TEXT,
                'attendanceRowsPreserved', TRUE,
                'slotIdPreserved', TRUE
            ),
            before_row,
            after_row,
            '/maintenance/teacher-schedule-overlap-repair',
            'PATCH',
            TRUE
        );
    END LOOP;
END;
$repair$;

COMMIT;
