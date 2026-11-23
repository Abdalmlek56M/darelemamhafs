-- =============================================================================
-- 027 — Meet bot control plane, alerts and manual sessions
-- =============================================================================
-- Adds what the owner asked for after the first real recording:
--   * manual sessions (join any Meet link, no calendar event required)
--   * runtime commands (stop / pause / resume) issued from the admin UI
--   * live telemetry (participants, audio health) reported by the bot
--   * an alerts feed for account/host/recording problems
-- Meet-only is enforced in the API: any non meet.google.com link is rejected.
-- =============================================================================

BEGIN;

-- Manual jobs have no calendar event; scheduled_end is only an upper bound.
ALTER TABLE meet_bot_jobs ALTER COLUMN event_id DROP NOT NULL;
ALTER TABLE meet_bot_jobs
    ADD COLUMN IF NOT EXISTS meet_link TEXT,
    ADD COLUMN IF NOT EXISTS summary TEXT,
    ADD COLUMN IF NOT EXISTS manual BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS stop_requested_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS pause_requested BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS participants INTEGER,
    ADD COLUMN IF NOT EXISTS audio_ok BOOLEAN,
    ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS circle_id_explicit BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE meet_sessions ADD COLUMN IF NOT EXISTS participants INTEGER;

ALTER TABLE meet_settings
    ADD COLUMN IF NOT EXISTS alert_email TEXT,
    ADD COLUMN IF NOT EXISTS telegram_bot_token TEXT,
    ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT,
    ADD COLUMN IF NOT EXISTS max_session_seconds INTEGER NOT NULL DEFAULT 21600
        CHECK (max_session_seconds BETWEEN 300 AND 43200),
    ADD COLUMN IF NOT EXISTS idle_stop_seconds INTEGER NOT NULL DEFAULT 300
        CHECK (idle_stop_seconds BETWEEN 0 AND 3600);

CREATE TABLE IF NOT EXISTS meet_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    severity VARCHAR(10) NOT NULL DEFAULT 'warning'
        CHECK (severity IN ('info', 'warning', 'critical')),
    code VARCHAR(60) NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    job_id UUID NULL REFERENCES meet_bot_jobs(id) ON DELETE SET NULL,
    session_id UUID NULL REFERENCES meet_sessions(id) ON DELETE SET NULL,
    read_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_meet_alerts_created ON meet_alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS ix_meet_alerts_unread ON meet_alerts(created_at DESC) WHERE read_at IS NULL;

INSERT INTO permissions (code, name_ar) VALUES
    ('meet.bot.control', 'التحكم في بوت التسجيل')
ON CONFLICT (code) DO UPDATE SET name_ar = EXCLUDED.name_ar;

-- Owner/admin already manage the module, so they receive the new capability.
INSERT INTO user_permissions(user_id, permission_code)
SELECT u.id, 'meet.bot.control'
FROM app_users u
WHERE EXISTS (
    SELECT 1 FROM user_permissions own
    WHERE own.user_id = u.id AND own.permission_code IN ('meet.manage', 'users.manage')
)
ON CONFLICT DO NOTHING;

COMMENT ON TABLE meet_alerts IS 'Operational alerts (bot join/stop failures, Google session problems, disk).';
COMMENT ON COLUMN meet_bot_jobs.stop_requested_at IS 'Set by the admin UI; the bot stops and finalises on its next heartbeat.';
COMMENT ON COLUMN meet_bot_jobs.pause_requested IS 'Set by the admin UI; the bot freezes/resumes the capture.';

COMMIT;
