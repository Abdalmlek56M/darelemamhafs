-- Safe additive migration: member gender (all member types) + circle type & children category flag.

ALTER TABLE students
    ADD COLUMN IF NOT EXISTS gender TEXT NULL,
    ADD COLUMN IF NOT EXISTS guardian_gender TEXT NULL;

ALTER TABLE students
    DROP CONSTRAINT IF EXISTS students_gender_check,
    ADD CONSTRAINT students_gender_check CHECK (gender IS NULL OR gender IN ('male', 'female'));

ALTER TABLE students
    DROP CONSTRAINT IF EXISTS students_guardian_gender_check,
    ADD CONSTRAINT students_guardian_gender_check CHECK (guardian_gender IS NULL OR guardian_gender IN ('male', 'female'));

ALTER TABLE teachers
    ADD COLUMN IF NOT EXISTS gender TEXT NULL;

ALTER TABLE teachers
    DROP CONSTRAINT IF EXISTS teachers_gender_check,
    ADD CONSTRAINT teachers_gender_check CHECK (gender IS NULL OR gender IN ('male', 'female'));

ALTER TABLE app_users
    ADD COLUMN IF NOT EXISTS gender TEXT NULL;

ALTER TABLE app_users
    DROP CONSTRAINT IF EXISTS app_users_gender_check,
    ADD CONSTRAINT app_users_gender_check CHECK (gender IS NULL OR gender IN ('male', 'female'));

ALTER TABLE circles
    ADD COLUMN IF NOT EXISTS circle_type TEXT NOT NULL DEFAULT 'group',
    ADD COLUMN IF NOT EXISTS is_children BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE circles
    DROP CONSTRAINT IF EXISTS circles_circle_type_check,
    ADD CONSTRAINT circles_circle_type_check CHECK (circle_type IN ('individual', 'group'));
