using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json;

namespace DarEltahfeez.Desktop;

/// <summary>
/// Stores optional remembered sign-in credentials encrypted for the current Windows user
/// with the Windows Data Protection API (DPAPI). Credentials are never written as plain text.
/// </summary>
internal static class WindowsCredentialVault
{
    private const uint CryptProtectUiForbidden = 0x1;
    private static readonly string VaultPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "DarEltahfeez", "saved-profiles.bin");

    public sealed record SavedCredential(string Username, string DisplayName, string Password);

    public static SavedCredential? Get(string username) => ReadAll().FirstOrDefault(
        item => string.Equals(item.Username, username, StringComparison.OrdinalIgnoreCase));

    public static void Save(string username, string password, string displayName)
    {
        if (string.IsNullOrWhiteSpace(username) || string.IsNullOrEmpty(password)) return;
        var items = ReadAll();
        items.RemoveAll(item => string.Equals(item.Username, username, StringComparison.OrdinalIgnoreCase));
        items.Insert(0, new SavedCredential(username.Trim(), displayName?.Trim() ?? username.Trim(), password));
        WriteAll(items.Take(6).ToList());
    }

    public static void UpdateIfSaved(string username, string password, string displayName)
    {
        if (string.IsNullOrWhiteSpace(username) || string.IsNullOrEmpty(password)) return;
        var items = ReadAll();
        var index = items.FindIndex(item => string.Equals(item.Username, username, StringComparison.OrdinalIgnoreCase));
        if (index < 0) return;
        items[index] = new SavedCredential(username.Trim(), displayName?.Trim() ?? items[index].DisplayName, password);
        WriteAll(items);
    }

    public static void Delete(string username)
    {
        if (string.IsNullOrWhiteSpace(username)) return;
        var items = ReadAll();
        if (items.RemoveAll(item => string.Equals(item.Username, username, StringComparison.OrdinalIgnoreCase)) > 0)
            WriteAll(items);
    }

    private static List<SavedCredential> ReadAll()
    {
        try
        {
            if (!File.Exists(VaultPath)) return [];
            var encrypted = File.ReadAllBytes(VaultPath);
            var clear = Transform(encrypted, protect: false);
            try { return JsonSerializer.Deserialize<List<SavedCredential>>(clear) ?? []; }
            finally { CryptographicOperations.ZeroMemory(clear); }
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or JsonException or CryptographicException or Win32Exception)
        {
            // A damaged or inaccessible vault must never prevent normal manual sign-in.
            return [];
        }
    }

    private static void WriteAll(List<SavedCredential> items)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(VaultPath)!);
        var clear = JsonSerializer.SerializeToUtf8Bytes(items);
        byte[]? encrypted = null;
        try
        {
            encrypted = Transform(clear, protect: true);
            var temporary = VaultPath + ".tmp";
            File.WriteAllBytes(temporary, encrypted);
            File.Move(temporary, VaultPath, overwrite: true);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(clear);
            if (encrypted is not null) CryptographicOperations.ZeroMemory(encrypted);
        }
    }

    private static byte[] Transform(byte[] bytes, bool protect)
    {
        var input = new DataBlob { Size = bytes.Length, Data = Marshal.AllocHGlobal(Math.Max(1, bytes.Length)) };
        DataBlob output = default;
        IntPtr description = IntPtr.Zero;
        try
        {
            if (bytes.Length > 0) Marshal.Copy(bytes, 0, input.Data, bytes.Length);
            var success = protect
                ? CryptProtectData(ref input, "Dar Eltahfeez remembered sign-in", IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, CryptProtectUiForbidden, out output)
                : CryptUnprotectData(ref input, out description, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, CryptProtectUiForbidden, out output);
            if (!success) throw new Win32Exception(Marshal.GetLastWin32Error(), "تعذر فك أو حماية بيانات الدخول باستخدام حماية Windows.");
            var result = new byte[output.Size];
            if (output.Size > 0) Marshal.Copy(output.Data, result, 0, output.Size);
            return result;
        }
        finally
        {
            if (input.Data != IntPtr.Zero)
            {
                if (bytes.Length > 0) Marshal.Copy(new byte[bytes.Length], 0, input.Data, bytes.Length);
                Marshal.FreeHGlobal(input.Data);
            }
            if (output.Data != IntPtr.Zero)
            {
                if (output.Size > 0) Marshal.Copy(new byte[output.Size], 0, output.Data, output.Size);
                LocalFree(output.Data);
            }
            if (description != IntPtr.Zero) LocalFree(description);
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct DataBlob
    {
        public int Size;
        public IntPtr Data;
    }

    [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CryptProtectData(ref DataBlob input, string description, IntPtr optionalEntropy, IntPtr reserved, IntPtr prompt, uint flags, out DataBlob output);

    [DllImport("crypt32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CryptUnprotectData(ref DataBlob input, out IntPtr description, IntPtr optionalEntropy, IntPtr reserved, IntPtr prompt, uint flags, out DataBlob output);

    [DllImport("kernel32.dll")]
    private static extern IntPtr LocalFree(IntPtr memory);
}
