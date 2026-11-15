#requires -Version 5.1
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
function Read-FunctionalSource([string]$RelativePath) {
    $path = Join-Path $projectRoot $RelativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Required source is missing: $RelativePath" }
    return [System.IO.File]::ReadAllText($path,[System.Text.Encoding]::UTF8)
}
$program = Read-FunctionalSource 'backend\DarEltahfeez.Api\Program.cs'
$runner = Read-FunctionalSource 'tests\runners\Verify-FunctionalApiAcceptance.ps1'
$testCenter = Read-FunctionalSource 'tests\runners\TestCenter.ps1'
$catalogText = Read-FunctionalSource 'tests\catalog.json'
$domain = Read-FunctionalSource 'backend\DarEltahfeez.Api\DomainEndpoints.cs'
$auth = Read-FunctionalSource 'backend\DarEltahfeez.Api\AuthEndpoints.cs'
$tokens = $null
$parseErrors = $null
[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $projectRoot 'tests\runners\Verify-FunctionalApiAcceptance.ps1'),[ref]$tokens,[ref]$parseErrors) | Out-Null
$psSyntaxValid = @($parseErrors).Count -eq 0
$portPreflightStart = $runner.IndexOf('$occupiedPortDetails = New-Object System.Collections.Generic.List[string]')
$portPreflightEnd = $runner.IndexOf('$missingBuildArtifacts = New-Object System.Collections.Generic.List[string]')
$portPreflightReady = $portPreflightStart -ge 0 -and $portPreflightEnd -gt $portPreflightStart
$portPreflight = if ($portPreflightReady) { $runner.Substring($portPreflightStart, $portPreflightEnd - $portPreflightStart) } else { '' }
$checks = @(
    @{ Name='Functional API mode is mutually exclusive with the migration rehearsal mode'; Pass=$program.Contains('isolatedRehearsal && isolatedFunctionalAcceptance') },
    @{ Name='Functional API mode requires its dedicated connection string'; Pass=$program.Contains('DAR_DATABASE_CONNECTION_STRING') -and $program.Contains('Functional acceptance mode requires DAR_DATABASE_CONNECTION_STRING') },
    @{ Name='Functional API connection is restricted to loopback PostgreSQL 17 port 55432 and dar_app'; Pass=$program.Contains('functionalBuilder.Host') -and $program.Contains('functionalBuilder.Port != 55432') -and $program.Contains('functionalBuilder.Username') -and $program.Contains('dar_app') },
    @{ Name='Functional API connection is restricted to dar_functional_test_* databases'; Pass=$program.Contains('dar_functional_test_') -and $program.Contains('Regex.IsMatch(') -and $program.Contains('^dar_functional_test_[a-f0-9]{16}$') },
    @{ Name='Functional API listener is restricted to 127.0.0.1:5082'; Pass=$program.Contains('http://127.0.0.1:5082') -and $program.Contains('builder.WebHost.UseUrls(requiredFunctionalUrl)') },
    @{ Name='Functional API disables migration startup because the isolated runner applies migrations first'; Pass=$program.Contains('Database:ApplyMigrationsOnStartup') -and $program.Contains('"false"') },
    @{ Name='Functional runner parses without PowerShell syntax errors'; Pass=$psSyntaxValid },
    @{ Name='Functional runner generates a strict unique disposable database name'; Pass=$runner.Contains("'dar_functional_test_' + `$suffix") -and $runner.Contains('^dar_functional_test_[a-f0-9]{16}$') },
    @{ Name='Functional runner applies exactly 12 migrations before API startup'; Pass=$runner.Contains('$migrationFiles.Count -ne 12') -and $runner.Contains("'Disposable database received all 12 migrations before API startup.'") },
    @{ Name='Functional runner reads the production signature before and after, then requires equality'; Pass=$runner.Contains('productionSignatureBefore') -and $runner.Contains('productionSignatureAfter') -and $runner.Contains('Production Dar logical signature is unchanged after isolated API acceptance.') },
    @{ Name='Functional runner drops only a strictly allow-listed disposable database'; Pass=$runner.Contains('$databaseName -match ''^dar_functional_test_[a-f0-9]{16}$''') -and $runner.Contains('DROP DATABASE IF EXISTS $databaseName WITH (FORCE)') },
    @{ Name='Functional runner preserves the disposable database if isolated API process or port cleanup cannot be confirmed'; Pass=$runner.Contains('preserving the disposable database instead of dropping it') -and $runner.Contains('apiLaunchAttempted') -and $runner.Contains('apiProcessStopped') -and $runner.Contains('portReleased') },
    @{ Name='Functional runner preflights ports 5080, 5081 and 5082, reports owners and never stops unrelated listeners'; Pass=$portPreflightReady -and $portPreflight.Contains('foreach ($port in @(5080,5081,5082))') -and $portPreflight.Contains('Test-FunctionalPort') -and $portPreflight.Contains('Get-NetTCPConnection') -and $portPreflight.Contains('Get-CimInstance Win32_Process') -and $portPreflight.Contains('Required functional-test ports are occupied') -and (-not $portPreflight.Contains('Stop-Process')) -and (-not $portPreflight.Contains('taskkill')) },
    @{ Name='Functional runner assigns the verified PostgreSQL bin directory to shared script scope before the first identity probe'; Pass=$runner.Contains('$script:DarPgBin = [string]$pgBin') -and $runner.IndexOf('$script:DarPgBin = [string]$pgBin') -ge 0 -and $runner.IndexOf('$script:DarPgBin = [string]$pgBin') -lt $runner.IndexOf('Test-DarExpectedPostgresIdentity -Secrets $secrets -Paths $paths') -and $runner.Contains("@('psql.exe','pg_ctl.exe','pg_restore.exe')") },
    @{ Name='Functional runner creates the initial admin and tests session authentication'; Pass=$runner.Contains('/api/setup/admin') -and $runner.Contains('/api/auth/login') -and $runner.Contains('/api/auth/me') },
    @{ Name='Functional runner covers teacher, circle, schedule, student and enrollment create flows'; Pass=$runner.Contains("'/api/teachers'") -and $runner.Contains("'/api/circles'") -and $runner.Contains("'/api/schedule-slots'") -and $runner.Contains("'/api/students'") -and $runner.Contains("'/api/enrollments'") },
    @{ Name='Functional runner covers duplicate enrollment, pause/resume and paused-date attendance rejection'; Pass=$runner.Contains('Reject duplicate active enrollment') -and $runner.Contains("'/pause'") -and $runner.Contains("'/resume'") -and $runner.Contains('Reject student attendance on a paused date') },
    @{ Name='Functional runner verifies student attendance upsert preserves the original row ID'; Pass=$runner.Contains('Student attendance update preserves the original row ID.') },
    @{ Name='Functional runner verifies teacher hourly-rate snapshot persists after a rate change'; Pass=$runner.Contains('Teacher attendance captures rate 120') -and $runner.Contains('Teacher attendance upsert preserves the original hourly-rate snapshot') },
    @{ Name='Functional runner creates a finance.create-only account without finance.read'; Pass=$runner.Contains("'finance.create'") -and $runner.Contains("-notcontains 'finance.read'") -and $runner.Contains('Create a finance.create-only user without finance.read') },
    @{ Name='Functional runner verifies financial redaction on student, teacher, circle, attendance and history reads'; Pass=$runner.Contains('Student list redacts due') -and $runner.Contains('Teacher list redacts hourly rate') -and $runner.Contains('Circle list redacts monthly fee') -and $runner.Contains('Teacher attendance redacts hourly-rate snapshot') -and $runner.Contains('Student history hides agreed fees') },
    @{ Name='Functional runner verifies finance entry options do not expose monetary values'; Pass=$runner.Contains('Finance entry options expose identity and IDs only') },
    @{ Name='Functional runner tests charge uniqueness, partial payment and overpayment rejection'; Pass=$runner.Contains('Reject duplicate monthly charge') -and $runner.Contains('Record a partial payment') -and $runner.Contains('Reject payment above the outstanding balance') },
    @{ Name='Functional runner verifies ledger, receipt and saved-report read restrictions without finance.read'; Pass=$runner.Contains('Deny ledger reads without finance.read') -and $runner.Contains('Deny payment receipt access without finance.read') -and $runner.Contains('Deny saved report snapshot access without finance.read') },
    @{ Name='Functional runner verifies administrator partial ledger totals are 150 due, 50 paid and 100 balance'; Pass=$runner.Contains('due 150, paid 50, balance 100, status partial') },
    @{ Name='Functional runner verifies final withdrawal closes every active enrollment'; Pass=$runner.Contains('Withdraw student with two active enrollments') -and $runner.Contains('Final student withdrawal ends all active enrollments') },
    @{ Name='Functional runner writes an acceptance diagnostic report and final result marker'; Pass=$runner.Contains('functional-api-acceptance-') -and $runner.Contains('DAR_TEST_RESULT=PASS') -and $runner.Contains('DAR_TEST_RESULT=FAIL') },
    @{ Name='Test Center registers isolated functional acceptance as an individual-only test'; Pass=$testCenter.Contains("Id='32'") -and $testCenter.Contains('Verify-FunctionalApiAcceptance.ps1') -and $testCenter.Contains('Interactive=$true') },
    @{ Name='Test Center registers functional source guards'; Pass=$testCenter.Contains("Id='33'") -and $testCenter.Contains('Verify-FunctionalApiAcceptanceSource.ps1') },
    @{ Name='Test Center requires prepared PostgreSQL, free ports and built API assets for Test 32'; Pass=$testCenter.Contains('$Id -eq ''32''') -and $testCenter.Contains('Test-RestoreClusterPrepared') -and $testCenter.Contains('5082') -and $testCenter.Contains('BUILD_DAR_FOR_REHEARSAL.bat') },
    @{ Name='JSON test catalog registers both functional acceptance tests'; Pass=($catalogText.Contains('API-TEST-01') -and $catalogText.Contains('API-SRC-01') -and $catalogText.Contains('Verify-FunctionalApiAcceptance.ps1') -and $catalogText.Contains('Verify-FunctionalApiAcceptanceSource.ps1')) },
    @{ Name='API source exposes the expected financial permission and redaction behavior exercised by the runner'; Pass=$domain.Contains('CanReadFinance(principal) ? amountDue : (decimal?)null') -and $domain.Contains('RequireAuthorization("finance.create")') -and $domain.Contains('RequireAuthorization("finance.read")') },
    @{ Name='API source exposes enrollment pause/resume and final withdrawal routes exercised by the runner'; Pass=$domain.Contains('/api/enrollments/{id:guid}/pause') -and $domain.Contains('/api/enrollments/{id:guid}/resume') -and $domain.Contains('request.Status == "withdrawn"') },
    @{ Name='API source exposes initial admin and restricted admin-user creation used in the scenario'; Pass=$auth.Contains('/api/setup/admin') -and $auth.Contains('users.MapPost') -and $auth.Contains('Results.Created($"/api/admin/users/{id}"') }
)
$failed = 0
foreach ($check in $checks) {
    if ($check.Pass) { Write-Host ('PASS: ' + $check.Name) -ForegroundColor Green }
    else { Write-Host ('FAIL: ' + $check.Name) -ForegroundColor Red; $failed++ }
}
Write-Host ("Functional API acceptance source checks: PASS={0}; FAIL={1}" -f ($checks.Count-$failed),$failed)
if ($failed -gt 0) { Write-Output 'DAR_TEST_RESULT=FAIL'; exit 1 }
Write-Output 'DAR_TEST_RESULT=PASS'
exit 0
