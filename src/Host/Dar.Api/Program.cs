using System.Net;
using System.Threading.RateLimiting;
using Dar.Api.Features.Health;
using Dar.Api.Features.System.MigrateDatabase;
using Dar.Api.Features.System.NotificationSync;
using Dar.Api.Infrastructure.Errors;
using Dar.Api.Infrastructure.Security;
using Dar.Modules.Identity;
using Dar.Modules.Meet;
using Dar.Modules.Secretariat;
using Dar.Modules.Teaching;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.RateLimiting;
using Npgsql;

var builder = WebApplication.CreateBuilder(args);

// P1-1 Turnstile: fail fast if the feature is enabled without its server-side configuration.
var turnstileSection = builder.Configuration.GetSection("Auth:Turnstile");
if (turnstileSection.GetValue<bool>("Enabled")
    && (string.IsNullOrWhiteSpace(turnstileSection["SiteKey"]) || string.IsNullOrWhiteSpace(turnstileSection["SecretKey"])))
    throw new InvalidOperationException("Auth:Turnstile is enabled but SiteKey/SecretKey is missing. Set them in the server environment.");

if (args.Contains("--migrate", StringComparer.OrdinalIgnoreCase))
{
    Environment.ExitCode = await MigrationRunner.RunAsync(builder.Configuration);
    return;
}

builder.Services.AddProblemDetails();
builder.Services.AddExceptionHandler<AppExceptionHandler>();
builder.Services.AddExceptionHandler<UnexpectedExceptionHandler>();
builder.Services.AddOpenApi("v1");

// Caddy terminates TLS on the same host. Trust only loopback by default; Docker
// deployments can add their proxy IP(s) through ForwardedHeaders:KnownProxies.
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    // P1-1: trust only the header Nginx overwrites from its real_ip value; ignore client X-Forwarded-For.
    options.ForwardedForHeaderName = "X-Real-IP";
    options.KnownProxies.Add(IPAddress.Loopback);
    options.KnownProxies.Add(IPAddress.IPv6Loopback);
    foreach (var value in builder.Configuration.GetSection("ForwardedHeaders:KnownProxies").Get<string[]>() ?? [])
    {
        if (IPAddress.TryParse(value, out var proxy)) options.KnownProxies.Add(proxy);
    }
});

var authRateLimitPermit = builder.Configuration.GetValue<int?>("Auth:RateLimit:PermitLimit") ?? 5;
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddPolicy("auth", context =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = authRateLimitPermit,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0
            }));
    options.OnRejected = async (context, token) =>
    {
        if (context.Lease.TryGetMetadata(MetadataName.RetryAfter, out var retryAfter))
            context.HttpContext.Response.Headers.RetryAfter = Math.Ceiling(retryAfter.TotalSeconds).ToString(System.Globalization.CultureInfo.InvariantCulture);
        context.HttpContext.Response.StatusCode = StatusCodes.Status429TooManyRequests;
        await context.HttpContext.Response.WriteAsJsonAsync(new { message = "محاولات كثيرة جدًا. انتظر قليلاً ثم أعد المحاولة." }, cancellationToken: token);
    };
});

// The data source is created lazily so build/test does not require a database.
// A production start must set ConnectionStrings:Default.
builder.Services.AddSingleton<NpgsqlDataSource>(_ =>
{
    var connectionString = builder.Configuration.GetConnectionString("Default");
    if (string.IsNullOrWhiteSpace(connectionString))
        throw new InvalidOperationException("ConnectionStrings:Default is not configured.");
    return NpgsqlDataSource.Create(connectionString);
});

builder.Services.AddIdentityModule(builder.Configuration, builder.Environment.IsDevelopment());
builder.Services.AddSecretariatModule();
builder.Services.AddMeetModule(builder.Configuration);
builder.Services.AddHostedService<NotificationSyncService>();

var app = builder.Build();

app.UseExceptionHandler();
app.UseStatusCodePages();
app.UseForwardedHeaders();
app.UseMiddleware<SecurityHeadersMiddleware>();
app.UseMiddleware<SameOriginGuardMiddleware>();
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();

app.MapOpenApi("/api/openapi/{documentName}.json");
app.MapHealthEndpoints();
app.MapIdentityEndpoints();
app.MapNotificationSyncEndpoints();
app.MapSecretariatEndpoints();
app.MapTeachingEndpoints();
app.MapMeetEndpoints();

app.MapGet("/api/v1/ping", () => Results.Ok(new
{
    status = "ok",
    service = "Dar.Api",
    version = "0.1.0"
})).WithTags("system");

app.Run();

// Required for WebApplicationFactory<Program> in integration tests.
public partial class Program;