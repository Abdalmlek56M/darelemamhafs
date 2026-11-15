using System.Security.Claims;
using Dapper;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Npgsql;

namespace Dar.Modules.Identity.Persistence;

/// <summary>
/// Server-side cookie ticket store: every session can be revoked and is bounded by an expiry.
/// The ticket itself is already encrypted by ASP.NET Data Protection; we store it Base64.
/// </summary>
public sealed class DatabaseTicketStore(
    NpgsqlDataSource dataSource,
    IHttpContextAccessor httpContextAccessor) : ITicketStore
{
    public async Task<string> StoreAsync(AuthenticationTicket ticket)
    {
        var userIdValue = ticket.Principal?.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!Guid.TryParse(userIdValue, out var userId))
            throw new InvalidOperationException("Cannot create a session without a user id.");

        var id = Guid.NewGuid();
        var expiresAt = ticket.Properties.ExpiresUtc ?? DateTimeOffset.UtcNow.AddHours(8);
        var serialized = Convert.ToBase64String(TicketSerializer.Default.Serialize(ticket));
        var context = httpContextAccessor.HttpContext;

        await using var connection = await dataSource.OpenConnectionAsync();
        await connection.ExecuteAsync("""
            INSERT INTO auth_sessions(id,user_id,ticket,expires_at,ip,user_agent)
            VALUES(@id,@userId,@ticket,@expiresAt,@ip,@userAgent);
            """, new
        {
            id,
            userId,
            ticket = serialized,
            expiresAt,
            ip = context?.Connection.RemoteIpAddress?.ToString(),
            userAgent = context?.Request.Headers.UserAgent.ToString()
        });

        return id.ToString();
    }

    public async Task RenewAsync(string key, AuthenticationTicket ticket)
    {
        if (!Guid.TryParse(key, out var id)) return;

        var expiresAt = ticket.Properties.ExpiresUtc ?? DateTimeOffset.UtcNow.AddHours(8);
        var serialized = Convert.ToBase64String(TicketSerializer.Default.Serialize(ticket));

        await using var connection = await dataSource.OpenConnectionAsync();
        await connection.ExecuteAsync("""
            UPDATE auth_sessions
            SET ticket=@ticket, expires_at=@expiresAt, last_seen_at=now()
            WHERE id=@id AND revoked_at IS NULL;
            """, new { id, ticket = serialized, expiresAt });
    }

    public async Task<AuthenticationTicket?> RetrieveAsync(string key)
    {
        if (!Guid.TryParse(key, out var id)) return null;

        await using var connection = await dataSource.OpenConnectionAsync();
        var row = await connection.QuerySingleOrDefaultAsync<SessionRow>("""
            SELECT ticket AS Ticket, expires_at AS ExpiresAt, revoked_at AS RevokedAt
            FROM auth_sessions WHERE id=@id;
            """, new { id });

        if (row is null || row.RevokedAt is not null || row.ExpiresAt <= DateTimeOffset.UtcNow)
            return null;

        await connection.ExecuteAsync("""
            UPDATE auth_sessions SET last_seen_at=now() WHERE id=@id;
            """, new { id });

        try
        {
            return TicketSerializer.Default.Deserialize(Convert.FromBase64String(row.Ticket));
        }
        catch
        {
            return null;
        }
    }

    public async Task RemoveAsync(string key)
    {
        if (!Guid.TryParse(key, out var id)) return;

        await using var connection = await dataSource.OpenConnectionAsync();
        await connection.ExecuteAsync("""
            UPDATE auth_sessions SET revoked_at=now()
            WHERE id=@id AND revoked_at IS NULL;
            """, new { id });
    }

    private sealed class SessionRow
    {
        public string Ticket { get; set; } = "";
        public DateTimeOffset ExpiresAt { get; set; }
        public DateTimeOffset? RevokedAt { get; set; }
    }
}
