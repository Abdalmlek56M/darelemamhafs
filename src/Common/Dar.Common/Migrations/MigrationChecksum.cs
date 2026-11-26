namespace Dar.Common.Migrations;

/// <summary>
/// FINAL 1.16: migration checksums must not depend on the checkout's line endings.
/// The desktop/Windows checkout used CRLF while the Linux deploy uses LF; hashing the
/// raw text made the same migration look changed on the other machine.
/// </summary>
public static class MigrationChecksum
{
    public static string NormalizeLineEndings(string sql) =>
        (sql ?? string.Empty).Replace("\r\n", "\n", StringComparison.Ordinal).Replace('\r', '\n');

    public static string Compute(string sql) =>
        Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(
            System.Text.Encoding.UTF8.GetBytes(NormalizeLineEndings(sql)))).ToLowerInvariant();
}
