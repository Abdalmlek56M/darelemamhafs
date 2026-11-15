-- v0.9: Identity for the web app.
-- Existing password accounts remain valid through the temporary fallback.
-- OTP/Google users are provisioned by an admin, not self-registered.

ALTER TABLE app_users ADD COLUMN IF NOT EXISTS email VARCHAR(320);
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS google_subject VARCHAR(255);

CREATE UNIQUE INDEX IF NOT EXISTS ux_app_users_email_lower
    ON app_users (lower(email))
    WHERE email IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_app_users_google_subject
    ON app_users (google_subject)
    WHERE google_subject IS NOT NULL;

CREATE TABLE IF NOT EXISTS auth_email_otps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(320) NOT NULL,
    code_hash TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 20),
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    request_ip TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_auth_email_otps_email_created
    ON auth_email_otps (lower(email), created_at DESC);

CREATE INDEX IF NOT EXISTS ix_auth_email_otps_active_expiry
    ON auth_email_otps (expires_at)
    WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS auth_sessions (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    ticket TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    last_seen_at TIMESTAMPTZ,
    ip TEXT,
    user_agent TEXT
);

CREATE INDEX IF NOT EXISTS ix_auth_sessions_user_active
    ON auth_sessions (user_id)
    WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS ix_auth_sessions_expiry
    ON auth_sessions (expires_at);
