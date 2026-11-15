using Npgsql;

namespace Dar.Api.Features.Health;

public static class HealthEndpoints
{
    public static IEndpointRouteBuilder MapHealthEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/health").WithTags("health");

        group.MapGet("/live", () => Results.Ok(new { status = "ok" }))
            .AllowAnonymous();

        group.MapGet("/ready", async (IServiceProvider services, IConfiguration configuration, CancellationToken cancellationToken) =>
        {
            var connectionString = configuration.GetConnectionString("Default");
            if (string.IsNullOrWhiteSpace(connectionString))
                return Results.Json(new { status = "not-ready", database = "not-configured" }, statusCode: 503);

            try
            {
                var dataSource = services.GetRequiredService<NpgsqlDataSource>();
                await using var command = dataSource.CreateCommand("SELECT 1;");
                await command.ExecuteScalarAsync(cancellationToken);
                return Results.Ok(new { status = "ready", database = "connected" });
            }
            catch
            {
                return Results.Json(new { status = "not-ready", database = "unavailable" }, statusCode: 503);
            }
        }).AllowAnonymous();

        return app;
    }
}
