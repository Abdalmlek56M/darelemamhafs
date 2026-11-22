using System.Globalization;
using System.Text;

namespace Dar.Modules.Meet.Application;

public sealed record CircleMatch(Guid CircleId, string CircleName, int Confidence);

/// <summary>
/// Suggests which circle a calendar event belongs to by matching the circle name
/// inside the event summary. Pure and unit tested: the owner still confirms the link,
/// and automatic linking only accepts a confidence of 100.
/// </summary>
public static class MeetCircleMatcher
{
    private static readonly char[] Diacritics =
    [
        '\u064B', '\u064C', '\u064D', '\u064E', '\u064F', '\u0650', '\u0651', '\u0652',
        '\u0653', '\u0654', '\u0655', '\u0670', '\u0640'
    ];

    public static string Normalize(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return string.Empty;

        var builder = new StringBuilder(value.Length);
        foreach (var raw in value)
        {
            if (Array.IndexOf(Diacritics, raw) >= 0) continue;
            var character = raw switch
            {
                'أ' or 'إ' or 'آ' or 'ٱ' => 'ا',
                'ى' => 'ي',
                'ئ' => 'ي',
                'ؤ' => 'و',
                'ة' => 'ه',
                _ => raw
            };

            if (char.IsLetterOrDigit(character)) builder.Append(char.ToLowerInvariant(character));
            else builder.Append(' ');
        }

        var normalized = builder.ToString();
        var words = normalized.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        return string.Join(' ', words).Normalize(NormalizationForm.FormKC);
    }

    public static CircleMatch? Best(string? summary, IReadOnlyList<(Guid Id, string Name)> circles)
    {
        var normalizedSummary = Normalize(summary);
        if (normalizedSummary.Length == 0 || circles.Count == 0) return null;

        var summaryTokens = normalizedSummary.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        CircleMatch? best = null;

        foreach (var circle in circles)
        {
            var name = Normalize(circle.Name);
            if (name.Length < 3) continue;

            var confidence = Score(name, normalizedSummary, summaryTokens);
            if (confidence <= 0) continue;

            if (best is null || confidence > best.Confidence ||
                (confidence == best.Confidence && name.Length > Normalize(best.CircleName).Length))
            {
                best = new CircleMatch(circle.Id, circle.Name, confidence);
            }
        }

        return best;
    }

    private static int Score(string normalizedName, string normalizedSummary, string[] summaryTokens)
    {
        if (normalizedSummary.Contains(normalizedName, StringComparison.Ordinal))
            return 100;

        var nameTokens = normalizedName.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (nameTokens.Length == 0) return 0;

        var matched = nameTokens.Count(token => summaryTokens.Contains(token, StringComparer.Ordinal));
        if (matched == 0) return 0;

        var ratio = matched / (double)nameTokens.Length;
        if (ratio >= 1 && nameTokens.All(token => token.Length >= 2)) return 85;
        if (ratio >= 0.75) return 70;
        if (ratio >= 0.5) return 55;
        return 0;
    }
}
