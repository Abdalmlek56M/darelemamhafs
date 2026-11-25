namespace Dar.Common.Domain;

/// <summary>Outstanding and balance rules.</summary>
public static partial class Money
{
    public static decimal Balance(decimal amountDue, decimal amountPaid) =>
        RoundCurrency(amountDue - amountPaid);

    /// <summary>Legacy/collection views clamp overpayments to zero.</summary>
    public static decimal NonNegativeBalance(decimal amountDue, decimal amountPaid) =>
        Math.Max(0m, Balance(amountDue, amountPaid));

    public static bool ExceedsOutstanding(decimal paymentAmount, decimal amountDue, decimal amountPaid)
    {
        var normalizedPayment = RoundCurrency(paymentAmount);
        var outstanding = Balance(amountDue, amountPaid);
        return normalizedPayment > outstanding;
    }
}
