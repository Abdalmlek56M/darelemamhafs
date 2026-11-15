$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$failedChecks = New-Object System.Collections.Generic.List[string]
try {
    $program = Get-Content -LiteralPath (Join-Path $projectRoot 'backend\DarEltahfeez.Api\Program.cs') -Raw -Encoding UTF8
    $runner = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'Invoke-MigrationRehearsal.ps1') -Raw -Encoding UTF8
    $signatureStart = $runner.IndexOf('function Get-ReportSignature', [StringComparison]::Ordinal)
    $signatureEnd = $runner.IndexOf('function Get-DatabaseSizeDelta', [StringComparison]::Ordinal)
    if ($signatureStart -lt 0 -or $signatureEnd -le $signatureStart) { throw 'The migration rehearsal logical-signature function could not be isolated for source checks.' }
    $reportSignature = $runner.Substring($signatureStart, $signatureEnd - $signatureStart)
    $testCenter = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'TestCenter.ps1') -Raw -Encoding UTF8
    $launcher = Get-Content -LiteralPath (Join-Path $projectRoot 'tools\run-desktop.ps1') -Raw -Encoding UTF8
    $portDiagnosticPath = Join-Path $projectRoot 'tools\Show-RehearsalPortOwner.ps1'
    $portDiagnostic = if (Test-Path -LiteralPath $portDiagnosticPath) { Get-Content -LiteralPath $portDiagnosticPath -Raw -Encoding UTF8 } else { '' }
    $staleStopPath = Join-Path $projectRoot 'tools\Stop-StaleRehearsalApi.ps1'
    $staleStop = if (Test-Path -LiteralPath $staleStopPath) { Get-Content -LiteralPath $staleStopPath -Raw -Encoding UTF8 } else { '' }
    $checks = @(
        @{ Name='API override is gated by DAR_ISOLATED_REHEARSAL'; Pattern='DAR_ISOLATED_REHEARSAL'; Text=$program },
        @{ Name='API override is restricted to loopback PostgreSQL port 55432'; Pattern='rehearsalBuilder\.Port\s*!=\s*55432'; Text=$program },
        @{ Name='API override only accepts migration rehearsal database prefix'; Pattern='dar_migration_rehearsal_'; Text=$program },
        @{ Name='Rehearsal database name is null-checked before prefix validation'; Pattern='rehearsalDatabaseName = rehearsalBuilder\.Database[\s\S]*?string\.IsNullOrWhiteSpace\(rehearsalDatabaseName\)[\s\S]*?rehearsalDatabaseName\.StartsWith'; Text=$program },
        @{ Name='Startup migrations are disabled in isolated rehearsal'; Pattern='ApplyMigrationsOnStartup.*false'; Text=$program },
        @{ Name='Rehearsal uses separate API port 5081'; Pattern='127\.0\.0\.1:5081'; Text=$runner },
        @{ Name='Rehearsal assigns verified PostgreSQL bin path to shared helper scope'; Pattern='\$script:DarPgBin\s*=\s*\[string\]\$pgBin'; Text=$runner },
        @{ Name='Rehearsal validates pg_restore before staging database creation'; Pattern='Test-Path\s+-LiteralPath\s+\(Join-Path\s+\$script:DarPgBin'; Text=$runner },
        @{ Name='Rehearsal failure diagnostics include source line'; Pattern='InvocationInfo\.ScriptLineNumber'; Text=$runner },
        @{ Name='Rehearsal failure diagnostics include stack trace'; Pattern='ScriptStackTrace'; Text=$runner },
        @{ Name='Rehearsal creates uniquely named staging database'; Pattern='dar_migration_rehearsal_'; Text=$runner },
        @{ Name='Rehearsal validates the verified sidecar manifest before selecting backup'; Pattern='Get-DarVerifiedBackupManifest[\s\S]*?Test-DarBackupArchive'; Text=$runner },
        @{ Name='Rehearsal requires the current 12 migration sequence'; Pattern='expectedCurrentMigrations[\s\S]*?012_teacher_schedule_no_overlap[\s\S]*?AppliedMigrations'; Text=$runner },
        @{ Name='Rehearsal compares restored staging snapshot to production before API launch'; Pattern='stagingSignatureBefore -cne \$productionSignatureBefore'; Text=$runner },
        @{ Name='Rehearsal checks production API is closed'; Pattern='Test-DarTcpPortListening\s+-Port\s+5080'; Text=$runner },
        @{ Name='Rehearsal drops only its own allow-listed staging database'; Pattern='\^dar_migration_rehearsal_\[a-f0-9\]\{16\}\$'; Text=$runner },
        @{ Name='Rehearsal stores the exact API Process handle'; Pattern='\$testApiProcess\s*=\s*Start-Process.*-PassThru'; Text=$runner },
        @{ Name='Rehearsal logical signature excludes volatile physical database size'; Pattern='DatabaseSizeBytes'; Text=$reportSignature; Negative=$true },
        @{ Name='Rehearsal logical signature compares all required logical schema metadata'; Pattern='AppliedMigrations[\s\S]*?RequiredTables[\s\S]*?RequiredColumns[\s\S]*?RequiredIndexes[\s\S]*?RequiredFunctions[\s\S]*?TableCounts'; Text=$reportSignature },
        @{ Name='Rehearsal signature compares applied migrations and required schema objects'; Pattern='AppliedMigrations[\s\S]*?RequiredTables[\s\S]*?RequiredColumns[\s\S]*?RequiredIndexes[\s\S]*?RequiredFunctions'; Text=$runner },
        @{ Name='Rehearsal logical signature includes enabled trigger inventory'; Pattern='RequiredTriggerCount[\s\S]*?RequiredTriggers[\s\S]*?RequiredTriggerSpecifications'; Text=$runner },
        @{ Name='Rehearsal records physical database size separately as diagnostic data'; Pattern='Get-DatabaseSizeDelta[\s\S]*?databaseSizeDeltaBytes'; Text=$runner },
        @{ Name='Rehearsal API connection defaults to PostgreSQL read-only transactions'; Pattern='Options=-c default_transaction_read_only=on'; Text=$runner },
        @{ Name='Rehearsal avoids the reserved PowerShell HOME variable'; Pattern='(?im)^\s*\$home\s*='; Text=$runner; Negative=$true },
        @{ Name='Rehearsal uses a non-reserved home page response variable'; Pattern='\$homePageResponse\s*=\s*Invoke-WebRequest'; Text=$runner },
        @{ Name='Rehearsal terminates only its captured API Process handle'; Pattern='\$testApiProcess\.Kill\(\)'; Text=$runner },
        @{ Name='Rehearsal waits for the captured API Process handle to exit'; Pattern='\$testApiProcess\.WaitForExit\(15000\)'; Text=$runner },
        @{ Name='Rehearsal verifies port 5081 release before staging cleanup'; Pattern='Test-TcpPort\s+5081'; Text=$runner },
        @{ Name='Rehearsal preserves staging DB if port 5081 remains occupied'; Pattern='staging database is preserved'; Text=$runner },
        @{ Name='Rehearsal emits explicit failure marker without terminating Write-Error'; Pattern='Write-Host.*Migration rehearsal failed.*Write-Output ''DAR_TEST_RESULT=FAIL'''; Text=$runner },
        @{ Name='Rehearsal writes its report immediately after staging restore'; Pattern='result=''RUNNING''.*backupRestore=''PASS'''; Text=$runner },
        @{ Name='Rehearsal records API diagnostics and failure state'; Pattern='API log tail'; Text=$runner },
        @{ Name='Rehearsal port owner diagnostic is read-only'; Pattern='This diagnostic is read-only'; Text=$portDiagnostic },
        @{ Name='Port diagnostic identifies the Dar API assembly'; Pattern='DarEltahfeez\\\.Api\\\.'; Text=$portDiagnostic },
        @{ Name='Port diagnostic identifies the isolated loopback URL'; Pattern='http://127\\\.0\\\.0\\\.1:5081'; Text=$portDiagnostic },
        @{ Name='Stale API cleanup requires dotnet process identity'; Pattern='\$processName\s+-ieq\s+''dotnet'''; Text=$staleStop },
        @{ Name='Stale API cleanup requires the Dar API assembly'; Pattern='DarEltahfeez\\\.Api\\\.dll'; Text=$staleStop },
        @{ Name='Stale API cleanup requires the isolated loopback URL'; Pattern='http://127\\\.0\\\.0\\\.1:5081'; Text=$staleStop },
        @{ Name='Stale API cleanup requires exact PID confirmation'; Pattern='Type STOP'; Text=$staleStop },
        @{ Name='Stale API cleanup never targets PostgreSQL'; Pattern='PostgreSQL on 55432 was not touched'; Text=$staleStop },
        @{ Name='Rehearsal never initializes a PostgreSQL cluster'; Pattern='initdb'; Text=$runner; Negative=$true },
        @{ Name='Run All skips interactive migration rehearsal'; Pattern='Interactive backup selection is required|Interactive'; Text=$testCenter },
        @{ Name='START_DAR tracks the API process it launches'; Pattern='Dar API started in background.*ApiProcess\.Id'; Text=$launcher },
        @{ Name='START_DAR waits for its own API process to stop'; Pattern='Wait-Process\s+-Id\s+\$ownedApiPid'; Text=$launcher },
        @{ Name='START_DAR verifies port 5080 release'; Pattern='Get-NetTCPConnection\s+-LocalPort\s+5080'; Text=$launcher }
    )
    foreach ($check in $checks) {
        $matched = [regex]::IsMatch([string]$check.Text, [string]$check.Pattern, [System.Text.RegularExpressions.RegexOptions]::Singleline)
        if ($check.Negative) { $matched = -not $matched }
        if (-not $matched) {
            Write-Host ('FAIL: ' + $check.Name) -ForegroundColor Red
            $failedChecks.Add([string]$check.Name)
        } else {
            Write-Host ('PASS: ' + $check.Name) -ForegroundColor Green
        }
    }
    if ($failedChecks.Count -gt 0) { Write-Output 'DAR_TEST_RESULT=FAIL'; exit 1 }
    Write-Output 'DAR_TEST_RESULT=PASS'
    exit 0
}
catch {
    Write-Host ('FAIL: Migration rehearsal source checker crashed: ' + $_.Exception.Message) -ForegroundColor Red
    if ($_.InvocationInfo -and $_.InvocationInfo.ScriptLineNumber -gt 0) {
        Write-Host ('At line ' + $_.InvocationInfo.ScriptLineNumber + ': ' + $_.InvocationInfo.Line) -ForegroundColor DarkYellow
    }
    if ($_.ScriptStackTrace) { Write-Host $_.ScriptStackTrace -ForegroundColor DarkYellow }
    Write-Output 'DAR_TEST_RESULT=FAIL'
    exit 1
}
