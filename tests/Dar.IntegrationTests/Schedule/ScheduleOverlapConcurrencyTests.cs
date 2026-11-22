using Dar.IntegrationTests.Infrastructure;
using Npgsql;
using Testcontainers.PostgreSql;
using Xunit;

namespace Dar.IntegrationTests.Schedule;

/// <summary>
/// Verifies the hardened timetable guarantees (migration 025) on a real PostgreSQL 17:
///   1) two concurrent writes for the same teacher are serialized by the advisory locks
///      and the loser fails with SQLSTATE 23514 / ck_teacher_schedule_no_overlap;
///   2) reassigning a circle to a teacher with an overlapping timetable is rejected;
///   3) the isolation guard refuses REPEATABLE READ (fresh READ COMMITTED snapshots are
///      required after the lock is granted).
/// Skips itself when Docker is unavailable (local sandbox), runs in CI.
/// </summary>
public sealed class ScheduleOverlapConcurrencyTests : IAsyncLifetime
{
    private static readonly Guid TeacherOne = Guid.Parse("1e000000-0000-4000-8000-000000000001");
    private static readonly Guid TeacherTwo = Guid.Parse("1e000000-0000-4000-8000-000000000002");
    private static readonly Guid CircleOne = Guid.Parse("2c000000-0000-4000-8000-000000000001");
    private static readonly Guid CircleTwo = Guid.Parse("2c000000-0000-4000-8000-000000000002");
    private static readonly Guid CircleThree = Guid.Parse("2c000000-0000-4000-8000-000000000003");
    private static readonly Guid CircleFour = Guid.Parse("2c000000-0000-4000-8000-000000000004");

    private readonly PostgreSqlContainer container = new PostgreSqlBuilder("postgres:17").Build();
    private string connectionString = string.Empty;

    public async Task InitializeAsync()
    {
        await container.StartAsync();
        connectionString = container.GetConnectionString();
        await PostgresTestDatabase.ApplyMigrationsAsync(connectionString, CancellationToken.None);

        await using var connection = new NpgsqlConnection(connectionString);
        await connection.OpenAsync();
        await ExecuteAsync(connection, """
            INSERT INTO teachers(id, teacher_code, full_name, status, hourly_rate) VALUES
                (@t1, 'T-RACE-1', 'معلمة سباق 1', 'active', 50),
                (@t2, 'T-RACE-2', 'معلمة سباق 2', 'active', 50);
            INSERT INTO circles(id, circle_code, name, teacher_id, monthly_fee, is_active, starts_on) VALUES
                (@c1, 'C-RACE-1', 'حلقة سباق 1', @t1, 250, TRUE, DATE '2026-01-01'),
                (@c2, 'C-RACE-2', 'حلقة سباق 2', @t1, 250, TRUE, DATE '2026-01-01'),
                (@c3, 'C-RACE-3', 'حلقة سباق 3', @t2, 250, TRUE, DATE '2026-01-01'),
                (@c4, 'C-RACE-4', 'حلقة سباق 4', @t2, 250, TRUE, DATE '2026-01-01');
            """,
            ("t1", TeacherOne), ("t2", TeacherTwo),
            ("c1", CircleOne), ("c2", CircleTwo), ("c3", CircleThree), ("c4", CircleFour));
    }

    public async Task DisposeAsync() => await container.DisposeAsync();

    [DockerFact]
    public async Task Concurrent_overlapping_slots_for_same_teacher_only_one_wins()
    {
        var firstInsertFinished = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);

        var firstWriter = Task.Run(async () =>
        {
            await using var connection = new NpgsqlConnection(connectionString);
            await connection.OpenAsync();
            await using var transaction = await connection.BeginTransactionAsync();
            await InsertSlotAsync(connection, transaction, CircleOne, dayOfWeek: 1, startsAt: "10:00");
            firstInsertFinished.SetResult();
            // Keep the transaction open long enough for the second writer to block on the lock.
            await Task.Delay(1500);
            await transaction.CommitAsync();
            return "committed";
        });

        await firstInsertFinished.Task;

        var secondWriter = Task.Run(async () =>
        {
            try
            {
                await using var connection = new NpgsqlConnection(connectionString);
                await connection.OpenAsync();
                await using var transaction = await connection.BeginTransactionAsync();
                await InsertSlotAsync(connection, transaction, CircleTwo, dayOfWeek: 1, startsAt: "10:30");
                await transaction.CommitAsync();
                return "committed";
            }
            catch (PostgresException exception)
            {
                return exception.SqlState + "|" + (exception.ConstraintName ?? string.Empty);
            }
        });

        var results = await Task.WhenAll(firstWriter, secondWriter);

        Assert.Equal("committed", results[0]);
        Assert.Equal("23514|ck_teacher_schedule_no_overlap", results[1]);
        var overlappingRows = await ScalarAsync(
            """
            SELECT count(*)
            FROM circle_schedule_slots ss
            JOIN circles c ON c.id = ss.circle_id
            WHERE c.teacher_id = @teacher AND ss.day_of_week = 1
              AND ss.is_active = TRUE AND ss.is_trashed = FALSE AND c.is_trashed = FALSE;
            """, ("teacher", TeacherOne));
        Assert.Equal(1L, overlappingRows);
    }

    [DockerFact]
    public async Task Reassigning_circle_to_teacher_with_overlapping_slot_fails()
    {
        await using (var connection = new NpgsqlConnection(connectionString))
        {
            await connection.OpenAsync();
            // Teacher one gets a Wednesday 09:00 slot, teacher two already has one on circle three.
            await InsertSlotAsync(connection, null, CircleOne, dayOfWeek: 3, startsAt: "09:00");
        }

        var failure = await CaptureAsync(async connection =>
        {
            await using var command = new NpgsqlCommand(
                "UPDATE circles SET teacher_id = @teacher WHERE id = @circle;", connection);
            command.Parameters.AddWithValue("teacher", TeacherOne);
            command.Parameters.AddWithValue("circle", CircleThree);
            await command.ExecuteNonQueryAsync();
        });

        Assert.NotNull(failure);
        Assert.Equal("23514", failure!.SqlState);
        Assert.Equal("ck_teacher_schedule_no_overlap", failure.ConstraintName);

        var owner = await ScalarAsync("SELECT count(*) FROM circles WHERE id = @circle AND teacher_id = @teacher;",
            ("circle", CircleThree), ("teacher", TeacherTwo));
        Assert.Equal(1L, owner);
    }

    [DockerFact]
    public async Task Repeatable_read_transaction_is_rejected_by_isolation_guard()
    {
        var failure = await CaptureAsync(async connection =>
        {
            await using var transaction = await connection.BeginTransactionAsync(System.Data.IsolationLevel.RepeatableRead);
            await InsertSlotAsync(connection, transaction, CircleOne, dayOfWeek: 5, startsAt: "08:00");
            await transaction.CommitAsync();
        });

        Assert.NotNull(failure);
        Assert.Equal("0A000", failure!.SqlState);
    }

    private async Task<PostgresException?> CaptureAsync(Func<NpgsqlConnection, Task> action)
    {
        await using var connection = new NpgsqlConnection(connectionString);
        await connection.OpenAsync();
        try
        {
            await action(connection);
            return null;
        }
        catch (PostgresException exception)
        {
            return exception;
        }
    }

    private static async Task InsertSlotAsync(NpgsqlConnection connection, NpgsqlTransaction? transaction, Guid circleId, int dayOfWeek, string startsAt)
    {
        await using var command = new NpgsqlCommand(
            """
            INSERT INTO circle_schedule_slots(circle_id, day_of_week, starts_at, duration_minutes, is_active)
            VALUES(@circle, @day, @time, 60, TRUE);
            """, connection, transaction);
        command.Parameters.AddWithValue("circle", circleId);
        command.Parameters.AddWithValue("day", (short)dayOfWeek);
        command.Parameters.AddWithValue("time", TimeOnly.Parse(startsAt));
        await command.ExecuteNonQueryAsync();
    }

    private static async Task ExecuteAsync(NpgsqlConnection connection, string sql, params (string Name, object Value)[] parameters)
    {
        await using var command = new NpgsqlCommand(sql, connection);
        foreach (var (name, value) in parameters) command.Parameters.AddWithValue(name, value);
        await command.ExecuteNonQueryAsync();
    }

    private async Task<long> ScalarAsync(string sql, params (string Name, object Value)[] parameters)
    {
        await using var connection = new NpgsqlConnection(connectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        foreach (var (name, value) in parameters) command.Parameters.AddWithValue(name, value);
        return (long)(await command.ExecuteScalarAsync() ?? 0L);
    }
}
