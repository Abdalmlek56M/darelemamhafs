#requires -Version 5.1
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false) } catch { }

$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$localPostgresPath = Join-Path $projectRoot 'tools\LocalPostgres.ps1'
$sqlPath = Join-Path $projectRoot 'tests\diagnostics\teacher_schedule_inspection.sql'
foreach ($path in @($localPostgresPath, $sqlPath)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Required read-only timetable inspection file is missing: $path" }
}
. $localPostgresPath

$failure = $null
$records = @()
try {
    $paths = Get-DarLocalPaths
    if (-not (Test-Path -LiteralPath $paths.Secrets -PathType Leaf)) {
        throw 'SKIP: Local Dar database secrets are missing. Prepare the existing r5 database runtime first; this inspection does not initialize a database.'
    }
    if (-not (Test-Path -LiteralPath (Join-Path $paths.Data 'PG_VERSION') -PathType Leaf)) {
        throw 'SKIP: The existing local PostgreSQL cluster is not initialized. No database initialization is performed.'
    }

    $secrets = Get-DarDatabaseSecrets
    Assert-DarDatabaseSecrets -Secrets $secrets
    try { $script:DarPgBin = Get-DarPostgresBin -ProjectRoot $projectRoot }
    catch { $script:DarPgBin = $null }
    if ([string]::IsNullOrWhiteSpace([string]$script:DarPgBin)) {
        throw 'SKIP: Verified PostgreSQL client binaries were not found. No download or cluster initialization is performed.'
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

    Write-Host 'Reading the affected circle and the teacher timetable (READ ONLY)...' -ForegroundColor Cyan
    $outputPath = Join-Path ([System.IO.Path]::GetTempPath()) ('dar-teacher-schedule-inspection-' + [Guid]::NewGuid().ToString('N') + '.txt')
    try {
        [System.IO.File]::WriteAllText($outputPath, '', [System.Text.Encoding]::ASCII)
        $queryResult = Invoke-DarPgTool -Tool 'psql' -Arguments @(
            '-X', '-h', '127.0.0.1', '-p', [string]$secrets.Port,
            '-U', $secrets.AppUser, '-d', $secrets.Database,
            '-qAt', '-P', 'pager=off', '-o', $outputPath,
            '-v', 'ON_ERROR_STOP=1', '-f', $sqlPath
        ) -Password $secrets.AppPassword
        if ($queryResult.ExitCode -ne 0) { throw ('psql returned exit code ' + $queryResult.ExitCode + ' while inspecting the read-only timetable.') }
        if (-not (Test-Path -LiteralPath $outputPath -PathType Leaf)) { throw 'psql did not create the timetable inspection output file.' }

        $lines = [System.IO.File]::ReadAllLines($outputPath, [System.Text.Encoding]::ASCII)
        foreach ($lineValue in $lines) {
            $line = ([string]$lineValue).Trim()
            if ([string]::IsNullOrWhiteSpace($line)) { continue }
            try {
                $bytes = [Convert]::FromBase64String($line)
                $json = [System.Text.Encoding]::UTF8.GetString($bytes)
                $record = ConvertFrom-Json -InputObject $json -ErrorAction Stop
                if ($null -eq $record -or $record.recordType -ne 'scheduleSlot') { throw 'Unexpected inspection record type.' }
                $records += $record
            }
            catch { throw ('Could not decode a complete timetable inspection row: ' + $_.Exception.Message) }
        }
    }
    finally {
        if ($outputPath) { Remove-Item -LiteralPath $outputPath -Force -ErrorAction SilentlyContinue }
    }

    if ($records.Count -eq 0) {
        throw 'No matching schedule rows were returned for the known circle/teacher identifiers. Do not modify data; verify the local database identity before proceeding.'
    }
    else {
        foreach ($row in $records) {
            $scope = if ($row.circleId -eq '01a6c471-d6a3-4bc2-83d6-af9379d214de') { 'TARGET CIRCLE' } else { 'SAME TEACHER / OTHER CIRCLE' }
            $slotState = if ($row.slotIsTrashed) { 'TRASHED' } elseif ($row.slotIsActive) { 'ACTIVE' } else { 'INACTIVE' }
            Write-Host ("[{0}] {1} | Circle: {2} ({3})" -f $scope,$row.dayName,$row.circleName,$row.circleId) -ForegroundColor Cyan
            Write-Host ("  Slot: {0} | Start stored in PostgreSQL: {1} | Seconds after midnight: {2} | Duration: {3}m | End offset: {4}s" -f $row.slotId,$row.startsAt,$row.startsAtSeconds,$row.durationMinutes,$row.endsAtSecondsFromMidnight)
            Write-Host ("  State: slot={0}; circleActive={1}; circleTrashed={2}; circleStartsOn={3}" -f $slotState,$row.circleIsActive,$row.circleIsTrashed,$row.circleStartsOn)
            Write-Host ("  Created Cairo: {0} | Teacher: {1} ({2})" -f $row.createdAtCairo,$row.teacherName,$row.teacherId)
            Write-Host ("  Attendance rows: teacher {0} total/{1} active; students {2} total/{3} active" -f $row.teacherAttendanceTotal,$row.teacherAttendanceActive,$row.studentAttendanceTotal,$row.studentAttendanceActive)
            if (-not [string]::IsNullOrWhiteSpace([string]$row.legacyScheduleText)) { Write-Host ("  Legacy circle schedule text: {0}" -f $row.legacyScheduleText) }
            $auditEvents = @($row.auditEvents)
            if ($auditEvents.Count -eq 0 -or ($auditEvents.Count -eq 1 -and $null -eq $auditEvents[0])) {
                Write-Host '  Audit: no schedule-slot audit event is available for this record.' -ForegroundColor DarkYellow
            }
            else {
                foreach ($event in $auditEvents) {
                    $details = if ($event.details) { $event.details | ConvertTo-Json -Compress -Depth 5 } else { '{}' }
                    Write-Host ("  Audit: {0} at {1} | {2}" -f $event.actionCode,$event.occurredAtCairo,$details) -ForegroundColor DarkGray
                }
            }
        }
        Write-Host 'Inspection complete. The SQL ran inside a READ ONLY transaction; no rows or schema objects were changed.' -ForegroundColor Green
    }
}
catch {
    $message = $_.Exception.Message
    if ($message -like 'SKIP:*') {
        Write-Host "SKIP: $message" -ForegroundColor Yellow
        Write-Output 'DAR_TEST_RESULT=SKIP'
        exit 0
    }
    $failure = $message
}

if ($failure) {
    Write-Host "FAIL: $failure" -ForegroundColor Red
    Write-Output 'DAR_TEST_RESULT=FAIL'
    exit 1
}
Write-Output 'DAR_TEST_RESULT=PASS'
exit 0
