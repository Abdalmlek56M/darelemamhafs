-- FINAL 2.2: server-side student search must not scan the whole students table.
-- The student searches use case-insensitive contains (ILIKE '%term%'), where a pg_trgm
-- GIN trigram index is the only index type PostgreSQL can use. The planner only matches
-- the EXACT indexed expression, and the two API layers search students with different
-- SQL shapes, so every expression below is copied from the query text (not guessed):
--
--   * legacy API  GET /api/students          -- backend/DarEltahfeez.Api/Pagination/LegacyStudentList.cs
--     nullable columns are searched as COALESCE(column,'') so the predicate is exactly
--     COALESCE(column,'') ILIKE @like.
--   * modular API GET /api/v1/students       -- src/Modules/Secretariat/.../Persistence/StudentRepository.cs
--     nullable columns are searched as the bare column (NULL ILIKE pattern is never true,
--     i.e. the same result set as COALESCE), which the planner cannot answer with the
--     COALESCE indexes above.
--
-- Idempotent and data-free: re-running only re-checks the extension and index existence.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Shared expressions: both APIs compare these NOT NULL columns directly.
CREATE INDEX IF NOT EXISTS ix_students_trgm_full_name
    ON students USING gin (full_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS ix_students_trgm_student_code
    ON students USING gin (student_code gin_trgm_ops);

-- Legacy API expressions (COALESCE over the nullable columns).
CREATE INDEX IF NOT EXISTS ix_students_trgm_phone_coalesce
    ON students USING gin ((COALESCE(phone, '')) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS ix_students_trgm_guardian_name_coalesce
    ON students USING gin ((COALESCE(guardian_name, '')) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS ix_students_trgm_guardian_phone_coalesce
    ON students USING gin ((COALESCE(guardian_phone, '')) gin_trgm_ops);

-- Modular Secretariat API expressions (bare nullable columns).
CREATE INDEX IF NOT EXISTS ix_students_trgm_phone
    ON students USING gin (phone gin_trgm_ops);
CREATE INDEX IF NOT EXISTS ix_students_trgm_guardian_name
    ON students USING gin (guardian_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS ix_students_trgm_guardian_phone
    ON students USING gin (guardian_phone gin_trgm_ops);
