$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$tempRoot = Join-Path $env:TEMP ('DarStorageCenterTest_' + [Guid]::NewGuid().ToString('N'))
$passed = 0
try {
    $modulePath = Join-Path $projectRoot 'tools\StorageCenter.ps1'
    if (-not (Test-Path -LiteralPath $modulePath -PathType Leaf)) { throw 'StorageCenter.ps1 is missing.' }
    $tokens = $null; $parseErrors = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile($modulePath,[ref]$tokens,[ref]$parseErrors)
    if ($parseErrors -and $parseErrors.Count -gt 0) { throw ('StorageCenter.ps1 parse error at line ' + $parseErrors[0].Extent.StartLineNumber + ': ' + $parseErrors[0].Message) }
    . $modulePath
    New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null

    $scanRoot = Join-Path $tempRoot 'scan'
    $nested = Join-Path $scanRoot 'nested'
    New-Item -ItemType Directory -Force -Path $nested | Out-Null
    [System.IO.File]::WriteAllBytes((Join-Path $scanRoot 'small.bin'),[byte[]]@(1,2,3))
    [System.IO.File]::WriteAllBytes((Join-Path $nested 'medium.bin'),[byte[]]@(1,2,3,4,5,6,7))
    [System.IO.File]::WriteAllBytes((Join-Path $scanRoot 'largest.bin'),[byte[]]@(1,2,3,4,5,6,7,8,9,10,11))
    $scan = Get-DarStorageDirectoryInventory -Path $scanRoot -DisplayPath 'Test/Scan' -ProjectRoot $tempRoot -MaxFiles 100 -LargestFileCount 3
    if (-not $scan.Complete -or $scan.Bytes -ne 21 -or $scan.FileCount -ne 3 -or $scan.DirectoryCount -ne 1) { throw ('Exact metrics failed: bytes={0}; files={1}; dirs={2}; complete={3}' -f $scan.Bytes,$scan.FileCount,$scan.DirectoryCount,$scan.Complete) }
    if ($scan.LargestFiles.Count -ne 3 -or $scan.LargestFiles[0].Name -ne 'largest.bin') { throw 'Largest-file ranking is incorrect.' }
    Write-Host 'PASS: Storage inventory returns exact recursive size, file and directory counts.' -ForegroundColor Green; $passed++

    $missing = Get-DarStorageDirectoryInventory -Path (Join-Path $tempRoot 'missing') -DisplayPath 'Test/Missing' -ProjectRoot $tempRoot
    if ($missing.Exists -or $missing.Complete -or $missing.Status -ne 'Missing' -or $missing.Bytes -ne 0 -or (Test-Path -LiteralPath (Join-Path $tempRoot 'missing'))) { throw 'Missing-path handling created a folder or returned an incorrect result.' }
    Write-Host 'PASS: Missing locations are reported as incomplete without creating directories.' -ForegroundColor Green; $passed++

    $limited = Get-DarStorageDirectoryInventory -Path $scanRoot -DisplayPath 'Test/Limited' -ProjectRoot $tempRoot -MaxFiles 1
    if (-not $limited.Limited -or $limited.Complete -or $limited.FileCount -ne 1 -or $limited.Status -ne 'Partial') { throw 'Per-location file limit is not reported as a partial lower-bound measurement.' }
    Write-Host 'PASS: Per-location file limit is enforced and marked as a partial measurement.' -ForegroundColor Green; $passed++

    $directoryLimitRoot = Join-Path $tempRoot 'directory-limit'
    New-Item -ItemType Directory -Force -Path $directoryLimitRoot | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $directoryLimitRoot 'one') | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $directoryLimitRoot 'two') | Out-Null
    $directoryLimited = Get-DarStorageDirectoryInventory -Path $directoryLimitRoot -DisplayPath 'Test/DirectoryLimit' -ProjectRoot $tempRoot -MaxFiles 100 -MaxDirectories 1
    if (-not $directoryLimited.Limited -or $directoryLimited.Complete -or $directoryLimited.Status -ne 'Partial' -or $directoryLimited.VisitedDirectoryEntries -ne 1) { throw 'Per-location directory-entry limit is not enforced and reported as partial.' }
    Write-Host 'PASS: Per-location directory-entry limit bounds trees with many empty directories.' -ForegroundColor Green; $passed++

    if (-not (Test-DarStoragePathContains -Parent $tempRoot -Child $scanRoot)) { throw 'Parent/child path overlap detection failed.' }
    if (Test-DarStoragePathContains -Parent $scanRoot -Child (Join-Path $tempRoot 'sibling')) { throw 'Sibling directories were incorrectly treated as overlapping.' }
    Write-Host 'PASS: Storage path overlap detection distinguishes nested paths from siblings.' -ForegroundColor Green; $passed++

    $programRoot = Join-Path $tempRoot 'Program'
    New-Item -ItemType Directory -Force -Path $programRoot | Out-Null
    $localBase = Join-Path $tempRoot 'LocalData'
    $syntheticPaths = [pscustomobject]@{
        Base=$localBase
        Runtime=(Join-Path $localBase 'Runtime\PostgreSQL\17')
        Data=(Join-Path $localBase 'Database\data')
        DatabaseFolder=(Join-Path $localBase 'Database')
        BackupFolder=(Join-Path $localBase 'Backups')
        Logs=(Join-Path $localBase 'Logs')
    }
    foreach ($folder in @((Join-Path $localBase 'Runtime'),$syntheticPaths.DatabaseFolder,$syntheticPaths.BackupFolder,$syntheticPaths.Logs,(Join-Path $localBase 'System\BackupScheduler'))) {
        New-Item -ItemType Directory -Force -Path $folder | Out-Null
    }
    [System.IO.File]::WriteAllBytes((Join-Path $localBase 'Runtime\runtime.bin'),[byte[]]@(1,2,3,4,5))
    [System.IO.File]::WriteAllBytes((Join-Path $syntheticPaths.DatabaseFolder 'database.bin'),[byte[]]@(1,2,3,4,5,6))
    [System.IO.File]::WriteAllBytes((Join-Path $syntheticPaths.BackupFolder 'backup.bin'),[byte[]]@(1,2,3,4,5,6,7))
    [System.IO.File]::WriteAllBytes((Join-Path $syntheticPaths.Logs 'log.bin'),[byte[]]@(1,2,3,4,5,6,7,8))
    [System.IO.File]::WriteAllBytes((Join-Path $localBase 'System\BackupScheduler\runner.bin'),[byte[]]@(1,2,3,4,5,6,7,8,9))
    [System.IO.File]::WriteAllBytes((Join-Path $programRoot 'program.bin'),[byte[]]@(1,2,3,4))
    $inventory = Get-DarStorageInventory -ProjectRoot $programRoot -LocalPaths $syntheticPaths -MaxFilesPerLocation 100
    if (-not $inventory.Report.readOnly -or $inventory.Report.locations.Count -ne 6) { throw 'Inventory report metadata or location count is incorrect.' }
    if ($inventory.Report.summary.measuredBytes -ne 39) { throw ('Independent location total is incorrect; expected 39 bytes, got ' + $inventory.Report.summary.measuredBytes) }
    $rawJson = $inventory.Report | ConvertTo-Json -Depth 9
    if ($rawJson.Contains($tempRoot) -or $rawJson.Contains($localBase) -or $rawJson.Contains('LocationHandles') -or $rawJson.Contains('FullPath')) { throw 'Exportable inventory report leaks an absolute path or an internal location handle.' }
    $storageNotesText = $inventory.Report.storageNotes -join ' '
    if ($storageNotesText -notmatch 'BYTEA' -or $storageNotesText -notmatch 'WAL' -or $storageNotesText -notmatch 'logical sum of FileInfo.Length') { throw 'Database and logical-file-size accounting notes are missing.' }
    Write-Host 'PASS: Full inventory totals independent roots once and exports sanitized paths.' -ForegroundColor Green; $passed++

    $volumeInventory = @(Get-DarStorageVolumeInventory -Paths @($scanRoot,$nested,(Join-Path $nested 'child')))
    if ($volumeInventory.Count -ne 1) { throw ('Volume inventory did not de-duplicate paths on the same volume; count=' + $volumeInventory.Count) }
    if ($volumeInventory[0].Root -ne [System.IO.Path]::GetPathRoot($scanRoot)) { throw 'Volume inventory returned an unexpected drive root.' }
    if ((Get-DarStorageFreeSpaceStatus -AvailableBytes (5GB - 1)) -ne 'Critical') { throw 'Critical free-space threshold is incorrect.' }
    if ((Get-DarStorageFreeSpaceStatus -AvailableBytes (5GB)) -ne 'Warning') { throw '5 GB boundary must be Warning.' }
    if ((Get-DarStorageFreeSpaceStatus -AvailableBytes (15GB - 1)) -ne 'Warning') { throw 'Warning free-space threshold is incorrect.' }
    if ((Get-DarStorageFreeSpaceStatus -AvailableBytes (15GB)) -ne 'Healthy') { throw '15 GB boundary must be Healthy.' }
    if ($inventory.Report.volumes.Count -ne 1) { throw 'Inventory report volume list was nested or duplicated.' }
    if ($inventory.Report.volumes[0].PSObject.Properties.Name -contains 'Label') { throw 'A user-defined volume label was exposed in the exportable report.' }
    if (-not ($inventory.Report.volumes[0].PSObject.Properties.Name -contains 'AvailableBytes')) { throw 'Volume report does not distinguish physical free space from current-user available space.' }
    if ($inventory.Report.volumes[0].Status -eq 'Ready') {
        $volume = $inventory.Report.volumes[0]
        if ($volume.UsedBytes -ne ($volume.TotalBytes - $volume.FreeBytes)) { throw 'Physical used bytes must equal total capacity minus physical free bytes.' }
        if ((Get-DarStorageFreeSpaceStatus -AvailableBytes $volume.AvailableBytes) -ne $volume.FreeSpaceStatus) { throw 'Volume pressure status must use current-user available bytes.' }
    }
    Write-Host 'PASS: Volume roots are de-duplicated, user-defined labels are hidden, physical/user-available space is distinguished, and thresholds are correct.' -ForegroundColor Green; $passed++

    $networkRootDisplay = ConvertTo-DarStorageVolumeDisplayRoot -Root '\\private-server\private-share\'
    if ($networkRootDisplay -ne '[Network volume]' -or $networkRootDisplay -match 'private-server|private-share') { throw 'Network share server/share names were exposed in volume display metadata.' }
    if ((ConvertTo-DarStorageVolumeDisplayRoot -Root 'C:\') -ne 'C:\') { throw 'A local drive root should remain visible for useful volume identification.' }
    Write-Host 'PASS: Network volume server/share names are masked while local drive roots remain useful.' -ForegroundColor Green; $passed++

    $missingBackupPaths = [pscustomobject]@{
        Base=$syntheticPaths.Base
        Runtime=$syntheticPaths.Runtime
        Data=$syntheticPaths.Data
        DatabaseFolder=$syntheticPaths.DatabaseFolder
        BackupFolder=(Join-Path $localBase 'NotCreatedBackups')
        Logs=$syntheticPaths.Logs
    }
    $missingAggregate = Get-DarStorageInventory -ProjectRoot $programRoot -LocalPaths $missingBackupPaths -MaxFilesPerLocation 100
    if (-not $missingAggregate.Report.summary.measuredBytesIsLowerBound -or $missingAggregate.Report.summary.missingLocations -ne 1) { throw 'A missing storage location was incorrectly presented as a complete aggregate.' }
    if (Test-Path -LiteralPath $missingBackupPaths.BackupFolder) { throw 'Missing backup location was created during inventory.' }
    Write-Host 'PASS: Missing storage locations mark the aggregate as a lower-bound measurement.' -ForegroundColor Green; $passed++

    # Force a parent/child overlap and verify the child is represented but not added twice.
    $overlapPaths = [pscustomobject]@{
        Base=$tempRoot
        Runtime=(Join-Path $tempRoot 'Runtime')
        Data=(Join-Path $tempRoot 'Database\data')
        DatabaseFolder=(Join-Path $tempRoot 'Database')
        BackupFolder=(Join-Path $tempRoot 'Backups')
        Logs=(Join-Path $tempRoot 'Logs')
    }
    $overlap = Get-DarStorageInventory -ProjectRoot $tempRoot -LocalPaths $overlapPaths -MaxFilesPerLocation 100
    if ($overlap.Report.summary.includedLocations -ne 5 -or $overlap.Report.locations[1].Status -ne 'Included' -or $overlap.Report.locations[1].Complete) { throw 'Nested locations were not represented as included without asserting an independent completeness result.' }
    Write-Host 'PASS: Nested storage roots are not double-counted in the aggregate.' -ForegroundColor Green; $passed++

    $outside = Join-Path $tempRoot 'outside-link-target'
    New-Item -ItemType Directory -Force -Path $outside | Out-Null
    [System.IO.File]::WriteAllBytes((Join-Path $outside 'outside.bin'),[byte[]](1..50))
    $junction = Join-Path $scanRoot 'junction'
    $junctionCreated = $false
    try {
        New-Item -ItemType Junction -Path $junction -Target $outside -ErrorAction Stop | Out-Null
        $junctionCreated = $true
    } catch {
        Write-Host 'SKIP: Windows did not allow creation of a junction in this environment; static reparse guards remain covered.' -ForegroundColor Yellow
    }
    if ($junctionCreated) {
        $linkedScan = Get-DarStorageDirectoryInventory -Path $scanRoot -DisplayPath 'Test/Link' -ProjectRoot $tempRoot -MaxFiles 100
        if ($linkedScan.Bytes -ne 21 -or $linkedScan.ReparsePointCount -lt 1 -or $linkedScan.Status -ne 'Partial' -or $linkedScan.Complete) { throw 'The scanner followed or failed to report a directory reparse point as a partial lower-bound measurement.' }
        $rootLink = Get-DarStorageDirectoryInventory -Path $junction -DisplayPath 'Test/RootLink' -ProjectRoot $tempRoot
        if ($rootLink.Status -ne 'UnsafeRoot' -or $rootLink.Bytes -ne 0) { throw 'A reparse-point root was traversed.' }
        $outsideChild = Join-Path $outside 'child'
        New-Item -ItemType Directory -Force -Path $outsideChild | Out-Null
        $ancestorLink = Get-DarStorageDirectoryInventory -Path (Join-Path $junction 'child') -DisplayPath 'Test/AncestorLink/child' -ProjectRoot $tempRoot -MaxFiles 100
        if ($ancestorLink.Status -ne 'UnsafeRoot' -or $ancestorLink.Bytes -ne 0) { throw 'A scan path below a reparse-point ancestor was traversed.' }
        Write-Host 'PASS: Directory reparse points and reparse-point ancestors are refused or skipped safely.' -ForegroundColor Green; $passed++
    }

    Write-Host ('PASS: Storage Center regression completed. Assertions=' + $passed) -ForegroundColor Green
    Write-Output 'DAR_TEST_RESULT=PASS'; exit 0
} catch {
    Write-Host ('FAIL: ' + $_.Exception.Message) -ForegroundColor Red
    Write-Output 'DAR_TEST_RESULT=FAIL'; exit 1
} finally {
    if (Test-Path -LiteralPath $tempRoot -PathType Container) { Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue }
}
