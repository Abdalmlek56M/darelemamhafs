-- =============================================================================
-- 028 — Meet access type, smart session length and alert delivery
-- =============================================================================
-- The bot is the meeting host, so it can decide how people join:
--   open    -> anyone with the link enters without asking (default)
--   trusted -> only invited Google accounts enter without asking
-- Per event override wins over the module default.
-- Sessions also stop on their own when the room stays empty (bot alone) for a while.
-- =============================================================================

ALTER TABLE meet_settings
    ADD COLUMN IF NOT EXISTS default_access_type VARCHAR(10) NOT NULL DEFAULT 'open'
        CHECK (default_access_type IN ('open', 'trusted')),
    ADD COLUMN IF NOT EXISTS max_session_minutes INTEGER NOT NULL DEFAULT 240
        CHECK (max_session_minutes BETWEEN 5 AND 720);

ALTER TABLE meet_events
    ADD COLUMN IF NOT EXISTS access_type VARCHAR(10) NULL
        CHECK (access_type IS NULL OR access_type IN ('open', 'trusted'));

ALTER TABLE meet_alerts
    ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS delivery_attempts SMALLINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS delivery_error TEXT NULL;

CREATE INDEX IF NOT EXISTS ix_meet_alerts_pending
    ON meet_alerts(created_at) WHERE delivered_at IS NULL;

COMMENT ON COLUMN meet_events.access_type IS 'NULL inherits meet_settings.default_access_type.';
COMMENT ON COLUMN meet_settings.max_session_minutes IS 'Hard cap for one recording, independent of the calendar end.';
COMMENT ON COLUMN meet_alerts.delivered_at IS 'Set once the alert reached the configured channels.';
