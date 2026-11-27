namespace DarEltahfeez.Api.Media;

/// <summary>
/// Small byte-level helper for the image formats the product accepts (JPG, PNG, WebP).
/// The same magic-byte rules are used by the receipt endpoint before and after the
/// <see cref="IReceiptImageProcessor"/> hook, so a future real resizer cannot smuggle in a
/// content type that does not match the produced bytes.
/// </summary>
public static class MediaContentTypes
{
    public const string Jpeg = "image/jpeg";
    public const string Png = "image/png";
    public const string WebP = "image/webp";
    public const string OctetStream = "application/octet-stream";

    private static readonly IReadOnlyDictionary<string, string> ExtensionByContentType =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            [Jpeg] = ".jpg",
            [Png] = ".png",
            [WebP] = ".webp",
            [OctetStream] = ".bin",
        };

    /// <summary>True when the declared content type is one the media store can name on disk.</summary>
    public static bool IsSupported(string? contentType) =>
        !string.IsNullOrWhiteSpace(contentType) && ExtensionByContentType.ContainsKey(Normalize(contentType));

    /// <summary>Trimmed, lower-case, parameter-free content type ("image/JPEG; charset=x" -> "image/jpeg").</summary>
    public static string Normalize(string? contentType)
    {
        if (string.IsNullOrWhiteSpace(contentType)) return string.Empty;
        var value = contentType.Trim();
        var separator = value.IndexOf(';');
        if (separator >= 0) value = value[..separator];
        return value.Trim().ToLowerInvariant();
    }

    /// <summary>Extension (with dot) stored on disk for a supported content type.</summary>
    public static bool TryGetExtension(string? contentType, out string extension)
    {
        extension = string.Empty;
        var normalized = Normalize(contentType);
        if (!ExtensionByContentType.TryGetValue(normalized, out var found)) return false;
        extension = found;
        return true;
    }

    /// <summary>Verifies the magic bytes of the declared image format (same rules as before Tier 2.5).</summary>
    public static bool MatchesDeclared(byte[] content, string? declaredContentType)
    {
        ArgumentNullException.ThrowIfNull(content);
        var contentType = Normalize(declaredContentType);
        var isJpeg = content.Length >= 3 && content[0] == 0xFF && content[1] == 0xD8 && content[2] == 0xFF;
        var isPng = content.Length >= 8 && content[0] == 0x89 && content[1] == 0x50 && content[2] == 0x4E && content[3] == 0x47
            && content[4] == 0x0D && content[5] == 0x0A && content[6] == 0x1A && content[7] == 0x0A;
        var isWebp = content.Length >= 12 && content[0] == (byte)'R' && content[1] == (byte)'I' && content[2] == (byte)'F' && content[3] == (byte)'F'
            && content[8] == (byte)'W' && content[9] == (byte)'E' && content[10] == (byte)'B' && content[11] == (byte)'P';
        return contentType switch
        {
            Jpeg => isJpeg,
            Png => isPng,
            WebP => isWebp,
            OctetStream => true,
            _ => false,
        };
    }

    /// <summary>
    /// Resolves the stored content type for a legacy row: keep a declared supported type,
    /// otherwise sniff the legacy bytes, otherwise use the caller's fallback. Only the receipt
    /// download uses the sniffing branch (historically a NULL type there failed the request);
    /// branding/avatar keep their documented "image/png" fallback.
    /// </summary>
    public static string ResolveLegacy(string? declaredContentType, byte[] content, string fallback)
    {
        var declared = Normalize(declaredContentType);
        if (IsSupported(declared)) return declared;
        if (content.Length >= 8 && content[0] == 0x89 && content[1] == 0x50 && content[2] == 0x4E && content[3] == 0x47) return Png;
        if (content.Length >= 3 && content[0] == 0xFF && content[1] == 0xD8 && content[2] == 0xFF) return Jpeg;
        if (content.Length >= 12 && content[0] == (byte)'R' && content[1] == (byte)'I' && content[2] == (byte)'F' && content[3] == (byte)'F'
            && content[8] == (byte)'W' && content[9] == (byte)'E' && content[10] == (byte)'B' && content[11] == (byte)'P') return WebP;
        return fallback;
    }
}
