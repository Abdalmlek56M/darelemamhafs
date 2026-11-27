namespace DarEltahfeez.Api.Media;

/// <summary>
/// Configuration for the Tier 2.5 file-backed media store. Bound manually from the "Media"
/// configuration section in Program.cs so this type stays a dependency-free POCO that can be
/// unit-checked without ASP.NET.
///
/// Environment variables (double underscore maps to the configuration colon):
///   Media__RootPath            absolute directory that holds receipts/avatars/logos.
///                              Production: /var/lib/dar/media (persistent, writable by the API user).
///                              Unset: &lt;system temp&gt;/dar-media (test/desktop fallback).
///   Media__MaxReceiptBytes     optional, default 8 MiB (kept in sync with the endpoint limit).
///   Media__MaxAvatarBytes      optional, default 2 MiB.
///   Media__MaxLogoBytes        optional, default 2 MiB.
///   Media__BackfillOnStartup   optional bool, default false: deliberately migrate legacy BYTEA rows once.
///   Media__BackfillBatchSize   optional, default 10 rows per batch for the backfill.
/// </summary>
public sealed class MediaOptions
{
    public const long DefaultMaxReceiptBytes = 8L * 1024 * 1024;
    public const long DefaultMaxAvatarBytes = 2L * 1024 * 1024;
    public const long DefaultMaxLogoBytes = 2L * 1024 * 1024;
    public const int DefaultBackfillBatchSize = 10;
    public const string DefaultRootDirectoryName = "dar-media";

    /// <summary>Configured media root; null/empty means the documented temp fallback.</summary>
    public string? RootPath { get; init; }

    public long MaxReceiptBytes { get; init; } = DefaultMaxReceiptBytes;
    public long MaxAvatarBytes { get; init; } = DefaultMaxAvatarBytes;
    public long MaxLogoBytes { get; init; } = DefaultMaxLogoBytes;

    /// <summary>When true the application runs one deliberate MediaBackfillService batch at startup.</summary>
    public bool BackfillOnStartup { get; init; }

    /// <summary>Rows loaded per batch by the deliberate BYTEA-to-file backfill.</summary>
    public int BackfillBatchSize { get; init; } = DefaultBackfillBatchSize;
}
