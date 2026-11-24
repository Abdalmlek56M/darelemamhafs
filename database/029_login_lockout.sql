-- P1-1: progressive per-account login lockout.
-- Additive only: manual is_locked remains the admin-controlled lock.
ALTER TABLE app_users
    ADD COLUMN IF NOT EXISTS failed_login_attempts smallint NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS login_locked_until timestamptz NULL,
    ADD COLUMN IF NOT EXISTS last_failed_login_at timestamptz NULL;
