namespace Dar.Common.Domain;

/// <summary>
/// Currency rules for values persisted in PostgreSQL NUMERIC(...,2) columns.
/// This is intentionally a pure domain helper: no database, no HTTP.
/// </summary>
public static class Money
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

    public static bool TryCalculateTeacherPayableAmount(
        decimal hourlyRateSnapshot,
        int durationMinutes,
        out decimal payableAmount)
    {
        payableAmount = 0m;
        if (durationMinutes is < 15 or > 360 ||
            !TryNormalizeNonNegativeCurrency(hourlyRateSnapshot, out var normalizedHourlyRate))
        {
            return false;
        }

        var calculatedAmount = normalizedHourlyRate * durationMinutes / 60m;
        return TryNormalizeNonNegativeCurrency(calculatedAmount, out payableAmount);
    }

    public static bool ExceedsOutstanding(decimal paymentAmount, decimal amountDue, decimal amountPaid)
    {
        var normalizedPayment = RoundCurrency(paymentAmount);
        var outstanding = RoundCurrency(amountDue - amountPaid);
        return normalizedPayment > outstanding;
    }
}
