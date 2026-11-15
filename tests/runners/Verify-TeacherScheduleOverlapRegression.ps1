$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$localPostgresPath = Join-Path $projectRoot 'tools\LocalPostgres.ps1'
$sqlTestPath = Join-Path $projectRoot 'tests\regression\sql\teacher_schedule_overlap.test.sql'
if (-not (Test-Path -LiteralPath $localPostgresPath -PathType Leaf)) { throw 'LocalPostgres.ps1 is missing.' }
if (-not (Test-Path -LiteralPath $sqlTestPath -PathType Leaf)) { throw 'Teacher schedule overlap SQL regression is missing.' }
. $localPostgresPath

$databaseName = $null
$databaseCreated = $false
$secrets = $null
$failure = $null
$script:result = 'FAIL'
$previousPassword = $env:PGPASSWORD
$previousPgOptions = $env:PGOPTIONS

try {
    $testPgOptions = '-c client_min_messages=warning'
    if (-not [string]::IsNullOrWhiteSpace([string]$previousPgOptions)) { $testPgOptions = ([string]$previousPgOptions + ' ' + $testPgOptions) }
    $env:PGOPTIONS = $testPgOptions

    $paths = Get-DarLocalPaths
    if (-not (Test-Path -LiteralPath $paths.Secrets -PathType Leaf)) {
        throw 'SKIP: Local Dar database secrets are missing. Start Dar once to prepare the local database runtime.'
    }
    $secrets = Get-DarDatabaseSecrets
    Assert-DarDatabaseSecrets -Secrets $secrets
    try { $script:DarPgBin = Get-DarPostgresBin -ProjectRoot $projectRoot } catch { $script:DarPgBin = $null }
    if ([string]::IsNullOrWhiteSpace([string]$script:DarPgBin)) {
        throw 'SKIP: Verified local PostgreSQL 17 client binaries were not found. Start Dar once to prepare the runtime, then retry.'
    }
    if (-not (Test-Path -LiteralPath (Join-Path $paths.Data 'PG_VERSION') -PathType Leaf)) {
        throw 'SKIP: The existing local PostgreSQL cluster is not initialized. The test will not run initdb.'
    }

    New-Item -ItemType Directory -Force -Path $paths.Logs | Out-Null
    $startupMutex = [System.Threading.Mutex]::new($false, 'Global\DarEltahfeez_Postgres_55432')
    $ownsStartupMutex = $false
    try {
        try { $ownsStartupMutex = $startupMutex.WaitOne([TimeSpan]::FromSeconds(30)) }
        catch [System.Threading.AbandonedMutexException] { $ownsStartupMutex = $true }
        if (-not $ownsStartupMutex) { throw 'Another process is starting local PostgreSQL. Retry after it finishes.' }
        if (-not (Test-DarExpectedPostgresIdentity -Secrets $secrets -Paths $paths)) {
            Start-DarPostgresServer -Secrets $secrets -Paths $paths
        }
    }
    finally {
        if ($ownsStartupMutex) { $startupMutex.ReleaseMutex() }
        $startupMutex.Dispose()
    }
    if (-not (Test-DarExpectedPostgresIdentity -Secrets $secrets -Paths $paths)) {
        throw 'Could not verify the prepared local PostgreSQL cluster.'
    }

    $databaseName = 'dar_schedule_test_' + [Guid]::NewGuid().ToString('N').Substring(0, 16)
    if (Test-DarDatabaseExists -Secrets $secrets -DatabaseName $databaseName) {
        throw 'Unexpected disposable database name collision.'
    }
    Write-Host "Creating isolated database: $databaseName" -ForegroundColor Cyan
    New-DarDatabase -DatabaseName $databaseName -Secrets $secrets
    $databaseCreated = $true

    Invoke-DarPgTool -Tool 'psql' -Arguments @('-h', '127.0.0.1', '-p', [string]$secrets.Port, '-U', $secrets.AppUser, '-d', $databaseName, '-v', 'ON_ERROR_STOP=1', '-c', "CREATE TABLE public.schema_migrations(version VARCHAR(120) PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now());") -Password $secrets.AppPassword | Out-Null

    $migrationFiles = @(Get-ChildItem -LiteralPath (Join-Path $projectRoot 'database') -Filter '*.sql' -File | Sort-Object Name)
    if ($migrationFiles.Count -ne 12) { throw "Expected 12 database migrations in this candidate; found $($migrationFiles.Count)." }
    foreach ($migration in $migrationFiles) {
        $version = [IO.Path]::GetFileNameWithoutExtension($migration.Name)
        if ($version -notmatch '^\d{3}_[a-z0-9_]+$') { throw "Unexpected migration filename: $($migration.Name)" }
        Write-Host "Applying $version to disposable database..." -ForegroundColor DarkCyan
        Invoke-DarPgTool -Tool 'psql' -Arguments @('-h', '127.0.0.1', '-p', [string]$secrets.Port, '-U', $secrets.AppUser, '-d', $databaseName, '-v', 'ON_ERROR_STOP=1', '-f', $migration.FullName) -Password $secrets.AppPassword | Out-Null
        Invoke-DarPgTool -Tool 'psql' -Arguments @('-h', '127.0.0.1', '-p', [string]$secrets.Port, '-U', $secrets.AppUser, '-d', $databaseName, '-v', 'ON_ERROR_STOP=1', '-c', "INSERT INTO public.schema_migrations(version) VALUES ('$version');") -Password $secrets.AppPassword | Out-Null
    }

    Write-Host 'Running teacher schedule overlap cases inside a rolled-back transaction...' -ForegroundColor Cyan
    $sqlResult = Invoke-DarPgTool -Tool 'psql' -Arguments @('-h', '127.0.0.1', '-p', [string]$secrets.Port, '-U', $secrets.AppUser, '-d', $databaseName, '-v', 'ON_ERROR_STOP=1', '-f', $sqlTestPath) -Password $secrets.AppPassword
    foreach ($line in $sqlResult.Output) { Write-Host $line }
    $sqlOutputText = @($sqlResult.Output | ForEach-Object { [string]$_ }) -join [Environment]::NewLine
    if ($sqlOutputText -notlike '*teacher timetable overlap regression completed*') {
        throw 'The SQL regression did not emit its final PASS marker.'
    }
    Write-Host 'PASS: Teacher schedule overlap regression completed in the isolated database.' -ForegroundColor Green
}
catch {
    $message = $_.Exception.Message
    if ($message -like 'SKIP:*') { $failure = $message; $script:result = 'SKIP' }
    else { $failure = $message; $script:result = 'FAIL' }
}
finally {
    if ($databaseCreated -and $databaseName -match '^dar_schedule_test_[a-f0-9]{16}$' -and $null -ne $secrets) {
        try {
            Write-Host "Removing only disposable database: $databaseName" -ForegroundColor DarkCyan
            Invoke-DarPgTool -Tool 'psql' -Arguments @('-h', '127.0.0.1', '-p', [string]$secrets.Port, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', "DROP DATABASE IF EXISTS $databaseName WITH (FORCE);") -Password $secrets.PostgresAdminPassword | Out-Null
            if (Test-DarDatabaseExists -Secrets $secrets -DatabaseName $databaseName) { throw "Disposable database remains after cleanup: $databaseName" }
        }
        catch {
            $cleanupMessage = $_.Exception.Message
            $failure = (($failure + ' ') + $cleanupMessage).Trim()
            $script:result = 'FAIL'
        }
    }
    if ($null -eq $previousPassword) { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
    else { $env:PGPASSWORD = $previousPassword }
    if ($null -eq $previousPgOptions) { Remove-Item Env:PGOPTIONS -ErrorAction SilentlyContinue }
    else { $env:PGOPTIONS = $previousPgOptions }
}

if ($failure) {
    if ($script:result -eq 'SKIP') {
        Write-Host "SKIP: $failure" -ForegroundColor Yellow
        Write-Output 'DAR_TEST_RESULT=SKIP'
        exit 0
    }
    Write-Host "FAIL: $failure" -ForegroundColor Red
    Write-Output 'DAR_TEST_RESULT=FAIL'
    exit 1
}
Write-Output 'DAR_TEST_RESULT=PASS'
exit 0
