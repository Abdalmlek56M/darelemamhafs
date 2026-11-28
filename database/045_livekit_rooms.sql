-- Phase 2: LiveKit circle meeting rooms and participant waiting/attendance state (additive only).

CREATE TABLE IF NOT EXISTS livekit_rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_name TEXT NOT NULL UNIQUE,
    invite_code TEXT NOT NULL UNIQUE,
    circle_id UUID NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
    session_id UUID NULL REFERENCES teacher_sessions(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    access_mode TEXT NOT NULL DEFAULT 'private' CHECK (access_mode IN ('private', 'public')),
    waiting_room_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    allow_student_screenshare BOOLEAN NOT NULL DEFAULT FALSE,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'ended')),
    created_by UUID NULL REFERENCES app_users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS ix_livekit_rooms_circle_status
    ON livekit_rooms(circle_id, status);

CREATE INDEX IF NOT EXISTS ix_livekit_rooms_session_id
    ON livekit_rooms(session_id)
    WHERE session_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS livekit_room_participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES livekit_rooms(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('host', 'participant')),
    admission_status TEXT NOT NULL DEFAULT 'pending' CHECK (admission_status IN ('pending', 'admitted', 'denied', 'banned')),
    muted_by_host BOOLEAN NOT NULL DEFAULT FALSE,
    first_joined_at TIMESTAMPTZ NULL,
    last_joined_at TIMESTAMPTZ NULL,
    last_left_at TIMESTAMPTZ NULL,
    attended_seconds INTEGER NOT NULL DEFAULT 0 CHECK (attended_seconds >= 0),
    is_connected BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (room_id, user_id)
);

CREATE INDEX IF NOT EXISTS ix_livekit_participants_room_status
    ON livekit_room_participants(room_id, admission_status);
