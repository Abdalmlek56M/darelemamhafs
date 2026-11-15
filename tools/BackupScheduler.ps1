# Windows Task Scheduler integration for independent Dar Eltahfeez backups.
# Dot-source after LocalPostgres.ps1 has been loaded.
$script:DarBackupTaskName = 'Dar Eltahfeez Automatic Backup'

function Copy-DarBackupPayloadAtomically([string]$Source,[string]$Destination) {
    if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) { throw "Backup scheduler payload source is missing: $Source" }
    $temporary = "$Destination.new"
    try {
        Copy-Item -LiteralPath $Source -Destination $temporary -Force -ErrorAction Stop
        $sourceHash = (Get-FileHash -LiteralPath $Source -Algorithm SHA256).Hash
        $copyHash = (Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash
        if (-not [string]::Equals($sourceHash,$copyHash,[StringComparison]::OrdinalIgnoreCase)) { throw 'The copied scheduler payload failed SHA-256 verification.' }
        Move-Item -LiteralPath $temporary -Destination $Destination -Force -ErrorAction Stop
    } catch {
        Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
        throw
    }
}

function Get-DarBackupSchedulerPaths {
    $paths = Get-DarLocalPaths
    $root = Join-Path $paths.Base 'System\BackupScheduler'
    [pscustomobject]@{
        Root = $root
        Config = Join-Path $root 'schedule.json'
        Runner = Join-Path $root 'Invoke-AutomatedBackup.ps1'
        LocalPostgres = Join-Path $root 'LocalPostgres.ps1'
        SchedulerModule = Join-Path $root 'BackupScheduler.ps1'
        Log = Join-Path $paths.Logs 'backup-scheduler.jsonl'
        Backups = $paths.BackupFolder
    }
}

function Get-DarBackupScheduleState {
    $paths = Get-DarBackupSchedulerPaths
    $config = $null
    if (Test-Path -LiteralPath $paths.Config -PathType Leaf) {
        try { $config = Get-Content -LiteralPath $paths.Config -Raw -Encoding UTF8 | ConvertFrom-Json } catch { }
    }
    $task = $null
    $taskInfo = $null
    try {
        Import-Module ScheduledTasks -ErrorAction Stop
        $task = Get-ScheduledTask -TaskName $script:DarBackupTaskName -ErrorAction SilentlyContinue
        if ($task) { $taskInfo = Get-ScheduledTaskInfo -TaskName $script:DarBackupTaskName -ErrorAction SilentlyContinue }
    } catch { }
    $nextRunTime = $null
    $lastRunTime = $null
    if ($taskInfo) {
        try { if ([DateTime]$taskInfo.NextRunTime -gt [DateTime]::MinValue) { $nextRunTime = [DateTime]$taskInfo.NextRunTime } } catch { }
        try { if ([DateTime]$taskInfo.LastRunTime -gt [DateTime]::MinValue) { $lastRunTime = [DateTime]$taskInfo.LastRunTime } } catch { }
    }
    [pscustomobject]@{
        Configured = ($null -ne $config)
        Enabled = [bool]($config -and $config.Enabled -and $task -and $task.State -ne 'Disabled')
        ConfigEnabled = [bool]($config -and $config.Enabled)
        Registered = ($null -ne $task)
        TaskState = if ($task) { [string]$task.State } else { 'NotRegistered' }
        DailyTime = if ($config -and $config.DailyTime) { [string]$config.DailyTime } else { '03:00' }
        RetentionCount = if ($config -and $config.RetentionCount) { [int]$config.RetentionCount } else { 30 }
        NextRunTime = $nextRunTime
        LastRunTime = $lastRunTime
        LastTaskResult = if ($taskInfo) { [int]$taskInfo.LastTaskResult } else { $null }
        ConfigPath = $paths.Config
        LogPath = $paths.Log
        BackupFolder = $paths.Backups
    }
}

function Set-DarBackupSchedule {
    param(
        [Parameter(Mandatory=$true)][string]$SourceToolsPath,
        [Parameter(Mandatory=$true)][string]$DailyTime,
        [Parameter(Mandatory=$true)][int]$RetentionCount
    )
    if ($DailyTime -notmatch '^(?:[01]\d|2[0-3]):[0-5]\d$') { throw 'Enter a valid daily time in 24-hour HH:mm format.' }
    if ($RetentionCount -lt 7 -or $RetentionCount -gt 365) { throw 'Retention must be between 7 and 365 automatic backups.' }

    $localPaths = Get-DarLocalPaths
    if (-not (Test-Path -LiteralPath $localPaths.Secrets -PathType Leaf)) { throw 'Local database credentials are not initialized. Start Dar Eltahfeez once before configuring automatic backups.' }
    if (-not (Test-Path -LiteralPath (Join-Path $localPaths.Data 'PG_VERSION') -PathType Leaf)) { throw 'The local PostgreSQL data cluster is not initialized. No schedule was registered.' }

    $sourceLocalPostgres = Join-Path $SourceToolsPath 'LocalPostgres.ps1'
    $sourceRunner = Join-Path $SourceToolsPath 'Invoke-AutomatedBackup.ps1'
    $sourceSchedulerModule = Join-Path $SourceToolsPath 'BackupScheduler.ps1'
    if (-not (Test-Path -LiteralPath $sourceLocalPostgres -PathType Leaf)) { throw 'LocalPostgres.ps1 is missing from the tools folder.' }
    if (-not (Test-Path -LiteralPath $sourceSchedulerModule -PathType Leaf)) { throw 'BackupScheduler.ps1 is missing from the tools folder.' }
    if (-not (Test-Path -LiteralPath $sourceRunner -PathType Leaf)) { throw 'Invoke-AutomatedBackup.ps1 is missing from the tools folder.' }

    $paths = Get-DarBackupSchedulerPaths
    New-Item -ItemType Directory -Force -Path $paths.Root,$localPaths.Logs,$localPaths.BackupFolder | Out-Null
    Copy-DarBackupPayloadAtomically -Source $sourceLocalPostgres -Destination $paths.LocalPostgres
    Copy-DarBackupPayloadAtomically -Source $sourceSchedulerModule -Destination $paths.SchedulerModule
    Copy-DarBackupPayloadAtomically -Source $sourceRunner -Destination $paths.Runner

    $config = [ordered]@{
        SchemaVersion = 1
        Enabled = $true
        DailyTime = $DailyTime
        RetentionCount = $RetentionCount
        TaskName = $script:DarBackupTaskName
        WindowsUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name
        UpdatedAtUtc = [DateTime]::UtcNow.ToString('o')
        BackupFolder = $localPaths.BackupFolder
    }
    Write-DarAtomicJson -Path $paths.Config -Value $config

    try {
        Import-Module ScheduledTasks -ErrorAction Stop
        $powerShell = Join-Path $PSHOME 'powershell.exe'
        if (-not (Test-Path -LiteralPath $powerShell -PathType Leaf)) { throw 'Windows PowerShell executable was not found.' }
        $argumentLine = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File ' + (ConvertTo-DarWindowsArgument -Argument $paths.Runner)
        $action = New-ScheduledTaskAction -Execute $powerShell -Argument $argumentLine -WorkingDirectory $paths.Root
        $timeParts = $DailyTime.Split(':')
        $runAt = [DateTime]::Today.AddHours([int]$timeParts[0]).AddMinutes([int]$timeParts[1])
        $trigger = New-ScheduledTaskTrigger -Daily -At $runAt
        # InteractiveToken runs under the current user's already-open Windows session.
        # It does not store the password or request elevation. The task continues to run
        # while Dar Eltahfeez is closed, provided this Windows user remains signed in.
        $principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
        $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 2) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
        $task = New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Creates a verified Dar Eltahfeez PostgreSQL full backup independently of the desktop app and API.'
        Register-ScheduledTask -TaskName $script:DarBackupTaskName -InputObject $task -Force | Out-Null
    }
    catch {
        $config.Enabled = $false
        $config.UpdatedAtUtc = [DateTime]::UtcNow.ToString('o')
        Write-DarAtomicJson -Path $paths.Config -Value $config
        throw "Windows Task Scheduler could not register the backup job: $($_.Exception.Message)"
    }
    Write-SystemCenterEvent -Level 'Information' -Message ("Automatic backup schedule enabled at $DailyTime; retention=$RetentionCount.")
    return Get-DarBackupScheduleState
}

function Disable-DarBackupSchedule {
    $paths = Get-DarBackupSchedulerPaths
    if (Test-Path -LiteralPath $paths.Config -PathType Leaf) {
        $config = Get-Content -LiteralPath $paths.Config -Raw -Encoding UTF8 | ConvertFrom-Json
        $config.Enabled = $false
        $config.UpdatedAtUtc = [DateTime]::UtcNow.ToString('o')
        Write-DarAtomicJson -Path $paths.Config -Value $config
    }
    try {
        Import-Module ScheduledTasks -ErrorAction Stop
        Disable-ScheduledTask -TaskName $script:DarBackupTaskName -ErrorAction SilentlyContinue | Out-Null
    } catch { throw "Could not disable the Windows scheduled task: $($_.Exception.Message)" }
    Write-SystemCenterEvent -Level 'Warning' -Message 'Automatic backup schedule disabled. Existing backup files were not changed.'
    return Get-DarBackupScheduleState
}

function Start-DarBackupNow([string]$SourceToolsPath) {
    $paths = Get-DarBackupSchedulerPaths
    if (-not (Test-Path -LiteralPath $paths.Config -PathType Leaf)) {
        # Allow a one-time manual backup before the user enables a daily schedule.
        # The disabled config satisfies the runner contract but does not register a Windows task.
        $localPaths = Get-DarLocalPaths
        New-Item -ItemType Directory -Force -Path $paths.Root,$localPaths.Logs,$localPaths.BackupFolder | Out-Null
        $manualConfig = [ordered]@{
            SchemaVersion = 1
            Enabled = $false
            DailyTime = '03:00'
            RetentionCount = 30
            TaskName = $script:DarBackupTaskName
            WindowsUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name
            UpdatedAtUtc = [DateTime]::UtcNow.ToString('o')
            BackupFolder = $localPaths.BackupFolder
        }
        Write-DarAtomicJson -Path $paths.Config -Value $manualConfig
    }
    if (-not [string]::IsNullOrWhiteSpace($SourceToolsPath)) {
        # Refresh all three helper files so manual runs and scheduled runs use the same version.
        [void](Update-DarBackupSchedulerPayload -SourceToolsPath $SourceToolsPath)
    }
    if (-not (Test-Path -LiteralPath $paths.Runner -PathType Leaf)) { throw 'The backup runner is not installed. Re-extract the complete package or open the schedule page once to install its helper files.' }
    if (-not (Test-Path -LiteralPath $paths.SchedulerModule -PathType Leaf)) { throw 'The backup scheduler helper is missing. Re-save the schedule or re-extract the complete package to install the helper files.' }
    $powerShell = Join-Path $PSHOME 'powershell.exe'
    if (-not (Test-Path -LiteralPath $powerShell -PathType Leaf)) { throw 'Windows PowerShell executable was not found.' }
    $argumentLine = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File ' + (ConvertTo-DarWindowsArgument -Argument $paths.Runner) + ' -Manual'
    # This is a same-user background process. A manual database backup does not require elevation.
    $process = Start-Process -FilePath $powerShell -ArgumentList $argumentLine -WorkingDirectory $paths.Root -WindowStyle Hidden -PassThru -ErrorAction Stop
    Write-SystemCenterEvent -Level 'Information' -Message ("Manual background backup started (ProcessId=$($process.Id)).")
    return [int]$process.Id
}

function Get-DarBackupRetentionPlan {
    param([Parameter(Mandatory=$true)][string]$BackupFolder,[int]$KeepLast=30)
    if ($KeepLast -lt 1) { throw 'KeepLast must be at least 1.' }
    $root = [IO.Path]::GetFullPath($BackupFolder).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    $completed = @()
    $unmanaged = @()
    foreach ($file in (Get-ChildItem -LiteralPath $BackupFolder -Filter 'DarEltahfeez_AUTO_*.backup' -File -ErrorAction SilentlyContinue)) {
        $manifestPath = $file.FullName + '.json'
        if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { $unmanaged += $file.FullName; continue }
        try {
            $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($manifest.Status -ne 'completed' -or $manifest.FileName -ne $file.Name -or [long]$manifest.FileSizeBytes -ne [long]$file.Length -or $manifest.Validation -ne 'pg_restore --list passed' -or $manifest.ArchiveFormat -ne 'PostgreSQL Custom') {
                $unmanaged += $file.FullName; continue
            }
            if ([string]::IsNullOrWhiteSpace([string]$manifest.Sha256) -or [string]$manifest.Sha256 -notmatch '^[a-fA-F0-9]{64}$') {
                $unmanaged += $file.FullName; continue
            }
            $actualHash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
            if (-not [string]::Equals($actualHash,[string]$manifest.Sha256,[StringComparison]::OrdinalIgnoreCase)) {
                $unmanaged += $file.FullName; continue
            }
            $stamp = [DateTimeOffset]::MinValue
            if (-not [DateTimeOffset]::TryParse([string]$manifest.CreatedAtUtc,[ref]$stamp)) { $unmanaged += $file.FullName; continue }
            $completed += [pscustomobject]@{ Path=$file.FullName; Manifest=$manifestPath; CreatedAt=$stamp }
        } catch { $unmanaged += $file.FullName }
    }
    $ordered = @($completed | Sort-Object CreatedAt -Descending)
    $delete = @()
    if ($ordered.Count -gt $KeepLast) { $delete = @($ordered | Select-Object -Skip $KeepLast) }
    [pscustomobject]@{ Keep=@($ordered | Select-Object -First $KeepLast); Delete=$delete; Unmanaged=$unmanaged }
}

function Update-DarBackupSchedulerPayload([string]$SourceToolsPath) {
    $paths = Get-DarBackupSchedulerPaths
    $sourceLocalPostgres = Join-Path $SourceToolsPath 'LocalPostgres.ps1'
    $sourceSchedulerModule = Join-Path $SourceToolsPath 'BackupScheduler.ps1'
    $sourceRunner = Join-Path $SourceToolsPath 'Invoke-AutomatedBackup.ps1'
    if (-not (Test-Path -LiteralPath $sourceLocalPostgres -PathType Leaf) -or -not (Test-Path -LiteralPath $sourceSchedulerModule -PathType Leaf) -or -not (Test-Path -LiteralPath $sourceRunner -PathType Leaf)) {
        throw 'Cannot refresh the installed backup runner because one or more source scripts are missing.'
    }
    New-Item -ItemType Directory -Force -Path $paths.Root | Out-Null
    Copy-DarBackupPayloadAtomically -Source $sourceLocalPostgres -Destination $paths.LocalPostgres
    Copy-DarBackupPayloadAtomically -Source $sourceSchedulerModule -Destination $paths.SchedulerModule
    Copy-DarBackupPayloadAtomically -Source $sourceRunner -Destination $paths.Runner
    Write-DarAtomicJson -Path (Join-Path $paths.Root 'payload-version.json') -Value ([ordered]@{ Version='0.8.25.0'; UpdatedAtUtc=[DateTime]::UtcNow.ToString('o') })
    return $true
}
