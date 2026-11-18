using Dar.Modules.Identity.Infrastructure;
using Npgsql;
using Testcontainers.PostgreSql;

namespace Dar.IntegrationTests.Supervision;

public sealed class SupervisionFixture : IAsyncLifetime
{
    private readonly PostgreSqlContainer container = new PostgreSqlBuilder("postgres:17")
        .Build();

    public string ConnectionString { get; private set; } = string.Empty;

    public const string Password = "TestPass123!";
    public static readonly Guid C1 = Guid.Parse("c1000000-0000-4000-8000-000000000001");
    public static readonly Guid C2 = Guid.Parse("c2000000-0000-4000-8000-000000000002");
    public static readonly Guid T1 = Guid.Parse("a1000000-0000-4000-8000-000000000001");
    public static readonly Guid T2 = Guid.Parse("a2000000-0000-4000-8000-000000000002");
    public static readonly Guid S1 = Guid.Parse("51000000-0000-4000-8000-000000000001");
    public static readonly Guid S2 = Guid.Parse("52000000-0000-4000-8000-000000000002");
    public static readonly Guid E1 = Guid.Parse("e1000000-0000-4000-8000-000000000001");
    public static readonly Guid E2 = Guid.Parse("e2000000-0000-4000-8000-000000000002");
    public static readonly Guid E3 = Guid.Parse("e3000000-0000-4000-8000-000000000003");
    public static readonly Guid CH1 = Guid.Parse("d1000000-0000-4000-8000-000000000001");
    public static readonly Guid CH2 = Guid.Parse("d2000000-0000-4000-8000-000000000002");
    public static readonly Guid CH3 = Guid.Parse("d3000000-0000-4000-8000-000000000003");
    public static readonly Guid A1 = Guid.Parse("f1000000-0000-4000-8000-000000000001");
    public static readonly Guid A2 = Guid.Parse("f2000000-0000-4000-8000-000000000002");
    public static readonly Guid SS1 = Guid.Parse("91000000-0000-4000-8000-000000000001");
    public static readonly Guid SS2 = Guid.Parse("92000000-0000-4000-8000-000000000002");
    public static readonly Guid N1 = Guid.Parse("81000000-0000-4000-8000-000000000001");
    public static readonly Guid N2 = Guid.Parse("82000000-0000-4000-8000-000000000002");
    public static readonly Guid TeacherUser = Guid.Parse("75000000-0000-4000-8000-000000000005");

    public async Task InitializeAsync()
    {
        await container.StartAsync();
        ConnectionString = container.GetConnectionString();
        await ApplyMigrationsAsync();
        await SeedAsync();
    }

    public async Task DisposeAsync() => await container.DisposeAsync();

    private async Task ApplyMigrationsAsync()
    {
        var root = new DirectoryInfo(AppContext.BaseDirectory);
        while (root is not null && !Directory.Exists(Path.Combine(root.FullName, "database")))
            root = root.Parent;
        if (root is null) throw new InvalidOperationException("database folder not found.");

        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();
        foreach (var file in Directory.GetFiles(Path.Combine(root.FullName, "database"), "*.sql").OrderBy(Path.GetFileName))
        {
            await using var command = new NpgsqlCommand(await File.ReadAllTextAsync(file), connection);
            await command.ExecuteNonQueryAsync();
        }
    }

    private async Task SeedAsync()
    {
        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand("""
            INSERT INTO teachers(id, teacher_code, full_name, phone, status, hourly_rate) VALUES
             (@t1, 'T1', 'معلمة أولى', '01000000001', 'active', 50),
             (@t2, 'T2', 'معلمة ثانية', '01000000002', 'active', 40);

            INSERT INTO circles(id, circle_code, name, teacher_id, monthly_fee, is_active, starts_on) VALUES
             (@c1, 'C1', 'حلقة أولى', @t1, 250, TRUE, CURRENT_DATE - 60),
             (@c2, 'C2', 'حلقة ثانية', @t2, 300, TRUE, CURRENT_DATE - 60);

            INSERT INTO students(id, student_code, full_name, guardian_name, guardian_phone, status, joined_on) VALUES
             (@s1, 'S1', 'طالبة أولى', 'ولي أول', '01000000011', 'active', CURRENT_DATE - 80),
             (@s2, 'S2', 'طالبة ثانية', 'ولي ثان', '01000000012', 'active', CURRENT_DATE - 70);

            INSERT INTO circle_enrollments(id, student_id, circle_id, starts_on, agreed_monthly_fee, status) VALUES
             (@e1, @s1, @c1, CURRENT_DATE - 80, 250, 'active'),
             (@e2, @s1, @c2, CURRENT_DATE - 80, 300, 'active'),
             (@e3, @s2, @c2, CURRENT_DATE - 70, 300, 'active');

            INSERT INTO monthly_charges(id, enrollment_id, billing_month, amount_due) VALUES
             (@ch1, @e1, date_trunc('month', CURRENT_DATE)::date, 250),
             (@ch2, @e2, date_trunc('month', CURRENT_DATE)::date, 300),
             (@ch3, @e3, date_trunc('month', CURRENT_DATE)::date, 300);

            INSERT INTO payments(monthly_charge_id, amount) VALUES (@ch1, 125);

            INSERT INTO circle_schedule_slots(id, circle_id, day_of_week, starts_at, duration_minutes, is_active) VALUES
             (@ss1, @c1, EXTRACT(DOW FROM CURRENT_DATE)::smallint, '00:01', 60, TRUE),
             (@ss2, @c2, EXTRACT(DOW FROM CURRENT_DATE)::smallint, '00:02', 60, TRUE);

            INSERT INTO teacher_attendance(id, schedule_slot_id, circle_id, teacher_id, session_date, scheduled_start,
              duration_minutes, status, hourly_rate_snapshot, payable_amount, actual_duration_minutes, pay_basis, note, is_trashed)
            VALUES
             (@a1, @ss1, @c1, @t1, CURRENT_DATE, '00:01', 60, 'present', 50, 50, 60, 'scheduled', 'ملاحظة حصة أولى', FALSE),
             (@a2, @ss2, @c2, @t2, CURRENT_DATE, '00:02', 60, 'present', 40, 40, 60, 'scheduled', 'ملاحظة حصة ثانية', FALSE);

            INSERT INTO student_attendance(schedule_slot_id, enrollment_id, session_date, status, note, is_trashed)
            VALUES (@ss1, @e1, CURRENT_DATE, 'present', 'ملاحظة طالبة أولى', FALSE);

            INSERT INTO app_users(id, username, display_name, password_hash, is_active, teacher_id) VALUES
             ('71000000-0000-4000-8000-000000000001', 'scope_c1', 'مشرفة حلقة أولى', @hash, TRUE, NULL),
             ('72000000-0000-4000-8000-000000000002', 'scope_all', 'مشرفة كل النطاق', @hash, TRUE, NULL),
             ('73000000-0000-4000-8000-000000000003', 'finance_all', 'مشرفة مالية', @hash, TRUE, NULL),
             ('74000000-0000-4000-8000-000000000004', 'comm_c1', 'مشرفة تواصل', @hash, TRUE, NULL),
             ('75000000-0000-4000-8000-000000000005', 'teacher1', 'معلمة أولى', @hash, TRUE, @t1);

            INSERT INTO user_permissions(user_id, permission_code)
            SELECT u.id, p.code FROM app_users u
            CROSS JOIN (VALUES
              ('supervisor.portal'), ('supervisor.students.read'), ('supervisor.teachers.read'),
              ('supervisor.absences'), ('supervisor.attendance.correct')
            ) AS p(code)
            WHERE u.username IN ('scope_c1', 'scope_all', 'finance_all');

            INSERT INTO user_permissions(user_id, permission_code) VALUES
             ('72000000-0000-4000-8000-000000000002', 'supervisor.unpaid'),
             ('73000000-0000-4000-8000-000000000003', 'supervisor.unpaid'),
             ('73000000-0000-4000-8000-000000000003', 'finance.read'),
             ('71000000-0000-4000-8000-000000000001', 'supervisor.unpaid'),
             ('71000000-0000-4000-8000-000000000001', 'supervisor.attendance.requests'),
             ('74000000-0000-4000-8000-000000000004', 'supervisor.communication'),
             ('74000000-0000-4000-8000-000000000004', 'supervisor.teachers.read'),
             ('74000000-0000-4000-8000-000000000004', 'supervisor.attendance.requests'),
             ('75000000-0000-4000-8000-000000000005', 'teacher.portal'),
             ('75000000-0000-4000-8000-000000000005', 'teacher.attendance'),
             ('75000000-0000-4000-8000-000000000005', 'teacher.requests'),
             ('75000000-0000-4000-8000-000000000005', 'teacher.calendar'),
             ('75000000-0000-4000-8000-000000000005', 'teacher.history.self'),
             ('75000000-0000-4000-8000-000000000005', 'teacher.earnings.self');

            INSERT INTO app_user_scopes(user_id, scope_type, scope_id) VALUES
             ('71000000-0000-4000-8000-000000000001', 'circle', @c1),
             ('74000000-0000-4000-8000-000000000004', 'circle', @c1);

            INSERT INTO notifications(id, role_scope, category, status, severity, title, body, entity_type, entity_id,
              action_url, dedupe_key, scope_circle_id, scope_teacher_id)
            VALUES
             (@n1, 'supervisor', 'attendance', 'open', 'warning', 'تنبيه أول', 'داخل النطاق', 'teacher_attendance', @a1,
              '/supervisor/absences', 'test:scope-c1', @c1, @t1),
             (@n2, 'supervisor', 'attendance', 'open', 'warning', 'تنبيه ثان', 'خارج النطاق', 'teacher_attendance', @a2,
              '/supervisor/absences', 'test:scope-c2', @c2, @t2);
            """, connection);
        command.Parameters.AddWithValue("hash", PasswordHasher.Hash(Password));
        command.Parameters.AddWithValue("t1", T1);
        command.Parameters.AddWithValue("t2", T2);
        command.Parameters.AddWithValue("c1", C1);
        command.Parameters.AddWithValue("c2", C2);
        command.Parameters.AddWithValue("s1", S1);
        command.Parameters.AddWithValue("s2", S2);
        command.Parameters.AddWithValue("e1", E1);
        command.Parameters.AddWithValue("e2", E2);
        command.Parameters.AddWithValue("e3", E3);
        command.Parameters.AddWithValue("ch1", CH1);
        command.Parameters.AddWithValue("ch2", CH2);
        command.Parameters.AddWithValue("ch3", CH3);
        command.Parameters.AddWithValue("ss1", SS1);
        command.Parameters.AddWithValue("ss2", SS2);
        command.Parameters.AddWithValue("a1", A1);
        command.Parameters.AddWithValue("a2", A2);
        command.Parameters.AddWithValue("n1", N1);
        command.Parameters.AddWithValue("n2", N2);
        await command.ExecuteNonQueryAsync();
    }
}
