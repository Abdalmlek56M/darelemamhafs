-- v0.9.2: supervisor/secretary scope by circle or teacher.
-- No rows for a user = all circles/teachers, backward compatible.

CREATE TABLE IF NOT EXISTS app_user_scopes (
    user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    scope_type VARCHAR(16) NOT NULL CHECK (scope_type IN ('circle', 'teacher')),
    scope_id UUID NOT NULL,
    created_by UUID NULL REFERENCES app_users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, scope_type, scope_id)
);

CREATE INDEX IF NOT EXISTS idx_app_user_scopes_user
    ON app_user_scopes(user_id, scope_type);
