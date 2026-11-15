using System.IO;
using System.Text;
using System.Windows;
using System.Windows.Threading;

namespace DarEltahfeez.Desktop;

public partial class App : Application
{
    private static readonly object LogSync = new();

    public App()
    {
        DispatcherUnhandledException += OnDispatcherUnhandledException;
        AppDomain.CurrentDomain.UnhandledException += OnDomainUnhandledException;
        TaskScheduler.UnobservedTaskException += OnUnobservedTaskException;
    }

    internal static void WriteDiagnostic(string source, string details)
    {
        try
        {
            var logDirectory = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "DarEltahfeez",
                "Logs");
            Directory.CreateDirectory(logDirectory);

            var logPath = Path.Combine(logDirectory, "desktop-crash.log");
            var entry = new StringBuilder()
                .Append('[').Append(DateTimeOffset.Now.ToString("O")).AppendLine("]")
                .Append("Source: ").AppendLine(source)
                .AppendLine(details)
                .AppendLine(new string('-', 72))
                .ToString();

            lock (LogSync)
            {
                File.AppendAllText(logPath, entry, new UTF8Encoding(false));
            }
        }
        catch
        {
            // Diagnostic logging must never prevent the desktop host from closing safely.
        }
    }

    private static void OnDispatcherUnhandledException(object? sender, DispatcherUnhandledExceptionEventArgs e)
    {
        WriteDiagnostic("WPF DispatcherUnhandledException", e.Exception.ToString());
        // Do not mark an unknown UI exception as handled; an inconsistent UI must not continue silently.
    }

    private static void OnDomainUnhandledException(object? sender, UnhandledExceptionEventArgs e)
    {
        var details = e.ExceptionObject?.ToString() ?? "Unknown unhandled application exception.";
        WriteDiagnostic("AppDomain.UnhandledException (IsTerminating=" + e.IsTerminating + ")", details);
    }

    private static void OnUnobservedTaskException(object? sender, UnobservedTaskExceptionEventArgs e)
    {
        WriteDiagnostic("TaskScheduler.UnobservedTaskException", e.Exception.ToString());
        e.SetObserved();
    }
}
