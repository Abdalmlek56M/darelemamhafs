-- v0.9.1: supervision/secretary permissions and account self-password gate.
-- Existing user_permissions remain the source of truth; roles document defaults.

INSERT INTO permissions (code, name_ar) VALUES
    ('account.password.self', 'تغيير كلمة المرور من الحساب'),
    ('supervisor.students.read', 'عرض الطلاب في النطاق'),
    ('supervisor.students.create', 'إضافة طلاب في النطاق'),
    ('supervisor.students.edit', 'تعديل طلاب في النطاق'),
    ('supervisor.students.delete', 'أرشفة طلاب في النطاق'),
    ('supervisor.students.notes', 'إضافة ملاحظات الطلاب'),
    ('supervisor.circles.read', 'عرض الحلقات في النطاق'),
    ('supervisor.circles.create', 'إضافة حلقات في النطاق'),
    ('supervisor.circles.edit', 'تعديل حلقات في النطاق'),
    ('supervisor.circles.delete', 'أرشفة حلقات في النطاق'),
    ('supervisor.teachers.notes', 'إضافة ملاحظات المعلمات'),
    ('supervisor.attendance.requests', 'مراجعة طلبات الغياب والتصحيح'),
    ('supervisor.communication', 'استخدام قوالب واتساب'),
    ('supervisor.reports', 'تقارير الإشراف'),
    ('teacher.calendar', 'تقويم المعلمة الأسبوعي'),
    ('teacher.history.self', 'سجل حلقات المعلمة السابقة'),
    ('teacher.requests', 'تقديم طلبات الغياب والتصحيح'),
    ('reports.finance', 'الأقسام المالية في التقارير')
ON CONFLICT (code) DO UPDATE SET name_ar = EXCLUDED.name_ar;

-- Supervisor default bundle: all student/circle operations plus the existing
-- supervision operations. The admin can revoke create/edit/delete independently.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN (
    'supervisor.portal', 'supervisor.live', 'supervisor.absences', 'supervisor.unpaid',
    'supervisor.attendance.correct', 'supervisor.teachers.read',
    'supervisor.students.read', 'supervisor.students.create', 'supervisor.students.edit',
    'supervisor.students.delete', 'supervisor.students.notes',
    'supervisor.circles.read', 'supervisor.circles.create', 'supervisor.circles.edit',
    'supervisor.circles.delete', 'supervisor.teachers.notes',
    'supervisor.attendance.requests', 'supervisor.communication', 'supervisor.reports'
)
WHERE r.code = 'supervisor'
ON CONFLICT DO NOTHING;

-- Teacher default bundle: calendar/history/requests in addition to the first slice.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN (
    'teacher.portal', 'teacher.attendance', 'teacher.earnings.self',
    'teacher.students.read', 'teacher.notes.write',
    'teacher.calendar', 'teacher.history.self', 'teacher.requests'
)
WHERE r.code = 'teacher'
ON CONFLICT DO NOTHING;
