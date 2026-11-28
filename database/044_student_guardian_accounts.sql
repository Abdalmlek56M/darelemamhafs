-- Safe additive migration: optional login accounts linked to a student/guardian.

ALTER TABLE app_users
    ADD COLUMN IF NOT EXISTS student_id UUID NULL REFERENCES students(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS guardian_name TEXT NULL,
    ADD COLUMN IF NOT EXISTS guardian_phone TEXT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_app_users_student_id
    ON app_users(student_id)
    WHERE student_id IS NOT NULL;
