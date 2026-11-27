using System.Security.Claims;
using System.Text.Json;
using Npgsql;
using NpgsqlTypes;

namespace DarEltahfeez.Api;

public static partial class AuthEndpoints
{
    private static void MapAdminUsers(WebApplication app)
    {
        var users = app.MapGroup("/api/admin/users").RequireAuthorization("users.manage");
        app.MapGet("/api/admin/permissions", () => Results.Ok(AppPermissions.All.Select(p => new PermissionResponse(p.Code, p.NameAr))))
            .RequireAuthorization("users.manage");
        users.MapGet("", (int? page, int? pageSize, HttpContext http, NpgsqlDataSource db, CancellationToken ct) => LoadAdminUsersAsync(page, pageSize, http, db, ct));

        users.MapPost("", async Task<IResult> (AdminUserWriteRequest request, NpgsqlDataSource db, CancellationToken ct) =>
        {
            var errors = ValidateCredentials(request.Username, request.DisplayName, request.Password, true);
            if (errors is not null) return Results.ValidationProblem(errors);
            var permissionErrors = ValidatePermissionList(request.PermissionCodes);
            if (permissionErrors is not null) return Results.ValidationProblem(permissionErrors);
            var linkError = await ValidateTeacherLinkAsync(db, null, request.TeacherId, ct);
            if (linkError is not null) return linkError;
            if (request.IsLocked && string.IsNullOrWhiteSpace(request.LockReason))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["lockReason"] = ["اكتب سبب قفل الحساب."] });
            var id = Guid.NewGuid();
            await using var connection = await db.OpenConnectionAsync(ct);
            await using var transaction = await connection.BeginTransactionAsync(ct);
            try
            {
                await using (var insert = new NpgsqlCommand("""
                    INSERT INTO app_users(id, username, display_name, password_hash, is_active, is_locked, teacher_id, locked_at, lock_reason)
                    VALUES (@id, @username, @display, @hash, TRUE, @locked, @teacher,
                            CASE WHEN @locked THEN now() ELSE NULL END,
                            CASE WHEN @locked THEN @lockReason ELSE NULL END);
                    """, connection, transaction))
                {
                    insert.Parameters.AddWithValue("id", id);
                    insert.Parameters.AddWithValue("username", request.Username.Trim().ToLowerInvariant());
                    insert.Parameters.AddWithValue("display", request.DisplayName.Trim());
                    insert.Parameters.AddWithValue("hash", Passwords.Hash(request.Password!));
                    insert.Parameters.AddWithValue("locked", request.IsLocked);
                    AddNullable(insert, "teacher", request.TeacherId);
                    AddNullable(insert, "lockReason", request.IsLocked ? request.LockReason?.Trim() : null);
                    await insert.ExecuteNonQueryAsync(ct);
                }
                await ReplacePermissions(connection, transaction, id, request.PermissionCodes, ct);
                await transaction.CommitAsync(ct);
                return Results.Created($"/api/admin/users/{id}", new { id, username = request.Username.Trim().ToLowerInvariant(), displayName = request.DisplayName.Trim(), isActive = true, isLocked = request.IsLocked, teacherId = request.TeacherId, permissionCodes = request.PermissionCodes });
            }
            catch (PostgresException ex) when (ex.SqlState == "23505")
            {
                await transaction.RollbackAsync(ct);
                return Results.Conflict(new { message = ex.ConstraintName == "ux_app_users_teacher_id" ? "هذه المعلمة مرتبطة بحساب آخر." : "اسم المستخدم مستخدم بالفعل." });
            }
        });

        users.MapPut("/{id:guid}", async Task<IResult> (Guid id, AdminUserWriteRequest request, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(request.DisplayName) || request.DisplayName.Trim().Length > 160)
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["displayName"] = ["اسم العرض مطلوب وبحد أقصى 160 حرفًا."] });
            if (string.IsNullOrWhiteSpace(request.Username) || request.Username.Trim().Length > 100)
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["username"] = ["اسم المستخدم مطلوب وبحد أقصى 100 حرف."] });
            var permissionErrors = ValidatePermissionList(request.PermissionCodes);
            if (permissionErrors is not null) return Results.ValidationProblem(permissionErrors);
            var actorId = GetActorId(principal);
            if (actorId == id && !request.IsActive)
                return Results.Conflict(new { message = "لا يمكنك تعطيل حسابك الحالي. استخدم حساب مدير آخر." });
            if (actorId == id && !request.PermissionCodes.Contains("users.manage", StringComparer.Ordinal))
                return Results.Conflict(new { message = "لا يمكنك إزالة صلاحية إدارة الحسابات من حسابك الحالي. استخدم حساب مدير آخر." });
            var removesUserManager = !request.IsActive || !request.PermissionCodes.Contains("users.manage", StringComparer.Ordinal);
            if (removesUserManager && await IsActiveUserManagerAsync(db, id, ct) && !await HasOtherActiveUserManagerAsync(db, id, ct))
                return Results.Conflict(new { message = "لا يمكن تعطيل آخر حساب مدير أو إزالة صلاحية إدارة الحسابات منه. أضف مديرًا آخر أولًا." });
            if (!string.IsNullOrEmpty(request.Password) && request.Password.Length < 6)
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["password"] = ["كلمة المرور الجديدة يجب ألا تقل عن 6 أحرف."] });

            await using var connection = await db.OpenConnectionAsync(ct);
            await using var transaction = await connection.BeginTransactionAsync(ct);
            try
            {
                var bumpSession = !request.IsActive || !string.IsNullOrEmpty(request.Password);
                var sql = string.IsNullOrEmpty(request.Password)
                    ? "UPDATE app_users SET username=@username, display_name=@display, is_active=@active, session_version=session_version+CASE WHEN @bump THEN 1 ELSE 0 END, updated_at=now() WHERE id=@id;"
                    : "UPDATE app_users SET username=@username, display_name=@display, is_active=@active, password_hash=@hash, session_version=session_version+CASE WHEN @bump THEN 1 ELSE 0 END, updated_at=now() WHERE id=@id;";
                await using (var update = new NpgsqlCommand(sql, connection, transaction))
                {
                    update.Parameters.AddWithValue("id", id);
                    update.Parameters.AddWithValue("username", request.Username.Trim().ToLowerInvariant());
                    update.Parameters.AddWithValue("display", request.DisplayName.Trim());
                    update.Parameters.AddWithValue("active", request.IsActive);
                    update.Parameters.AddWithValue("bump", bumpSession);
                    if (!string.IsNullOrEmpty(request.Password)) update.Parameters.AddWithValue("hash", Passwords.Hash(request.Password));
                    if (await update.ExecuteNonQueryAsync(ct) == 0) return Results.NotFound();
                }
                await ReplacePermissions(connection, transaction, id, request.PermissionCodes, ct);
                await transaction.CommitAsync(ct);
                return Results.Ok(new { id, username = request.Username.Trim().ToLowerInvariant(), displayName = request.DisplayName.Trim(), isActive = request.IsActive, permissionCodes = request.PermissionCodes });
            }
            catch (PostgresException ex) when (ex.SqlState == "23505")
            {
                await transaction.RollbackAsync(ct);
                return Results.Conflict(new { message = "اسم المستخدم مستخدم بالفعل." });
            }
        });

        users.MapPut("/{id:guid}/access", async Task<IResult> (Guid id, AdminUserAccessRequest request, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            var actorId = GetActorId(principal);
            if (actorId == id && request.IsLocked)
                return Results.Conflict(new { message = "لا يمكنك قفل حسابك الحالي. استخدم حساب مدير آخر." });
            if (request.IsLocked && string.IsNullOrWhiteSpace(request.LockReason))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["lockReason"] = ["اكتب سبب قفل الحساب."] });
            var linkError = await ValidateTeacherLinkAsync(db, id, request.TeacherId, ct);
            if (linkError is not null) return linkError;

            var replaceScopes = request.ScopeCircleIds is not null || request.ScopeTeacherIds is not null;
            var scopeCircles = (request.ScopeCircleIds ?? []).Distinct().ToArray();
            var scopeTeachers = (request.ScopeTeacherIds ?? []).Distinct().ToArray();

            if (scopeCircles.Length > 0)
            {
                await using var valid = db.CreateCommand("SELECT COUNT(*) FROM circles WHERE id = ANY(@ids) AND is_trashed = FALSE;");
                valid.Parameters.AddWithValue("ids", scopeCircles);
                if (Convert.ToInt32(await valid.ExecuteScalarAsync(ct) ?? 0) != scopeCircles.Length)
                    return Results.ValidationProblem(new Dictionary<string, string[]> { ["scopeCircleIds"] = ["بعض الحلقات المحددة غير موجودة."] });
            }

            if (scopeTeachers.Length > 0)
            {
                await using var valid = db.CreateCommand("SELECT COUNT(*) FROM teachers WHERE id = ANY(@ids) AND is_trashed = FALSE;");
                valid.Parameters.AddWithValue("ids", scopeTeachers);
                if (Convert.ToInt32(await valid.ExecuteScalarAsync(ct) ?? 0) != scopeTeachers.Length)
                    return Results.ValidationProblem(new Dictionary<string, string[]> { ["scopeTeacherIds"] = ["بعض المعلمات المحددة غير موجودة."] });
            }

            await using var connection = await db.OpenConnectionAsync(ct);
            await using var transaction = await connection.BeginTransactionAsync(ct);
            try
            {
                bool currentLocked;
                Guid? currentTeacherId;
                await using (var current = new NpgsqlCommand("SELECT is_locked, teacher_id FROM app_users WHERE id=@id FOR UPDATE;", connection, transaction))
                {
                    current.Parameters.AddWithValue("id", id);
                    await using var reader = await current.ExecuteReaderAsync(ct);
                    if (!await reader.ReadAsync(ct)) return Results.NotFound();
                    currentLocked = reader.GetBoolean(0);
                    currentTeacherId = reader.IsDBNull(1) ? null : reader.GetGuid(1);
                }

                var changed = request.IsLocked != currentLocked || request.TeacherId != currentTeacherId;
                var lockReason = request.IsLocked ? request.LockReason?.Trim() : null;
                await using (var update = new NpgsqlCommand("""
                    UPDATE app_users
                    SET is_locked=@locked, teacher_id=@teacher, lock_reason=@lockReason,
                        locked_at=CASE WHEN @locked THEN COALESCE(locked_at, now()) ELSE NULL END,
                        locked_by=CASE WHEN @locked THEN COALESCE(locked_by, @actor) ELSE NULL END,
                        session_version=session_version+CASE WHEN @changed THEN 1 ELSE 0 END,
                        updated_at=now()
                    WHERE id=@id;
                    """, connection, transaction))
                {
                    update.Parameters.AddWithValue("id", id);
                    update.Parameters.AddWithValue("locked", request.IsLocked);
                    update.Parameters.AddWithValue("changed", changed);
                    update.Parameters.AddWithValue("actor", actorId);
                    AddNullable(update, "teacher", request.TeacherId);
                    AddNullable(update, "lockReason", lockReason);
                    if (await update.ExecuteNonQueryAsync(ct) == 0) return Results.NotFound();
                }

                if (replaceScopes)
                {
                    await using (var clear = new NpgsqlCommand("DELETE FROM app_user_scopes WHERE user_id=@id;", connection, transaction))
                    {
                        clear.Parameters.AddWithValue("id", id);
                        await clear.ExecuteNonQueryAsync(ct);
                    }
                    foreach (var circle in scopeCircles)
                    {
                        await using var insert = new NpgsqlCommand("""
                            INSERT INTO app_user_scopes(user_id, scope_type, scope_id, created_by)
                            VALUES (@user, 'circle', @scope, @actor);
                            """, connection, transaction);
                        insert.Parameters.AddWithValue("user", id);
                        insert.Parameters.AddWithValue("scope", circle);
                        insert.Parameters.AddWithValue("actor", actorId);
                        await insert.ExecuteNonQueryAsync(ct);
                    }
                    foreach (var teacher in scopeTeachers)
                    {
                        await using var insert = new NpgsqlCommand("""
                            INSERT INTO app_user_scopes(user_id, scope_type, scope_id, created_by)
                            VALUES (@user, 'teacher', @scope, @actor);
                            """, connection, transaction);
                        insert.Parameters.AddWithValue("user", id);
                        insert.Parameters.AddWithValue("scope", teacher);
                        insert.Parameters.AddWithValue("actor", actorId);
                        await insert.ExecuteNonQueryAsync(ct);
                    }
                }

                await AuditLogWriter.WriteAsync(connection, transaction, actorId,
                    principal.FindFirstValue("display_name") ?? "مدير النظام",
                    "user.access.update", "app_user", id,
                    detailsJson: JsonSerializer.Serialize(new
                    {
                        isLocked = request.IsLocked,
                        teacherId = request.TeacherId,
                        scopeCircles,
                        scopeTeachers
                    }),
                    requestPath: $"/api/admin/users/{id}/access", httpMethod: "PUT", cancellationToken: ct);

                await transaction.CommitAsync(ct);
                return Results.Ok(new { id, isLocked = request.IsLocked, teacherId = request.TeacherId, lockReason });
            }
            catch (PostgresException ex) when (ex.SqlState == "23505")
            {
                await transaction.RollbackAsync(ct);
                return Results.Conflict(new { message = "هذه المعلمة مرتبطة بحساب آخر." });
            }
        });

        users.MapDelete("/{id:guid}", async Task<IResult> (Guid id, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            if (GetActorId(principal) == id) return Results.Conflict(new { message = "لا يمكنك تعطيل حسابك الحالي." });
            if (await IsActiveUserManagerAsync(db, id, ct) && !await HasOtherActiveUserManagerAsync(db, id, ct))
                return Results.Conflict(new { message = "لا يمكن تعطيل آخر حساب مدير. أضف مديرًا آخر أولًا." });
            await using var cmd = db.CreateCommand("UPDATE app_users SET is_active=FALSE, session_version=session_version+1, updated_at=now() WHERE id=@id RETURNING id;");
            cmd.Parameters.AddWithValue("id", id);
            var result = await cmd.ExecuteScalarAsync(ct);
            if (result is null) return Results.NotFound();
            return Results.Ok(new { id, isActive = false });
        });
    }
}
