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
    public void TeacherPayable_AcceptsOneMinute()
    {
        var ok = Money.TryCalculateTeacherPayableAmount(120m, 1, out var payable);

        Assert.True(ok);
        Assert.Equal(2.00m, payable);
    }

    [Fact]
    public void TeacherPayable_RejectsZeroAndTooLong()
    {
        Assert.False(Money.TryCalculateTeacherPayableAmount(120m, 0, out _));
        Assert.False(Money.TryCalculateTeacherPayableAmount(120m, 361, out _));
    }

    [Fact]
    public void TeacherSessionPay_OverScheduled_PaysScheduledAndRecordsOvertime()
    {
        var ok = Money.TryCalculateTeacherSessionPay(100m, 90, 98, out var result);

        Assert.True(ok);
        Assert.Equal(98, result.ActualMinutes);
        Assert.Equal(90, result.PayableMinutes);
        Assert.Equal(8, result.OvertimeMinutes);
        Assert.Equal(0, result.UndertimeMinutes);
        Assert.Equal("scheduled", result.PayBasis);
        Assert.Equal(150.00m, result.PayableAmount);
    }

    [Fact]
    public void TeacherSessionPay_EarlyEnd_PaysActualAndRecordsUndertime()
    {
        var ok = Money.TryCalculateTeacherSessionPay(100m, 90, 75, out var result);

        Assert.True(ok);
        Assert.Equal(75, result.PayableMinutes);
        Assert.Equal(0, result.OvertimeMinutes);
        Assert.Equal(15, result.UndertimeMinutes);
        Assert.Equal("actual", result.PayBasis);
        Assert.Equal(125.00m, result.PayableAmount);
    }

    [Fact]
    public void TeacherSessionPay_ZeroActual_PaysOneMinuteMinimum()
    {
        var ok = Money.TryCalculateTeacherSessionPay(100m, 60, 0, out var result);

        Assert.True(ok);
        Assert.Equal(1, result.PayableMinutes);
        Assert.Equal(59, result.UndertimeMinutes);
        Assert.Equal(1.67m, result.PayableAmount);
    }

    [Fact]
    public void Balance_PreservesNegativeOverpaymentAndRounds()
    {
        Assert.Equal(-20.00m, Money.Balance(100.00m, 120.00m));
        Assert.Equal(0.01m, Money.Balance(0.005m, 0m));
    }

    [Fact]
    public void NonNegativeBalance_ClampsOnlyWhereRequested()
    {
        Assert.Equal(0m, Money.NonNegativeBalance(100.00m, 120.00m));
        Assert.Equal(20.00m, Money.NonNegativeBalance(120.00m, 100.00m));
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
