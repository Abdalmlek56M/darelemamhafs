namespace Dar.Common.Domain;

/// <summary>Teacher pay rules shared by legacy and new APIs.</summary>
public static partial class Money
{
    public static bool TryCalculateTeacherPayableAmount(
        decimal hourlyRateSnapshot,
        int durationMinutes,
        out decimal payableAmount)
    {
        payableAmount = 0m;
        if (durationMinutes is < 1 or > 360 ||
            !TryNormalizeNonNegativeCurrency(hourlyRateSnapshot, out var normalizedHourlyRate))
        {
            return false;
        }

        var calculatedAmount = normalizedHourlyRate * durationMinutes / 60m;
        return TryNormalizeNonNegativeCurrency(calculatedAmount, out payableAmount);
    }

    /// <summary>
    /// Teacher session pay: pay the scheduled duration when the teacher reaches or
    /// exceeds it; pay the actual whole minutes when she ends early. A zero-minute
    /// actual duration is zero pay (owner decision, FINAL B3) — there is no 1-minute
    /// minimum. Overtime is recorded for review but is not paid automatically.
    /// </summary>
    public static bool TryCalculateTeacherSessionPay(
        decimal hourlyRateSnapshot,
        int scheduledMinutes,
        int actualMinutes,
        out TeacherPayResult result)
    {
        result = default;
        if (scheduledMinutes is < 1 or > 360 || actualMinutes is < 0 or > 1440)
            return false;

        var paidActual = Math.Max(0, actualMinutes);
        int payableMinutes;
        int overtimeMinutes;
        int undertimeMinutes;
        string payBasis;

        if (paidActual >= scheduledMinutes)
        {
            payableMinutes = scheduledMinutes;
            overtimeMinutes = paidActual - scheduledMinutes;
            undertimeMinutes = 0;
            payBasis = "scheduled";
        }
        else
        {
            payableMinutes = paidActual;
            overtimeMinutes = 0;
            undertimeMinutes = scheduledMinutes - paidActual;
            payBasis = "actual";
        }

        // Zero payable minutes is a valid outcome (zero pay), so it must not fail validation.
        if (payableMinutes == 0)
        {
            result = new TeacherPayResult(actualMinutes, 0, overtimeMinutes, undertimeMinutes, payBasis, 0m);
            return true;
        }

        if (!TryCalculateTeacherPayableAmount(hourlyRateSnapshot, payableMinutes, out var payableAmount))
            return false;

        result = new TeacherPayResult(
            actualMinutes,
            payableMinutes,
            overtimeMinutes,
            undertimeMinutes,
            payBasis,
            payableAmount);
        return true;
    }
}

public readonly record struct TeacherPayResult(
    int ActualMinutes,
    int PayableMinutes,
    int OvertimeMinutes,
    int UndertimeMinutes,
    string PayBasis,
    decimal PayableAmount);
