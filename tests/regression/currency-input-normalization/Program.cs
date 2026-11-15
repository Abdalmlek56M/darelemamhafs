using DarEltahfeez.Api;

var failures = 0;
var passes = 0;

void Check(string name, bool condition)
{
    if (condition)
    {
        passes++;
        Console.WriteLine($"PASS: {name}");
    }
    else
    {
        failures++;
        Console.Error.WriteLine($"FAIL: {name}");
    }
}

Check("Non-negative currency accepts zero", MoneyRules.TryNormalizeNonNegativeCurrency(0m, out var zero) && zero == 0m);
Check("Non-negative currency rejects a negative value even when it rounds to zero", !MoneyRules.TryNormalizeNonNegativeCurrency(-0.001m, out var negativeNearZero) && negativeNearZero == 0m);
Check("Non-negative currency rejects a negative amount", !MoneyRules.TryNormalizeNonNegativeCurrency(-1m, out _));
Check("Positive currency rejects zero", !MoneyRules.TryNormalizePositiveCurrency(0m, out _));
Check("Positive currency rejects a positive sub-cent value that rounds to zero", !MoneyRules.TryNormalizePositiveCurrency(0.004m, out var subCent) && subCent == 0m);
Check("Positive currency normalizes a half-cent to one cent", MoneyRules.TryNormalizePositiveCurrency(0.005m, out var oneCent) && oneCent == 0.01m);
Check("Values below midpoint round down", MoneyRules.TryNormalizeNonNegativeCurrency(100.004m, out var belowMidpoint) && belowMidpoint == 100.00m);
Check("Positive midpoint rounds away from zero", MoneyRules.TryNormalizeNonNegativeCurrency(100.005m, out var midpoint) && midpoint == 100.01m);
Check("Values above midpoint round up", MoneyRules.TryNormalizeNonNegativeCurrency(100.006m, out var aboveMidpoint) && aboveMidpoint == 100.01m);
Check("Negative midpoint is rounded away from zero but remains rejected", !MoneyRules.TryNormalizeNonNegativeCurrency(-1.005m, out var negativeMidpoint) && negativeMidpoint == -1.01m);
Check("NUMERIC(12,2) maximum is accepted", MoneyRules.TryNormalizeNonNegativeCurrency(MoneyRules.MaximumNumeric12Currency, out var max12) && max12 == MoneyRules.MaximumNumeric12Currency);
Check("NUMERIC(12,2) amount above maximum after rounding is rejected", !MoneyRules.TryNormalizeNonNegativeCurrency(9_999_999_999.995m, out var above12) && above12 == 10_000_000_000.00m);
Check("NUMERIC(14,2) maximum is accepted when explicitly selected", MoneyRules.TryNormalizePositiveCurrency(MoneyRules.MaximumNumeric14Currency, out var max14, MoneyRules.MaximumNumeric14Currency) && max14 == MoneyRules.MaximumNumeric14Currency);
Check("NUMERIC(14,2) amount above maximum after rounding is rejected", !MoneyRules.TryNormalizePositiveCurrency(999_999_999_999.995m, out var above14, MoneyRules.MaximumNumeric14Currency) && above14 == 1_000_000_000_000.00m);
var maxDailyFor3650Days = decimal.Floor(MoneyRules.MaximumNumeric14Currency * 100m / 3650m) / 100m;
Check("Advertising daily cap is rounded down to cents for a 3650-day generated total", maxDailyFor3650Days * 3650m <= MoneyRules.MaximumNumeric14Currency);
Check("The next cent above the advertising daily cap would exceed NUMERIC(14,2)", (maxDailyFor3650Days + 0.01m) * 3650m > MoneyRules.MaximumNumeric14Currency);
Check("Payment normalization still uses NUMERIC(12,2) positive-amount rules", MoneyRules.TryNormalizePaymentAmount(100.005m, out var payment) && payment == 100.01m);
Check("Teacher payable calculates from the saved hourly-rate snapshot", MoneyRules.TryCalculateTeacherPayableAmount(100m, 90, out var teacherPayable) && teacherPayable == 150m);
Check("Teacher payable accepts zero-rate sessions", MoneyRules.TryCalculateTeacherPayableAmount(0m, 60, out var zeroTeacherPayable) && zeroTeacherPayable == 0m);
Check("Teacher payable rejects invalid duration", !MoneyRules.TryCalculateTeacherPayableAmount(100m, 361, out _));
Check("Teacher payable rejects a derived value above NUMERIC(12,2)", !MoneyRules.TryCalculateTeacherPayableAmount(MoneyRules.MaximumNumeric12Currency, 360, out _));

Console.WriteLine($"Currency input normalization regression: PASS={passes}; FAIL={failures}");
Console.WriteLine(failures == 0 ? "DAR_TEST_RESULT=PASS" : "DAR_TEST_RESULT=FAIL");
return failures == 0 ? 0 : 1;
