-- v0.8.16: historical notes per teacher, reversible through the existing Trash workflow.
CREATE TABLE IF NOT EXISTS teacher_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    teacher_id UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    note_text TEXT NOT NULL,
    created_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    is_trashed BOOLEAN NOT NULL DEFAULT FALSE,
    CHECK (length(trim(note_text)) > 0)
);
CREATE INDEX IF NOT EXISTS idx_teacher_notes_teacher_date
    ON teacher_notes(teacher_id, created_at DESC) WHERE is_trashed = FALSE;
