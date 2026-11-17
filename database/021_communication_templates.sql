-- v0.8.26: configurable WhatsApp message templates and teacher-notes banner.
ALTER TABLE school_settings
    ADD COLUMN IF NOT EXISTS whatsapp_template_absence TEXT NOT NULL DEFAULT 'مرحبًا، نود متابعة غياب {name} عن {circle}.',
    ADD COLUMN IF NOT EXISTS whatsapp_template_unpaid TEXT NOT NULL DEFAULT 'مرحبًا، نود التذكير بمتابعة اشتراك {name} في {circle}.',
    ADD COLUMN IF NOT EXISTS whatsapp_template_teacher_followup TEXT NOT NULL DEFAULT 'مرحبًا {name}، نود متابعة خطة الحلقة.',
    ADD COLUMN IF NOT EXISTS whatsapp_template_student_followup TEXT NOT NULL DEFAULT 'مرحبًا، نود متابعة {name} مع {brand}.',
    ADD COLUMN IF NOT EXISTS teacher_notes_banner TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS teacher_notes_banner_active BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN school_settings.whatsapp_template_absence IS 'قالب رسالة غياب الطالبة؛ المتغيرات: {name} و{circle} و{brand}.';
COMMENT ON COLUMN school_settings.whatsapp_template_unpaid IS 'قالب تذكير الاشتراك؛ المتغيرات: {name} و{circle} و{brand}.';
COMMENT ON COLUMN school_settings.whatsapp_template_teacher_followup IS 'قالب متابعة المعلمة؛ المتغيرات: {name} و{circle} و{brand}.';
COMMENT ON COLUMN school_settings.whatsapp_template_student_followup IS 'قالب متابعة ولي الأمر؛ المتغيرات: {name} و{circle} و{brand}.';
COMMENT ON COLUMN school_settings.teacher_notes_banner IS 'رسالة إدارية تظهر أعلى صفحة ملاحظات المعلمات عند تفعيلها.';
COMMENT ON COLUMN school_settings.teacher_notes_banner_active IS 'تفعيل أو إخفاء رسالة ملاحظات المعلمات.';
