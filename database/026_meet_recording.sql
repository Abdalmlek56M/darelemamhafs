-- v1.0.0 (Phase 3.1): Google Meet recording - calendar sync, event/circle links,
-- recording scope, bot job queue, sessions and media assets.
-- Source of truth for the module is docs/adr/0007-meet-recording-architecture.md.
-- No media files live in PostgreSQL; these tables only track metadata and state.

-- One connected Google account per provider. Re-connecting replaces the token.
CREATE TABLE IF NOT EXISTS meet_calendar_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider VARCHAR(20) NOT NULL DEFAULT 'google' CHECK (provider IN ('google')),
    account_email VARCHAR(320) NOT NULL,
    calendar_id VARCHAR(200) NOT NULL DEFAULT 'primary',
    encrypted_refresh_token TEXT NOT NULL,
    token_scope TEXT NULL,
    token_issued_at TIMESTAMPTZ NULL,
    sync_token TEXT NULL,
    last_sync_at TIMESTAMPTZ NULL,
    last_full_sync_at TIMESTAMPTZ NULL,
    last_error_code VARCHAR(60) NULL,
    last_error_message TEXT NULL,
    consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
    status VARCHAR(20) NOT NULL DEFAULT 'connected'
        CHECK (status IN ('connected', 'needs_reconnect', 'revoked')),
    connected_by UUID NULL REFERENCES app_users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_meet_calendar_account_email UNIQUE (provider, account_email)
);

-- Only one account may be active at a time; a revoked row stays for history.
CREATE UNIQUE INDEX IF NOT EXISTS uq_meet_calendar_account_active
    ON meet_calendar_accounts(provider) WHERE status <> 'revoked';

-- Calendar events are pulled read-only. occurrence_start separates the expanded
-- occurrences of a recurring event (singleEvents=true on the Google side).
CREATE TABLE IF NOT EXISTS meet_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES meet_calendar_accounts(id) ON DELETE CASCADE,
    google_event_id VARCHAR(1024) NOT NULL,
    calendar_id VARCHAR(200) NOT NULL DEFAULT 'primary',
    occurrence_start TIMESTAMPTZ NOT NULL,
    occurrence_end TIMESTAMPTZ NOT NULL,
    time_zone VARCHAR(80) NULL,
    summary VARCHAR(500) NULL,
    description TEXT NULL,
    location VARCHAR(500) NULL,
    meet_link VARCHAR(1024) NULL,
    html_link VARCHAR(1024) NULL,
    organizer_email VARCHAR(320) NULL,
    google_status VARCHAR(20) NOT NULL DEFAULT 'confirmed'
        CHECK (google_status IN ('confirmed', 'tentative', 'cancelled')),
    is_recurring BOOLEAN NOT NULL DEFAULT FALSE,
    -- inherit = follow the circle selection, force = record, exclude = never record.
    recording_mode VARCHAR(16) NOT NULL DEFAULT 'inherit'
        CHECK (recording_mode IN ('inherit', 'force', 'exclude')),
    raw JSONB NULL,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_meet_event_occurrence UNIQUE (account_id, google_event_id, occurrence_start),
    CONSTRAINT ck_meet_event_window CHECK (occurrence_end >= occurrence_start)
);
CREATE INDEX IF NOT EXISTS idx_meet_events_account_start
    ON meet_events(account_id, occurrence_start);
CREATE INDEX IF NOT EXISTS idx_meet_events_start
    ON meet_events(occurrence_start);

-- Manual or automatic link between one calendar occurrence and one circle.
CREATE TABLE IF NOT EXISTS meet_event_links (
    event_id UUID PRIMARY KEY REFERENCES meet_events(id) ON DELETE CASCADE,
    circle_id UUID NOT NULL REFERENCES circles(id) ON DELETE RESTRICT,
    auto_matched BOOLEAN NOT NULL DEFAULT FALSE,
    linked_by UUID NULL REFERENCES app_users(id) ON DELETE SET NULL,
    linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_meet_event_links_circle
    ON meet_event_links(circle_id);

-- The owner selects which circles are recorded. No row = not recorded.
CREATE TABLE IF NOT EXISTS meet_circle_settings (
    circle_id UUID PRIMARY KEY REFERENCES circles(id) ON DELETE CASCADE,
    auto_record BOOLEAN NOT NULL DEFAULT FALSE,
    auto_link BOOLEAN NOT NULL DEFAULT TRUE,
    updated_by UUID NULL REFERENCES app_users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Durable job queue claimed by the bot with FOR UPDATE SKIP LOCKED.
CREATE TABLE IF NOT EXISTS meet_bot_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES meet_events(id) ON DELETE CASCADE,
    occurrence_key VARCHAR(160) NOT NULL,
    circle_id UUID NULL REFERENCES circles(id) ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'scheduled'
        CHECK (status IN ('scheduled', 'waiting', 'joining', 'live', 'finalizing',
                          'uploading', 'ready', 'failed', 'cancelled', 'stalled', 'partial')),
    scheduled_start TIMESTAMPTZ NOT NULL,
    scheduled_end TIMESTAMPTZ NOT NULL,
    join_at TIMESTAMPTZ NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    claimed_at TIMESTAMPTZ NULL,
    claimed_by VARCHAR(120) NULL,
    heartbeat_at TIMESTAMPTZ NULL,
    started_at TIMESTAMPTZ NULL,
    finished_at TIMESTAMPTZ NULL,
    error_code VARCHAR(60) NULL,
    error_message TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_meet_bot_job_occurrence UNIQUE (occurrence_key),
    CONSTRAINT ck_meet_bot_job_window CHECK (scheduled_end >= scheduled_start)
);
CREATE INDEX IF NOT EXISTS idx_meet_bot_jobs_queue
    ON meet_bot_jobs(status, join_at);
CREATE INDEX IF NOT EXISTS idx_meet_bot_jobs_event
    ON meet_bot_jobs(event_id, scheduled_start);

-- One recording session per job run (a rejoin may add parts, never a second row).
CREATE TABLE IF NOT EXISTS meet_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NULL REFERENCES meet_bot_jobs(id) ON DELETE SET NULL,
    event_id UUID NULL REFERENCES meet_events(id) ON DELETE SET NULL,
    circle_id UUID NULL REFERENCES circles(id) ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'live'
        CHECK (status IN ('live', 'finalizing', 'uploading', 'ready', 'partial', 'failed')),
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at TIMESTAMPTZ NULL,
    scheduled_end TIMESTAMPTZ NULL,
    parts SMALLINT NOT NULL DEFAULT 1 CHECK (parts BETWEEN 1 AND 20),
    duration_seconds INTEGER NULL CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
    failure_reason TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_meet_sessions_event ON meet_sessions(event_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_meet_sessions_status ON meet_sessions(status);

-- HLS segments are temporary; the MP4 is the archived playable asset.
CREATE TABLE IF NOT EXISTS meet_media_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES meet_sessions(id) ON DELETE CASCADE,
    kind VARCHAR(16) NOT NULL CHECK (kind IN ('hls', 'mp4', 'poster')),
    part_no SMALLINT NOT NULL DEFAULT 1 CHECK (part_no BETWEEN 1 AND 20),
    local_path TEXT NULL,
    size_bytes BIGINT NULL CHECK (size_bytes IS NULL OR size_bytes >= 0),
    sha256 VARCHAR(64) NULL,
    duration_seconds INTEGER NULL CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
    status VARCHAR(20) NOT NULL DEFAULT 'local'
        CHECK (status IN ('local', 'uploading', 'uploaded', 'verified', 'failed', 'deleted', 'purged')),
    drive_file_id VARCHAR(200) NULL,
    drive_link TEXT NULL,
    uploaded_at TIMESTAMPTZ NULL,
    verified_on_drive BOOLEAN NOT NULL DEFAULT FALSE,
    deleted_at TIMESTAMPTZ NULL,
    deleted_by UUID NULL REFERENCES app_users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_meet_media_asset_part UNIQUE (session_id, kind, part_no)
);
CREATE INDEX IF NOT EXISTS idx_meet_media_assets_session ON meet_media_assets(session_id);
CREATE INDEX IF NOT EXISTS idx_meet_media_assets_pending
    ON meet_media_assets(status) WHERE status IN ('local', 'uploading', 'failed');

-- Single-row runtime settings. The disk thresholds are the owner's decision.
CREATE TABLE IF NOT EXISTS meet_settings (
    id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
    recording_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    join_lead_seconds INTEGER NOT NULL DEFAULT 60
        CHECK (join_lead_seconds BETWEEN 10 AND 600),
    stop_grace_seconds INTEGER NOT NULL DEFAULT 120
        CHECK (stop_grace_seconds BETWEEN 0 AND 900),
    max_concurrent_sessions SMALLINT NOT NULL DEFAULT 1
        CHECK (max_concurrent_sessions BETWEEN 1 AND 2),
    disk_block_gb INTEGER NOT NULL DEFAULT 25 CHECK (disk_block_gb BETWEEN 5 AND 500),
    disk_warn_gb INTEGER NOT NULL DEFAULT 40 CHECK (disk_warn_gb BETWEEN 10 AND 1000),
    upload_bwlimit VARCHAR(20) NOT NULL DEFAULT '8M',
    hls_retention_hours INTEGER NOT NULL DEFAULT 24
        CHECK (hls_retention_hours BETWEEN 1 AND 168),
    updated_by UUID NULL REFERENCES app_users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_meet_settings_disk_order CHECK (disk_warn_gb > disk_block_gb)
);
INSERT INTO meet_settings(id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;

-- Permission catalog (kept in sync with PermissionCodes.cs and Security.cs).
INSERT INTO permissions (code, name_ar) VALUES
    ('meet.view', 'عرض التسجيل والمحاضرات'),
    ('meet.manage', 'إدارة التسجيل وربط الحلقات'),
    ('meet.calendar.manage', 'ربط ومزامنة تقويم Google'),
    ('meet.media.view', 'مشاهدة تسجيلات الحلقات'),
    ('meet.media.delete', 'حذف ملفات التسجيل يدويًا')
ON CONFLICT (code) DO UPDATE SET name_ar = EXCLUDED.name_ar;

-- Owner/admin default bundle: everything. Granted by capability, not by a role
-- row, because the installation may not use roles at all.
INSERT INTO user_permissions(user_id, permission_code)
SELECT u.id, p.code
FROM app_users u
CROSS JOIN (VALUES
    ('meet.view'), ('meet.manage'), ('meet.calendar.manage'),
    ('meet.media.view'), ('meet.media.delete')
) AS p(code)
WHERE EXISTS (
    SELECT 1 FROM user_permissions own
    WHERE own.user_id = u.id AND own.permission_code = 'users.manage'
)
ON CONFLICT DO NOTHING;

-- Supervisor default bundle: view only. meet.media.view stays revocable per user
-- from the permissions screen, which is exactly what the owner asked for.
INSERT INTO user_permissions(user_id, permission_code)
SELECT u.id, p.code
FROM app_users u
CROSS JOIN (VALUES ('meet.view'), ('meet.media.view')) AS p(code)
WHERE EXISTS (
    SELECT 1 FROM user_permissions own
    WHERE own.user_id = u.id AND own.permission_code = 'supervisor.portal'
)
ON CONFLICT DO NOTHING;

-- Document the same defaults on the supervisor role template (roles are
-- documentation only; users without a role row still receive the grants above).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN ('meet.view', 'meet.media.view')
WHERE r.code = 'supervisor'
ON CONFLICT DO NOTHING;

COMMENT ON TABLE meet_calendar_accounts IS 'Google Calendar OAuth account; refresh token is AES-GCM encrypted.';
COMMENT ON TABLE meet_events IS 'Calendar occurrences pulled read-only; occurrence_start identifies expanded recurring instances.';
COMMENT ON TABLE meet_event_links IS 'Calendar occurrence to circle link used for naming, reporting and recording scope.';
COMMENT ON TABLE meet_circle_settings IS 'Owner-selected circles eligible for automatic recording.';
COMMENT ON TABLE meet_bot_jobs IS 'Durable recording queue claimed by dar-meet-bot with SKIP LOCKED.';
COMMENT ON TABLE meet_sessions IS 'Recording session lifecycle; media assets hang off a session.';
COMMENT ON TABLE meet_media_assets IS 'Temporary HLS, final MP4 and poster metadata; deletion is manual and audited.';
COMMENT ON TABLE meet_settings IS 'Single-row operational limits for the recording module.';
