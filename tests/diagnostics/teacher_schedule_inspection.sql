-- Read-only inspection of the affected circle and the teacher's active weekly timetable.
-- Includes raw PostgreSQL TIME, exact seconds, record timestamps, attendance counts,
-- and available schedule.create audit details. It never changes schema or business rows.
BEGIN TRANSACTION READ ONLY;

WITH target AS (
    SELECT
        '01a6c471-d6a3-4bc2-83d6-af9379d214de'::UUID AS circle_id,
        '86f8e5af-19e8-4403-9431-3a6d6bf701ca'::UUID AS teacher_id
), relevant_slots AS (
    SELECT
        slot.*,
        c.name AS circle_name,
        c.circle_code,
        c.teacher_id,
        COALESCE(t.full_name, '') AS teacher_name,
        c.is_active AS circle_is_active,
        c.is_trashed AS circle_is_trashed,
        c.schedule_text,
        c.starts_on
    FROM public.circle_schedule_slots slot
    JOIN public.circles c ON c.id = slot.circle_id
    LEFT JOIN public.teachers t ON t.id = c.teacher_id
    CROSS JOIN target
    WHERE c.id = target.circle_id
       OR (
            c.teacher_id = target.teacher_id
            AND c.is_active = TRUE
            AND c.is_trashed = FALSE
            AND slot.is_active = TRUE
            AND slot.is_trashed = FALSE
       )
)
SELECT translate(
    encode(
        convert_to(
            json_build_object(
                'recordType', 'scheduleSlot',
                'slotId', slot.id::TEXT,
                'circleId', slot.circle_id::TEXT,
                'circleCode', slot.circle_code,
                'circleName', slot.circle_name,
                'teacherId', slot.teacher_id::TEXT,
                'teacherName', slot.teacher_name,
                'dayOfWeek', slot.day_of_week,
                'dayName', CASE slot.day_of_week
                    WHEN 0 THEN 'الأحد'
                    WHEN 1 THEN 'الاثنين'
                    WHEN 2 THEN 'الثلاثاء'
                    WHEN 3 THEN 'الأربعاء'
                    WHEN 4 THEN 'الخميس'
                    WHEN 5 THEN 'الجمعة'
                    WHEN 6 THEN 'السبت'
                    ELSE 'غير معروف'
                END,
                'startsAt', to_char(slot.starts_at, 'HH24:MI:SS.US'),
                'startsAtSeconds', EXTRACT(EPOCH FROM slot.starts_at)::NUMERIC,
                'durationMinutes', slot.duration_minutes,
                'endsAtSecondsFromMidnight', EXTRACT(EPOCH FROM slot.starts_at)::NUMERIC + slot.duration_minutes * 60,
                'slotIsActive', slot.is_active,
                'slotIsTrashed', slot.is_trashed,
                'circleIsActive', slot.circle_is_active,
                'circleIsTrashed', slot.circle_is_trashed,
                'circleStartsOn', slot.starts_on,
                'legacyScheduleText', slot.schedule_text,
                'createdAtCairo', to_char(slot.created_at AT TIME ZONE 'Africa/Cairo', 'YYYY-MM-DD HH24:MI:SS'),
                'teacherAttendanceTotal', (
                    SELECT COUNT(*) FROM public.teacher_attendance ta WHERE ta.schedule_slot_id = slot.id
                ),
                'teacherAttendanceActive', (
                    SELECT COUNT(*) FROM public.teacher_attendance ta WHERE ta.schedule_slot_id = slot.id AND ta.is_trashed = FALSE
                ),
                'studentAttendanceTotal', (
                    SELECT COUNT(*) FROM public.student_attendance sa WHERE sa.schedule_slot_id = slot.id
                ),
                'studentAttendanceActive', (
                    SELECT COUNT(*) FROM public.student_attendance sa WHERE sa.schedule_slot_id = slot.id AND sa.is_trashed = FALSE
                ),
                'auditEvents', COALESCE((
                    SELECT json_agg(
                        json_build_object(
                            'actionCode', audit.action_code,
                            'entityType', audit.entity_type,
                            'occurredAtCairo', to_char(audit.occurred_at AT TIME ZONE 'Africa/Cairo', 'YYYY-MM-DD HH24:MI:SS'),
                            'details', audit.details
                        ) ORDER BY audit.occurred_at, audit.id
                    )
                    FROM public.audit_log audit
                    WHERE audit.entity_id = slot.id
                      AND audit.entity_type = 'circle_schedule_slot'
                ), '[]'::JSON)
            )::TEXT,
            'UTF8'
        ),
        'base64'
    ),
    E'\n\r', ''
)
FROM relevant_slots slot
ORDER BY
    (slot.circle_id = (SELECT circle_id FROM target)) DESC,
    slot.is_active DESC,
    slot.is_trashed,
    slot.day_of_week,
    slot.starts_at,
    slot.circle_name;

COMMIT;
