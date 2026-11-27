-- =====================================================================================
-- 041_blob_file_storage.sql — FINAL Tier 2.5: move media blobs out of hot BYTEA columns.
-- Append-only and idempotent (safe to re-run). Existing BYTEA data is NOT touched here.
-- =====================================================================================
--
-- REAL BLOB INVENTORY (Tier 2.5):
--   payments.receipt_data        BYTEA  (003_schedule_attendance_ads_receipts.sql:34)
--       read path: GET /api/payments/{id}/receipt
--       write path: POST /api/payments/with-receipt
--       derived:    GET /api/students/{id}/history -> payments[].hasReceipt (boolean only)
--   school_settings.logo_data    BYTEA  (005_system_admin.sql:26)
--       read paths: GET /api/branding (anonymous), GET /api/admin/settings (settings.manage)
--       write path: PUT /api/admin/settings (logoDataUrl data: URL)
--       derived:    audit/trash branding snapshot has_logo (boolean only)
--   app_users.avatar_data        BYTEA  (005_system_admin.sql:103)
--       read path:  GET /api/auth/profile/avatar
--       write path: PUT /api/auth/profile/avatar (data: URL)
--   students / meet media: NO BYTEA. students has no photo column; meet_media_assets
--       (026_meet_recording.sql:139) already stores files on disk and keeps only metadata
--       (local_path, size_bytes, sha256) in PostgreSQL, so it needs no migration.
--
-- TARGET DESIGN (implemented in backend/DarEltahfeez.Api/Media):
--   * Files live under a configurable root: Media:RootPath  (env Media__RootPath).
--     Production: /var/lib/dar/media, owned by the API OS user, on a persistent volume.
--     Harness/tests: any writable temp directory (the runner passes it to both the app and
--     the tier2-blobs suite; see tests/regression/tier2-blobs/run.mjs).
--     If unset, the app falls back to <temp>/dar-media and logs the resolved root.
--   * File name = SHA-256 of the stored bytes + an extension derived from the content type
--     (receipts/<hash[0..2]>/<hash>.jpg, avatars/..., logos/...). Content-addressed names
--     make writes idempotent: a retried/lazy migration of the same bytes reuses the file.
--   * These nullable metadata columns are the source of truth for file-backed rows:
--       payments.receipt_file_path / receipt_size_bytes (+ existing receipt_content_type)
--       app_users.avatar_file_path / avatar_size_bytes (+ existing avatar_content_type)
--       school_settings.logo_file_path / logo_size_bytes (+ existing logo_content_type)
--     The pre-existing *_content_type columns are reused unchanged, so responses and clients
--     stay byte-identical and no duplicate content-type column is introduced.
--   * Dual read: if the path is NULL and the legacy BYTEA is present, the API writes the file
--     and stores the path on first read ("lazy migration"), then serves the original bytes.
--     Durable/deliberate backfill is available through:
--       - POST /api/admin/media/backfill        (settings.manage; optional ?dryRun=true)
--       - Media__BackfillOnStartup=true          (one batch run at application startup)
--     Both use the same MediaBackfillService and are safe to re-run.
--
-- MIGRATION PLAN (deploy order):
--   1. Apply this migration (adds nullable columns only; zero-downtime, no data rewrite).
--   2. Deploy the Tier 2.5 application build (file-backed writes + dual reads).
--   3. Point Media__RootPath at the persistent media directory and make sure it is writable
--      by the API OS user; include that directory in the backup/restore procedure.
--   4. Optionally run POST /api/admin/media/backfill (or restart once with
--      Media__BackfillOnStartup=true) to migrate historical rows deliberately.
--   5. Verify with GET /api/admin/media/status that pending counts are zero.
--   6. A LATER, separate cleanup migration (not this one) may drop the BYTEA columns and
--      the corresponding legacy metadata. Until that cleanup ships, BYTEA stays untouched.
--
-- ROLLBACK PLAN (no data loss):
--   * Application: redeploy the previous build. It reads only the BYTEA columns, which this
--     migration leaves intact, so receipt/logo/avatar downloads keep working for rows that
--     existed before the rollout.
--   * Files: the media directory can be deleted at any time; it is a derived copy. New rows
--     created by the Tier 2.5 build store only paths, so rolling back while also deleting the
--     files loses the receipts/avatars/logo uploaded after the migration — keep the directory
--     for that rollback window.
--   * Columns: this migration is additive, so rollback = DROP the six columns below:
--       ALTER TABLE payments        DROP COLUMN IF EXISTS receipt_file_path,
--                                   DROP COLUMN IF EXISTS receipt_size_bytes,
--                                   DROP INDEX IF EXISTS idx_payments_receipt_pending_migration;
--       ALTER TABLE app_users       DROP COLUMN IF EXISTS avatar_file_path,
--                                   DROP COLUMN IF EXISTS avatar_size_bytes,
--                                   DROP INDEX IF EXISTS idx_app_users_avatar_pending_migration;
--       ALTER TABLE school_settings DROP COLUMN IF EXISTS logo_file_path,
--                                   DROP COLUMN IF EXISTS logo_size_bytes;
--     (Only run after the previous application build is back in service.)
--   * schema_migrations: delete the '041_blob_file_storage' row if the migration must be
--     re-applied after a manual rollback.
-- =====================================================================================

ALTER TABLE payments ADD COLUMN IF NOT EXISTS receipt_file_path TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS receipt_size_bytes BIGINT;

ALTER TABLE app_users ADD COLUMN IF NOT EXISTS avatar_file_path TEXT;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS avatar_size_bytes BIGINT;

ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS logo_file_path TEXT;
ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS logo_size_bytes BIGINT;

-- Guard the new metadata: negative sizes are never valid, and an empty path is not a file.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_payments_receipt_file_metadata') THEN
        ALTER TABLE payments ADD CONSTRAINT ck_payments_receipt_file_metadata
            CHECK ((receipt_size_bytes IS NULL OR receipt_size_bytes >= 0)
                   AND (receipt_file_path IS NULL OR length(receipt_file_path) > 0));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_app_users_avatar_file_metadata') THEN
        ALTER TABLE app_users ADD CONSTRAINT ck_app_users_avatar_file_metadata
            CHECK ((avatar_size_bytes IS NULL OR avatar_size_bytes >= 0)
                   AND (avatar_file_path IS NULL OR length(avatar_file_path) > 0));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_school_settings_logo_file_metadata') THEN
        ALTER TABLE school_settings ADD CONSTRAINT ck_school_settings_logo_file_metadata
            CHECK ((logo_size_bytes IS NULL OR logo_size_bytes >= 0)
                   AND (logo_file_path IS NULL OR length(logo_file_path) > 0));
    END IF;
END $$;

-- The deliberate batch backfill scans for "legacy blob that has no file yet". These partial
-- indexes keep that scan cheap without indexing the blob content itself.
CREATE INDEX IF NOT EXISTS idx_payments_receipt_pending_migration
    ON payments (id) WHERE receipt_data IS NOT NULL AND receipt_file_path IS NULL;
CREATE INDEX IF NOT EXISTS idx_app_users_avatar_pending_migration
    ON app_users (id) WHERE avatar_data IS NOT NULL AND avatar_file_path IS NULL;

COMMENT ON COLUMN payments.receipt_file_path IS
    'Tier 2.5: SHA-256-addressed file path relative to Media:RootPath; NULL means legacy lines may still hold receipt_data.';
COMMENT ON COLUMN payments.receipt_size_bytes IS
    'Tier 2.5: byte size of the file at receipt_file_path; NULL for legacy BYTEA-only rows.';
COMMENT ON COLUMN app_users.avatar_file_path IS
    'Tier 2.5: SHA-256-addressed avatar file path relative to Media:RootPath; legacy avatar_data stays untouched.';
COMMENT ON COLUMN app_users.avatar_size_bytes IS
    'Tier 2.5: byte size of the file at avatar_file_path; NULL for legacy BYTEA-only rows.';
COMMENT ON COLUMN school_settings.logo_file_path IS
    'Tier 2.5: SHA-256-addressed branding logo file path relative to Media:RootPath; legacy logo_data stays untouched.';
COMMENT ON COLUMN school_settings.logo_size_bytes IS
    'Tier 2.5: byte size of the file at logo_file_path; NULL for legacy BYTEA-only rows.';
