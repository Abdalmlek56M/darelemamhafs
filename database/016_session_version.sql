-- Session version lets the server revoke every existing cookie for a user
-- after a password reset, deactivation, or email change.
ALTER TABLE app_users
    ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 0;
