-- Run only against a uniquely named disposable test database.
-- All synthetic records are rolled back at the end.
BEGIN;

DO $test$
DECLARE
    teacher_one UUID;
    teacher_two UUID;
    circle_one UUID;
    circle_two UUID;
    circle_three UUID;
    inactive_circle UUID;
    trashed_circle UUID;
    circle_six UUID;
    circle_seven UUID;
    adjacent_slot UUID;
    restorable_slot UUID;
BEGIN
    INSERT INTO public.teachers(teacher_code, full_name)
    VALUES ('SCH-OVERLAP-T1', 'Schedule overlap test teacher one')
    RETURNING id INTO teacher_one;

    INSERT INTO public.teachers(teacher_code, full_name)
    VALUES ('SCH-OVERLAP-T2', 'Schedule overlap test teacher two')
    RETURNING id INTO teacher_two;

    INSERT INTO public.circles(circle_code, name, teacher_id)
    VALUES ('SCH-OVERLAP-C1', 'Schedule overlap circle one', teacher_one)
    RETURNING id INTO circle_one;

    INSERT INTO public.circles(circle_code, name, teacher_id)
    VALUES ('SCH-OVERLAP-C2', 'Schedule overlap circle two', teacher_one)
    RETURNING id INTO circle_two;

    INSERT INTO public.circles(circle_code, name, teacher_id)
    VALUES ('SCH-OVERLAP-C3', 'Schedule overlap circle three', teacher_two)
    RETURNING id INTO circle_three;

    -- Baseline: Monday 09:00-10:00 for teacher one.
    INSERT INTO public.circle_schedule_slots(circle_id, day_of_week, starts_at, duration_minutes)
    VALUES (circle_one, 1, '09:00', 60);

    -- Overlap in a different circle must be rejected.
    BEGIN
        INSERT INTO public.circle_schedule_slots(circle_id, day_of_week, starts_at, duration_minutes)
        VALUES (circle_two, 1, '09:30', 60);
        RAISE EXCEPTION 'TEST_ASSERTION_FAILED: overlapping cross-circle schedule was accepted.';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;

    -- Exact adjacency is allowed: Monday 10:00 starts when the prior slot ends.
    INSERT INTO public.circle_schedule_slots(circle_id, day_of_week, starts_at, duration_minutes)
    VALUES (circle_two, 1, '10:00', 60)
    RETURNING id INTO adjacent_slot;

    -- Different teachers may have overlapping schedules.
    INSERT INTO public.circle_schedule_slots(circle_id, day_of_week, starts_at, duration_minutes)
    VALUES (circle_three, 1, '09:30', 60);

    -- Overlapping slots inside the same circle are rejected as well.
    BEGIN
        INSERT INTO public.circle_schedule_slots(circle_id, day_of_week, starts_at, duration_minutes)
        VALUES (circle_one, 1, '09:45', 15);
        RAISE EXCEPTION 'TEST_ASSERTION_FAILED: overlapping same-circle schedule was accepted.';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;

    -- The weekly timeline wraps across midnight and the Saturday/Sunday boundary.
    INSERT INTO public.circle_schedule_slots(circle_id, day_of_week, starts_at, duration_minutes)
    VALUES (circle_one, 6, '23:00', 120);
    BEGIN
        INSERT INTO public.circle_schedule_slots(circle_id, day_of_week, starts_at, duration_minutes)
        VALUES (circle_two, 0, '00:30', 30);
        RAISE EXCEPTION 'TEST_ASSERTION_FAILED: Saturday/Sunday overlap was accepted.';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;

    -- Assigning an already scheduled circle to a conflicting teacher is rejected.
    BEGIN
        UPDATE public.circles SET teacher_id = teacher_one WHERE id = circle_three;
        RAISE EXCEPTION 'TEST_ASSERTION_FAILED: conflicting teacher reassignment was accepted.';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;

    -- An inactive circle can hold draft slots; activating it must validate the timetable.
    INSERT INTO public.circles(circle_code, name, teacher_id, is_active)
    VALUES ('SCH-OVERLAP-C4', 'Schedule overlap inactive circle', teacher_one, FALSE)
    RETURNING id INTO inactive_circle;
    INSERT INTO public.circle_schedule_slots(circle_id, day_of_week, starts_at, duration_minutes)
    VALUES (inactive_circle, 1, '09:30', 30);
    BEGIN
        UPDATE public.circles SET is_active = TRUE WHERE id = inactive_circle;
        RAISE EXCEPTION 'TEST_ASSERTION_FAILED: conflicting circle activation was accepted.';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;

    -- Restoring a trashed circle must revalidate its active timetable too.
    INSERT INTO public.circles(circle_code, name, teacher_id, is_trashed)
    VALUES ('SCH-OVERLAP-C5', 'Schedule overlap trashed circle', teacher_one, TRUE)
    RETURNING id INTO trashed_circle;
    INSERT INTO public.circle_schedule_slots(circle_id, day_of_week, starts_at, duration_minutes)
    VALUES (trashed_circle, 1, '09:30', 30);
    BEGIN
        UPDATE public.circles SET is_trashed = FALSE WHERE id = trashed_circle;
        RAISE EXCEPTION 'TEST_ASSERTION_FAILED: conflicting circle restoration was accepted.';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;

    -- Moving an existing active slot into a conflict must be rejected.
    BEGIN
        UPDATE public.circle_schedule_slots SET starts_at = '09:30' WHERE id = adjacent_slot;
        RAISE EXCEPTION 'TEST_ASSERTION_FAILED: moving a slot into a conflict was accepted.';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;

    -- Deactivated timetable rows do not block new active schedules.
    UPDATE public.circle_schedule_slots SET is_active = FALSE WHERE id = adjacent_slot;
    INSERT INTO public.circles(circle_code, name, teacher_id)
    VALUES ('SCH-OVERLAP-C6', 'Schedule overlap circle six', teacher_one)
    RETURNING id INTO circle_six;
    INSERT INTO public.circle_schedule_slots(circle_id, day_of_week, starts_at, duration_minutes)
    VALUES (circle_six, 1, '10:00', 30);

    -- Reactivating a previously inactive slot must revalidate the current timetable.
    BEGIN
        UPDATE public.circle_schedule_slots SET is_active = TRUE WHERE id = adjacent_slot;
        RAISE EXCEPTION 'TEST_ASSERTION_FAILED: conflicting slot reactivation was accepted.';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;

    -- Restoring a trashed slot must also revalidate against schedules created since it was trashed.
    INSERT INTO public.circle_schedule_slots(circle_id, day_of_week, starts_at, duration_minutes)
    VALUES (circle_two, 1, '11:00', 60)
    RETURNING id INTO restorable_slot;
    UPDATE public.circle_schedule_slots SET is_trashed = TRUE WHERE id = restorable_slot;

    INSERT INTO public.circles(circle_code, name, teacher_id)
    VALUES ('SCH-OVERLAP-C7', 'Schedule overlap circle seven', teacher_one)
    RETURNING id INTO circle_seven;
    INSERT INTO public.circle_schedule_slots(circle_id, day_of_week, starts_at, duration_minutes)
    VALUES (circle_seven, 1, '11:00', 30);

    BEGIN
        UPDATE public.circle_schedule_slots SET is_trashed = FALSE WHERE id = restorable_slot;
        RAISE EXCEPTION 'TEST_ASSERTION_FAILED: conflicting slot trash restoration was accepted.';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;
END;
$test$;

SELECT 'PASS: teacher timetable overlap regression completed.' AS result;
ROLLBACK;
