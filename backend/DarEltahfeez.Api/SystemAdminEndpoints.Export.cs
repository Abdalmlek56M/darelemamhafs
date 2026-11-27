using System.Security.Claims;
using System.Text.Json;
using System.Text.RegularExpressions;
using DarEltahfeez.Api.Services;
using Npgsql;
using NpgsqlTypes;

namespace DarEltahfeez.Api;

public static partial class SystemAdminEndpoints
{
    /// <summary>
    /// Tier 2.7: one export section as a jsonb aggregate subquery, embedded in the single
    /// /api/admin/export command. Tables and predicates come from the fixed allow-lists above,
    /// never from the request, so the interpolation is not injectable.
    /// </summary>
    private static string ExportSectionJsonSubquery(string table, string predicate) => table == "app_users"
        ? $"COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'username',username,'display_name',display_name,'is_active',is_active,'created_at',created_at)) FROM app_users t WHERE {predicate}), '[]'::jsonb)"
        : $"COALESCE((SELECT jsonb_agg(to_jsonb(t) - 'password_hash' - 'receipt_data' - 'logo_data' - 'avatar_data' - 'backup_path') FROM public.{table} t WHERE {predicate}), '[]'::jsonb)";

    private static string ExportEntityFamilyPredicate(string table, string entityType) => (table, entityType) switch
    {
        // Whole-family exports include only related records, not unrelated circles or students from outside the selected family.
        ("students", "student") => "TRUE",
        ("student_notes", "student") => "t.student_id IN (SELECT id FROM students)",
        ("circle_enrollments", "student") => "t.student_id IN (SELECT id FROM students)",
        ("monthly_charges", "student") => "t.enrollment_id IN (SELECT id FROM circle_enrollments WHERE student_id IN (SELECT id FROM students))",
        ("payments", "student") => "t.monthly_charge_id IN (SELECT mc.id FROM monthly_charges mc JOIN circle_enrollments ce ON ce.id=mc.enrollment_id JOIN students s ON s.id=ce.student_id)",
        ("student_attendance", "student") => "t.enrollment_id IN (SELECT id FROM circle_enrollments WHERE student_id IN (SELECT id FROM students))",
        ("circles", "student") => "t.id IN (SELECT circle_id FROM circle_enrollments WHERE student_id IN (SELECT id FROM students))",
        ("teachers", "student") => "t.id IN (SELECT c.teacher_id FROM circles c JOIN circle_enrollments ce ON ce.circle_id=c.id)",
        ("circle_schedule_slots", "student") => "t.circle_id IN (SELECT circle_id FROM circle_enrollments WHERE student_id IN (SELECT id FROM students))",

        ("teachers", "teacher") => "TRUE",
        ("circles", "teacher") => "t.teacher_id IN (SELECT id FROM teachers)",
        ("circle_schedule_slots", "teacher") => "t.circle_id IN (SELECT id FROM circles WHERE teacher_id IN (SELECT id FROM teachers))",
        ("circle_enrollments", "teacher") => "t.circle_id IN (SELECT id FROM circles WHERE teacher_id IN (SELECT id FROM teachers))",
        ("students", "teacher") => "t.id IN (SELECT ce.student_id FROM circle_enrollments ce JOIN circles c ON c.id=ce.circle_id WHERE c.teacher_id IN (SELECT id FROM teachers))",
        ("teacher_notes", "teacher") => "t.teacher_id IN (SELECT id FROM teachers)",
        ("teacher_attendance", "teacher") => "t.teacher_id IN (SELECT id FROM teachers)",
        ("student_attendance", "teacher") => "t.enrollment_id IN (SELECT ce.id FROM circle_enrollments ce JOIN circles c ON c.id=ce.circle_id WHERE c.teacher_id IN (SELECT id FROM teachers))",

        ("circles", "circle") => "TRUE",
        ("circle_schedule_slots", "circle") => "t.circle_id IN (SELECT id FROM circles)",
        ("circle_enrollments", "circle") => "t.circle_id IN (SELECT id FROM circles)",
        ("students", "circle") => "t.id IN (SELECT student_id FROM circle_enrollments WHERE circle_id IN (SELECT id FROM circles))",
        ("teachers", "circle") => "t.id IN (SELECT teacher_id FROM circles WHERE teacher_id IS NOT NULL)",
        ("student_notes", "circle") => "t.student_id IN (SELECT student_id FROM circle_enrollments WHERE circle_id IN (SELECT id FROM circles))",
        ("student_attendance", "circle") => "t.enrollment_id IN (SELECT id FROM circle_enrollments WHERE circle_id IN (SELECT id FROM circles))",
        ("teacher_attendance", "circle") => "t.circle_id IN (SELECT id FROM circles)",
        ("monthly_charges", "circle") => "t.enrollment_id IN (SELECT id FROM circle_enrollments WHERE circle_id IN (SELECT id FROM circles))",
        ("payments", "circle") => "t.monthly_charge_id IN (SELECT mc.id FROM monthly_charges mc JOIN circle_enrollments ce ON ce.id=mc.enrollment_id WHERE ce.circle_id IN (SELECT id FROM circles))",
        ("advertising_expenses", "circle") => "t.circle_id IN (SELECT id FROM circles)",
        ("operating_expenses", "circle") => "t.circle_id IN (SELECT id FROM circles)",
        _ => "FALSE"
    };

    private static string ExportEntityPredicate(string table, string entityType) => (table, entityType) switch
    {
        ("students", "student") => "t.id=@entityId",
        ("students", "circle") => "t.id IN (SELECT ce.student_id FROM circle_enrollments ce WHERE ce.circle_id=@entityId)",
        ("students", "teacher") => "t.id IN (SELECT ce.student_id FROM circle_enrollments ce JOIN circles c ON c.id=ce.circle_id WHERE c.teacher_id=@entityId)",
        ("student_notes", "student") => "t.student_id=@entityId",
        ("student_notes", "circle") => "t.student_id IN (SELECT ce.student_id FROM circle_enrollments ce WHERE ce.circle_id=@entityId)",
        ("student_notes", "teacher") => "t.student_id IN (SELECT ce.student_id FROM circle_enrollments ce JOIN circles c ON c.id=ce.circle_id WHERE c.teacher_id=@entityId)",
        ("teacher_notes", "teacher") => "t.teacher_id=@entityId",
        ("teachers", "teacher") => "t.id=@entityId",
        ("teachers", "student") => "t.id IN (SELECT c.teacher_id FROM circles c JOIN circle_enrollments ce ON ce.circle_id=c.id WHERE ce.student_id=@entityId)",
        ("teachers", "circle") => "t.id=(SELECT c.teacher_id FROM circles c WHERE c.id=@entityId)",
        ("circles", "circle") => "t.id=@entityId",
        ("circles", "teacher") => "t.teacher_id=@entityId",
        ("circles", "student") => "t.id IN (SELECT ce.circle_id FROM circle_enrollments ce WHERE ce.student_id=@entityId)",
        ("circle_schedule_slots", "circle") => "t.circle_id=@entityId",
        ("circle_schedule_slots", "teacher") => "t.circle_id IN (SELECT c.id FROM circles c WHERE c.teacher_id=@entityId)",
        ("circle_schedule_slots", "student") => "t.circle_id IN (SELECT ce.circle_id FROM circle_enrollments ce WHERE ce.student_id=@entityId)",
        ("circle_enrollments", "student") => "t.student_id=@entityId",
        ("circle_enrollments", "circle") => "t.circle_id=@entityId",
        ("circle_enrollments", "teacher") => "t.circle_id IN (SELECT c.id FROM circles c WHERE c.teacher_id=@entityId)",
        ("monthly_charges", "student") => "t.enrollment_id IN (SELECT ce.id FROM circle_enrollments ce WHERE ce.student_id=@entityId)",
        ("monthly_charges", "circle") => "t.enrollment_id IN (SELECT ce.id FROM circle_enrollments ce WHERE ce.circle_id=@entityId)",
        ("monthly_charges", "teacher") => "t.enrollment_id IN (SELECT ce.id FROM circle_enrollments ce JOIN circles c ON c.id=ce.circle_id WHERE c.teacher_id=@entityId)",
        ("payments", "student") => "t.monthly_charge_id IN (SELECT mc.id FROM monthly_charges mc JOIN circle_enrollments ce ON ce.id=mc.enrollment_id WHERE ce.student_id=@entityId)",
        ("payments", "circle") => "t.monthly_charge_id IN (SELECT mc.id FROM monthly_charges mc JOIN circle_enrollments ce ON ce.id=mc.enrollment_id WHERE ce.circle_id=@entityId)",
        ("payments", "teacher") => "t.monthly_charge_id IN (SELECT mc.id FROM monthly_charges mc JOIN circle_enrollments ce ON ce.id=mc.enrollment_id JOIN circles c ON c.id=ce.circle_id WHERE c.teacher_id=@entityId)",
        ("teacher_attendance", "teacher") => "t.teacher_id=@entityId",
        ("teacher_attendance", "circle") => "t.circle_id=@entityId",
        ("student_attendance", "student") => "t.enrollment_id IN (SELECT ce.id FROM circle_enrollments ce WHERE ce.student_id=@entityId)",
        ("student_attendance", "circle") => "t.enrollment_id IN (SELECT ce.id FROM circle_enrollments ce WHERE ce.circle_id=@entityId)",
        ("student_attendance", "teacher") => "t.enrollment_id IN (SELECT ce.id FROM circle_enrollments ce JOIN circles c ON c.id=ce.circle_id WHERE c.teacher_id=@entityId)",
        ("advertising_expenses", "circle") => "t.circle_id=@entityId",
        ("advertising_expenses", "teacher") => "t.circle_id IN (SELECT c.id FROM circles c WHERE c.teacher_id=@entityId)",
        ("operating_expenses", "circle") => "t.circle_id=@entityId",
        ("operating_expenses", "teacher") => "t.circle_id IN (SELECT c.id FROM circles c WHERE c.teacher_id=@entityId)",
        ("collection_reports", _) => "FALSE",
        _ => "FALSE"
    };
}
