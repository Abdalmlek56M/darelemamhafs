using Dar.Common.Domain;

namespace DarEltahfeez.Api;

/// <summary>
/// Legacy compatibility facade. All currency rules live in <see cref="Money"/>;
/// this class must not duplicate the rule implementations.
/// </summary>
public static class MoneyRules
{
    public const int CurrencyScale = Money.CurrencyScale;
    public const decimal MaximumNumeric12Currency = Money.MaximumNumeric12Currency;
    public const decimal MaximumNumeric14Currency = Money.MaximumNumeric14Currency;
    public const decimal MaximumPaymentAmount = Money.MaximumPaymentAmount;

    public static decimal RoundCurrency(decimal amount) => Money.RoundCurrency(amount);

    public static bool TryNormalizeNonNegativeCurrency(
        decimal amount,
        out decimal normalizedAmount,
        decimal maximumAmount = Money.MaximumNumeric12Currency) =>
        Money.TryNormalizeNonNegativeCurrency(amount, out normalizedAmount, maximumAmount);

    public static bool TryNormalizePositiveCurrency(
        decimal amount,
        out decimal normalizedAmount,
        decimal maximumAmount = Money.MaximumNumeric12Currency) =>
        Money.TryNormalizePositiveCurrency(amount, out normalizedAmount, maximumAmount);

    public static bool TryNormalizePaymentAmount(decimal amount, out decimal normalizedAmount) =>
        Money.TryNormalizePaymentAmount(amount, out normalizedAmount);

    public static bool TryCalculateTeacherPayableAmount(
        decimal hourlyRateSnapshot,
        int durationMinutes,
        out decimal payableAmount) =>
        Money.TryCalculateTeacherPayableAmount(hourlyRateSnapshot, durationMinutes, out payableAmount);

    public static bool ExceedsOutstanding(decimal paymentAmount, decimal amountDue, decimal amountPaid) =>
        Money.ExceedsOutstanding(paymentAmount, amountDue, amountPaid);
}
