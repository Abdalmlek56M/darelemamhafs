-- FINAL 1.15: OAuth state carries a one-time nonce; consuming it in the database makes
-- a replayed callback (same state) fail even on another instance.
CREATE TABLE IF NOT EXISTS meet_oauth_states (
    nonce UUID PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    consumed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_meet_oauth_states_created ON meet_oauth_states(created_at);
