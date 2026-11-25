namespace Dar.Common.Domain;

/// <summary>
/// Currency limits, rounding and amount normalization for values persisted in PostgreSQL NUMERIC columns.
/// </summary>
public static partial class Money
{
    public const int CurrencyScale = 2;
    public const decimal MaximumNumeric12Currency = 9_999_999_999.99m;
    public const decimal MaximumNumeric14Currency = 999_999_999_999.99m;
    public const decimal MaximumPaymentAmount = MaximumNumeric12Currency;

    public static decimal RoundCurrency(decimal amount) =>
        decimal.Round(amount, CurrencyScale, MidpointRounding.AwayFromZero);

    public static bool TryNormalizeNonNegativeCurrency(
        decimal amount,
        out decimal normalizedAmount,
        decimal maximumAmount = MaximumNumeric12Currency)
    {
        normalizedAmount = RoundCurrency(amount);
        return amount >= 0m && normalizedAmount >= 0m && normalizedAmount <= maximumAmount;
    }

    public static bool TryNormalizePositiveCurrency(
        decimal amount,
        out decimal normalizedAmount,
        decimal maximumAmount = MaximumNumeric12Currency)
    {
        normalizedAmount = RoundCurrency(amount);
        return amount > 0m && normalizedAmount > 0m && normalizedAmount <= maximumAmount;
    }

    public static bool TryNormalizePaymentAmount(decimal amount, out decimal normalizedAmount) =>
        TryNormalizePositiveCurrency(amount, out normalizedAmount, MaximumPaymentAmount);
}
