-- Dar Eltahfeez v0.3: age, detailed history, staff access and collection snapshots.
ALTER TABLE students ADD COLUMN IF NOT EXISTS age_years INTEGER;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'students_age_years_range') THEN
        ALTER TABLE students ADD CONSTRAINT students_age_years_range CHECK (age_years IS NULL OR (age_years BETWEEN 0 AND 120));
    END IF;
END $$;

ALTER TABLE teachers ADD COLUMN IF NOT EXISTS hourly_rate NUMERIC(12,2) NOT NULL DEFAULT 0;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'teachers_hourly_rate_nonnegative') THEN
        ALTER TABLE teachers ADD CONSTRAINT teachers_hourly_rate_nonnegative CHECK (hourly_rate >= 0);
    END IF;
END $$;

-- Keep the ability to delete a student when explicitly requested, including their dependent records.
-- The API also records a deletion event in audit_log before deleting the student.
ALTER TABLE circle_enrollments DROP CONSTRAINT IF EXISTS circle_enrollments_student_id_fkey;
ALTER TABLE circle_enrollments ADD CONSTRAINT circle_enrollments_student_id_fkey
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE;
ALTER TABLE monthly_charges DROP CONSTRAINT IF EXISTS monthly_charges_enrollment_id_fkey;
ALTER TABLE monthly_charges ADD CONSTRAINT monthly_charges_enrollment_id_fkey
    FOREIGN KEY (enrollment_id) REFERENCES circle_enrollments(id) ON DELETE CASCADE;
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_monthly_charge_id_fkey;
ALTER TABLE payments ADD CONSTRAINT payments_monthly_charge_id_fkey
    FOREIGN KEY (monthly_charge_id) REFERENCES monthly_charges(id) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS student_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    note_text TEXT NOT NULL,
    created_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (length(trim(note_text)) > 0)
);
CREATE INDEX IF NOT EXISTS idx_student_notes_student_date ON student_notes(student_id, created_at DESC);

CREATE TABLE IF NOT EXISTS user_permissions (
    user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    permission_code VARCHAR(100) NOT NULL,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, permission_code)
);

CREATE TABLE IF NOT EXISTS collection_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(180) NOT NULL,
    billing_month DATE NOT NULL CHECK (EXTRACT(DAY FROM billing_month) = 1),
    snapshot JSONB NOT NULL,
    saved_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_collection_reports_month_created ON collection_reports(billing_month, created_at DESC);

INSERT INTO permissions(code, name_ar) VALUES
 ('dashboard.read', 'عرض لوحة التحكم'),
 ('students.read', 'عرض الطلاب وسجلاتهم'),
 ('students.create', 'إضافة الطلاب'),
 ('students.edit', 'تعديل الطلاب وملاحظاتهم وحلقاتهم'),
 ('students.delete', 'حذف الطلاب وسجلاتهم'),
 ('teachers.read', 'عرض المعلمات'),
 ('teachers.create', 'إضافة المعلمات'),
 ('teachers.edit', 'تعديل المعلمات وأجر الساعة'),
 ('teachers.delete', 'حذف المعلمات غير المرتبطة بحلقات'),
 ('circles.read', 'عرض الحلقات'),
 ('circles.create', 'إنشاء الحلقات'),
 ('circles.edit', 'تعديل الحلقات والالتحاقات'),
 ('circles.delete', 'حذف الحلقات الفارغة'),
 ('finance.read', 'عرض الاشتراكات والتحصيلات والمالية'),
 ('finance.create', 'تسجيل الاستحقاقات والمدفوعات وحفظ تقارير التحصيل'),
 ('finance.edit', 'تعديل الاستحقاقات'),
 ('finance.delete', 'حذف حركات التحصيل وتقاريرها'),
 ('users.manage', 'إدارة الحسابات والصلاحيات'),
 ('settings.manage', 'إدارة إعدادات الدار')
ON CONFLICT (code) DO UPDATE SET name_ar = EXCLUDED.name_ar;

-- Prevent duplicate active enrollment of the same student in the same circle while preserving ended history.
CREATE UNIQUE INDEX IF NOT EXISTS uq_circle_enrollments_active_student_circle
    ON circle_enrollments(student_id, circle_id) WHERE status = 'active';
