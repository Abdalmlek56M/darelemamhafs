namespace Dar.IntegrationTests;

/// <summary>
/// Central access to the disposable integration database.
///
/// A missing <c>DAR_TEST_DATABASE</c> FAILS by default: integration tests must never pass
/// silently just because the database environment is absent (CI false-green protection).
/// For local runs without PostgreSQL, the explicit opt-out
/// <c>DAR_INTEGRATION_DB_OPTIONAL=1</c> makes <see cref="Require"/> return an empty string so
/// the individual tests skip themselves. The opt-out is never the CI default.
/// </summary>
internal static class IntegrationDatabase
{
    public const string EnvName = "DAR_TEST_DATABASE";
    public const string OptionalEnvName = "DAR_INTEGRATION_DB_OPTIONAL";

    public static bool IsOptional =>
        string.Equals(Environment.GetEnvironmentVariable(OptionalEnvName), "1", StringComparison.Ordinal);

    /// <summary>
    /// Returns the disposable database connection string, or an empty string when the explicit
    /// local opt-out is set. Throws a clear error when the env is missing and not opted out.
    /// </summary>
    public static string Require()
    {
        var value = Environment.GetEnvironmentVariable(EnvName);
        if (!string.IsNullOrWhiteSpace(value))
        {
            return value;
        }

        if (IsOptional)
        {
            return string.Empty;
        }

        throw new InvalidOperationException(
            EnvName + " is required for the Dar integration tests (a disposable PostgreSQL database with the " +
            "production schema). CI and tests/run-regression.sh must provide it; local runs without PostgreSQL " +
            "may explicitly opt out with " + OptionalEnvName + "=1.");
    }
}
