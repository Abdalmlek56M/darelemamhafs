using System.Net;
using System.Threading.RateLimiting;
using DarEltahfeez.Api;
using DarEltahfeez.Api.Services;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.RateLimiting;
using Npgsql;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddHttpClient();
builder.Services.AddMemoryCache();
builder.Services.AddSingleton<TurnstileVerifier>();

// P1-1 Turnstile: fail fast if the feature is enabled without its server-side configuration.
var turnstileSection = builder.Configuration.GetSection("Auth:Turnstile");
if (turnstileSection.GetValue<bool>("Enabled")
    && (string.IsNullOrWhiteSpace(turnstileSection["SiteKey"]) || string.IsNullOrWhiteSpace(turnstileSection["SecretKey"]) || string.IsNullOrWhiteSpace(turnstileSection["ExpectedHostname"])))
    throw new InvalidOperationException("Auth:Turnstile is enabled but SiteKey/SecretKey/ExpectedHostname is missing. Set them in the server environment.");

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

// Persistent structured logs are shared with the external Dar System Center.
builder.Logging.AddProvider(new DarFileLoggerProvider());

// Per-user local database configuration. Connection secrets stay outside the application folder.
var sharedSettingsPath = Path.Combine(
    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
    "DarEltahfeez", "appsettings.json");
builder.Configuration.AddJsonFile(sharedSettingsPath, optional: true, reloadOnChange: true);

// A narrowly gated connection override is reserved for isolated API acceptance runners.
// Both modes are restricted to uniquely named disposable databases on the local Dar PostgreSQL port.
var isolatedRehearsal = string.Equals(Environment.GetEnvironmentVariable("DAR_ISOLATED_REHEARSAL"), "1", StringComparison.Ordinal);
var isolatedFunctionalAcceptance = string.Equals(Environment.GetEnvironmentVariable("DAR_ISOLATED_FUNCTIONAL_ACCEPTANCE"), "1", StringComparison.Ordinal);
if (isolatedRehearsal && isolatedFunctionalAcceptance)
    throw new InvalidOperationException("Only one isolated API mode may be enabled at a time.");

if (isolatedFunctionalAcceptance)
{
    var functionalConnection = Environment.GetEnvironmentVariable("DAR_DATABASE_CONNECTION_STRING");
    if (string.IsNullOrWhiteSpace(functionalConnection))
        throw new InvalidOperationException("Functional acceptance mode requires DAR_DATABASE_CONNECTION_STRING.");

    var functionalBuilder = new NpgsqlConnectionStringBuilder(functionalConnection);
    var functionalDatabaseName = functionalBuilder.Database;
    const string requiredFunctionalUrl = "http://127.0.0.1:5082";
    var configuredUrls = Environment.GetEnvironmentVariable("ASPNETCORE_URLS");
    if (!string.Equals(functionalBuilder.Host, "127.0.0.1", StringComparison.OrdinalIgnoreCase) ||
        functionalBuilder.Port != 55432 ||
        !System.Text.RegularExpressions.Regex.IsMatch(
            functionalDatabaseName ?? string.Empty,
            "^dar_functional_test_[a-f0-9]{16}$",
            System.Text.RegularExpressions.RegexOptions.CultureInvariant) ||
        !string.Equals(functionalBuilder.Username, "dar_app", StringComparison.Ordinal) ||
        !string.Equals(configuredUrls, requiredFunctionalUrl, StringComparison.Ordinal))
        throw new InvalidOperationException("Isolated functional acceptance connection rejected. Only a dar_functional_test_* database on local PostgreSQL and the fixed loopback API port 5082 are allowed.");

    builder.Configuration["ConnectionStrings:DarDatabase"] = functionalConnection;
    // The runner applies the migrations to its disposable database before the API starts.
    builder.Configuration["Database:ApplyMigrationsOnStartup"] = "false";
    builder.WebHost.UseUrls(requiredFunctionalUrl);
}

// The rehearsal runner is read-only and restricted to its own staging database on port 5081.
if (isolatedRehearsal)
{
    var rehearsalConnection = Environment.GetEnvironmentVariable("DAR_DATABASE_CONNECTION_STRING");
    if (string.IsNullOrWhiteSpace(rehearsalConnection))
        throw new InvalidOperationException("Isolated rehearsal mode requires DAR_DATABASE_CONNECTION_STRING.");

    var rehearsalBuilder = new NpgsqlConnectionStringBuilder(rehearsalConnection);
    var rehearsalDatabaseName = rehearsalBuilder.Database;
    if (!string.Equals(rehearsalBuilder.Host, "127.0.0.1", StringComparison.OrdinalIgnoreCase) ||
        rehearsalBuilder.Port != 55432 ||
        string.IsNullOrWhiteSpace(rehearsalDatabaseName) ||
        !rehearsalDatabaseName.StartsWith("dar_migration_rehearsal_", StringComparison.Ordinal) ||
        !string.Equals(rehearsalBuilder.Username, "dar_app", StringComparison.Ordinal))
        throw new InvalidOperationException("Isolated rehearsal connection rejected. Only a dar_migration_rehearsal_* database on local PostgreSQL is allowed.");

    builder.Configuration["ConnectionStrings:DarDatabase"] = rehearsalConnection;
    // Rehearsal is read-only at the HTTP level and must never apply migrations to the staged archive.
    builder.Configuration["Database:ApplyMigrationsOnStartup"] = "false";
}

var desktopLocalMode = builder.Configuration.GetValue<bool>("Desktop:LocalMode") ||
    string.Equals(Environment.GetEnvironmentVariable("DAR_DESKTOP_LOCAL_MODE"), "1", StringComparison.Ordinal);

builder.Services.AddSingleton(sp =>
{
    var configuration = sp.GetRequiredService<IConfiguration>();
    var connectionString = configuration.GetConnectionString("DarDatabase");
    if (string.IsNullOrWhiteSpace(connectionString))
        throw new InvalidOperationException("Database connection is not configured. Set ConnectionStrings:DarDatabase in the application settings.");
    return NpgsqlDataSource.Create(connectionString);
});

builder.Services.AddSingleton<SystemAdminService>();

// ADR-0006: the admin session is shared with Dar.Api (/api/v1/meet/*). Both APIs must use
// the same Data Protection key ring and application name, otherwise the new API cannot
// decrypt the DarEltahfeez.Admin cookie. Changing the name invalidates existing sessions.
var dataProtection = builder.Services.AddDataProtection().SetApplicationName("DarEltahfeez");
var dataProtectionKeysPath = builder.Configuration["DataProtection:KeysPath"];
if (!string.IsNullOrWhiteSpace(dataProtectionKeysPath))
    dataProtection.PersistKeysToFileSystem(new DirectoryInfo(dataProtectionKeysPath));

builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(options =>
    {
        options.Cookie.Name = "DarEltahfeez.Admin";
        options.Cookie.HttpOnly = true;
        options.Cookie.SameSite = SameSiteMode.Strict;
        options.Cookie.SecurePolicy = (builder.Environment.IsDevelopment() || desktopLocalMode) ? CookieSecurePolicy.SameAsRequest : CookieSecurePolicy.Always;
        options.ExpireTimeSpan = TimeSpan.FromHours(8);
        options.SlidingExpiration = true;
        options.Events.OnValidatePrincipal = AuthEndpoints.ValidatePrincipalAsync;
        options.Events.OnRedirectToLogin = context =>
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return Task.CompletedTask;
        };
        options.Events.OnRedirectToAccessDenied = context =>
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            return Task.CompletedTask;
        };
    });

builder.Services.AddAuthorization(options =>
{
    foreach (var permission in AppPermissions.All)
        options.AddPolicy(permission.Code, policy => policy.RequireAuthenticatedUser().RequireClaim("permission", permission.Code));
    options.AddPolicy("schedule.access", policy => policy.RequireAuthenticatedUser().RequireAssertion(context =>
        context.User.HasClaim("permission", "schedule.read") || context.User.HasClaim("permission", "schedule.edit") ||
        context.User.HasClaim("permission", "attendance.read") || context.User.HasClaim("permission", "attendance.edit")));
    options.AddPolicy("attendance.access", policy => policy.RequireAuthenticatedUser().RequireAssertion(context =>
        context.User.HasClaim("permission", "attendance.read") || context.User.HasClaim("permission", "attendance.edit")));
});

// P1-1: per-IP throttling for password endpoints (5/min by default, configurable for tests).
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

var app = builder.Build();
app.UseForwardedHeaders();
app.Use(async (context, next) =>
{
    if (context.Request.Path.StartsWithSegments("/api"))
    {
        context.Response.Headers["Cache-Control"] = "no-store, no-cache, must-revalidate";
        context.Response.Headers["Pragma"] = "no-cache";
        context.Response.Headers["X-Content-Type-Options"] = "nosniff";
        context.Response.Headers["Referrer-Policy"] = "no-referrer";
        context.Response.Headers["X-Frame-Options"] = "DENY";
        context.Response.Headers["Content-Security-Policy"] = "frame-ancestors 'none'; base-uri 'self'; object-src 'none'";
        context.Response.Headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()";
        if (context.Request.IsHttps)
            context.Response.Headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
    }
    else if (context.Request.Path.Equals("/sw.js", StringComparison.OrdinalIgnoreCase))
    {
        // The service worker must be revalidated on every navigation so a deploy can update it immediately.
        context.Response.Headers["Cache-Control"] = "no-cache, max-age=0, must-revalidate";
        context.Response.Headers["Pragma"] = "no-cache";
    }
    await next();
});
app.UseMiddleware<SpaSecurityHeadersMiddleware>();
app.Use(async (context, next) =>
{
    try
    {
        await next();
    }
    catch (OperationCanceledException)
    {
        // Never turn client disconnects/cancellations into a generic server error.
        throw;
    }
    catch (Exception ex)
    {
        app.Logger.LogError(ex, "Unhandled exception for {Method} {Path}", context.Request.Method, context.Request.Path);
        if (context.Response.HasStarted) throw;
        context.Response.StatusCode = StatusCodes.Status500InternalServerError;
        context.Response.ContentType = "application/json; charset=utf-8";
        await context.Response.WriteAsJsonAsync(new { message = "حدث خطأ مؤقت في الخادم. لم يتم حفظ التغييرات، حاول بعد قليل." });
    }
});
// UI assets are static; all data still comes from permission-protected API endpoints.
app.UseDefaultFiles();
app.UseStaticFiles();
app.UseMiddleware<ApiRequestLoggingMiddleware>();
app.UseMiddleware<SameOriginGuardMiddleware>();
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();
app.UseMiddleware<AuditMiddleware>();

// Never auto-migrate a production web deployment. Legacy desktop/local development
// keeps its existing behavior until the new migration CLI replaces this block.
if (app.Configuration.GetValue<bool>("Database:ApplyMigrationsOnStartup") &&
    (app.Environment.IsDevelopment() || desktopLocalMode))
{
    var dataSource = app.Services.GetRequiredService<NpgsqlDataSource>();
    var migrationsDirectory = Path.Combine(AppContext.BaseDirectory, "database");
    var applied = await DatabaseInitializer.ApplyMigrationsAsync(dataSource, migrationsDirectory);
    app.Logger.LogInformation(applied.Count == 0
        ? "Database schema is already up to date."
        : "Applied database migrations: {Migrations}", string.Join(", ", applied));
}

// P0-14: public health answers expose status only; service/build details stay behind auth.
app.MapGet("/health", async Task<IResult> (NpgsqlDataSource db, CancellationToken ct) =>
{
    try
    {
        await using var cmd = db.CreateCommand("SELECT 1;");
        await cmd.ExecuteScalarAsync(ct);
        return Results.Ok(new { status = "ok" });
    }
    catch (NpgsqlException)
    {
        return Results.Json(new { status = "degraded" }, statusCode: 503);
    }
});
app.MapGet("/health/live", () => Results.Ok(new { status = "ok" }));
app.MapGet("/health/ready", async Task<IResult> (NpgsqlDataSource db, CancellationToken ct) =>
{
    try
    {
        await using var cmd = db.CreateCommand("SELECT 1;");
        await cmd.ExecuteScalarAsync(ct);
        return Results.Ok(new { status = "ready" });
    }
    catch (NpgsqlException)
    {
        return Results.Json(new { status = "not-ready" }, statusCode: 503);
    }
});
app.MapGet("/api/health/details", async Task<IResult> (NpgsqlDataSource db, CancellationToken ct) =>
{
    try
    {
        await using var cmd = db.CreateCommand("SELECT 1;");
        await cmd.ExecuteScalarAsync(ct);
        return Results.Ok(new { status = "ok", service = "DarEltahfeez.Api", database = "connected", stage = $"v{typeof(Program).Assembly.GetName().Version?.ToString(3) ?? "unknown"}" });
    }
    catch (NpgsqlException)
    {
        return Results.Json(new { status = "degraded", service = "DarEltahfeez.Api", database = "unavailable" }, statusCode: 503);
    }
}).RequireAuthorization();

AuthEndpoints.Map(app);
DomainEndpoints.Map(app);
SystemAdminEndpoints.Map(app);
SystemAdminEndpoints.MapInsights(app);
SystemAdminEndpoints.MapRequests(app);
SystemAdminEndpoints.MapPayroll(app);

// Serve the React single-page app in release/desktop hosting. Unknown /api routes stay 404.
app.MapFallback(async context =>
{
    if (context.Request.Path.StartsWithSegments("/api") || !SpaSecurityHeadersMiddleware.IsSpaEntry(context.Request.Path))
    {
        context.Response.StatusCode = StatusCodes.Status404NotFound;
        return;
    }

    var indexFile = app.Environment.WebRootFileProvider.GetFileInfo("index.html");
    if (!indexFile.Exists)
    {
        context.Response.StatusCode = StatusCodes.Status404NotFound;
        await context.Response.WriteAsync("The web UI has not been built. Run frontend npm build.");
        return;
    }

    context.Response.ContentType = "text/html; charset=utf-8";
    await context.Response.SendFileAsync(indexFile);
});
app.Run();
