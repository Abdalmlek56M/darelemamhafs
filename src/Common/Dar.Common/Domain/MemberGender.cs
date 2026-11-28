namespace Dar.Common.Domain;

/// <summary>
/// Single source of truth for normalizing and validating member gender values
/// before database writes so invalid values return HTTP 400 instead of a 23514 constraint error.
/// </summary>
public static class MemberGender
{
    public const string InvalidMessage = "اختر جنسًا صحيحًا (male أو female).";

    public static bool TryNormalize(string? value, out string? normalized)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            normalized = null;
            return true;
        }

        var candidate = value.Trim().ToLowerInvariant();
        if (candidate is "male" or "female")
        {
            normalized = candidate;
            return true;
        }

        normalized = null;
        return false;
    }

    public static bool IsInvalid(string? value) => !TryNormalize(value, out _);

    public static string? NormalizeOrNull(string? value) => TryNormalize(value, out var normalized) ? normalized : null;
}
