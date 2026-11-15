param([switch]$Manual)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$localPostgresScript = Join-Path $PSScriptRoot 'LocalPostgres.ps1'
if (-not (Test-Path -LiteralPath $localPostgresScript -PathType Leaf)) { throw 'The scheduler PostgreSQL helper is missing.' }
. $localPostgresScript
$schedulerModule = Join-Path $PSScriptRoot 'BackupScheduler.ps1'
if (-not (Test-Path -LiteralPath $schedulerModule -PathType Leaf)) { throw 'The installed backup scheduler module is missing; retention planning is unavailable. Re-save the schedule from Dar System Center.' }
. $schedulerModule
if (-not (Get-Command 'Get-DarBackupRetentionPlan' -CommandType Function -ErrorAction SilentlyContinue)) { throw 'The backup retention planner could not be loaded.' }

$paths = Get-DarLocalPaths
# Keep scheduler diagnostics available even if a configured removable backup volume is offline.
New-Item -ItemType Directory -Force -Path $paths.Logs | Out-Null
$schedulerRoot = Join-Path $paths.Base 'System\BackupScheduler'
$configPath = Join-Path $schedulerRoot 'schedule.json'
$logPath = Join-Path $paths.Logs 'backup-scheduler.jsonl'
$mutex = $null
$ownsMutex = $false
$partialPath = $null

function Write-BackupSchedulerLog([string]$Level,[string]$Message,$Data=$null) {
    $entry = [ordered]@{
        timestamp = [DateTimeOffset]::Now.ToString('o')
        level = $Level
        source = 'Backup Scheduler'
        message = $Message
        manual = [bool]$Manual
    }
    if ($null -ne $Data) { $entry.data = $Data }
    $line = ($entry | ConvertTo-Json -Compress -Depth 6) + [Environment]::NewLine
    [System.IO.File]::AppendAllText($logPath,$line,[System.Text.UTF8Encoding]::new($false))
}
function Write-Step([string]$Message) { Write-BackupSchedulerLog -Level 'Information' -Message $Message }
$runTypeLabel = if ($Manual) { 'Manual' } else { 'Automatic' }

try {
    $mutex = [System.Threading.Mutex]::new($false,'Global\DarEltahfeez.AutomaticBackup')
    try { $ownsMutex = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $ownsMutex = $true }
    if (-not $ownsMutex) {
        Write-BackupSchedulerLog -Level 'Warning' -Message 'A backup is already running; this overlapping run was skipped.'
        Write-Output 'DAR_BACKUP_RESULT=SKIP'
        exit 0
    }

    # Re-resolve paths only after owning the shared mutex. A scheduled runner can
    # start just before a relocation, lose the first race for the mutex, then begin
    # after relocation commits; a cached pre-lock BackupFolder would be stale.
    $paths = Get-DarLocalPaths
    $logPath = Join-Path $paths.Logs 'backup-scheduler.jsonl'

    if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) { throw 'Backup schedule configuration is missing. Configure the schedule from Dar System Center.' }
    $config = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not $config.Enabled -and -not $Manual) {
        Write-BackupSchedulerLog -Level 'Information' -Message 'Scheduled backup skipped because the schedule is disabled.'
        Write-Output 'DAR_BACKUP_RESULT=SKIP'
        exit 0
    }
    if (-not (Test-Path -LiteralPath $paths.Secrets -PathType Leaf)) { throw 'Local database secrets are missing. The scheduler will not initialize a new database.' }
    if (-not (Test-Path -LiteralPath (Join-Path $paths.Data 'PG_VERSION') -PathType Leaf)) { throw 'The local PostgreSQL data cluster is missing. No database was created.' }

    $script:DarPgBin = Get-DarPostgresBin -ProjectRoot $PSScriptRoot
    if ([string]::IsNullOrWhiteSpace([string]$script:DarPgBin)) { throw 'The bundled PostgreSQL runtime is unavailable. Open Dar Eltahfeez once to prepare the local runtime.' }
    $secrets = Get-DarDatabaseSecrets
    Assert-DarDatabaseSecrets -Secrets $secrets
    $startupMutex = [System.Threading.Mutex]::new($false,'Global\DarEltahfeez_Postgres_55432')
    $ownsStartupMutex = $false
    try {
        try { $ownsStartupMutex = $startupMutex.WaitOne([TimeSpan]::FromSeconds(30)) } catch [System.Threading.AbandonedMutexException] { $ownsStartupMutex = $true }
        if (-not $ownsStartupMutex) { throw 'Another process is initializing the local PostgreSQL engine. The scheduled backup will retry at the next run.' }
        if (-not (Test-DarExpectedPostgresIdentity -Secrets $secrets -Paths $paths)) { Start-DarPostgresServer -Secrets $secrets -Paths $paths }
    } finally {
        if ($ownsStartupMutex) { $startupMutex.ReleaseMutex() }
        $startupMutex.Dispose()
    }
    if (-not (Test-DarExpectedPostgresIdentity -Secrets $secrets -Paths $paths)) { throw 'PostgreSQL identity verification failed after startup.' }
    if (-not (Test-DarDatabaseExists -Secrets $secrets -DatabaseName $secrets.Database)) { throw 'The expected Dar application database does not exist. The scheduler will not create an empty database.' }

    # Create/check the active target only after taking the shared backup mutex.
    # If a custom removable drive is offline, fail and log safely; never fall back to LocalAppData.
    New-Item -ItemType Directory -Force -Path $paths.BackupFolder -ErrorAction Stop | Out-Null
    $stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
    $finalName = "DarEltahfeez_AUTO_$stamp.backup"
    $finalPath = Join-Path $paths.BackupFolder $finalName
    if (Test-Path -LiteralPath $finalPath) { throw "Backup target already exists; it will not be overwritten: $finalName" }
    $partialPath = $finalPath + '.partial'
    Write-BackupSchedulerLog -Level 'Information' -Message ($runTypeLabel + ' full backup started.') -Data @{ fileName=$finalName; database=$secrets.Database; port=[int]$secrets.Port }

    $dump = New-DarDatabaseBackup -DestinationPath $partialPath -Secrets $secrets
    Move-Item -LiteralPath $partialPath -Destination $finalPath -ErrorAction Stop
    $file = Get-Item -LiteralPath $finalPath
    $manifestResult = New-DarBackupManifest -BackupPath $finalPath -Secrets $secrets
    Write-BackupSchedulerLog -Level 'Information' -Message ($runTypeLabel + ' full backup completed and verified.') -Data @{ fileName=$finalName; sizeBytes=[long]$file.Length; sha256=$manifestResult.Sha256; validation=$manifestResult.Validation; manifestPath=$manifestResult.Path }

    $keepCount = 30
    if ($config.RetentionCount -and [int]$config.RetentionCount -ge 7 -and [int]$config.RetentionCount -le 365) { $keepCount = [int]$config.RetentionCount }
    try {
        $retention = Get-DarBackupRetentionPlan -BackupFolder $paths.BackupFolder -KeepLast $keepCount
        $retainedCount = @($retention.Keep).Count
        $deletionCandidateCount = @($retention.Delete).Count
        $protectedCount = @($retention.Unmanaged).Count
        $retentionSummary = 'Retention plan completed. Kept=' + $retainedCount + '; deletion candidates=' + $deletionCandidateCount + '; protected unmanaged=' + $protectedCount + '.'
        Write-BackupSchedulerLog -Level 'Information' -Message $retentionSummary
        foreach ($candidate in $retention.Delete) {
            try {
                $fullPath = [IO.Path]::GetFullPath([string]$candidate.Path)
                $backupRoot = [IO.Path]::GetFullPath($paths.BackupFolder).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
                if (-not $fullPath.StartsWith($backupRoot,[StringComparison]::OrdinalIgnoreCase)) { throw 'Retention safety check rejected a path outside the backup folder.' }
                if ([IO.Path]::GetFileName($fullPath) -notmatch '^DarEltahfeez_AUTO_\d{8}_\d{6}\.backup$') { continue }
                Remove-Item -LiteralPath $fullPath -Force -ErrorAction Stop
                Remove-Item -LiteralPath ([string]$candidate.Manifest) -Force -ErrorAction SilentlyContinue
                Write-BackupSchedulerLog -Level 'Information' -Message 'An older verified automatic backup was removed by retention policy.' -Data @{ fileName=[IO.Path]::GetFileName($fullPath) }
            } catch { Write-BackupSchedulerLog -Level 'Warning' -Message ('Retention cleanup could not remove an older automatic backup: ' + $_.Exception.Message) }
        }
    } catch { Write-BackupSchedulerLog -Level 'Warning' -Message ('Retention planning failed after the new backup was safely completed: ' + $_.Exception.Message) }
    Write-Output 'DAR_BACKUP_RESULT=PASS'
    exit 0
}
catch {
    if (-not [string]::IsNullOrWhiteSpace([string]$partialPath)) {
        try {
            $partialFullPath = [IO.Path]::GetFullPath([string]$partialPath)
            $backupRoot = [IO.Path]::GetFullPath($paths.BackupFolder).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
            if ($partialFullPath.StartsWith($backupRoot,[StringComparison]::OrdinalIgnoreCase) -and [IO.Path]::GetFileName($partialFullPath) -match '^DarEltahfeez_AUTO_\d{8}_\d{6}\.backup\.partial$' -and (Test-Path -LiteralPath $partialFullPath -PathType Leaf)) {
                Remove-Item -LiteralPath $partialFullPath -Force -ErrorAction Stop
                Write-BackupSchedulerLog -Level 'Warning' -Message 'An incomplete partial backup created by this run was removed after failure.'
            }
        } catch { try { Write-BackupSchedulerLog -Level 'Warning' -Message ('Could not remove this run partial backup: ' + $_.Exception.Message) } catch { } }
    }
    try {
        $message = [string]$_.Exception.Message
        Write-BackupSchedulerLog -Level 'Error' -Message $message -Data @{ location=[string]$_.InvocationInfo.PositionMessage; stack=[string]$_.ScriptStackTrace }
    } catch { }
    Write-Output ('BACKUP_ERROR: ' + [string]$_.Exception.Message)
    Write-Output 'DAR_BACKUP_RESULT=FAIL'
    exit 1
}
finally {
    if ($ownsMutex -and $mutex) { try { $mutex.ReleaseMutex() } catch { } }
    if ($mutex) { $mutex.Dispose() }
}
