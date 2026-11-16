using System.Net;
using System.Threading.RateLimiting;
using Dar.Api.Features.Health;
using Dar.Api.Features.System.MigrateDatabase;
using Dar.Api.Infrastructure.Errors;
using Dar.Api.Infrastructure.Security;
using Dar.Modules.Identity;
using Dar.Modules.Secretariat;
using Dar.Modules.Teaching;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.RateLimiting;
using Npgsql;

var builder = WebApplication.CreateBuilder(args);

if (args.Contains("--migrate", StringComparer.OrdinalIgnoreCase))
{
    Environment.ExitCode = await MigrationRunner.RunAsync(builder.Configuration);
    return;
}

builder.Services.AddProblemDetails();
builder.Services.AddExceptionHandler<AppExceptionHandler>();
builder.Services.AddOpenApi("v1");

// Caddy terminates TLS on the same host. Trust only loopback by default; Docker
// deployments can add their proxy IP(s) through ForwardedHeaders:KnownProxies.
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    options.KnownProxies.Add(IPAddress.Loopback);
    options.KnownProxies.Add(IPAddress.IPv6Loopback);
    foreach (var value in builder.Configuration.GetSection("ForwardedHeaders:KnownProxies").Get<string[]>() ?? [])
    {
        if (IPAddress.TryParse(value, out var proxy)) options.KnownProxies.Add(proxy);
    }
});

builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddPolicy("auth", context =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 10,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0
            }));
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
app.MapSecretariatEndpoints();
app.MapTeachingEndpoints();

app.MapGet("/api/v1/ping", () => Results.Ok(new
{
    status = "ok",
    service = "Dar.Api",
    version = "0.1.0"
})).WithTags("system");

app.Run();

// Required for WebApplicationFactory<Program> in integration tests.
public partial class Program;
