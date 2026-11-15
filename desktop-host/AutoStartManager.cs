using Microsoft.Win32;
using System.IO;

namespace DarEltahfeez.Desktop;

internal static class AutoStartManager
{
    private const string RunKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string ValueName = "DarEltahfeezDesktop";

    public static bool IsEnabledForCurrentLocation()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(RunKeyPath, writable: false);
            var stored = key?.GetValue(ValueName) as string;
            if (string.IsNullOrWhiteSpace(stored)) return false;
            var expected = GetLauncherCommand();
            return string.Equals(stored, expected, StringComparison.OrdinalIgnoreCase);
        }
        catch { return false; }
    }

    public static void SetEnabled(bool enabled)
    {
        using var key = Registry.CurrentUser.CreateSubKey(RunKeyPath, writable: true)
            ?? throw new InvalidOperationException("تعذر فتح إعدادات التشغيل التلقائي الخاصة بمستخدم Windows.");
        if (!enabled)
        {
            key.DeleteValue(ValueName, throwOnMissingValue: false);
            return;
        }
        key.SetValue(ValueName, GetLauncherCommand(), RegistryValueKind.String);
    }

    private static string GetLauncherCommand()
    {
        var current = new DirectoryInfo(AppContext.BaseDirectory);
        while (current is not null)
        {
            var batch = Path.Combine(current.FullName, "START_DAR.bat");
            var vbs = Path.Combine(current.FullName, "tools", "launch-hidden.vbs");
            if (File.Exists(batch) && File.Exists(vbs))
            {
                var wscript = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "wscript.exe");
                return $"\"{wscript}\" \"{vbs}\"";
            }
            current = current.Parent;
        }
        throw new InvalidOperationException("لم أجد START_DAR.bat وtools\\launch-hidden.vbs. فك ضغط حزمة التطبيق كاملة قبل تفعيل التشغيل التلقائي.");
    }
}
