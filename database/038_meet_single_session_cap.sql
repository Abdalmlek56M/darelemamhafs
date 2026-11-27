-- FINAL 2.6: meet_settings had two overlapping hard caps for one recording:
-- max_session_seconds (027, unused by code) and max_session_minutes (028, the cap the
-- bot/recorder contract actually reads). Keep minutes and drop the unused seconds column.
--
-- 038 must be safe on a fresh schema: the shipped defaults disagree (21600 seconds vs
-- 240 minutes). Dropping seconds is the point of the migration, so a mismatch is logged
-- with RAISE NOTICE and minutes is preserved exactly as the owner set it.
DO $$
DECLARE
    v_seconds INTEGER;
    v_minutes INTEGER;
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'meet_settings' AND column_name = 'max_session_seconds'
    ) THEN
        SELECT max_session_seconds, max_session_minutes
        INTO v_seconds, v_minutes
        FROM meet_settings
        WHERE id = TRUE;

        IF FOUND AND v_seconds IS DISTINCT FROM v_minutes * 60 THEN
            RAISE NOTICE 'meet_settings cap mismatch: dropping max_session_seconds=% and keeping max_session_minutes=%',
                v_seconds, v_minutes;
        END IF;

        ALTER TABLE meet_settings DROP COLUMN max_session_seconds;
    END IF;
END $$;
