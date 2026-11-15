#requires -Version 5.1
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$script:diagnosticLogPath = $null
function Write-EnrollmentRegressionTrace([string]$Message) {
    $line = ('[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss.fffK'),$Message)
    try {
        if (-not [string]::IsNullOrWhiteSpace([string]$script:diagnosticLogPath)) {
            [System.IO.File]::AppendAllText($script:diagnosticLogPath,$line + [Environment]::NewLine,[System.Text.UTF8Encoding]::new($false))
        }
    } catch { }
    Write-Host $line
}
trap {
    # Last-resort diagnostic for failures that occur outside the main try/catch.
    $record = $_
    try { Write-EnrollmentRegressionTrace ('UNHANDLED: ' + $record.Exception.ToString()) } catch { }
    try { [Console]::Out.WriteLine('DAR_TEST_RESULT=FAIL'); [Console]::Out.Flush() } catch { }
    exit 1
}

$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$localPostgresPath = Join-Path $projectRoot 'tools\LocalPostgres.ps1'
$sqlTestPath = Join-Path $projectRoot 'tests\regression\sql\enrollment_month_eligibility.test.sql'
$databaseName = $null
$databaseCreated = $false
$secrets = $null
$failure = $null
$script:result = 'FAIL'
$previousPassword = $env:PGPASSWORD
$previousPgOptions = $env:PGOPTIONS
$logRoot = Join-Path $env:LOCALAPPDATA 'DarEltahfeez\Logs'
New-Item -ItemType Directory -Force -Path $logRoot | Out-Null
$script:diagnosticLogPath = Join-Path $logRoot ('test-24-enrollment-billing-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '.log')
Write-EnrollmentRegressionTrace 'Starting enrollment lifecycle regression. Production database writes are not permitted; all data is created inside a disposable database.'
try {
    if (-not (Test-Path -LiteralPath $localPostgresPath -PathType Leaf)) { throw 'LocalPostgres.ps1 is missing.' }
    if (-not (Test-Path -LiteralPath $sqlTestPath -PathType Leaf)) { throw 'Enrollment monthly eligibility SQL regression is missing.' }
    . $localPostgresPath
    Write-EnrollmentRegressionTrace 'Loaded LocalPostgres.ps1.'
    # PostgreSQL NOTICE messages from idempotent migrations (for example IF NOT EXISTS
    # in migration 005) are informational, not failures. On Windows PowerShell 5.1,
    # native stderr can be promoted to an error record when ErrorActionPreference=Stop.
    # Suppress NOTICE for this disposable regression only; WARNING and above remain visible.
    $testPgOptions = '-c client_min_messages=warning'
    if (-not [string]::IsNullOrWhiteSpace([string]$previousPgOptions)) { $testPgOptions = ([string]$previousPgOptions + ' ' + $testPgOptions) }
    $env:PGOPTIONS = $testPgOptions
    $paths = Get-DarLocalPaths
    Write-EnrollmentRegressionTrace 'Resolved Dar local paths.'
    if (-not (Test-Path -LiteralPath $paths.Secrets -PathType Leaf)) { throw 'SKIP: Local Dar database secrets are missing. Start Dar once to prepare the local database runtime.' }
    $secrets = Get-DarDatabaseSecrets
    Write-EnrollmentRegressionTrace 'Loaded and validated local database secrets.'
    Assert-DarDatabaseSecrets -Secrets $secrets
    Write-EnrollmentRegressionTrace ('Validated PostgreSQL settings for loopback port ' + [string]$secrets.Port + '.')
    try { $script:DarPgBin = Get-DarPostgresBin -ProjectRoot $projectRoot } catch { $script:DarPgBin = $null }
    if ([string]::IsNullOrWhiteSpace([string]$script:DarPgBin)) { throw 'SKIP: Verified local PostgreSQL 17 client binaries were not found. Start Dar once to prepare the runtime, then retry.' }
    Write-EnrollmentRegressionTrace ('Resolved PostgreSQL client runtime: ' + $script:DarPgBin)
    if (-not (Test-Path -LiteralPath (Join-Path $paths.Data 'PG_VERSION') -PathType Leaf)) { throw 'SKIP: The existing local PostgreSQL cluster is not initialized. The test will not run initdb.' }
    Write-EnrollmentRegressionTrace 'Existing PostgreSQL data cluster is initialized; no initdb operation will be run.'
    New-Item -ItemType Directory -Force -Path $paths.Logs | Out-Null

    $startupMutex = [System.Threading.Mutex]::new($false,'Global\DarEltahfeez_Postgres_55432')
    $ownsStartupMutex = $false
    try {
        try { $ownsStartupMutex = $startupMutex.WaitOne([TimeSpan]::FromSeconds(30)) }
        catch [System.Threading.AbandonedMutexException] { $ownsStartupMutex = $true }
        if (-not $ownsStartupMutex) { throw 'Another process is starting local PostgreSQL. Retry after it finishes.' }
        if (-not (Test-DarExpectedPostgresIdentity -Secrets $secrets -Paths $paths)) {
            Write-EnrollmentRegressionTrace 'PostgreSQL is not accepting the expected identity probe; starting the existing initialized cluster.'
            Start-DarPostgresServer -Secrets $secrets -Paths $paths
        } else { Write-EnrollmentRegressionTrace 'Existing PostgreSQL server identity is already healthy.' }
    } finally {
        if ($ownsStartupMutex) { $startupMutex.ReleaseMutex() }
        $startupMutex.Dispose()
    }
    if (-not (Test-DarExpectedPostgresIdentity -Secrets $secrets -Paths $paths)) { throw 'Could not verify the prepared Dar PostgreSQL cluster.' }
    Write-EnrollmentRegressionTrace 'Verified PostgreSQL server identity after startup.'

    $databaseName = 'dar_lifecycle_test_' + [Guid]::NewGuid().ToString('N').Substring(0,16)
    if (Test-DarDatabaseExists -Secrets $secrets -DatabaseName $databaseName) { throw 'Unexpected disposable database name collision.' }
    Write-EnrollmentRegressionTrace ("Creating isolated database: $databaseName")
    New-DarDatabase -DatabaseName $databaseName -Secrets $secrets
    $databaseCreated = $true
    Write-EnrollmentRegressionTrace 'Disposable lifecycle regression database created.'

    Invoke-DarPgTool -Tool 'psql' -Arguments @('-X','-h','127.0.0.1','-p',[string]$secrets.Port,'-U',$secrets.AppUser,'-d',$databaseName,'-v','ON_ERROR_STOP=1','-c',"CREATE TABLE public.schema_migrations(version VARCHAR(120) PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now());") -Password $secrets.AppPassword | Out-Null

    $migrationFiles = @(Get-ChildItem -LiteralPath (Join-Path $projectRoot 'database') -Filter '*.sql' -File | Sort-Object Name)
    if ($migrationFiles.Count -ne 12) { throw "Expected 12 database migrations in this candidate; found $($migrationFiles.Count)." }
    Write-EnrollmentRegressionTrace 'Applying all 12 migrations to the disposable database.'
    foreach ($migration in $migrationFiles) {
        $version = [IO.Path]::GetFileNameWithoutExtension($migration.Name)
        if ($version -notmatch '^\d{3}_[a-z0-9_]+$') { throw "Unexpected migration filename: $($migration.Name)" }
        Write-EnrollmentRegressionTrace ("Applying $version to disposable database.")
        Invoke-DarPgTool -Tool 'psql' -Arguments @('-X','-h','127.0.0.1','-p',[string]$secrets.Port,'-U',$secrets.AppUser,'-d',$databaseName,'-v','ON_ERROR_STOP=1','-f',$migration.FullName) -Password $secrets.AppPassword | Out-Null
        Invoke-DarPgTool -Tool 'psql' -Arguments @('-X','-h','127.0.0.1','-p',[string]$secrets.Port,'-U',$secrets.AppUser,'-d',$databaseName,'-v','ON_ERROR_STOP=1','-c',"INSERT INTO public.schema_migrations(version) VALUES ('$version');") -Password $secrets.AppPassword | Out-Null
    }

    Write-EnrollmentRegressionTrace 'Running date-effective monthly charge eligibility cases inside a rolled-back transaction.'
    $sqlResult = Invoke-DarPgTool -Tool 'psql' -Arguments @('-X','-A','-t','-h','127.0.0.1','-p',[string]$secrets.Port,'-U',$secrets.AppUser,'-d',$databaseName,'-v','ON_ERROR_STOP=1','-f',$sqlTestPath) -Password $secrets.AppPassword
    foreach ($line in $sqlResult.Output) { Write-EnrollmentRegressionTrace ([string]$line) }
    $sqlOutputText = @($sqlResult.Output | ForEach-Object { [string]$_ }) -join "`n"
    if ($sqlOutputText -notmatch '(?m)^ENROLLMENT_LIFECYCLE_REGRESSION_PASS$') { throw 'The SQL regression did not emit the required final success marker. See the psql output and test-24 diagnostic log.' }
    Write-EnrollmentRegressionTrace 'PASS: Enrollment lifecycle billing eligibility regression completed in the isolated database.'
    # Keep the persistent diagnostic result consistent with the explicit SQL PASS marker.
    # Cleanup below may still downgrade this to FAIL if dropping the disposable DB fails.
    $script:result = 'PASS'
}
catch {
    $message = $_.Exception.Message
    if ($message -like 'SKIP:*') { $failure = $message; $script:result = 'SKIP' }
    else { $failure = $message; $script:result = 'FAIL' }
    Write-EnrollmentRegressionTrace ('Caught ' + $script:result + ': ' + $message)
    if ($_.ScriptStackTrace) { Write-EnrollmentRegressionTrace ('Stack: ' + $_.ScriptStackTrace) }
}
finally {
    if ($databaseCreated -and $databaseName -match '^dar_lifecycle_test_[a-f0-9]{16}$' -and $null -ne $secrets) {
        try {
            Write-EnrollmentRegressionTrace ("Removing only disposable database: $databaseName")
            Invoke-DarPgTool -Tool 'psql' -Arguments @('-X','-h','127.0.0.1','-p',[string]$secrets.Port,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c',"DROP DATABASE IF EXISTS $databaseName WITH (FORCE);") -Password $secrets.PostgresAdminPassword | Out-Null
            if (Test-DarDatabaseExists -Secrets $secrets -DatabaseName $databaseName) { throw "Disposable database remains after cleanup: $databaseName" }
        } catch {
            $cleanupMessage = $_.Exception.Message
            $failure = (($failure + ' ') + $cleanupMessage).Trim()
            $script:result = 'FAIL'
        }
    }
    if ($null -eq $previousPassword) { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
    else { $env:PGPASSWORD = $previousPassword }
    if ($null -eq $previousPgOptions) { Remove-Item Env:PGOPTIONS -ErrorAction SilentlyContinue }
    else { $env:PGOPTIONS = $previousPgOptions }
    Write-EnrollmentRegressionTrace ('Runner cleanup finished. Result=' + $script:result + '; Failure=' + [string]$failure)
}

if ($failure) {
    if ($script:result -eq 'SKIP') {
        Write-Host "SKIP: $failure" -ForegroundColor Yellow
        Write-Host ("Diagnostic log: $script:diagnosticLogPath") -ForegroundColor DarkGray
        Write-Output 'DAR_TEST_RESULT=SKIP'
        exit 0
    }
    Write-Host "FAIL: $failure" -ForegroundColor Red
    Write-Host ("Diagnostic log: $script:diagnosticLogPath") -ForegroundColor DarkGray
    Write-Output 'DAR_TEST_RESULT=FAIL'
    exit 1
}
Write-Host ("Diagnostic log: $script:diagnosticLogPath") -ForegroundColor DarkGray
Write-Output 'DAR_TEST_RESULT=PASS'
exit 0
