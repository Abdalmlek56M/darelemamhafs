#requires -Version 5.1
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
function Read-Source([string]$RelativePath) {
    $path = Join-Path $projectRoot $RelativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Required file is missing: $RelativePath" }
    return [System.IO.File]::ReadAllText($path,[System.Text.Encoding]::UTF8)
}
$runner = Read-Source 'tests\runners\Verify-EnrollmentBillingLifecycleRegression.ps1'
$sql = Read-Source 'tests\regression\sql\enrollment_month_eligibility.test.sql'
$checks = @(
    @{ Name='Test 24 writes a persistent diagnostic log under Dar Logs'; Pass=$runner.Contains('test-24-enrollment-billing-') -and $runner.Contains('diagnosticLogPath') },
    @{ Name='Test 24 records startup and database lifecycle phases'; Pass=$runner.Contains('Starting enrollment lifecycle regression') -and $runner.Contains('Applying all 14 migrations') -and $runner.Contains('Disposable lifecycle regression database created') },
    @{ Name='Test 24 has a last-resort trap for failures outside the main try/catch'; Pass=$runner.Contains('trap {') -and $runner.Contains('UNHANDLED: ') -and $runner.Contains('DAR_TEST_RESULT=FAIL') },
    @{ Name='Test 24 records exception and script stack details'; Pass=$runner.Contains('Caught ') -and $runner.Contains('$_.ScriptStackTrace') },
    @{ Name='Test 24 ignores local psqlrc for deterministic disposable database commands'; Pass=([regex]::Matches($runner,"-Arguments @\('-X'")).Count -ge 4 },
    @{ Name='Test 24 requires ON_ERROR_STOP for the SQL regression'; Pass=$runner.Contains("'ON_ERROR_STOP=1'") },
    @{ Name='SQL regression emits an explicit final PASS row before rollback'; Pass=$sql.Contains("SELECT 'ENROLLMENT_LIFECYCLE_REGRESSION_PASS';") -and $runner.Contains('ENROLLMENT_LIFECYCLE_REGRESSION_PASS') },
    @{ Name='Test 24 marks its diagnostic result PASS after the SQL marker and before cleanup; cleanup can still downgrade to FAIL'; Pass=($runner.IndexOf("$script:result = 'PASS'") -gt $runner.IndexOf('ENROLLMENT_LIFECYCLE_REGRESSION_PASS')) -and ($runner.IndexOf("$script:result = 'PASS'") -lt $runner.LastIndexOf('finally {')) -and $runner.Contains("$script:result = 'FAIL'") },
    @{ Name='Test Center displays stdout and stderr paths if a child process exits without a marker'; Pass=(Read-Source 'tests\runners\TestCenter.ps1').Contains('Captured stderr: $script:currentErr') }
)
$failed=0
foreach ($check in $checks) {
    if ($check.Pass) { Write-Host ('PASS: ' + $check.Name) -ForegroundColor Green }
    else { Write-Host ('FAIL: ' + $check.Name) -ForegroundColor Red; $failed++ }
}
Write-Host ("Enrollment regression runner source checks: PASS={0}; FAIL={1}" -f ($checks.Count-$failed),$failed)
if ($failed -gt 0) { Write-Output 'DAR_TEST_RESULT=FAIL'; exit 1 }
Write-Output 'DAR_TEST_RESULT=PASS'
exit 0
