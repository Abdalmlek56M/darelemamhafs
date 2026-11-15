$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$tempRoot = Join-Path $env:TEMP ('DarStoragePathManagerTest-' + [Guid]::NewGuid().ToString('N'))
$passed = 0
$skips = 0
try {
    New-Item -ItemType Directory -Path $tempRoot -ErrorAction Stop | Out-Null
    $tempDrive = [System.IO.DriveInfo]::new([System.IO.Path]::GetPathRoot($tempRoot))
    if (-not $tempDrive.IsReady -or $tempDrive.DriveFormat -ne 'NTFS' -or $tempDrive.DriveType.ToString() -notin @('Fixed','Removable')) {
        throw 'Test 15 requires a ready local NTFS temporary volume because it verifies Windows ACLs and same-volume directory rename.'
    }
    $tools = Join-Path $projectRoot 'tools'
    . (Join-Path $tools 'LocalPostgres.ps1')
    . (Join-Path $tools 'BackupScheduler.ps1')
    . (Join-Path $tools 'StoragePathManager.ps1')
    $script:ArchiveValidationCalls = 0
    function Test-DarBackupArchive {
        param([Parameter(Mandatory=$true)][string]$BackupPath)
        if (-not (Test-Path -LiteralPath $BackupPath -PathType Leaf)) { throw 'Synthetic archive was not copied before validation.' }
        $script:ArchiveValidationCalls++
        return [pscustomobject]@{ Valid=$true }
    }

    $source = Join-Path $tempRoot 'source-backups'
    $target = Join-Path $tempRoot 'destination-backups'
    $targetParent = $tempRoot
    $localBase = Join-Path $tempRoot 'local-data'
    $programRoot = Join-Path $tempRoot 'program'
    New-Item -ItemType Directory -Path $source,(Join-Path $source 'nested'),$localBase,$programRoot -Force | Out-Null
    [System.IO.File]::WriteAllBytes((Join-Path $source 'one.bin'),[byte[]]@(1,2,3,4,5,6,7,8))
    [System.IO.File]::WriteAllBytes((Join-Path $source 'nested\two.bin'),[byte[]](11..40))
    [System.IO.File]::WriteAllBytes((Join-Path $source 'sample.backup'),[byte[]]@(101,102,103,104,105))

    $manifest = Get-DarStorageTreeManifest -Root $source
    if ($manifest.FileCount -ne 3 -or $manifest.DirectoryCount -ne 1 -or $manifest.TotalBytes -ne 43) { throw 'Source manifest file/directory/byte totals are wrong.' }
    Write-Host 'PASS: Backup tree manifest counts files, directories and bytes exactly.' -ForegroundColor Green; $passed++

    $sourceHash = (Get-FileHash -LiteralPath (Join-Path $source 'one.bin') -Algorithm SHA256).Hash
    $copy = Copy-DarStorageTreeWithVerification -Manifest $manifest -DestinationRoot $target
    if (-not $copy.Sha256Verified -or -not $copy.ArchivesValidated -or $copy.FileCount -ne 3 -or $copy.TotalBytes -ne 43) { throw 'Copy verification summary is incorrect.' }
    $targetHash = (Get-FileHash -LiteralPath (Join-Path $target 'one.bin') -Algorithm SHA256).Hash
    if ($sourceHash -ne $targetHash -or -not (Test-Path -LiteralPath (Join-Path $target 'nested\two.bin') -PathType Leaf) -or $copy.ArchiveCount -ne 1 -or $script:ArchiveValidationCalls -ne 1) { throw 'Copied files do not match source content or directory structure.' }
    if (-not (Test-Path -LiteralPath (Join-Path $source 'one.bin') -PathType Leaf)) { throw 'Source backup file was removed during copy verification.' }
    $destinationAcl = Get-Acl -LiteralPath $target
    $destinationSids = @($destinationAcl.Access | ForEach-Object { try { $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value } catch { '' } })
    foreach ($requiredSid in @([Security.Principal.WindowsIdentity]::GetCurrent().User.Value,'S-1-5-18','S-1-5-32-544')) {
        if ($requiredSid -notin $destinationSids) { throw ('Destination backup folder ACL is missing required principal SID ' + $requiredSid) }
    }
    Write-Host 'PASS: Copy pipeline preserves source, verifies SHA-256 and applies a private NTFS ACL.' -ForegroundColor Green; $passed++

    if (-not (Test-DarStoragePathContainsPath -Parent $tempRoot -Child $source)) { throw 'Parent-to-child path containment was not detected.' }
    if (Test-DarStoragePathContainsPath -Parent $source -Child (Join-Path $tempRoot 'source-backups-sibling')) { throw 'Sibling path was incorrectly treated as nested.' }
    Write-Host 'PASS: Path containment does not confuse sibling folders.' -ForegroundColor Green; $passed++
    $shortPathManifest = [pscustomobject]@{ Files=@([pscustomobject]@{ RelativePath='short.backup' }) }
    $longPathManifest = [pscustomobject]@{ Files=@([pscustomobject]@{ RelativePath=('x' * 260) }) }
    $pathLengthTarget = Join-Path $tempRoot 'path-length-parent\DarEltahfeez-Backups'
    if (-not (Test-DarStorageTargetPathLength -TargetFolder $pathLengthTarget -Manifest $shortPathManifest -MaximumLength 250)) { throw 'A short backup file path was incorrectly rejected.' }
    if (Test-DarStorageTargetPathLength -TargetFolder $pathLengthTarget -Manifest $longPathManifest -MaximumLength 250) { throw 'A destination file path longer than the Windows compatibility limit was accepted.' }
    $pathLengthParent = Split-Path -Parent $pathLengthTarget
    $stagePrefixLength = $pathLengthParent.TrimEnd('\','/').Length + 1 + '.DarEltahfeez-Backups-stage-'.Length + 32 + 1
    $finalPrefixLength = $pathLengthTarget.TrimEnd('\','/').Length + 1
    if ($stagePrefixLength -le $finalPrefixLength) { throw 'The test setup did not produce a longer staging path than final path.' }
    $stageOnlyManifest = [pscustomobject]@{ Files=@([pscustomobject]@{ RelativePath=('s' * [Math]::Max(1,(250 - $finalPrefixLength))) }) }
    if (Test-DarStorageTargetPathLength -TargetFolder $pathLengthTarget -Manifest $stageOnlyManifest -MaximumLength 250) { throw 'A path that fits the final directory but exceeds the longer staging path was accepted.' }
    Write-Host 'PASS: Path length checks cover final files and the longer GUID staging directory.' -ForegroundColor Green; $passed++

    New-Item -ItemType Directory -Path (Join-Path $tempRoot 'plan-parent') | Out-Null
    $validPlan = Get-DarBackupFolderMovePlan -SourceFolder $source -TargetFolder (Join-Path (Join-Path $tempRoot 'plan-parent') 'DarEltahfeez-Backups') -LocalBase $localBase -ProjectRoot $programRoot
    $drive = [System.IO.DriveInfo]::new([System.IO.Path]::GetPathRoot($tempRoot))
    if ($drive.IsReady -and $drive.DriveFormat -eq 'NTFS' -and $drive.DriveType.ToString() -in @('Fixed','Removable')) {
        if ($validPlan.AvailableBytes -lt $validPlan.RequiredBytes) {
            if ($validPlan.Ready -or (($validPlan.Issues -join ' ') -notmatch 'المساحة المتاحة')) { throw 'Move preflight did not reject a volume below the configured safety reserve.' }
            Write-Host 'PASS: Move preflight correctly blocks a test volume below the free-space safety reserve.' -ForegroundColor Green; $passed++
        } else {
            if (-not $validPlan.Ready) { throw ('Valid same-volume test plan unexpectedly failed: ' + ($validPlan.Issues -join '; ')) }
            if ($validPlan.FileCount -ne 3 -or $validPlan.TotalBytes -ne 43) { throw 'Move plan did not preserve the manifest summary.' }
            Write-Host 'PASS: Valid local NTFS destination passes move preflight and reports exact capacity requirements.' -ForegroundColor Green; $passed++
        }
    } else {
        if ($validPlan.Ready) { throw 'A destination on an unsupported test volume was incorrectly approved.' }
        Write-Host 'SKIP: Temporary volume is not a supported local NTFS volume; copy and safety tests still ran.' -ForegroundColor Yellow; $skips++
    }

    $relativePlan = Get-DarBackupFolderMovePlan -SourceFolder $source -TargetFolder 'relative\DarEltahfeez-Backups' -LocalBase $localBase -ProjectRoot $programRoot
    if ($relativePlan.Ready -or (($relativePlan.Issues -join ' ') -notmatch 'مسارًا مطلقًا')) { throw 'Move preflight accepted a plain relative destination path.' }
    Write-Host 'PASS: Move preflight rejects plain relative destination paths before normalization.' -ForegroundColor Green; $passed++

    $driveRelativePlan = Get-DarBackupFolderMovePlan -SourceFolder $source -TargetFolder 'C:relative\DarEltahfeez-Backups' -LocalBase $localBase -ProjectRoot $programRoot
    if ($driveRelativePlan.Ready -or (($driveRelativePlan.Issues -join ' ') -notmatch 'مسارًا مطلقًا')) { throw 'Move preflight accepted a drive-relative destination path.' }
    Write-Host 'PASS: Move preflight rejects drive-relative destination paths.' -ForegroundColor Green; $passed++

    $overlapPlan = Get-DarBackupFolderMovePlan -SourceFolder $source -TargetFolder (Join-Path $source 'DarEltahfeez-Backups') -LocalBase $localBase -ProjectRoot $programRoot
    if ($overlapPlan.Ready -or (($overlapPlan.Issues -join ' ') -notmatch 'تتداخل')) { throw 'A target nested beneath the source was not rejected.' }
    Write-Host 'PASS: Move preflight rejects source/target overlap.' -ForegroundColor Green; $passed++

    $baseTarget = Join-Path $localBase 'DarEltahfeez-Backups'
    $basePlan = Get-DarBackupFolderMovePlan -SourceFolder $source -TargetFolder $baseTarget -LocalBase $localBase -ProjectRoot $programRoot
    if ($basePlan.Ready -or (($basePlan.Issues -join ' ') -notmatch 'بيانات دار التحفيظ')) { throw 'A target inside LocalAppData data was not rejected.' }
    Write-Host 'PASS: Move preflight refuses destinations inside LocalAppData Dar data.' -ForegroundColor Green; $passed++

    $programTarget = Join-Path $programRoot 'DarEltahfeez-Backups'
    $programPlan = Get-DarBackupFolderMovePlan -SourceFolder $source -TargetFolder $programTarget -LocalBase $localBase -ProjectRoot $programRoot
    if ($programPlan.Ready -or (($programPlan.Issues -join ' ') -notmatch 'مجلد البرنامج')) { throw 'A target inside the program root was not rejected.' }
    Write-Host 'PASS: Move preflight refuses destinations inside the application package.' -ForegroundColor Green; $passed++

    $existingParent = Join-Path $tempRoot 'existing-parent'
    New-Item -ItemType Directory -Path (Join-Path $existingParent 'DarEltahfeez-Backups') -Force | Out-Null
    $existingPlan = Get-DarBackupFolderMovePlan -SourceFolder $source -TargetFolder (Join-Path $existingParent 'DarEltahfeez-Backups') -LocalBase $localBase -ProjectRoot $programRoot
    if ($existingPlan.Ready -or (($existingPlan.Issues -join ' ') -notmatch 'موجود بالفعل')) { throw 'An existing destination was not rejected.' }
    Write-Host 'PASS: Move preflight refuses to merge with or overwrite an existing destination.' -ForegroundColor Green; $passed++

    $orphanParent = Join-Path $tempRoot 'orphan-stage-parent'
    $orphanStagePath = Join-Path $orphanParent '.DarEltahfeez-Backups-stage-interrupted'
    New-Item -ItemType Directory -Path $orphanParent -Force | Out-Null
    New-Item -ItemType Directory -Path $orphanStagePath -Force | Out-Null
    [System.IO.File]::WriteAllText((Join-Path $orphanStagePath 'preserve-for-review.txt'),'abandoned synthetic stage')
    $orphanPlan = Get-DarBackupFolderMovePlan -SourceFolder $source -TargetFolder (Join-Path $orphanParent 'DarEltahfeez-Backups') -LocalBase $localBase -ProjectRoot $programRoot
    if ($orphanPlan.Ready -or (($orphanPlan.Issues -join ' ') -notmatch 'مجلد تجهيز من محاولة نقل سابقة غير مكتملة')) { throw 'Move preflight did not detect an abandoned staging directory.' }
    if (-not (Test-Path -LiteralPath (Join-Path $orphanStagePath 'preserve-for-review.txt') -PathType Leaf)) { throw 'Move preflight deleted or modified the abandoned staging directory; it must be retained for manual review.' }
    Write-Host 'PASS: Move preflight detects abandoned staging data and preserves it without automatic deletion.' -ForegroundColor Green; $passed++

    $partialSource = Join-Path $tempRoot 'partial-source'
    New-Item -ItemType Directory -Path $partialSource | Out-Null
    [System.IO.File]::WriteAllText((Join-Path $partialSource 'unfinished.backup.partial'),'incomplete')
    New-Item -ItemType Directory -Path (Join-Path $tempRoot 'partial-parent') | Out-Null
    $partialPlan = Get-DarBackupFolderMovePlan -SourceFolder $partialSource -TargetFolder (Join-Path (Join-Path $tempRoot 'partial-parent') 'DarEltahfeez-Backups') -LocalBase $localBase -ProjectRoot $programRoot
    if ($partialPlan.Ready -or (($partialPlan.Issues -join ' ') -notmatch 'غير مكتملة')) { throw 'Incomplete backup artifacts were not rejected.' }
    Write-Host 'PASS: Move preflight rejects partial, temporary or unfinished backup files.' -ForegroundColor Green; $passed++

    $tamperedManifest = Get-DarStorageTreeManifest -Root $source
    $tamperedManifest.Files[0].Sha256 = ('0' * 64)
    $tamperedTarget = Join-Path $tempRoot 'tampered-target'
    $tamperRejected = $false
    try { Copy-DarStorageTreeWithVerification -Manifest $tamperedManifest -DestinationRoot $tamperedTarget | Out-Null } catch { $tamperRejected = $true }
    if (-not $tamperRejected) { throw 'The copy pipeline accepted a source file that changed after manifest creation.' }
    Write-Host 'PASS: Copy pipeline detects source changes after manifest creation.' -ForegroundColor Green; $passed++

    # Exercise path configuration resolution with an isolated LocalAppData root.
    $savedLocalAppData = $env:LOCALAPPDATA
    try {
        $env:LOCALAPPDATA = Join-Path $tempRoot 'isolated-localappdata'
        $isolatedBase = Join-Path $env:LOCALAPPDATA 'DarEltahfeez'
        New-Item -ItemType Directory -Path $isolatedBase -Force | Out-Null
        $defaultPaths = Get-DarBackupLocationConfiguration -BasePath $isolatedBase
        if ($defaultPaths.IsCustom -or $defaultPaths.BackupFolder -ne (Join-Path $isolatedBase 'Backups')) { throw 'Default backup path resolution changed unexpectedly.' }
        $externalPath = Join-Path $tempRoot 'DarEltahfeez-Backups'
        $config = [ordered]@{ SchemaVersion=1; BackupFolder=$externalPath; BackupFolderHistory=@(@{Path=(Join-Path $isolatedBase 'Backups'); RetainedAtUtc='2026-10-31T00:00:00Z'; Reason='test'}) }
        Write-DarAtomicJson -Path $defaultPaths.ConfigPath -Value $config
        $customPaths = Get-DarBackupLocationConfiguration -BasePath $isolatedBase
        if (-not $customPaths.IsCustom -or $customPaths.BackupFolder -ne [IO.Path]::GetFullPath($externalPath) -or $customPaths.History.Count -ne 1) { throw 'Custom backup configuration or retained default path history did not resolve.' }
        $config.BackupFolder = Join-Path $isolatedBase 'Database'
        Write-DarAtomicJson -Path $defaultPaths.ConfigPath -Value $config
        $overlapRejected = $false
        try { Get-DarBackupLocationConfiguration -BasePath $isolatedBase | Out-Null } catch { $overlapRejected = $true }
        if (-not $overlapRejected) { throw 'A custom backup path inside the Dar data root was accepted.' }
        $config.BackupFolder = '\\private-server\share\backups'
        Write-DarAtomicJson -Path $defaultPaths.ConfigPath -Value $config
        $uncRejected = $false
        try { Get-DarBackupLocationConfiguration -BasePath $isolatedBase | Out-Null } catch { $uncRejected = $true }
        if (-not $uncRejected) { throw 'A UNC backup path was accepted by the path resolver.' }
        $config.BackupFolder = 'C:relative\DarEltahfeez-Backups'
        Write-DarAtomicJson -Path $defaultPaths.ConfigPath -Value $config
        $driveRelativeRejected = $false
        try { Get-DarBackupLocationConfiguration -BasePath $isolatedBase | Out-Null } catch { $driveRelativeRejected = $true }
        if (-not $driveRelativeRejected) { throw 'A drive-relative backup path was accepted by the path resolver.' }
        Write-Host 'PASS: Default/custom path resolution, retained history, LocalAppData overlap, UNC and drive-relative path rejection work in an isolated config.' -ForegroundColor Green; $passed++
    } finally { $env:LOCALAPPDATA = $savedLocalAppData }

    $pathManagerText = Get-Content -LiteralPath (Join-Path $tools 'StoragePathManager.ps1') -Raw -Encoding UTF8
    if ($pathManagerText -notmatch 'Global\\DarEltahfeez\.AutomaticBackup' -or $pathManagerText -notmatch 'Update-DarBackupSchedulerPayload' -or $pathManagerText -notmatch 'Write-DarAtomicJson' -or $pathManagerText -notmatch 'PreviousCopyRetained=\$true') { throw 'Relocation orchestration is missing shared backup lock, scheduler payload refresh, atomic config commit or retained-source evidence.' }
    if ($pathManagerText -match 'Remove-Item[^\r\n]*\$plan\.SourceFolder') { throw 'Relocation source folder must never be deleted by the move routine.' }
    if ($pathManagerText -notmatch '\[System\.IO\.Directory\]::Move' -or $pathManagerText -notmatch 'ظهرت وجهة موجودة أثناء النقل') { throw 'Relocation must use collision-safe Directory.Move and refuse a destination created during copying.' }
    Write-Host 'PASS: Relocation source guards require shared backup lock, scheduler payload refresh, atomic config commit, retained source and collision-safe final rename.' -ForegroundColor Green; $passed++

    # End-to-end relocation against an isolated LocalAppData and synthetic backup files.
    # The production LocalAppData, database, scheduler task and real backups are never used.
    # The production preflight requires at least 128 MiB of free space even for a tiny backup;
    # keep the deterministic unit/source checks green on nearly-full test volumes.
    $integrationDrive = [System.IO.DriveInfo]::new([System.IO.Path]::GetPathRoot($tempRoot))
    if ($integrationDrive.AvailableFreeSpace -lt 128MB) {
        Write-Host 'SKIP: Isolated end-to-end relocation needs the production 128 MiB safety reserve; source, copy/hash and path guards passed.' -ForegroundColor Yellow
        $skips++
    } else {
    $savedLocalAppData = $env:LOCALAPPDATA
    try {
        $integrationRoot = Join-Path $tempRoot 'move-integration'
        $integrationLocalAppData = Join-Path $integrationRoot 'localappdata'
        $integrationBase = Join-Path $integrationLocalAppData 'DarEltahfeez'
        $integrationSource = Join-Path $integrationBase 'Backups'
        $integrationTargetParent = Join-Path $integrationRoot 'target-parent'
        New-Item -ItemType Directory -Path $integrationSource,$integrationTargetParent -Force | Out-Null
        [System.IO.File]::WriteAllBytes((Join-Path $integrationSource 'synthetic.backup'),[byte[]]@(9,8,7,6,5,4,3,2,1))
        [System.IO.File]::WriteAllText((Join-Path $integrationSource 'synthetic.backup.json'),'{"Status":"completed","Synthetic":true}')
        $env:LOCALAPPDATA = $integrationLocalAppData
        $integrationScheduler = Get-DarBackupSchedulerPaths
        New-Item -ItemType Directory -Path $integrationScheduler.Root -Force | Out-Null
        Write-DarAtomicJson -Path $integrationScheduler.Config -Value ([ordered]@{ SchemaVersion=1; Enabled=$false; DailyTime='03:00'; RetentionCount=30; BackupFolder=$integrationSource })
        $integrationMutexName = 'Local\DarEltahfeez.StoragePathManagerTest.' + [Guid]::NewGuid().ToString('N')
        function Get-NetTCPConnection {
            [CmdletBinding()]
            param([int]$LocalPort,[string]$State)
            return @()
        }

        $integrationTarget = Join-Path $integrationTargetParent 'DarEltahfeez-Backups'
        $integrationResult = Invoke-DarBackupFolderRelocation -TargetFolder $integrationTarget -ProjectRoot $projectRoot -SourceToolsPath $tools -MutexName $integrationMutexName
        $activePaths = Get-DarLocalPaths
        if ($activePaths.BackupFolder -ne [IO.Path]::GetFullPath($integrationTarget) -or -not $integrationResult.PreviousCopyRetained) { throw 'End-to-end relocation did not commit the verified new backup path and retain its source.' }
        if (-not (Test-Path -LiteralPath (Join-Path $integrationSource 'synthetic.backup')) -or -not (Test-Path -LiteralPath (Join-Path $integrationTarget 'synthetic.backup'))) { throw 'End-to-end relocation did not retain source and destination backup files.' }
        $schedulerConfigAfterMove = Get-Content -LiteralPath $integrationScheduler.Config -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($schedulerConfigAfterMove.BackupFolder -ne [IO.Path]::GetFullPath($integrationTarget)) { throw 'The installed schedule metadata did not receive the new backup folder.' }
        foreach ($payloadFile in @($integrationScheduler.LocalPostgres,$integrationScheduler.SchedulerModule,$integrationScheduler.Runner)) { if (-not (Test-Path -LiteralPath $payloadFile -PathType Leaf)) { throw 'The installed scheduler payload was not refreshed during relocation.' } }
        $payloadVersion = Get-Content -LiteralPath (Join-Path $integrationScheduler.Root 'payload-version.json') -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($payloadVersion.Version -ne '0.8.25.0') { throw 'The installed scheduler payload version did not match the source release.' }
        Write-Host 'PASS: Isolated end-to-end relocation commits the new path, refreshes scheduler payload/metadata, verifies files and retains the original source.' -ForegroundColor Green; $passed++

        # Simulate a competing folder appearing after preflight but during copy.
        $collisionTarget = Join-Path (Join-Path $integrationRoot 'collision-parent') 'DarEltahfeez-Backups'
        New-Item -ItemType Directory -Path (Split-Path -Parent $collisionTarget) -Force | Out-Null
        $script:collisionCreated = $false
        $collisionProgress = {
            param($progress)
            if (-not $script:collisionCreated) {
                New-Item -ItemType Directory -Path $collisionTarget -Force | Out-Null
                [System.IO.File]::WriteAllText((Join-Path $collisionTarget 'do-not-touch.txt'),'created by competing actor')
                $script:collisionCreated = $true
            }
        }
        $collisionRejected = $false
        try { Invoke-DarBackupFolderRelocation -TargetFolder $collisionTarget -ProjectRoot $projectRoot -SourceToolsPath $tools -MutexName $integrationMutexName -OnProgress $collisionProgress | Out-Null } catch { $collisionRejected = $true }
        if (-not $collisionRejected -or -not (Test-Path -LiteralPath (Join-Path $collisionTarget 'do-not-touch.txt')) -or (Get-DarLocalPaths).BackupFolder -ne [IO.Path]::GetFullPath($integrationTarget)) { throw 'A destination created during the copy was not safely rejected or the active path changed.' }
        $remainingStages = @(Get-ChildItem -LiteralPath (Split-Path -Parent $collisionTarget) -Directory -Force -Filter '.DarEltahfeez-Backups-stage-*' -ErrorAction SilentlyContinue)
        if ($remainingStages.Count -gt 0) { throw 'The failed collision test left a temporary staging directory behind.' }
        Write-Host 'PASS: A destination created during copying is rejected without merging, deleting the competing folder or changing the active path.' -ForegroundColor Green; $passed++

        # Fail scheduler payload refresh after the verified target has been renamed; ensure rollback keeps the old active path.
        function Update-DarBackupSchedulerPayload {
            [CmdletBinding()]
            param([string]$SourceToolsPath)
            throw 'Synthetic scheduler payload refresh failure for rollback test.'
        }
        $rollbackTarget = Join-Path (Join-Path $integrationRoot 'rollback-parent') 'DarEltahfeez-Backups'
        New-Item -ItemType Directory -Path (Split-Path -Parent $rollbackTarget) -Force | Out-Null
        $rollbackRejected = $false
        try { Invoke-DarBackupFolderRelocation -TargetFolder $rollbackTarget -ProjectRoot $projectRoot -SourceToolsPath $tools -MutexName $integrationMutexName | Out-Null } catch { $rollbackRejected = $true }
        if (-not $rollbackRejected -or (Get-DarLocalPaths).BackupFolder -ne [IO.Path]::GetFullPath($integrationTarget) -or (Test-Path -LiteralPath $rollbackTarget)) { throw 'Relocation did not clean its uncommitted target and preserve the previously active backup path after a scheduler payload failure.' }
        if (-not (Test-Path -LiteralPath (Join-Path $integrationTarget 'synthetic.backup'))) { throw 'The previously active verified backup folder was removed during rollback.' }
        Write-Host 'PASS: Scheduler payload failure rolls back the uncommitted target and preserves the previously active backup folder.' -ForegroundColor Green; $passed++
    } finally { $env:LOCALAPPDATA = $savedLocalAppData }
    }
    Write-Host ('PASS: Backup path manager regression completed. Assertions=' + $passed + '; SKIP=' + $skips) -ForegroundColor Green
    Write-Output 'DAR_TEST_RESULT=PASS'
    exit 0
} catch {
    Write-Host ('FAIL: ' + $_.Exception.Message) -ForegroundColor Red
    Write-Output 'DAR_TEST_RESULT=FAIL'
    exit 1
} finally {
    if (Test-Path -LiteralPath $tempRoot -PathType Container) { Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue }
}
