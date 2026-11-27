namespace DarEltahfeez.Api.Media;

/// <summary>The three media families stored on disk by Tier 2.5.</summary>
public enum MediaFileKind
{
    Receipt = 0,
    Avatar = 1,
    Logo = 2,
}

/// <summary>Result of storing one media file (content-addressed, immutable).</summary>
public sealed record MediaFileWriteResult(MediaFileKind Kind, string RelativePath, long SizeBytes, string ContentType);

/// <summary>A blob returned by a legacy BYTEA row together with the content type used on disk.</summary>
public sealed record MediaBlob(byte[] Content, string ContentType);

/// <summary>
/// Abstraction over the on-disk media store so endpoints depend on the contract, not on the
/// file-system implementation. All paths stored in PostgreSQL are relative to <see cref="RootPath"/>
/// and are always content-addressed SHA-256 names written by this service.
/// </summary>
public interface IMediaFileStore
{
    /// <summary>Absolute, canonical media root (created and write-probed at construction).</summary>
    string RootPath { get; }

    Task<MediaFileWriteResult> SaveReceiptAsync(byte[] content, string contentType, CancellationToken cancellationToken = default);
    Task<MediaFileWriteResult> SaveAvatarAsync(byte[] content, string contentType, CancellationToken cancellationToken = default);
    Task<MediaFileWriteResult> SaveLogoAsync(byte[] content, string contentType, CancellationToken cancellationToken = default);

    /// <summary>Reads a stored file; null when it does not exist. Throws on an unsafe relative path.</summary>
    Task<byte[]?> ReadAsync(string? relativePath, CancellationToken cancellationToken = default);

    /// <summary>True when the stored file exists; false for null paths (and for unsafe paths it throws).</summary>
    bool Exists(string? relativePath);
}

/// <summary>The configured/derived media root cannot be created or written to.</summary>
public sealed class MediaRootUnavailableException(string message, Exception? innerException = null)
    : InvalidOperationException(message, innerException);

/// <summary>A path from the database/configuration would escape the media root or is malformed.</summary>
public sealed class MediaPathTraversalException(string path)
    : InvalidOperationException($"Refusing an unsafe media path: {path}");

/// <summary>A media payload is larger than the configured per-kind limit.</summary>
public sealed class MediaSizeLimitExceededException(MediaFileKind kind, long actualBytes, long maxBytes)
    : InvalidOperationException($"Media payload for {kind} is {actualBytes} bytes, above the {maxBytes} byte limit.");

/// <summary>The content type cannot be mapped to a safe on-disk extension.</summary>
public sealed class MediaUnsupportedContentTypeException(string? contentType)
    : InvalidOperationException($"Unsupported media content type: {contentType ?? "(null)"}");
