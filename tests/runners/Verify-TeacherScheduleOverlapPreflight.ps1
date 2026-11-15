#requires -Version 5.1
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false) } catch { }

$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$localPostgresPath = Join-Path $projectRoot 'tools\LocalPostgres.ps1'
$sqlPath = Join-Path $projectRoot 'tests\diagnostics\teacher_schedule_overlap_preflight.sql'
foreach ($path in @($localPostgresPath, $sqlPath)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Required read-only schedule preflight file is missing: $path" }
}
. $localPostgresPath

$failure = $null
$script:result = 'FAIL'
try {
    $paths = Get-DarLocalPaths
    if (-not (Test-Path -LiteralPath $paths.Secrets -PathType Leaf)) {
        throw 'SKIP: Local Dar database secrets are missing. Do not launch candidate r6.3 yet; prepare the existing database runtime from the preserved r5 installation, then rerun this preflight.'
    }
    if (-not (Test-Path -LiteralPath (Join-Path $paths.Data 'PG_VERSION') -PathType Leaf)) {
        throw 'SKIP: The existing local PostgreSQL cluster is not initialized. Do not initialize or launch candidate r6.3 before this preflight; prepare the original r5 runtime separately.'
    }

    $secrets = Get-DarDatabaseSecrets
    Assert-DarDatabaseSecrets -Secrets $secrets
    try { $script:DarPgBin = Get-DarPostgresBin -ProjectRoot $projectRoot }
    catch { $script:DarPgBin = $null }
    if ([string]::IsNullOrWhiteSpace([string]$script:DarPgBin)) {
        throw 'SKIP: Verified local PostgreSQL 17 client binaries were not found. No download or cluster initialization is performed.'
    }

    $startupMutex = [System.Threading.Mutex]::new($false, 'Global\DarEltahfeez_Postgres_55432')
    $ownsStartupMutex = $false
    try {
        try { $ownsStartupMutex = $startupMutex.WaitOne([TimeSpan]::FromSeconds(30)) }
        catch [System.Threading.AbandonedMutexException] { $ownsStartupMutex = $true }
        if (-not $ownsStartupMutex) { throw 'Another process is preparing local PostgreSQL. Retry after it finishes.' }
        if (-not (Test-DarExpectedPostgresIdentity -Secrets $secrets -Paths $paths)) {
            Start-DarPostgresServer -Secrets $secrets -Paths $paths
        }
    }
    finally {
        if ($ownsStartupMutex) { $startupMutex.ReleaseMutex() }
        $startupMutex.Dispose()
    }
    if (-not (Test-DarExpectedPostgresIdentity -Secrets $secrets -Paths $paths)) {
        throw 'Could not verify the existing Dar PostgreSQL cluster identity.'
    }

    Write-Host 'Running a read-only timetable overlap preflight against the current Dar database...' -ForegroundColor Cyan

    # PostgreSQL encode(..., 'base64') wraps output at 76 characters. The SQL
    # diagnostic removes CR/LF before psql emits each row; this private output
    # file adds a second transport boundary independent of console rendering.
    # Base64 rows are ASCII; decoded payloads remain UTF-8 JSON.
    $preflightOutputPath = Join-Path ([System.IO.Path]::GetTempPath()) ('dar-teacher-schedule-preflight-' + [Guid]::NewGuid().ToString('N') + '.txt')
    try {
        # Pre-create an empty file so a zero-conflict result is still a valid empty result set.
        [System.IO.File]::WriteAllText($preflightOutputPath, '', [System.Text.Encoding]::ASCII)
        $queryResult = Invoke-DarPgTool -Tool 'psql' -Arguments @(
            '-X',
            '-h', '127.0.0.1',
            '-p', [string]$secrets.Port,
            '-U', $secrets.AppUser,
            '-d', $secrets.Database,
            '-qAt',
            '-P', 'pager=off',
            '-o', $preflightOutputPath,
            '-v', 'ON_ERROR_STOP=1',
            '-f', $sqlPath
        ) -Password $secrets.AppPassword

        if ($queryResult.ExitCode -ne 0) {
            throw ('psql returned exit code ' + $queryResult.ExitCode + ' while running the read-only timetable preflight.')
        }
        if (-not (Test-Path -LiteralPath $preflightOutputPath -PathType Leaf)) {
            throw 'psql did not create the read-only preflight output file.'
        }

        $resultLines = [System.IO.File]::ReadAllLines($preflightOutputPath, [System.Text.Encoding]::ASCII)
        $conflicts = @($resultLines | ForEach-Object {
            $line = ([string]$_).Trim()
            if ([string]::IsNullOrWhiteSpace($line)) { return }
            try {
                $jsonBytes = [Convert]::FromBase64String($line)
                $jsonText = [System.Text.Encoding]::UTF8.GetString($jsonBytes)
                $record = ConvertFrom-Json -InputObject $jsonText -ErrorAction Stop
                if ($null -ne $record -and $record.PSObject.Properties.Name -contains 'teacherId') { $record }
            }
            catch { throw ('The read-only preflight returned an unexpected UTF-8/base64 result row: ' + $_.Exception.Message) }
        })
    }
    finally {
        if ($preflightOutputPath) {
            Remove-Item -LiteralPath $preflightOutputPath -Force -ErrorAction SilentlyContinue
        }
    }

    if ($conflicts.Count -gt 0) {
        Write-Host 'FAIL: Existing active teacher timetable overlaps were found. Migration 012 will stop until they are reviewed.' -ForegroundColor Red
        foreach ($conflict in $conflicts) {
            Write-Host ("Teacher: {0} ({1})" -f $conflict.teacherName,$conflict.teacherId) -ForegroundColor Yellow
            Write-Host ("  Slot A: {0} | Circle: {1} ({2}) | Day: {3} | Start: {4} | Duration: {5}m" -f $conflict.slotAId,$conflict.circleA,$conflict.circleAId,$conflict.dayA,$conflict.startA,$conflict.durationA) -ForegroundColor Yellow
            Write-Host ("  Slot B: {0} | Circle: {1} ({2}) | Day: {3} | Start: {4} | Duration: {5}m" -f $conflict.slotBId,$conflict.circleB,$conflict.circleBId,$conflict.dayB,$conflict.startB,$conflict.durationB) -ForegroundColor Yellow
        }
        Write-Host 'No database rows were changed by this preflight.' -ForegroundColor DarkYellow
        $failure = 'Existing timetable overlaps were found; review the listed circle/slot pairs before applying Migration 012.'
    }
    else {
        Write-Host 'PASS: No active teacher timetable overlaps were found in the current Dar database.' -ForegroundColor Green
        Write-Host 'The query ran inside a READ ONLY transaction and did not modify database rows.' -ForegroundColor DarkGray
    }
}
catch {
    $message = $_.Exception.Message
    if ($message -like 'SKIP:*') { $failure = $message; $script:result = 'SKIP' }
    else { $failure = $message; $script:result = 'FAIL' }
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
