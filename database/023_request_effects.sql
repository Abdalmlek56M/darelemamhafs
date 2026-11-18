-- v0.9.5: request effect snapshots, soft delete, and safe post-approval actions.
ALTER TABLE attendance_requests ADD COLUMN IF NOT EXISTS effect_before JSONB;
ALTER TABLE attendance_requests ADD COLUMN IF NOT EXISTS effect_after JSONB;
ALTER TABLE attendance_requests ADD COLUMN IF NOT EXISTS is_trashed BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_attendance_requests_active
    ON attendance_requests(status, created_at DESC) WHERE is_trashed = FALSE;
