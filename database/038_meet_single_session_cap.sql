-- FINAL 2.6: meet_settings had two overlapping hard caps for one recording:
-- max_session_seconds (027, unused) and max_session_minutes (028, used by the bot contract).
-- Keep minutes and drop the unused seconds column. The migration refuses to guess when a
-- non-default seconds cap disagrees with the minute cap.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'meet_settings' AND column_name = 'max_session_seconds'
    ) THEN
        IF EXISTS (
            SELECT 1 FROM meet_settings
            WHERE max_session_seconds IS DISTINCT FROM max_session_minutes * 60
        ) THEN
            RAISE EXCEPTION 'Refusing to drop meet_settings.max_session_seconds: it disagrees with max_session_minutes. Reconcile the owner setting first.';
        END IF;
        ALTER TABLE meet_settings DROP COLUMN max_session_seconds;
    END IF;
END $$;
