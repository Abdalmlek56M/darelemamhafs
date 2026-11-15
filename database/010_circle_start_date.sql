-- v0.8.17.1: retain the explicit operational start date of every circle.
-- Existing rows use their original creation date as a safe baseline; admins may correct it in the circle editor.
ALTER TABLE circles ADD COLUMN IF NOT EXISTS starts_on DATE;
UPDATE circles SET starts_on = COALESCE(starts_on, (created_at AT TIME ZONE 'Africa/Cairo')::date, CURRENT_DATE) WHERE starts_on IS NULL;
ALTER TABLE circles ALTER COLUMN starts_on SET DEFAULT CURRENT_DATE;
ALTER TABLE circles ALTER COLUMN starts_on SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_circles_starts_on ON circles(starts_on) WHERE is_trashed = FALSE;
