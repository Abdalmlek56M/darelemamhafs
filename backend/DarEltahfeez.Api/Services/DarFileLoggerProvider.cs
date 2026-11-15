using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Logging;

namespace DarEltahfeez.Api.Services;

/// <summary>
/// Writes structured API logs to LocalAppData so the external Dar System Center
/// can inspect them even when the desktop application is closed.
/// Logging failures are intentionally swallowed and never interrupt business requests.
/// </summary>
public sealed class DarFileLoggerProvider : ILoggerProvider
{
    private const long MaxFileBytes = 10 * 1024 * 1024;
    private static readonly TimeSpan Retention = TimeSpan.FromDays(30);
    private static readonly UTF8Encoding Utf8NoBom = new(false);
    private static readonly Regex SecretPattern = new(
        @"(?i)(password|passwd|pwd|pgpassword|access_token|refresh_token)\s*([=:])\s*([^;\s,]+)",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);
    private static readonly Regex BearerPattern = new(
        @"(?i)(bearer\s+)[a-z0-9._~+/-]+=*", RegexOptions.Compiled | RegexOptions.CultureInvariant);
    private static readonly Regex EmailPattern = new(
        @"\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b", RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private readonly object _sync = new();
    private readonly string _logDirectory;
    private DateOnly _lastCleanup = DateOnly.MinValue;
    private bool _disposed;

    public DarFileLoggerProvider()
    {
        var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        if (string.IsNullOrWhiteSpace(local)) local = AppContext.BaseDirectory;
        _logDirectory = Path.Combine(local, "DarEltahfeez", "Logs");
    }

    public ILogger CreateLogger(string categoryName) => new DarFileLogger(this, categoryName);

    internal void Write(string category, LogLevel level, EventId eventId, string message, Exception? exception)
    {
        if (level == LogLevel.None || _disposed) return;
        try
        {
            var now = DateTimeOffset.Now;
            var record = new
            {
                timestamp = now,
                level = level.ToString(),
                category,
                eventId = eventId.Id,
                eventName = eventId.Name,
                processId = Environment.ProcessId,
                processName = Path.GetFileNameWithoutExtension(Environment.ProcessPath ?? "DarEltahfeez.Api"),
                message = Sanitize(message),
                exception = exception is null ? null : Sanitize(exception.ToString())
            };
            var line = JsonSerializer.Serialize(record) + Environment.NewLine;
            var bytes = Utf8NoBom.GetBytes(line);

            lock (_sync)
            {
                if (_disposed) return;
                Directory.CreateDirectory(_logDirectory);
                CleanupOldFiles(now);
                var file = GetCurrentFile(now, bytes.Length);
                using var stream = new FileStream(file, FileMode.Append, FileAccess.Write, FileShare.ReadWrite | FileShare.Delete);
                stream.Write(bytes, 0, bytes.Length);
                stream.Flush();
            }
        }
        catch
        {
            // A diagnostics sink must never take down the application.
        }
    }

    private string GetCurrentFile(DateTimeOffset now, int incomingBytes)
    {
        var prefix = $"api-{now:yyyyMMdd}";
        for (var index = 1; index < 1000; index++)
        {
            var suffix = index == 1 ? string.Empty : $"-{index:000}";
            var candidate = Path.Combine(_logDirectory, prefix + suffix + ".jsonl");
            var size = File.Exists(candidate) ? new FileInfo(candidate).Length : 0;
            if (size + incomingBytes <= MaxFileBytes) return candidate;
        }
        return Path.Combine(_logDirectory, prefix + "-overflow.jsonl");
    }

    private void CleanupOldFiles(DateTimeOffset now)
    {
        var today = DateOnly.FromDateTime(now.LocalDateTime);
        if (_lastCleanup == today) return;
        _lastCleanup = today;
        var cutoff = now.LocalDateTime - Retention;
        foreach (var file in Directory.EnumerateFiles(_logDirectory, "api-*.jsonl", SearchOption.TopDirectoryOnly))
        {
            try
            {
                if (File.GetLastWriteTime(file) < cutoff) File.Delete(file);
            }
            catch { /* Retention cleanup is best-effort. */ }
        }
    }

    private static string Sanitize(string value)
    {
        var safe = SecretPattern.Replace(value, "$1$2[REDACTED]");
        safe = BearerPattern.Replace(safe, "$1[REDACTED]");
        safe = EmailPattern.Replace(safe, "[EMAIL]");
        return safe.Length > 16_000 ? safe[..16_000] + " …[truncated]" : safe;
    }

    public void Dispose()
    {
        lock (_sync) _disposed = true;
    }

    private sealed class DarFileLogger(DarFileLoggerProvider owner, string category) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => NullScope.Instance;
        public bool IsEnabled(LogLevel logLevel) => logLevel != LogLevel.None;
        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            if (!IsEnabled(logLevel)) return;
            string message;
            try { message = formatter(state, exception); }
            catch { message = "A log event could not be formatted."; }
            owner.Write(category, logLevel, eventId, message, exception);
        }
    }

    private sealed class NullScope : IDisposable
    {
        public static readonly NullScope Instance = new();
        public void Dispose() { }
    }
}
