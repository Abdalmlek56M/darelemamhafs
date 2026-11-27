namespace DarEltahfeez.Api.Media;

/// <summary>Outcome of the receipt image hook. ContentType must be one of the supported image types
/// (image/jpeg, image/png, image/webp) and must match the returned bytes; the upload endpoint
/// re-validates the magic bytes after this call.</summary>
public sealed record ReceiptImageProcessingResult(byte[] Content, string ContentType, bool WasResized);

/// <summary>
/// Hook for downscaling/re-encoding a receipt image before it is written to the media store.
///
/// STATUS: REAL RESIZING IS BLOCKED (Tier 2.5). The repository has no cross-platform image
/// codec dependency: there is no Directory.Packages.props and no csproj references
/// SixLabors.ImageSharp, SkiaSharp, Magick.NET or System.Drawing.Common. The CI/harness restores
/// NuGet packages offline, so no package may be added here. When the owner approves a dependency
/// (recommended: SixLabors.ImageSharp 3.1.x, cross-platform and pure managed; alternative:
/// SkiaSharp), implement this interface, register it instead of
/// <see cref="PassThroughReceiptImageProcessor"/> in Program.cs, and the upload endpoint keeps
/// working unchanged. Until then the registered implementation is a documented no-op so the
/// endpoint behaviour cannot silently pretend to resize.
/// </summary>
public interface IReceiptImageProcessor
{
    Task<ReceiptImageProcessingResult> ProcessAsync(byte[] content, string contentType, CancellationToken cancellationToken = default);
}

/// <summary>
/// The currently registered pass-through implementation: returns exactly the uploaded bytes and
/// declared content type (<see cref="ReceiptImageProcessingResult.WasResized"/> is false). It is a
/// real, testable no-op — not a fake resizer and not a hidden failure.
/// </summary>
public sealed class PassThroughReceiptImageProcessor : IReceiptImageProcessor
{
    public Task<ReceiptImageProcessingResult> ProcessAsync(byte[] content, string contentType, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(content);
        return Task.FromResult(new ReceiptImageProcessingResult(content, contentType, WasResized: false));
    }
}
