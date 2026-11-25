namespace Dar.Common.Domain;

/// <summary>Outstanding and balance rules.</summary>
public static partial class Money
{
    public static bool ExceedsOutstanding(decimal paymentAmount, decimal amountDue, decimal amountPaid)
    {
        var normalizedPayment = RoundCurrency(paymentAmount);
        var outstanding = RoundCurrency(amountDue - amountPaid);
        return normalizedPayment > outstanding;
    }
}
