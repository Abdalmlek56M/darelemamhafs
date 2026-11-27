using System.Net;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Npgsql;
using NpgsqlTypes;

namespace DarEltahfeez.Api;

public static partial class AuthEndpoints
{
    // Random per process: no attacker can submit a plaintext that verifies against this hash.
    private static readonly string DummyPasswordHash = Passwords.Hash(
        $"{Guid.NewGuid():N}-{Convert.ToHexString(RandomNumberGenerator.GetBytes(32))}");


    public static void Map(WebApplication app)
    {
        MapSetupAndLogin(app);
        app.MapPost("/api/auth/change-password", async Task<IResult> (ChangePasswordRequest request, ClaimsPrincipal principal, NpgsqlDataSource db, CancellationToken ct) =>
        {
            var userId = GetActorId(principal);
            if (userId == Guid.Empty) return Results.Unauthorized();
            if (string.IsNullOrEmpty(request.CurrentPassword))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["currentPassword"] = ["اكتب كلمة المرور الحالية."] });
            if (string.IsNullOrEmpty(request.NewPassword) || request.NewPassword.Length < 6 || request.NewPassword.Length > 200)
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["newPassword"] = ["كلمة المرور الجديدة يجب أن تكون بين 6 و200 حرف."] });

            string storedHash;
            await using (var current = db.CreateCommand("SELECT password_hash FROM app_users WHERE id=@id AND is_active=TRUE;"))
            {
                current.Parameters.AddWithValue("id", userId);
                var value = await current.ExecuteScalarAsync(ct);
                if (value is not string hash) return Results.Unauthorized();
                storedHash = hash;
            }
            if (!Passwords.Verify(request.CurrentPassword, storedHash))
                return Results.BadRequest(new { message = "كلمة المرور الحالية غير صحيحة." });
            if (Passwords.Verify(request.NewPassword, storedHash))
                return Results.BadRequest(new { message = "اختَر كلمة مرور مختلفة عن الحالية." });

            await using (var update = db.CreateCommand("UPDATE app_users SET password_hash=@hash,session_version=session_version+1,updated_at=now() WHERE id=@id AND is_active=TRUE;"))
            {
                update.Parameters.AddWithValue("id", userId);
                update.Parameters.AddWithValue("hash", Passwords.Hash(request.NewPassword));
                if (await update.ExecuteNonQueryAsync(ct) == 0) return Results.Unauthorized();
            }
            try
            {
                await SystemAdminEndpoints.InsertAuditAsync(db, userId, principal.FindFirst("display_name")?.Value,
                    "auth.password.change", "app_users", userId, null,
                    JsonSerializer.Serialize(new { passwordChanged = true }), "/api/auth/change-password", "POST", false, ct);
            }
            catch { /* Password change has already committed; do not misreport it as failed because audit logging failed. */ }
            return Results.Ok(new { changed = true, reauthenticate = true, message = "تم تغيير كلمة المرور. سجّل الدخول من جديد." });
        }).RequireAuthorization();

        app.MapGet("/api/auth/me", (ClaimsPrincipal user) => Results.Ok(ToSession(user)))
            .RequireAuthorization();

        app.MapPost("/api/auth/logout", async Task<IResult> (HttpContext context) =>
        {
            await context.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            return Results.Ok(new { success = true });
        }).RequireAuthorization();

        MapAdminUsers(app);
    }

}
