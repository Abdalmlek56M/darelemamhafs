$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$projectPath = Join-Path $projectRoot 'tests\regression\currency-input-normalization\CurrencyInputNormalizationRegression.csproj'
$apiSourcePath = Join-Path $projectRoot 'backend\DarEltahfeez.Api\DomainEndpoints.cs'
$rulesPath = Join-Path $projectRoot 'backend\DarEltahfeez.Api\MoneyRules.cs'

foreach ($requiredPath in @($projectPath, $apiSourcePath, $rulesPath)) {
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
        Write-Output "FAIL: Required currency normalization source is missing: $requiredPath"
        Write-Output 'DAR_TEST_RESULT=FAIL'
        exit 1
    }
}

$apiSource = [System.IO.File]::ReadAllText($apiSourcePath)
$expectedUses = @(
    'TryNormalizeNonNegativeCurrency(request.HourlyRate',
    'TryNormalizeNonNegativeCurrency(request.MonthlyFee',
    'TryNormalizeNonNegativeCurrency(request.AgreedMonthlyFee',
    'var generatedTotalDailyLimit = decimal.Floor(MoneyRules.MaximumNumeric14Currency * 100m / request.DaysCount) / 100m',
    'var maximumDailyCost = Math.Min(MoneyRules.MaximumNumeric12Currency, generatedTotalDailyLimit)',
    'TryNormalizeNonNegativeCurrency(request.DailyCost',
    'TryNormalizePositiveCurrency(request.Amount, out var normalizedAmount, MoneyRules.MaximumNumeric14Currency)',
    'TryNormalizeNonNegativeCurrency(request.AmountDue',
    'TryCalculateTeacherPayableAmount(hourlyRateSnapshot, request.DurationMinutes',
    'TryCalculateTeacherPayableAmount(effectiveHourlyRate, duration',
    'SELECT teacher_id,hourly_rate_snapshot FROM teacher_attendance WHERE schedule_slot_id=@slot AND session_date=@date FOR UPDATE;',
    'FOR UPDATE OF ss;'
)
$missingUses = @($expectedUses | Where-Object { -not $apiSource.Contains($_) })
if ($missingUses.Count -gt 0) {
    foreach ($missing in $missingUses) { Write-Output "FAIL: Missing API normalization guard: $missing" }
    Write-Output 'DAR_TEST_RESULT=FAIL'
    exit 1
}

$dotnet = Get-Command dotnet -ErrorAction SilentlyContinue
if (-not $dotnet) {
    Write-Output 'SKIP: .NET 10 SDK is unavailable; static API guards passed, executable currency regression was not compiled or run.'
    Write-Output 'DAR_TEST_RESULT=SKIP'
    exit 0
}

$sdkList = @(& $dotnet.Source --list-sdks 2>$null)
$hasNet10Sdk = @($sdkList | Where-Object { [string]$_ -match '^\s*10\.0\.\d+' }).Count -gt 0
if (-not $hasNet10Sdk) {
    Write-Output 'SKIP: dotnet is installed, but no .NET 10 SDK is available; static API guards passed, executable currency regression was not compiled or run.'
    Write-Output 'DAR_TEST_RESULT=SKIP'
    exit 0
}

Write-Output 'START: Currency input normalization regression (.NET 10; no database connection)'
$output = @(& $dotnet.Source run --project $projectPath --configuration Release 2>&1)
$exitCode = $LASTEXITCODE
foreach ($line in $output) { Write-Output ([string]$line) }
if ($exitCode -ne 0 -or -not ($output -match 'DAR_TEST_RESULT=PASS')) {
    Write-Output ('FAIL: Currency input normalization regression exited with code ' + $exitCode)
    Write-Output 'DAR_TEST_RESULT=FAIL'
    exit 1
}

Write-Output 'PASS: API normalization source guards and isolated currency regression completed.'
Write-Output 'DAR_TEST_RESULT=PASS'
exit 0
