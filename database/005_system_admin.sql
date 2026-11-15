-- v0.7: organisation branding, auditable changes, reversible trash, and backup history.
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS before_data JSONB;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS after_data JSONB;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS actor_display_name VARCHAR(160);
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS request_path TEXT;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS http_method VARCHAR(12);
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS can_restore BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS restored_at TIMESTAMPTZ;

ALTER TABLE students ADD COLUMN IF NOT EXISTS is_trashed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS is_trashed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE circles ADD COLUMN IF NOT EXISTS is_trashed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE student_notes ADD COLUMN IF NOT EXISTS is_trashed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE circle_enrollments ADD COLUMN IF NOT EXISTS is_trashed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE monthly_charges ADD COLUMN IF NOT EXISTS is_trashed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS is_trashed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE collection_reports ADD COLUMN IF NOT EXISTS is_trashed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE circle_schedule_slots ADD COLUMN IF NOT EXISTS is_trashed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE teacher_attendance ADD COLUMN IF NOT EXISTS is_trashed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE advertising_expenses ADD COLUMN IF NOT EXISTS is_trashed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE operating_expenses ADD COLUMN IF NOT EXISTS is_trashed BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS school_settings (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    brand_name VARCHAR(200) NOT NULL DEFAULT 'دار الإمام حفص للقرآن والتجويد',
    logo_data BYTEA,
    logo_content_type VARCHAR(100),
    facebook_url VARCHAR(600),
    tiktok_url VARCHAR(600),
    whatsapp_url VARCHAR(600),
    trash_retention_days INTEGER NOT NULL DEFAULT 30 CHECK (trash_retention_days BETWEEN 1 AND 3650),
    backup_interval_hours INTEGER NOT NULL DEFAULT 12 CHECK (backup_interval_hours BETWEEN 1 AND 168),
    auto_backup_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    updated_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO school_settings(id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS trash_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type VARCHAR(80) NOT NULL,
    entity_id UUID NOT NULL,
    display_name VARCHAR(240) NOT NULL,
    record_snapshot JSONB NOT NULL,
    parent_trash_id UUID REFERENCES trash_items(id) ON DELETE SET NULL,
    deleted_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
    deleted_by_name VARCHAR(160),
    deleted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    restored_at TIMESTAMPTZ,
    purged_at TIMESTAMPTZ,
    purge_error TEXT
);
ALTER TABLE trash_items ADD COLUMN IF NOT EXISTS parent_trash_id UUID REFERENCES trash_items(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_trash_parent ON trash_items(parent_trash_id) WHERE parent_trash_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_trash_active_entity
    ON trash_items(entity_type, entity_id)
    WHERE restored_at IS NULL AND purged_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_trash_expiration ON trash_items(expires_at) WHERE restored_at IS NULL AND purged_at IS NULL;

CREATE TABLE IF NOT EXISTS system_backups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    backup_file_name VARCHAR(255) NOT NULL,
    backup_path TEXT NOT NULL,
    scope_codes TEXT NOT NULL DEFAULT 'all',
    backup_format VARCHAR(30) NOT NULL DEFAULT 'pg_dump_custom',
    status VARCHAR(20) NOT NULL CHECK (status IN ('running','completed','failed')),
    file_size_bytes BIGINT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    created_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
    created_by_name VARCHAR(160),
    error_message TEXT
);
CREATE INDEX IF NOT EXISTS idx_system_backups_recent ON system_backups(started_at DESC);

INSERT INTO permissions(code, name_ar) VALUES
 ('audit.read', 'عرض سجل التدقيق والتغييرات'),
 ('audit.restore', 'استرجاع نسخة سابقة من تعديل'),
 ('trash.manage', 'إدارة سلة المهملات والاستعادة والحذف النهائي'),
 ('backup.manage', 'إنشاء وتنزيل النسخ الاحتياطية وإدارتها'),
 ('exports.manage', 'تصدير بيانات الدار وتقارير PDF')
ON CONFLICT (code) DO UPDATE SET name_ar=EXCLUDED.name_ar;

-- Existing full administrator accounts retain full system access. Narrow accounts gain no new powers.
WITH admin_candidates AS (
    SELECT user_id
    FROM user_permissions
    GROUP BY user_id
    HAVING bool_and(permission_code IN (
        'dashboard.read','students.read','students.create','students.edit','students.delete',
        'teachers.read','teachers.create','teachers.edit','teachers.delete',
        'circles.read','circles.create','circles.edit','circles.delete',
        'schedule.read','schedule.edit','attendance.read','attendance.edit',
        'finance.read','finance.create','finance.edit','finance.delete','users.manage','settings.manage'
    )) AND COUNT(DISTINCT permission_code) >= 23
)
INSERT INTO user_permissions(user_id, permission_code)
SELECT a.user_id, p.code FROM admin_candidates a
CROSS JOIN (VALUES ('audit.read'),('audit.restore'),('trash.manage'),('backup.manage'),('exports.manage')) p(code)
ON CONFLICT (user_id, permission_code) DO NOTHING;

ALTER TABLE app_users ADD COLUMN IF NOT EXISTS avatar_data BYTEA;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS avatar_content_type VARCHAR(100);
