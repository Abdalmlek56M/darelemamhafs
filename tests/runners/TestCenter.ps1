$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$runnerRoot = Join-Path $projectRoot 'tests\runners'
$testRunRoot = Join-Path $env:LOCALAPPDATA 'DarEltahfeez\TestRuns'
New-Item -ItemType Directory -Force -Path $testRunRoot | Out-Null
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::SetUnhandledExceptionMode([System.Windows.Forms.UnhandledExceptionMode]::CatchException)
$script:TestCenterThreadExceptionHandler = [System.Threading.ThreadExceptionEventHandler]{
    param($sender, $eventArgs)
    try {
        $logPath = Join-Path $env:LOCALAPPDATA 'DarEltahfeez\Logs\testcenter-crash.log'
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $logPath) | Out-Null
        $details = "[$(Get-Date -Format o)] Test Center UI exception`r`n$($eventArgs.Exception.ToString())`r`n$('=' * 72)`r`n"
        [System.IO.File]::AppendAllText($logPath, $details, [System.Text.UTF8Encoding]::new($false))
    } catch { }
}
[System.Windows.Forms.Application]::add_ThreadException($script:TestCenterThreadExceptionHandler)
[System.Windows.Forms.Application]::EnableVisualStyles()

$script:Tests = @(
    [pscustomobject]@{ Id='1'; Name='System Center & test-runner source'; Description='Static source and result-protocol checks. Safe; no app or database required.'; File='Verify-SystemCenterSource.ps1'; Requirement='Always available'; Status='READY' },
    [pscustomobject]@{ Id='2'; Name='Live file watcher'; Description='Creates and removes a unique temporary folder under %TEMP%.'; File='Verify-SystemCenterWatcher.ps1'; Requirement='Always available'; Status='READY' },
    [pscustomobject]@{ Id='3'; Name='API logging pipeline'; Description='Sends an unauthenticated GET and verifies the structured API log.'; File='Verify-LoggingPipeline.ps1'; Requirement='Dar API running at 127.0.0.1:5080'; Status='READY' },
    [pscustomobject]@{ Id='4'; Name='Teacher rate snapshot'; Description='Runs regression checks in a unique temporary PostgreSQL database.'; File='Run-TeacherAttendanceSnapshotTest.ps1'; Requirement='Local PostgreSQL on port 55432 + local secrets'; Status='READY' },
    @{ Id='5'; Name='Backup scheduler source'; Description='Checks Task Scheduler integration, API independence and safety guards.'; File='Verify-BackupSchedulerSource.ps1'; Requirement='Always available; source inspection only'; Status='READY' },
    @{ Id='6'; Name='Backup retention plan'; Description='Tests retention selection using dummy files in a unique temporary folder; deletes nothing.'; File='Verify-BackupRetention.ps1'; Requirement='Windows PowerShell 5.1 only'; Status='READY' }
    @{ Id='7'; Name='Launch encoding & System Center drawing'; Description='Checks JSON/BAT UTF-8 encoding and owner-drawn tab rectangle overload. Safe; no app/database required.'; File='Verify-LaunchEncodingAndDrawString.ps1'; Requirement='Windows PowerShell 5.1 only'; Status='READY' },
    @{ Id='8'; Name='Backup restore isolation & rollback'; Description='Automatically uses the newest full backup with a completed SHA-256 sidecar manifest in the active Dar backup folder; requires the current 12-migration snapshot, restores to unique temporary databases, validates all table row counts/schema objects, rejects an invalid archive and tests rollback. Saves the exact accepted backup reference for Test 10.'; File='Verify-BackupRestoreIsolation.ps1'; Requirement='Prepared local PostgreSQL cluster + local secrets; Dar API closed; create a fresh full backup after current migrations. The newest verified manifest-backed backup is chosen automatically; older files without manifests are ignored.'; Status='READY'; Interactive=$true },
    @{ Id='9'; Name='Backup restore safety source'; Description='Static source checks for isolated restore, migration-required tables, columns, indexes, functions, enabled triggers, production protection and rollback.'; File='Verify-BackupRestoreSource.ps1'; Requirement='Always available; source inspection only'; Status='READY' },
    @{ Id='10'; Name='Migration rehearsal: restored database API smoke test'; Description='Uses the exact path and SHA-256 accepted by the latest successful Test 8 run, restores to a temporary database, boots a read-only API on port 5081, and verifies health plus React assets without writing production.'; File='Invoke-MigrationRehearsal.ps1'; Requirement='Run BUILD_DAR_FOR_REHEARSAL.bat once; local PostgreSQL + secrets; ports 5080/5081 free; Test 8 must have completed PASS. Test 10 reuses the exact accepted backup automatically.'; Status='READY'; Interactive=$true },
    @{ Id='11'; Name='Migration rehearsal safety source'; Description='Static checks for the gated staging-only API connection override and temporary database cleanup.'; File='Verify-MigrationRehearsalSource.ps1'; Requirement='Always available; source inspection only'; Status='READY' },
    @{ Id='12'; Name='System Health source & read-only guards'; Description='PowerShell AST syntax parsing plus source, read-only SQL, privacy and System Center integration checks.'; File='Verify-HealthChecksSource.ps1'; Requirement='Always available; source inspection only'; Status='READY' },
    @{ Id='13'; Name='Storage metrics regression'; Description='Creates a unique temporary folder and verifies recursive size/count and scan limits; no Dar data is read or changed.'; File='Verify-HealthStorageMetrics.ps1'; Requirement='Windows PowerShell 5.1 only'; Status='READY' },
    @{ Id='14'; Name='Storage Center inventory & safety'; Description='Tests file and directory bounds, missing/partial results, largest files, path overlap, volume metrics, UNC root masking, reparse-point safety and sanitized JSON in temporary folders only.'; File='Verify-StorageCenter.ps1'; Requirement='Windows PowerShell 5.1 only; temporary folders under %TEMP%'; Status='READY' },
    @{ Id='15'; Name='Backup folder relocation safety'; Description='Runs isolated synthetic backup relocation, SHA-256, scheduler payload/config update, source retention, destination collision refusal and rollback checks; never touches real backups or scheduled tasks.'; File='Verify-StoragePathManager.ps1'; Requirement='Windows PowerShell 5.1; temporary local NTFS volume under %TEMP%'; Status='READY' },
    @{ Id='16'; Name='Database Studio source & read-only guards'; Description='Parses the Database Studio module and verifies bounded, loopback-only, fixed catalog queries, read-only UI and no raw SQL input.'; File='Verify-DatabaseStudioSource.ps1'; Requirement='Always available; source inspection only'; Status='READY' },
    @{ Id='17'; Name='Database Studio live catalog regression'; Description='Reads PostgreSQL 17 catalogs for the Dar database: overview, databases, tables, columns, constraints, indexes and connection metadata. No business rows or SQL text are read.'; File='Verify-DatabaseStudioRegression.ps1'; Requirement='Local PostgreSQL on port 55432 + prepared local secrets + PostgreSQL runtime'; Status='READY' },
    @{ Id='18'; Name='PostgreSQL maintenance source & read-only guards'; Description='Parses the maintenance module and verifies monitoring-only queries, safe UI and no maintenance command execution.'; File='Verify-PostgresMaintenanceSource.ps1'; Requirement='Windows PowerShell 5.1 only; source inspection'; Status='READY' },
    @{ Id='19'; Name='PostgreSQL maintenance live statistics regression'; Description='Reads Autovacuum settings, table statistics, XID age and active VACUUM progress for the local Dar database; no maintenance command is run.'; File='Verify-PostgresMaintenanceRegression.ps1'; Requirement='Local PostgreSQL 17 on port 55432 + validated local secrets + PostgreSQL runtime'; Status='READY' }
    @{ Id='20'; Name='Financial payment rounding regression'; Description='Builds and runs the exact API currency rules for NUMERIC(12,2) midpoint, outstanding-balance and maximum-value boundaries; no database connection or business data changes.'; File='Verify-FinancialRounding.ps1'; Requirement='.NET 10 SDK; isolated console regression only'; Status='READY' },
    @{ Id='21'; Name='Currency input normalization regression'; Description='Checks API source guards and runs 21 two-decimal currency and teacher-payable boundaries; no database connection or business data changes.'; File='Verify-CurrencyInputNormalization.ps1'; Requirement='Windows PowerShell 5.1 + .NET 10 SDK for executable cases'; Status='READY' }
    @{ Id='22'; Name='Financial read permission redaction'; Description='Verifies API and UI hide financial values without finance.read, including audit, trash, exports, payment errors, schedule attendance, hidden enrollment fee defaults and enrollment requests; source-only, no database connection.'; File='Verify-FinanceReadRedactionSource.ps1'; Requirement='Always available; source inspection only'; Status='READY' },
    @{ Id='23'; Name='Enrollment lifecycle & create-only finance'; Description='Checks independent enrollment pause/resume, final withdrawal history, paused-date attendance guards and finance.create entry without ledger access; source-only.'; File='Verify-EnrollmentLifecycleAndCreateOnlyFinanceSource.ps1'; Requirement='Always available; source inspection only'; Status='READY' }
    @{ Id='24'; Name='Enrollment billing lifecycle regression'; Description='Applies all 12 SQL migrations to a uniquely named disposable PostgreSQL database and tests pause/resume, full-month pause, later withdrawal, legacy rows, circle and enrollment start dates and attendance eligibility. Persists phase/error diagnostics and requires an explicit SQL PASS row; test rows roll back and only the disposable database is dropped.'; File='Verify-EnrollmentBillingLifecycleRegression.ps1'; Requirement='Prepared Dar PostgreSQL 17 cluster on port 55432 + validated local secrets'; Status='READY' },
    @{ Id='25'; Name='Teacher schedule overlap source guards'; Description='Read-only checks for migration 012, SQL interval policy, database triggers, API conflicts, restore validation, RTL-safe time controls and guarded timetable repair.'; File='Verify-TeacherScheduleOverlapSource.ps1'; Requirement='Windows PowerShell 5.1 only; source inspection'; Status='READY' },
    @{ Id='26'; Name='Teacher schedule overlap database regression'; Description='Applies all 12 SQL migrations to a uniquely named disposable PostgreSQL database and tests overlap, exact adjacency, same-circle/cross-circle cases, weekly boundary, teacher reassignment, activation, circle/slot trash restoration, slot editing and reactivation; data rolls back and only the disposable database is dropped.'; File='Verify-TeacherScheduleOverlapRegression.ps1'; Requirement='Prepared Dar PostgreSQL 17 cluster on port 55432 + validated local secrets'; Status='READY' },
    @{ Id='27'; Name='Teacher schedule overlap production preflight'; Description='Read-only check of the current Dar database. Lists all overlapping active weekly slots assigned to the same teacher before applying migration 012; SQL removes PostgreSQL Base64 line wrapping before each row is written; psql writes ASCII Base64 rows to a temporary file and the runner decodes UTF-8 JSON from it inside a READ ONLY transaction.'; File='Verify-TeacherScheduleOverlapPreflight.ps1'; Requirement='Prepared existing local PostgreSQL 17 cluster + validated local secrets; run before launching candidate r6.3 or applying Migration 012'; Status='READY' }
    @{ Id='28'; Name='Inspect affected teacher timetable & audit trail'; Description='Read-only inspection of the affected circle and all active weekly slots for the same teacher. Shows exact PostgreSQL TIME, seconds, duration, slot state, creation time, attendance counts and available schedule.create audit details; does not apply migrations or change rows.'; File='Inspect-TeacherScheduleSlots.ps1'; Requirement='Prepared existing local PostgreSQL 17 cluster + validated local secrets; safe before Migration 012'; Status='READY' }
    @{ Id='29'; Name='Backup manifest & rehearsal build workflow source'; Description='Checks that the System Center, Scheduler and API all-scope full-backup paths write the same SHA-256 sidecar manifest; API failure cleanup cannot delete a prior backup on filename collision; Test 8 uses the newest verified backup automatically and Test 10 reuses the exact Test 8 acceptance token; and the build-only .NET/React workflow prepares Test 10 without starting PostgreSQL or applying migrations.'; File='Verify-BackupManifestAndRehearsalBuildSource.ps1'; Requirement='Always available; source inspection only'; Status='READY' }
    @{ Id='30'; Name='PostgreSQL native error handling'; Description='Exercises the shared PostgreSQL process wrapper with a disposable fake psql executable that writes STDERR and exits non-zero under ErrorActionPreference=Stop; verifies -AllowFailure, exit-code reporting and caller preference restoration.'; File='Verify-PostgresNativeErrorHandling.ps1'; Requirement='Windows PowerShell 5.1; no PostgreSQL service or Dar database access'; Status='READY' },
    @{ Id='31'; Name='Enrollment lifecycle regression runner diagnostics source'; Description='Checks Test 24 always emits a final marker, persists phase/error diagnostics, executes SQL without psqlrc interference, requires an explicit SQL PASS row and keeps its cleanup result consistent with the final runner result.'; File='Verify-EnrollmentBillingRegressionRunnerSource.ps1'; Requirement='Windows PowerShell 5.1 only; source inspection'; Status='READY' },
    @{ Id='32'; Name='Functional API acceptance — isolated database'; Description='Runs student, enrollment, pause/resume, student and teacher attendance, hourly-rate snapshot, create-only finance permissions, partial payment, overpayment rejection, ledger/report access and final withdrawal through the real API on port 5082 against a unique disposable database with all 12 migrations. Verifies production logical signature is unchanged.'; File='Verify-FunctionalApiAcceptance.ps1'; Requirement='Prepared PostgreSQL 17 + local secrets + built API/React artifacts in this exact project folder + ports 5080/5081/5082 free. Run individually; creates/drops only dar_functional_test_*.'; Status='READY'; Interactive=$true },
    @{ Id='33'; Name='Functional API acceptance source & isolation guards'; Description='Parses the functional runner and validates the narrowly gated API mode, fixed loopback connection/port, disposable database allow-list, complete 12-migration setup, API workflow coverage and production-signature checks.'; File='Verify-FunctionalApiAcceptanceSource.ps1'; Requirement='Always available; source inspection only'; Status='READY' }
    @{ Id='34'; Name='Build output & stale Dar API recovery source'; Description='Checks that the functional build window pauses and persists a log, the build reports exact artifact paths, and the port 5080 cleanup helper stops only a revalidated Dar API after typed PID confirmation.'; File='Verify-BuildAndDarPortRecoverySource.ps1'; Requirement='Always available; source/PowerShell AST inspection only'; Status='READY' },
    @{ Id='35'; Name='Financial artifacts UI/API source guards'; Description='Checks receipt upload/download security, expense endpoints and validation, saved report snapshots, UI permission gating, report printing and exports, and the isolated acceptance runner via PowerShell AST/source inspection.'; File='Verify-FinancialArtifactsAcceptanceSource.ps1'; Requirement='Windows PowerShell 5.1 only; source inspection'; Status='READY' },
    @{ Id='36'; Name='Financial artifacts API acceptance — isolated database'; Description='Creates a unique dar_functional_test_* database, applies all 12 migrations, starts a narrowly gated API on 127.0.0.1:5082, tests receipt upload/download, operating and advertising expenses, create-only finance permissions and immutable collection-report snapshots, then verifies production logical signature is unchanged and removes only its disposable database. Run individually; skipped by Run All.'; File='Verify-FinancialArtifactsApiAcceptance.ps1'; Requirement='Prepared PostgreSQL 17 + local secrets + built API DLL and runtime wwwroot in this exact project folder + ports 5080/5081/5082 free'; Status='READY'; Interactive=$true }
)
$script:StatusLabels = @{}
$script:PendingTests = New-Object System.Collections.Queue
$script:Current = $null
$script:Total = 0
$script:Finished = 0
$script:RunFailures = 0
$script:RunSkips = 0
$script:RunAllMode = $false

function Test-TcpPort([int]$Port) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $async = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
        if (-not $async.AsyncWaitHandle.WaitOne(700)) { return $false }
        $client.EndConnect($async)
        return $true
    } catch { return $false } finally { $client.Close() }
}
function Get-PortListenerSummary([int]$Port) {
    $connections = @()
    try { $connections = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) } catch { }
    $owners = @($connections | Select-Object -ExpandProperty OwningProcess -Unique)
    if ($owners.Count -eq 0) {
        # Fallback for systems where Get-NetTCPConnection is unavailable or restricted.
        try {
            $netstatLines = @(netstat.exe -ano -p tcp 2>$null | Select-String -Pattern (':'+$Port+'\s+.*LISTENING\s+(\d+)'))
            foreach ($line in $netstatLines) { if ($line.Matches.Count -gt 0) { $owners += [int]$line.Matches[0].Groups[1].Value } }
            $owners = @($owners | Select-Object -Unique)
        } catch { }
    }
    if ($owners.Count -eq 0) { return "Port $Port is no longer listening." }
    $descriptions = foreach ($ownerId in $owners) {
        $process = Get-Process -Id ([int]$ownerId) -ErrorAction SilentlyContinue
        $processInfo = $null
        try { $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $ownerId" -ErrorAction SilentlyContinue } catch { }
        $name = if ($process) { $process.ProcessName } elseif ($processInfo) { [System.IO.Path]::GetFileNameWithoutExtension($processInfo.Name) } else { 'Unknown process' }
        $role = if ($processInfo -and $processInfo.CommandLine -match 'DarEltahfeez\.Api\.(dll|exe)') { ' — Dar API' } else { '' }
        '{0} (PID {1}){2}' -f $name,$ownerId,$role
    }
    return ('Port {0} is listening under: {1}. Close the Dar window AND wait for the START_DAR console to finish cleanup. If it remains, run tools\Show-DarPortOwner.ps1 to inspect the process command line. Stop only a verified Dar API process; never stop postgres.exe. This is a safety SKIP, not a test failure.' -f $Port,($descriptions -join '; '))
}
function Test-ApiReady {
    try {
        $health = Invoke-RestMethod -Uri 'http://127.0.0.1:5080/health' -TimeoutSec 2
        return ($health.status -eq 'ok' -and $health.service -eq 'DarEltahfeez.Api')
    } catch { return $false }
}
function Test-SnapshotReady {
    $secretPath = Join-Path $env:LOCALAPPDATA 'DarEltahfeez\database-secrets.json'
    return ((Test-TcpPort 55432) -and (Test-Path -LiteralPath $secretPath -PathType Leaf))
}
function Test-RestoreClusterPrepared {
    $localRoot = Join-Path $env:LOCALAPPDATA 'DarEltahfeez'
    $secretPath = Join-Path $localRoot 'database-secrets.json'
    $dataVersion = Join-Path $localRoot 'Database\data\PG_VERSION'
    $runtimeCandidates = @(
        (Join-Path $projectRoot 'database-runtime\pgsql\bin\pg_ctl.exe'),
        (Join-Path $projectRoot 'database-runtime\bin\pg_ctl.exe'),
        (Join-Path $localRoot 'Runtime\PostgreSQL\17\pgsql\bin\pg_ctl.exe'),
        (Join-Path $localRoot 'Runtime\PostgreSQL\17\bin\pg_ctl.exe')
    )
    $runtimeReady = @($runtimeCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf }).Count -gt 0
    return ((Test-Path -LiteralPath $secretPath -PathType Leaf) -and (Test-Path -LiteralPath $dataVersion -PathType Leaf) -and $runtimeReady)
}
function Set-Status([string]$Id, [string]$Status) {
    if ($script:StatusLabels.ContainsKey($Id)) {
        $label = $script:StatusLabels[$Id]
        $label.Text = $Status
        switch ($Status) {
            'PASS' { $label.ForeColor = [System.Drawing.Color]::FromArgb(75, 205, 151) }
            'FAIL' { $label.ForeColor = [System.Drawing.Color]::FromArgb(255, 105, 115) }
            'SKIP' { $label.ForeColor = [System.Drawing.Color]::FromArgb(245, 184, 83) }
            'RUNNING' { $label.ForeColor = [System.Drawing.Color]::FromArgb(89, 166, 255) }
            default { $label.ForeColor = [System.Drawing.Color]::FromArgb(150, 165, 184) }
        }
    }
}
function Write-Console([string]$Text, [string]$Kind='INFO') {
    $color = switch ($Kind) {
        'PASS' { [System.Drawing.Color]::FromArgb(75, 205, 151) }
        'FAIL' { [System.Drawing.Color]::FromArgb(255, 105, 115) }
        'SKIP' { [System.Drawing.Color]::FromArgb(245, 184, 83) }
        'RUN' { [System.Drawing.Color]::FromArgb(89, 166, 255) }
        default { [System.Drawing.Color]::FromArgb(211, 221, 235) }
    }
    $console.SelectionStart = $console.TextLength
    $console.SelectionLength = 0
    $console.SelectionColor = $color
    $console.AppendText("[$(Get-Date -Format 'HH:mm:ss')] $Text`r`n")
    $console.SelectionColor = $console.ForeColor
    $console.SelectionStart = $console.TextLength
    $console.ScrollToCaret()
}
function Update-EnvironmentStatus {
    $apiUp = Test-ApiReady
    $dbUp = Test-TcpPort 55432
    $apiBadge.Text = if ($apiUp) { 'API: ONLINE' } else { 'API: OFFLINE' }
    $apiBadge.ForeColor = if ($apiUp) { [System.Drawing.Color]::FromArgb(75,205,151) } else { [System.Drawing.Color]::FromArgb(245,184,83) }
    $dbBadge.Text = if ($dbUp) { 'POSTGRES: ONLINE' } else { 'POSTGRES: OFFLINE' }
    $dbBadge.ForeColor = if ($dbUp) { [System.Drawing.Color]::FromArgb(75,205,151) } else { [System.Drawing.Color]::FromArgb(245,184,83) }
}
function Get-TestPrecondition([string]$Id) {
    if ($Id -eq '3' -and -not (Test-ApiReady)) { return 'Dar API is not ready. Start Dar Eltahfeez and keep it open.' }
    if ($Id -eq '4' -and -not (Test-SnapshotReady)) { return 'Local PostgreSQL is unavailable. Start Dar Eltahfeez first; the local database and secrets must be ready.' }
    if ($Id -eq '17' -and -not (Test-SnapshotReady)) { return 'Local PostgreSQL and validated Dar database secrets are required. Start Dar Eltahfeez and keep the local database ready.' }
    if ($Id -eq '19' -and -not (Test-SnapshotReady)) { return 'Local PostgreSQL and validated Dar database secrets are required. Start Dar Eltahfeez and keep the local database ready.' }
    if ($Id -eq '8' -and -not (Test-RestoreClusterPrepared)) { return 'The existing local PostgreSQL cluster, runtime or local secrets are missing. Start Dar Eltahfeez once to prepare them; the focused test can start the existing cluster itself afterward.' }
    if ($Id -eq '8' -and (Test-TcpPort 5080)) { return ((Get-PortListenerSummary 5080) + ' The test starts the existing PostgreSQL cluster if it is offline.') }
    if ($Id -eq '10' -and (Test-TcpPort 5080)) { return (Get-PortListenerSummary 5080) }
    if ($Id -eq '10' -and (Test-TcpPort 5081)) { return 'Port 5081 is already in use. Run SHOW_REHEARSAL_PORT_OWNER.bat to inspect. If it confirms a stale Dar rehearsal API, use STOP_STALE_REHEARSAL_API.bat; it requires exact PID confirmation. Never stop postgres.exe.' }
    if ($Id -eq '10' -and -not (Test-RestoreClusterPrepared)) { return 'The prepared local PostgreSQL cluster and secrets are required. The test will not initialize a new cluster.' }
    if ($Id -eq '32' -and -not (Test-RestoreClusterPrepared)) { return 'The existing PostgreSQL 17 cluster, runtime and local secrets must be prepared first. The functional test never runs initdb.' }
    if ($Id -eq '32' -and (Test-TcpPort 5080)) { return (Get-PortListenerSummary 5080) }
    if ($Id -eq '32' -and (Test-TcpPort 5081)) { return 'Port 5081 is occupied by a rehearsal API. Close the rehearsal API before running functional acceptance.' }
    if ($Id -eq '32' -and (Test-TcpPort 5082)) { return 'Port 5082 is already occupied. Inspect the process; the functional test will not stop an unrelated listener.' }
    if ($Id -eq '36' -and -not (Test-RestoreClusterPrepared)) { return 'The existing PostgreSQL 17 cluster, runtime and local secrets must be prepared first. The financial artifacts test never runs initdb.' }
    if ($Id -eq '36' -and (Test-TcpPort 5080)) { return (Get-PortListenerSummary 5080) }
    if ($Id -eq '36' -and (Test-TcpPort 5081)) { return 'Port 5081 is occupied by a migration rehearsal API. Close it before running financial artifacts acceptance.' }
    if ($Id -eq '36' -and (Test-TcpPort 5082)) { return 'Port 5082 is already occupied. Inspect the process; the financial artifacts test will not stop an unrelated listener.' }
    $apiDll = Join-Path $projectRoot 'backend\DarEltahfeez.Api\bin\Debug\net10.0\DarEltahfeez.Api.dll'
    $apiIndex = Join-Path $projectRoot 'backend\DarEltahfeez.Api\wwwroot\index.html'
    $apiRuntimeIndex = Join-Path $projectRoot 'backend\DarEltahfeez.Api\bin\Debug\net10.0\wwwroot\index.html'
    if (($Id -eq '10' -or $Id -eq '32') -and (-not (Test-Path -LiteralPath $apiDll) -or -not (Test-Path -LiteralPath $apiIndex))) { return 'Run BUILD_DAR_FOR_REHEARSAL.bat from the project root. It builds the React assets and API only; it does not start Dar, PostgreSQL or apply migrations.' }
    if ($Id -eq '36' -and (-not (Test-Path -LiteralPath $apiDll) -or -not (Test-Path -LiteralPath $apiRuntimeIndex))) { return 'Run BUILD_DAR_FOR_REHEARSAL.bat from this exact project root. Test 36 requires the API DLL and runtime bin\Debug\net10.0\wwwroot\index.html; it does not build, launch production Dar or apply production migrations.' }
    return $null
}
function Read-OutputFile([string]$Path, [int]$Offset) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return @{ Text=''; Offset=$Offset } }
    try {
        $bytes = [System.IO.File]::ReadAllBytes($Path)
        $utf8 = [System.Text.UTF8Encoding]::new($false, $true)
        try { $content = $utf8.GetString($bytes) }
        catch { $content = [System.Text.Encoding]::Default.GetString($bytes) }
        if ($content.Length -le $Offset) { return @{ Text=''; Offset=$Offset } }
        return @{ Text=$content.Substring($Offset); Offset=$content.Length }
    } catch { return @{ Text=''; Offset=$Offset } }
}
function Start-NextTest {
    if ($script:Current) { return }
    if ($script:PendingTests.Count -eq 0) {
        $runButton.Enabled = $true
        $allButton.Enabled = $true
        $script:runTimer.Stop()
        $summary = "Run complete. PASS=$($script:Finished - $script:RunFailures - $script:RunSkips); FAIL=$($script:RunFailures); SKIP=$($script:RunSkips)."
        Write-Console $summary 'INFO'
        $footerStatus.Text = $summary
        Update-EnvironmentStatus
        return
    }
    $test = $script:PendingTests.Dequeue()
    if ($test.Interactive -and $script:RunAllMode) {
        Set-Status $test.Id 'SKIP'
        $script:Finished++; $script:RunSkips++
        Write-Console ("SKIP: $($test.Name) - interactive backup selection is required; run this test individually.") 'SKIP'
        Start-NextTest
        return
    }
    $skipReason = Get-TestPrecondition $test.Id
    if ($skipReason) {
        Set-Status $test.Id 'SKIP'
        $script:Finished++; $script:RunSkips++
        Write-Console "SKIP: $($test.Name) - $skipReason" 'SKIP'
        Start-NextTest
        return
    }
    $script:currentOut = Join-Path $testRunRoot ('test-' + $test.Id + '-' + [Guid]::NewGuid().ToString('N') + '.out.log')
    $script:currentErr = Join-Path $testRunRoot ('test-' + $test.Id + '-' + [Guid]::NewGuid().ToString('N') + '.err.log')
    $script:outOffset = 0
    $script:errOffset = 0
    $script:current = $test
    $script:Current = $test
    $script:CurrentStarted = Get-Date
    $script:CurrentResult = $null
    Set-Status $test.Id 'RUNNING'
    Write-Console "START: $($test.Name)" 'RUN'
    $scriptPath = Join-Path $runnerRoot $test.File
    $psExe = Join-Path $PSHOME 'powershell.exe'
    $arguments = '-NoLogo -NoProfile -ExecutionPolicy Bypass -File "' + $scriptPath + '"'
    try {
        $script:CurrentProcess = Start-Process -FilePath $psExe -ArgumentList $arguments -WorkingDirectory $projectRoot -PassThru -WindowStyle Hidden -RedirectStandardOutput $script:currentOut -RedirectStandardError $script:currentErr
        $footerStatus.Text = "Running: $($test.Name)"
        $script:runTimer.Start()
    } catch {
        Set-Status $test.Id 'FAIL'
        $script:Finished++; $script:RunFailures++
        Write-Console "FAIL: Could not start $($test.Name): $($_.Exception.Message)" 'FAIL'
        $script:Current = $null
        Start-NextTest
    }
}
function Add-TestOutput([string]$Text, [string]$Kind='INFO') {
    if ([string]::IsNullOrEmpty($Text)) { return }
    $marker = [regex]::Match($Text, '(?im)^\s*DAR_TEST_RESULT=(PASS|FAIL|SKIP)\s*$')
    if ($marker.Success) { $script:CurrentResult = $marker.Groups[1].Value.ToUpperInvariant() }
    $displayText = [regex]::Replace($Text, '(?im)^\s*DAR_TEST_RESULT=(?:PASS|FAIL|SKIP)\s*\r?\n?', '')
    foreach ($line in ($displayText -split "`r?`n")) {
        if ($line) { Write-Console $line $Kind }
    }
}
function Complete-CurrentTest {
    if (-not $script:Current -or -not $script:CurrentProcess) { return }
    $out = Read-OutputFile $script:currentOut $script:outOffset
    $err = Read-OutputFile $script:currentErr $script:errOffset
    $script:outOffset = $out.Offset; $script:errOffset = $err.Offset
    Add-TestOutput $out.Text 'INFO'
    Add-TestOutput $err.Text 'FAIL'
    $script:CurrentProcess.Refresh()
    if (-not $script:CurrentProcess.HasExited) { return }

    # Wait for redirected output handles to flush before the final marker scan.
    try { $script:CurrentProcess.WaitForExit(1500) | Out-Null } catch { }
    $out = Read-OutputFile $script:currentOut $script:outOffset
    $err = Read-OutputFile $script:currentErr $script:errOffset
    $script:outOffset = $out.Offset; $script:errOffset = $err.Offset
    Add-TestOutput $out.Text 'INFO'
    Add-TestOutput $err.Text 'FAIL'

    $exitCode = $null
    try {
        $rawExitCode = $script:CurrentProcess.ExitCode
        if ($null -ne $rawExitCode -and -not [string]::IsNullOrWhiteSpace([string]$rawExitCode)) { $exitCode = [int]$rawExitCode }
    } catch { $exitCode = $null }
    $result = $script:CurrentResult
    if (-not $result -and $null -ne $exitCode) {
        if ($exitCode -eq 0) { $result = 'PASS' }
        elseif ($exitCode -eq 2) { $result = 'SKIP' }
        else { $result = 'FAIL' }
    }
    if ($result -eq 'PASS') {
        Set-Status $script:Current.Id 'PASS'; Write-Console "PASS: $($script:Current.Name)" 'PASS'
    } elseif ($result -eq 'SKIP') {
        Set-Status $script:Current.Id 'SKIP'; $script:RunSkips++; Write-Console "SKIP: $($script:Current.Name) prerequisite unavailable." 'SKIP'
    } else {
        Set-Status $script:Current.Id 'FAIL'; $script:RunFailures++
        if ($null -eq $exitCode -and -not $script:CurrentResult) {
            Write-Console "FAIL: $($script:Current.Name) ended without a result marker or readable process exit code." 'FAIL'
            Write-Console ("Captured stdout: $script:currentOut") 'INFO'
            Write-Console ("Captured stderr: $script:currentErr") 'INFO'
            if (Test-Path -LiteralPath $script:currentOut -PathType Leaf) {
                $outTail = @(Get-Content -LiteralPath $script:currentOut -Tail 20 -ErrorAction SilentlyContinue)
                foreach ($line in $outTail) { if ($line) { Write-Console ("[stdout] $line") 'INFO' } }
            }
            if (Test-Path -LiteralPath $script:currentErr -PathType Leaf) {
                $errTail = @(Get-Content -LiteralPath $script:currentErr -Tail 30 -ErrorAction SilentlyContinue)
                foreach ($line in $errTail) { if ($line) { Write-Console ("[stderr] $line") 'FAIL' } }
            }
        } else {
            Write-Console "FAIL: $($script:Current.Name) (ExitCode=$exitCode)" 'FAIL'
        }
    }
    $script:Finished++
    $script:CurrentProcess.Dispose()
    $script:CurrentProcess = $null
    $script:Current = $null
    $script:CurrentResult = $null
    Start-NextTest
}
function Queue-Test([string]$Id) {
    if ($script:Current) { return }
    $test = $script:Tests | Where-Object { $_.Id -eq $Id } | Select-Object -First 1
    if (-not $test) { return }
    $script:PendingTests.Clear()
    $script:Finished=0; $script:RunFailures=0; $script:RunSkips=0
    foreach ($item in $script:Tests) { Set-Status $item.Id 'READY' }
    $script:PendingTests.Enqueue($test)
    $script:RunAllMode = $false
    $runButton.Enabled = $false; $allButton.Enabled = $false
    Start-NextTest
}
function Queue-AllApplicable {
    if ($script:Current) { return }
    $script:PendingTests.Clear()
    $script:Finished=0; $script:RunFailures=0; $script:RunSkips=0
    foreach ($item in $script:Tests) { Set-Status $item.Id 'QUEUED' }
    foreach ($item in $script:Tests) { $script:PendingTests.Enqueue($item) }
    $script:RunAllMode = $true
    $runButton.Enabled = $false; $allButton.Enabled = $false
    Write-Console 'Running all applicable tests. Missing runtime prerequisites will be SKIPPED, not marked as failures.' 'INFO'
    Start-NextTest
}

$form = New-Object System.Windows.Forms.Form
$form.Text = 'Dar Eltahfeez - Test Center'
$form.StartPosition = 'CenterScreen'
$form.Size = New-Object System.Drawing.Size(1120, 790)
$form.MinimumSize = New-Object System.Drawing.Size(980, 700)
$form.BackColor = [System.Drawing.Color]::FromArgb(9, 15, 26)
$form.ForeColor = [System.Drawing.Color]::FromArgb(231, 238, 247)
$form.Font = New-Object System.Drawing.Font('Segoe UI', 9)

$header = New-Object System.Windows.Forms.Panel
$header.Location = New-Object System.Drawing.Point(18, 16); $header.Size = New-Object System.Drawing.Size(1068, 104)
$header.Anchor = 'Top,Left,Right'; $header.BackColor = [System.Drawing.Color]::FromArgb(16, 27, 44)
$form.Controls.Add($header)
$title = New-Object System.Windows.Forms.Label
$title.Text = 'DAR ELTAHFEEZ  /  TEST CENTER'; $title.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 18, [System.Drawing.FontStyle]::Bold)
$title.ForeColor = [System.Drawing.Color]::FromArgb(238, 244, 252); $title.Location = New-Object System.Drawing.Point(22, 15); $title.Size = New-Object System.Drawing.Size(700, 36)
$header.Controls.Add($title)
$subtitle = New-Object System.Windows.Forms.Label
$subtitle.Text = 'Version 0.8.25.0  |  Focused checks for the desktop app, API, local database and system tools.'
$subtitle.ForeColor = [System.Drawing.Color]::FromArgb(145, 162, 184); $subtitle.Location = New-Object System.Drawing.Point(24, 55); $subtitle.Size = New-Object System.Drawing.Size(780, 25)
$header.Controls.Add($subtitle)
$apiBadge = New-Object System.Windows.Forms.Label
$apiBadge.Location = New-Object System.Drawing.Point(805, 22); $apiBadge.Size = New-Object System.Drawing.Size(118, 26); $apiBadge.TextAlign = 'MiddleCenter'
$apiBadge.BackColor = [System.Drawing.Color]::FromArgb(29, 42, 61); $apiBadge.Font = New-Object System.Drawing.Font('Segoe UI', 8, [System.Drawing.FontStyle]::Bold)
$header.Controls.Add($apiBadge)
$dbBadge = New-Object System.Windows.Forms.Label
$dbBadge.Location = New-Object System.Drawing.Point(930, 22); $dbBadge.Size = New-Object System.Drawing.Size(122, 26); $dbBadge.TextAlign = 'MiddleCenter'
$dbBadge.BackColor = [System.Drawing.Color]::FromArgb(29, 42, 61); $dbBadge.Font = New-Object System.Drawing.Font('Segoe UI', 8, [System.Drawing.FontStyle]::Bold)
$header.Controls.Add($dbBadge)

$testsPanel = New-Object System.Windows.Forms.Panel
$testsPanel.Location = New-Object System.Drawing.Point(18, 136); $testsPanel.Size = New-Object System.Drawing.Size(390, 560); $testsPanel.AutoScroll = $true
$testsPanel.Anchor = 'Top,Bottom,Left'; $testsPanel.BackColor = [System.Drawing.Color]::FromArgb(16, 27, 44)
$form.Controls.Add($testsPanel)
$testsTitle = New-Object System.Windows.Forms.Label
$testsTitle.Text = 'TEST SUITES'; $testsTitle.Font = New-Object System.Drawing.Font('Segoe UI', 11, [System.Drawing.FontStyle]::Bold)
$testsTitle.Location = New-Object System.Drawing.Point(18, 16); $testsTitle.Size = New-Object System.Drawing.Size(340, 26); $testsTitle.ForeColor = [System.Drawing.Color]::FromArgb(93, 190, 173)
$testsPanel.Controls.Add($testsTitle)
$y = 55
foreach ($test in $script:Tests) {
    $card = New-Object System.Windows.Forms.Panel
    $card.Location = New-Object System.Drawing.Point(14, $y); $card.Size = New-Object System.Drawing.Size(362, 105)
    $card.BackColor = [System.Drawing.Color]::FromArgb(22, 36, 56)
    $testsPanel.Controls.Add($card)
    $name = New-Object System.Windows.Forms.Label
    $name.Text = $test.Id + '.  ' + $test.Name; $name.Font = New-Object System.Drawing.Font('Segoe UI', 9, [System.Drawing.FontStyle]::Bold)
    $name.Location = New-Object System.Drawing.Point(12, 9); $name.Size = New-Object System.Drawing.Size(235, 22); $name.ForeColor = [System.Drawing.Color]::FromArgb(232, 239, 248)
    $card.Controls.Add($name)
    $status = New-Object System.Windows.Forms.Label
    $status.Text = 'READY'; $status.Location = New-Object System.Drawing.Point(267, 10); $status.Size = New-Object System.Drawing.Size(82, 20)
    $status.Font = New-Object System.Drawing.Font('Consolas', 8, [System.Drawing.FontStyle]::Bold); $status.ForeColor = [System.Drawing.Color]::FromArgb(150, 165, 184)
    $card.Controls.Add($status); $script:StatusLabels[$test.Id] = $status
    $desc = New-Object System.Windows.Forms.Label
    $desc.Text = $test.Description; $desc.Location = New-Object System.Drawing.Point(12, 33); $desc.Size = New-Object System.Drawing.Size(330, 35)
    $desc.ForeColor = [System.Drawing.Color]::FromArgb(154, 171, 193); $desc.Font = New-Object System.Drawing.Font('Segoe UI', 8)
    $card.Controls.Add($desc)
    $req = New-Object System.Windows.Forms.Label
    $req.Text = 'Requires: ' + $test.Requirement; $req.Location = New-Object System.Drawing.Point(12, 72); $req.Size = New-Object System.Drawing.Size(230, 22)
    $req.ForeColor = [System.Drawing.Color]::FromArgb(116, 139, 166); $req.Font = New-Object System.Drawing.Font('Segoe UI', 7)
    $card.Controls.Add($req)
    $run = New-Object System.Windows.Forms.Button
    $run.Text = 'RUN'; $run.Location = New-Object System.Drawing.Point(274, 69); $run.Size = New-Object System.Drawing.Size(74, 28)
    $run.FlatStyle = 'Flat'; $run.FlatAppearance.BorderSize = 0; $run.BackColor = [System.Drawing.Color]::FromArgb(38, 111, 105)
    $run.ForeColor = [System.Drawing.Color]::White; $run.Font = New-Object System.Drawing.Font('Segoe UI', 8, [System.Drawing.FontStyle]::Bold)
    $run.Tag = [string]$test.Id
    $run.Add_Click({ param($sender, $eventArgs) Queue-Test ([string]$sender.Tag) })
    $card.Controls.Add($run)
    $y += 116
}

$consolePanel = New-Object System.Windows.Forms.Panel
$consolePanel.Location = New-Object System.Drawing.Point(426, 136); $consolePanel.Size = New-Object System.Drawing.Size(660, 560)
$consolePanel.Anchor = 'Top,Bottom,Left,Right'; $consolePanel.BackColor = [System.Drawing.Color]::FromArgb(16, 27, 44)
$form.Controls.Add($consolePanel)
$consoleTitle = New-Object System.Windows.Forms.Label
$consoleTitle.Text = 'TEST OUTPUT'; $consoleTitle.Font = New-Object System.Drawing.Font('Segoe UI', 11, [System.Drawing.FontStyle]::Bold)
$consoleTitle.Location = New-Object System.Drawing.Point(18, 16); $consoleTitle.Size = New-Object System.Drawing.Size(250, 25); $consoleTitle.ForeColor = [System.Drawing.Color]::FromArgb(93, 190, 173)
$consolePanel.Controls.Add($consoleTitle)
$console = New-Object System.Windows.Forms.RichTextBox
$console.Location = New-Object System.Drawing.Point(16, 52); $console.Size = New-Object System.Drawing.Size(628, 430)
$console.Anchor = 'Top,Bottom,Left,Right'; $console.ReadOnly = $true; $console.DetectUrls = $false; $console.WordWrap = $false
$console.BackColor = [System.Drawing.Color]::FromArgb(8, 13, 22); $console.ForeColor = [System.Drawing.Color]::FromArgb(211, 221, 235)
$console.Font = New-Object System.Drawing.Font('Consolas', 9); $console.BorderStyle = 'FixedSingle'
$consolePanel.Controls.Add($console)
$clearButton = New-Object System.Windows.Forms.Button
$clearButton.Text = 'CLEAR OUTPUT'; $clearButton.Location = New-Object System.Drawing.Point(16, 496); $clearButton.Size = New-Object System.Drawing.Size(130, 34)
$clearButton.FlatStyle = 'Flat'; $clearButton.FlatAppearance.BorderSize = 0; $clearButton.BackColor = [System.Drawing.Color]::FromArgb(48, 59, 77); $clearButton.ForeColor = [System.Drawing.Color]::White
$clearButton.Add_Click({ $console.Clear() }); $consolePanel.Controls.Add($clearButton)
$copyButton = New-Object System.Windows.Forms.Button
$copyButton.Text = 'COPY OUTPUT'; $copyButton.Location = New-Object System.Drawing.Point(154, 496); $copyButton.Size = New-Object System.Drawing.Size(125, 34)
$copyButton.FlatStyle = 'Flat'; $copyButton.FlatAppearance.BorderSize = 0; $copyButton.BackColor = [System.Drawing.Color]::FromArgb(48, 59, 77); $copyButton.ForeColor = [System.Drawing.Color]::White
$copyButton.Add_Click({ if ($console.Text) { [System.Windows.Forms.Clipboard]::SetText($console.Text) } }); $consolePanel.Controls.Add($copyButton)
$allButton = New-Object System.Windows.Forms.Button
$allButton.Text = 'RUN ALL APPLICABLE'; $allButton.Location = New-Object System.Drawing.Point(416, 496); $allButton.Size = New-Object System.Drawing.Size(228, 34)
$allButton.FlatStyle = 'Flat'; $allButton.FlatAppearance.BorderSize = 0; $allButton.BackColor = [System.Drawing.Color]::FromArgb(31, 121, 105); $allButton.ForeColor = [System.Drawing.Color]::White
$allButton.Font = New-Object System.Drawing.Font('Segoe UI', 8, [System.Drawing.FontStyle]::Bold)
$allButton.Add_Click({ Queue-AllApplicable }); $consolePanel.Controls.Add($allButton)
$runButton = $allButton
$footerStatus = New-Object System.Windows.Forms.Label
$footerStatus.Text = 'Ready. Tests that need a stopped service will be marked SKIP.'
$footerStatus.Location = New-Object System.Drawing.Point(20, 714); $footerStatus.Size = New-Object System.Drawing.Size(1060, 28)
$footerStatus.Anchor = 'Bottom,Left,Right'; $footerStatus.ForeColor = [System.Drawing.Color]::FromArgb(148, 165, 188)
$form.Controls.Add($footerStatus)
$script:runTimer = New-Object System.Windows.Forms.Timer
$script:runTimer.Interval = 250
$script:runTimer.Add_Tick({ Complete-CurrentTest })

Update-EnvironmentStatus
Write-Console 'Test Center ready. Select a focused check or run all applicable tests.' 'INFO'
[void]$form.ShowDialog()
