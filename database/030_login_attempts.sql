-- P1-1: unified per-username login attempt tracking.
-- Existing and unknown usernames use the same rows so failures cannot reveal account existence.
CREATE TABLE IF NOT EXISTS login_attempts (
    username text PRIMARY KEY,
    failed_attempts smallint NOT NULL DEFAULT 0,
    locked_until timestamptz NULL,
    last_failed_at timestamptz NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_login_attempts_last_failed_at ON login_attempts(last_failed_at);

-- Preserve any locks created by the first P1-1 deployment (app_users columns are now retired).
INSERT INTO login_attempts(username, failed_attempts, locked_until, last_failed_at, updated_at)
SELECT lower(trim(u.username)),
       GREATEST(u.failed_login_attempts, 0),
       u.login_locked_until,
       u.last_failed_login_at,
       now()
FROM app_users u
WHERE u.failed_login_attempts > 0 OR u.login_locked_until IS NOT NULL
ON CONFLICT (username) DO UPDATE
SET failed_attempts = GREATEST(login_attempts.failed_attempts, EXCLUDED.failed_attempts),
    locked_until = NULLIF(GREATEST(COALESCE(login_attempts.locked_until, '-infinity'::timestamptz),
                                   COALESCE(EXCLUDED.locked_until, '-infinity'::timestamptz)), '-infinity'::timestamptz),
    last_failed_at = NULLIF(GREATEST(COALESCE(login_attempts.last_failed_at, '-infinity'::timestamptz),
                                     COALESCE(EXCLUDED.last_failed_at, '-infinity'::timestamptz)), '-infinity'::timestamptz),
    updated_at = now();

-- Bounded cleanup: never removes a lock that is still active; enforces a table-size cap.
CREATE OR REPLACE FUNCTION cleanup_login_attempts(p_max_rows integer DEFAULT 50000)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    removed integer := 0;
    deleted_now integer := 0;
    excess integer := 0;
BEGIN
    -- Drop stale, inactive rows first (older than 30 days, no live lock).
    WITH stale AS (
        SELECT username
        FROM login_attempts
        WHERE COALESCE(last_failed_at, updated_at) < now() - interval '30 days'
          AND (locked_until IS NULL OR locked_until <= now())
        ORDER BY COALESCE(last_failed_at, updated_at)
        LIMIT 1000
    )
    DELETE FROM login_attempts a USING stale WHERE a.username = stale.username;
    GET DIAGNOSTICS deleted_now = ROW_COUNT;
    removed := removed + deleted_now;

    -- Enforce the maximum size by removing the oldest inactive rows only.
    SELECT GREATEST(count(*) - p_max_rows, 0) INTO excess FROM login_attempts;
    IF excess > 0 THEN
        WITH victims AS (
            SELECT username
            FROM login_attempts
            WHERE locked_until IS NULL OR locked_until <= now()
            ORDER BY COALESCE(last_failed_at, updated_at), username
            LIMIT 5000
        )
        DELETE FROM login_attempts a USING victims WHERE a.username = victims.username;
        GET DIAGNOSTICS deleted_now = ROW_COUNT;
        removed := removed + deleted_now;
    END IF;

    RETURN removed;
END;
$$;
