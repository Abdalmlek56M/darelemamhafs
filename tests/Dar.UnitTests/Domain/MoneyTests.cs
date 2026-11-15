using Dar.Common.Domain;

namespace Dar.UnitTests.Domain;

public sealed class MoneyTests
{
    [Theory]
    [InlineData(100.004, 100.00)]
    [InlineData(100.005, 100.01)]
    [InlineData(12.345, 12.35)]
    [InlineData(-1.005, -1.01)]
    public void RoundCurrency_UsesAwayFromZeroAtMidpoint(decimal input, decimal expected)
    {
        Assert.Equal(expected, Money.RoundCurrency(input));
    }

    [Fact]
    public void TeacherPayable_For60MinutesAt120_Is120()
    {
        var ok = Money.TryCalculateTeacherPayableAmount(120m, 60, out var payable);

        Assert.True(ok);
        Assert.Equal(120m, payable);
    }

    [Fact]
    public void TeacherPayable_For45MinutesAt120_Is90()
    {
        var ok = Money.TryCalculateTeacherPayableAmount(120m, 45, out var payable);

        Assert.True(ok);
        Assert.Equal(90m, payable);
    }

    [Fact]
    public void TeacherPayable_RejectsDurationBelow15Minutes()
    {
        var ok = Money.TryCalculateTeacherPayableAmount(120m, 14, out var payable);

        Assert.False(ok);
        Assert.Equal(0m, payable);
    }

    [Fact]
    public void ExceedsOutstanding_RejectsOnePiasterOver()
    {
        Assert.True(Money.ExceedsOutstanding(100.01m, 100m, 0m));
        Assert.False(Money.ExceedsOutstanding(100.00m, 100m, 0m));
    }

    [Fact]
    public void PaymentAmount_RejectsZeroAndNegative()
    {
        Assert.False(Money.TryNormalizePaymentAmount(0m, out _));
        Assert.False(Money.TryNormalizePaymentAmount(-1m, out _));
        Assert.True(Money.TryNormalizePaymentAmount(1m, out var normalized));
        Assert.Equal(1m, normalized);
    }
}
