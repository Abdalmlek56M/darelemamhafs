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

Check("PostgreSQL-compatible midpoint rounds 1.005 away from zero to 1.01", MoneyRules.RoundCurrency(1.005m) == 1.01m);
Check("PostgreSQL-compatible negative midpoint rounds away from zero", MoneyRules.RoundCurrency(-1.005m) == -1.01m);
Check("Values below half a cent normalize down", MoneyRules.RoundCurrency(1.004m) == 1.00m);
Check("A payment that rounds to zero is rejected", !MoneyRules.TryNormalizePaymentAmount(0.004m, out var subCent) && subCent == 0m);
Check("A half-cent payment normalizes to one cent", MoneyRules.TryNormalizePaymentAmount(0.005m, out var oneCent) && oneCent == 0.01m);
Check("Exact outstanding amount is accepted", !MoneyRules.ExceedsOutstanding(100.00m, 100.00m, 0m));
Check("A raw 100.004 payment is normalized to 100.00 and accepted", MoneyRules.TryNormalizePaymentAmount(100.004m, out var roundedUnder) && !MoneyRules.ExceedsOutstanding(roundedUnder, 100.00m, 0m));
Check("A raw 100.005 payment normalizes to 100.01 and is rejected against 100.00", MoneyRules.TryNormalizePaymentAmount(100.005m, out var roundedOver) && MoneyRules.ExceedsOutstanding(roundedOver, 100.00m, 0m));
Check("Outstanding balance is compared after currency normalization", !MoneyRules.ExceedsOutstanding(69.99m, 100.00m, 30.01m));
Check("One cent above the outstanding balance is rejected", MoneyRules.ExceedsOutstanding(70.00m, 100.00m, 30.01m));
Check("A half-cent above a one-cent balance rounds to two cents and is rejected", MoneyRules.TryNormalizePaymentAmount(0.015m, out var twoCents) && twoCents == 0.02m && MoneyRules.ExceedsOutstanding(twoCents, 0.01m, 0m));
Check("NUMERIC(12,2) maximum payment is accepted", MoneyRules.TryNormalizePaymentAmount(9_999_999_999.99m, out var maximum) && maximum == 9_999_999_999.99m);
Check("Payment above NUMERIC(12,2) maximum after rounding is rejected", !MoneyRules.TryNormalizePaymentAmount(9_999_999_999.995m, out var aboveMaximum) && aboveMaximum == 10_000_000_000.00m);
Check("Negative payments are rejected", !MoneyRules.TryNormalizePaymentAmount(-1.00m, out _));

Console.WriteLine($"Financial rounding regression: PASS={passes}; FAIL={failures}");
Console.WriteLine(failures == 0 ? "DAR_TEST_RESULT=PASS" : "DAR_TEST_RESULT=FAIL");
return failures == 0 ? 0 : 1;
