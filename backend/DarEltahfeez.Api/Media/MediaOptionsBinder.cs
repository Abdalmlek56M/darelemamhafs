using System.Globalization;
using Microsoft.Extensions.Configuration;

namespace DarEltahfeez.Api.Media;

/// <summary>
/// Reads the "Media" configuration section (env keys use a double underscore:
/// Media__RootPath, Media__BackfillOnStartup, ...) into the <see cref="MediaOptions"/> POCO.
/// Kept separate so the file store itself has no configuration dependency.
/// </summary>
public static class MediaOptionsBinder
{
    public static MediaOptions FromConfiguration(IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        return new MediaOptions
        {
            RootPath = configuration["Media:RootPath"],
            MaxReceiptBytes = ReadPositiveLong(configuration, "Media:MaxReceiptBytes", MediaOptions.DefaultMaxReceiptBytes),
            MaxAvatarBytes = ReadPositiveLong(configuration, "Media:MaxAvatarBytes", MediaOptions.DefaultMaxAvatarBytes),
            MaxLogoBytes = ReadPositiveLong(configuration, "Media:MaxLogoBytes", MediaOptions.DefaultMaxLogoBytes),
            BackfillOnStartup = configuration.GetValue<bool>("Media:BackfillOnStartup"),
            BackfillBatchSize = (int)Math.Clamp(
                ReadPositiveLong(configuration, "Media:BackfillBatchSize", MediaOptions.DefaultBackfillBatchSize), 1, 100),
        };
    }

    private static long ReadPositiveLong(IConfiguration configuration, string key, long fallback) =>
        long.TryParse(configuration[key], NumberStyles.Integer, CultureInfo.InvariantCulture, out var value) && value > 0
            ? value
            : fallback;
}
