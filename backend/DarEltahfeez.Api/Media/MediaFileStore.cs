using System.Security.Cryptography;

namespace DarEltahfeez.Api.Media;

/// <summary>
/// File-system implementation of <see cref="IMediaFileStore"/>.
///
/// Responsibilities (Tier 2.5):
///   * resolve and validate the media root once (absolute path, not a file, writable, not "/" );
///   * reject any relative path that is rooted, contains "." / ".." segments or escapes the root;
///   * store files under content-addressed SHA-256 names with a content-type-derived extension;
///   * atomic writes (same-directory temp file + rename) so a crash never leaves a torn file;
///   * enforce the per-kind maximum sizes before touching the disk.
///
/// The class has no ASP.NET/Npgsql dependency, which keeps it checkable with a plain console
/// harness (see tests/regression/tier2-blobs for the HTTP-level regression suite).
/// </summary>
public sealed class MediaFileStore : IMediaFileStore
{
    private const int WriteBufferBytes = 64 * 1024;
    private const int MaxRelativePathLength = 1024;

    private readonly MediaOptions _options;

    public MediaFileStore(MediaOptions options)
    {
        _options = options ?? throw new ArgumentNullException(nameof(options));
        RootPath = ResolveRoot(options.RootPath);
    }

    public string RootPath { get; }

    public Task<MediaFileWriteResult> SaveReceiptAsync(byte[] content, string contentType, CancellationToken cancellationToken = default) =>
        SaveAsync(MediaFileKind.Receipt, content, contentType, _options.MaxReceiptBytes, cancellationToken);

    public Task<MediaFileWriteResult> SaveAvatarAsync(byte[] content, string contentType, CancellationToken cancellationToken = default) =>
        SaveAsync(MediaFileKind.Avatar, content, contentType, _options.MaxAvatarBytes, cancellationToken);

    public Task<MediaFileWriteResult> SaveLogoAsync(byte[] content, string contentType, CancellationToken cancellationToken = default) =>
        SaveAsync(MediaFileKind.Logo, content, contentType, _options.MaxLogoBytes, cancellationToken);

    public async Task<byte[]?> ReadAsync(string? relativePath, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(relativePath)) return null;
        var fullPath = ResolveExistingPathOrThrow(relativePath);
        return File.Exists(fullPath) ? await File.ReadAllBytesAsync(fullPath, cancellationToken) : null;
    }

    public bool Exists(string? relativePath)
    {
        if (string.IsNullOrWhiteSpace(relativePath)) return false;
        return File.Exists(ResolveExistingPathOrThrow(relativePath));
    }

    /// <summary>
    /// Resolves a stored relative path to an absolute path inside the root. Public for tests and
    /// diagnostics; throws <see cref="MediaPathTraversalException"/> for unsafe input.
    /// </summary>
    public string GetAbsolutePath(string relativePath) => ResolveExistingPathOrThrow(relativePath);

    private async Task<MediaFileWriteResult> SaveAsync(
        MediaFileKind kind,
        byte[] content,
        string contentType,
        long maxBytes,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(content);
        if (content.Length == 0) throw new ArgumentException("Media payload is empty.", nameof(content));
        if (maxBytes > 0 && content.Length > maxBytes)
            throw new MediaSizeLimitExceededException(kind, content.Length, maxBytes);

        var normalizedContentType = MediaContentTypes.Normalize(contentType);
        if (!MediaContentTypes.TryGetExtension(normalizedContentType, out var extension))
            throw new MediaUnsupportedContentTypeException(contentType);

        var hash = Convert.ToHexString(SHA256.HashData(content)).ToLowerInvariant();
        var relativePath = $"{DirectoryName(kind)}/{hash[..2]}/{hash}{extension}";
        var fullPath = ResolveNewPathOrThrow(relativePath);

        Directory.CreateDirectory(Path.GetDirectoryName(fullPath)!);
        if (!File.Exists(fullPath))
            await WriteAtomicallyAsync(fullPath, content, cancellationToken);

        return new MediaFileWriteResult(kind, relativePath, content.Length, normalizedContentType);
    }

    private static async Task WriteAtomicallyAsync(string fullPath, byte[] content, CancellationToken cancellationToken)
    {
        // Same directory as the target so File.Move is an atomic rename on the same file system.
        var tempPath = $"{fullPath}.{Guid.NewGuid():N}.tmp";
        try
        {
            await using (var stream = new FileStream(tempPath, FileMode.CreateNew, FileAccess.Write, FileShare.None,
                             WriteBufferBytes, FileOptions.Asynchronous))
            {
                await stream.WriteAsync(content, cancellationToken);
                await stream.FlushAsync(cancellationToken);
            }

            try
            {
                File.Move(tempPath, fullPath, overwrite: false);
            }
            catch (IOException) when (File.Exists(fullPath))
            {
                // Content-addressed name: a concurrent writer already stored identical bytes.
            }

            RestrictFilePermissions(fullPath);
        }
        finally
        {
            TryDelete(tempPath);
        }
    }

    private static void RestrictFilePermissions(string fullPath)
    {
        if (OperatingSystem.IsWindows()) return;
        try
        {
            // Financial evidence/avatars are private: owner read+write only.
            File.SetUnixFileMode(fullPath, UnixFileMode.UserRead | UnixFileMode.UserWrite);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or PlatformNotSupportedException)
        {
            // Best effort: the shared volume may not support mode changes; the root is still private.
        }
    }

    private static string DirectoryName(MediaFileKind kind) => kind switch
    {
        MediaFileKind.Receipt => "receipts",
        MediaFileKind.Avatar => "avatars",
        MediaFileKind.Logo => "logos",
        _ => throw new ArgumentOutOfRangeException(nameof(kind), kind, "Unknown media file kind."),
    };

    // ---------------------------------------------------------------------------------------
    // Root resolution / validation
    // ---------------------------------------------------------------------------------------

    private static string ResolveRoot(string? configuredRoot)
    {
        var candidate = string.IsNullOrWhiteSpace(configuredRoot)
            ? Path.Combine(Path.GetTempPath(), MediaOptions.DefaultRootDirectoryName)
            : configuredRoot.Trim();

        if (!Path.IsPathRooted(candidate))
            candidate = Path.Combine(AppContext.BaseDirectory, candidate);

        string fullPath;
        try
        {
            fullPath = Path.GetFullPath(candidate);
        }
        catch (Exception ex) when (ex is ArgumentException or NotSupportedException or PathTooLongException)
        {
            throw new MediaRootUnavailableException($"Media root path is not valid: {configuredRoot}", ex);
        }

        // Refuse a filesystem root ("/", "C:\") so a misconfigured variable can never make the
        // application write across the whole disk.
        var pathRoot = Path.GetPathRoot(fullPath) ?? string.Empty;
        if (string.Equals(
                Path.TrimEndingDirectorySeparator(pathRoot),
                Path.TrimEndingDirectorySeparator(fullPath),
                OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal))
            throw new MediaRootUnavailableException($"Media root must be a directory below the filesystem root: {fullPath}");

        try
        {
            if (File.Exists(fullPath))
                throw new MediaRootUnavailableException($"Media root points at a file, not a directory: {fullPath}");
            Directory.CreateDirectory(fullPath);
            ProbeWritable(fullPath);
        }
        catch (MediaRootUnavailableException)
        {
            throw;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or NotSupportedException)
        {
            throw new MediaRootUnavailableException(
                $"Media root is not writable: {fullPath}. Set Media__RootPath to a writable persistent directory.", ex);
        }

        return fullPath;
    }

    private static void ProbeWritable(string rootPath)
    {
        var probePath = Path.Combine(rootPath, $".media-write-probe-{Guid.NewGuid():N}");
        try
        {
            using (new FileStream(probePath, FileMode.CreateNew, FileAccess.Write, FileShare.None, 1, FileOptions.None))
            {
                // Creating and closing the probe is enough to prove directory writability.
            }
        }
        finally
        {
            TryDelete(probePath);
        }
    }

    private static void TryDelete(string path)
    {
        try
        {
            if (File.Exists(path)) File.Delete(path);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            // Best effort temp cleanup; the OS removes stale temp files on the media volume.
        }
    }

    // ---------------------------------------------------------------------------------------
    // Path-traversal guard
    // ---------------------------------------------------------------------------------------

    private string ResolveNewPathOrThrow(string relativePath) =>
        TryResolvePath(relativePath, requireExisting: false, out var fullPath)
            ? fullPath
            : throw new MediaPathTraversalException(relativePath);

    private string ResolveExistingPathOrThrow(string relativePath) =>
        TryResolvePath(relativePath, requireExisting: true, out var fullPath)
            ? fullPath
            : throw new MediaPathTraversalException(relativePath);

    private bool TryResolvePath(string? relativePath, bool requireExisting, out string fullPath)
    {
        fullPath = string.Empty;
        if (string.IsNullOrWhiteSpace(relativePath)) return false;
        if (relativePath.Length > MaxRelativePathLength) return false;
        if (relativePath.Contains('\0')) return false;

        // Accept both separators in stored values so a row migrated on Windows still reads on Linux.
        var normalized = relativePath.Replace('\\', '/');
        if (normalized.StartsWith('/')) return false;
        if (normalized.Contains(':')) return false;
        if (Path.IsPathRooted(normalized)) return false;

        var segments = normalized.Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (segments.Length == 0) return false;

        var comparison = OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;
        foreach (var segment in segments)
        {
            if (segment is "." or "..") return false;
            if (segment.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0) return false;
        }

        var combined = Path.GetFullPath(Path.Combine([RootPath, .. segments]));
        var rootWithSeparator = Path.EndsInDirectorySeparator(RootPath)
            ? RootPath
            : RootPath + Path.DirectorySeparatorChar;
        if (!combined.StartsWith(rootWithSeparator, comparison)) return false;
        if (string.Equals(combined, RootPath, comparison)) return false;
        if (requireExisting && Directory.Exists(combined)) return false;

        fullPath = combined;
        return true;
    }
}
