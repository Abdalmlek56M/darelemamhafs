# Read-only storage inventory for Dar System Center.
# This module reports metadata only. It never reads file contents, connects to PostgreSQL,
# creates folders, moves files, deletes files, or changes service state.

function ConvertTo-DarStorageDisplayPath {
    param(
        [Parameter(Mandatory=$true)][string]$Path,
        [string]$ProjectRoot = '',
        [string]$LocalBase = ''
    )
    $full = [System.IO.Path]::GetFullPath($Path).TrimEnd([char[]]@([char]92,[char]47))
    foreach ($rootInfo in @(
        @{ Root=$ProjectRoot; Prefix='Project' },
        @{ Root=$LocalBase; Prefix='%LOCALAPPDATA%\DarEltahfeez' }
    )) {
        if ([string]::IsNullOrWhiteSpace([string]$rootInfo.Root)) { continue }
        $root = [System.IO.Path]::GetFullPath([string]$rootInfo.Root).TrimEnd([char[]]@([char]92,[char]47))
        if ([string]::Equals($full,$root,[System.StringComparison]::OrdinalIgnoreCase)) { return [string]$rootInfo.Prefix }
        $prefix = $root + [System.IO.Path]::DirectorySeparatorChar
        if ($full.StartsWith($prefix,[System.StringComparison]::OrdinalIgnoreCase)) {
            $relative = $full.Substring($prefix.Length).Replace([char]92,[char]47)
            return ([string]$rootInfo.Prefix + '/' + $relative)
        }
    }
    return '[External path hidden]'
}

function Test-DarStoragePathContains {
    param([Parameter(Mandatory=$true)][string]$Parent,[Parameter(Mandatory=$true)][string]$Child)
    $parentFull = [System.IO.Path]::GetFullPath($Parent).TrimEnd([char[]]@([char]92,[char]47))
    $childFull = [System.IO.Path]::GetFullPath($Child).TrimEnd([char[]]@([char]92,[char]47))
    if ([string]::Equals($parentFull,$childFull,[System.StringComparison]::OrdinalIgnoreCase)) { return $true }
    $prefix = $parentFull + [System.IO.Path]::DirectorySeparatorChar
    return $childFull.StartsWith($prefix,[System.StringComparison]::OrdinalIgnoreCase)
}

function Get-DarStorageReparseAncestor {
    [CmdletBinding()]
    param([Parameter(Mandatory=$true)][string]$Path)

    try { $current = [System.IO.Path]::GetFullPath($Path) }
    catch { return [pscustomobject]@{ Safe=$false; Status='Unknown'; Path='[Path could not be normalized]' } }

    while (-not [string]::IsNullOrWhiteSpace($current)) {
        try {
            $directory = [System.IO.DirectoryInfo]::new($current)
            $attributes = $directory.Attributes
            if (($attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
                return [pscustomobject]@{ Safe=$false; Status='ReparsePoint'; Path=$current }
            }
            $parent = $directory.Parent
            if ($null -eq $parent) { break }
            $current = $parent.FullName
        } catch {
            return [pscustomobject]@{ Safe=$false; Status='Unknown'; Path='[Ancestor metadata unavailable]' }
        }
    }
    return [pscustomobject]@{ Safe=$true; Status='Safe'; Path=$null }
}

function Get-DarStorageFreeSpaceStatus {
    [CmdletBinding()]
    param([Parameter(Mandatory=$true)][long]$AvailableBytes)
    if ($AvailableBytes -lt 5GB) { return 'Critical' }
    if ($AvailableBytes -lt 15GB) { return 'Warning' }
    return 'Healthy'
}

function ConvertTo-DarStorageVolumeDisplayRoot {
    [CmdletBinding()]
    param([Parameter(Mandatory=$true)][string]$Root)
    # A local drive root is useful and non-personal (for example C:\).
    # UNC server/share names may identify private infrastructure, so mask them.
    if ($Root -match '^[A-Za-z]:\\$') { return $Root }
    return '[Network volume]'
}

function Get-DarStorageDirectoryInventory {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)][string]$Path,
        [Parameter(Mandatory=$true)][string]$DisplayPath,
        [ValidateRange(1,2000000)][int]$MaxFiles = 200000,
        [ValidateRange(1,2000000)][int]$MaxDirectories = 200000,
        [ValidateRange(1,100)][int]$LargestFileCount = 10,
        [string]$ProjectRoot = '',
        [string]$LocalBase = '',
        [scriptblock]$OnProgress
    )

    $emptyLargest = @()
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        return [pscustomobject][ordered]@{
            Name=$DisplayPath; Path=$DisplayPath; Exists=$false; Status='Missing'; Complete=$false
            Bytes=[long]0; FileCount=[long]0; DirectoryCount=[long]0; ErrorCount=0
            ReparsePointCount=0; VisitedFileEntries=0; VisitedDirectoryEntries=0; Limited=$false; LargestFiles=$emptyLargest; Note='Folder is not present; no folder was created.'
        }
    }

    try {
        $rootFull = [System.IO.Path]::GetFullPath($Path)
        $rootInfo = [System.IO.DirectoryInfo]::new($rootFull)
        $pathSafety = Get-DarStorageReparseAncestor -Path $rootFull
        if (-not $pathSafety.Safe) {
            $safetyNote = if ($pathSafety.Status -eq 'ReparsePoint') { 'The scan root or one of its ancestors is a reparse point. It was not traversed.' } else { 'The scan root ancestry could not be verified safely. It was not traversed.' }
            return [pscustomobject][ordered]@{
                Name=$DisplayPath; Path=$DisplayPath; Exists=$true; Status='UnsafeRoot'; Complete=$false
                Bytes=[long]0; FileCount=[long]0; DirectoryCount=[long]0; ErrorCount=1
                ReparsePointCount=1; VisitedFileEntries=0; VisitedDirectoryEntries=0; Limited=$false; LargestFiles=$emptyLargest
                Note=$safetyNote
            }
        }
    } catch {
        return [pscustomobject][ordered]@{
            Name=$DisplayPath; Path=$DisplayPath; Exists=$true; Status='Partial'; Complete=$false
            Bytes=[long]0; FileCount=[long]0; DirectoryCount=[long]0; ErrorCount=1
            ReparsePointCount=0; VisitedFileEntries=0; VisitedDirectoryEntries=0; Limited=$false; LargestFiles=$emptyLargest; Note='Folder metadata could not be read.'
        }
    }

    [long]$bytes = 0
    [long]$fileCount = 0
    [long]$directoryCount = 0
    $errorCount = 0
    $reparseCount = 0
    $visitedFileEntries = 0
    $visitedDirectoryEntries = 0
    $limitReason = $null
    $limited = $false
    $pending = New-Object 'System.Collections.Generic.Stack[string]'
    $largest = New-Object 'System.Collections.Generic.List[object]'
    $pending.Push($rootInfo.FullName)

    while ($pending.Count -gt 0) {
        $current = $pending.Pop()
        try {
            foreach ($filePath in [System.IO.Directory]::EnumerateFiles($current,'*',[System.IO.SearchOption]::TopDirectoryOnly)) {
                if ($visitedFileEntries -ge $MaxFiles) { $limited = $true; $limitReason = 'Files'; break }
                $visitedFileEntries++
                try {
                    $fileInfo = [System.IO.FileInfo]::new([string]$filePath)
                    if (($fileInfo.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
                        $reparseCount++
                        continue
                    }
                    $length = [long]$fileInfo.Length
                    if ($length -gt ([long]::MaxValue - $bytes)) { $errorCount++; continue }
                    $bytes += $length
                    $fileCount++
                    if ($OnProgress -and ($fileCount % 5000 -eq 0)) { & $OnProgress ('Scanned ' + $fileCount + ' files in ' + $DisplayPath + '...') }
                    $fileDisplayPath = ConvertTo-DarStorageDisplayPath -Path $fileInfo.FullName -ProjectRoot $ProjectRoot -LocalBase $LocalBase
                    $largest.Add([pscustomobject]@{
                        Area=$DisplayPath; Name=$fileInfo.Name; SizeBytes=$length; Path=$fileDisplayPath
                    })
                    if ($largest.Count -gt ($LargestFileCount * 3)) {
                        $trimmed = @($largest | Sort-Object -Property SizeBytes -Descending | Select-Object -First $LargestFileCount)
                        $largest.Clear()
                        foreach ($entry in $trimmed) { $largest.Add($entry) }
                    }
                } catch { $errorCount++ }
            }
        } catch { $errorCount++ }
        if ($limited) { break }

        try {
            foreach ($directoryPath in [System.IO.Directory]::EnumerateDirectories($current,'*',[System.IO.SearchOption]::TopDirectoryOnly)) {
                if ($visitedDirectoryEntries -ge $MaxDirectories) { $limited = $true; $limitReason = 'Directories'; break }
                $visitedDirectoryEntries++
                try {
                    $directoryInfo = [System.IO.DirectoryInfo]::new([string]$directoryPath)
                    if (($directoryInfo.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
                        $reparseCount++
                        continue
                    }
                    $pending.Push($directoryInfo.FullName)
                    $directoryCount++
                    if ($OnProgress -and ($visitedDirectoryEntries % 5000 -eq 0)) { & $OnProgress ('Scanned ' + $visitedDirectoryEntries + ' directories in ' + $DisplayPath + '...') }
                } catch { $errorCount++ }
            }
        } catch { $errorCount++ }
        if ($limited) { break }
    }

    $complete = ($errorCount -eq 0 -and -not $limited -and $reparseCount -eq 0)
    $status = if ($complete) { 'Complete' } else { 'Partial' }
    $note = if ($limited -and $limitReason -eq 'Directories') { 'Directory-entry scan limit reached; measured size is a lower bound.' } elseif ($limited) { 'File-entry scan limit reached; measured size is a lower bound.' } elseif ($errorCount -gt 0) { 'Some entries could not be measured; measured size is a lower bound.' } elseif ($reparseCount -gt 0) { 'Reparse points were skipped; measured size excludes their targets and is a lower bound.' } else { 'Metadata-only scan completed.' }
    $top = @($largest | Sort-Object -Property SizeBytes -Descending | Select-Object -First $LargestFileCount)

    return [pscustomobject][ordered]@{
        Name=$DisplayPath; Path=$DisplayPath; Exists=$true; Status=$status; Complete=$complete
        Bytes=$bytes; FileCount=$fileCount; DirectoryCount=$directoryCount; ErrorCount=$errorCount
        ReparsePointCount=$reparseCount; VisitedFileEntries=$visitedFileEntries; VisitedDirectoryEntries=$visitedDirectoryEntries; Limited=$limited; LargestFiles=$top; Note=$note
    }
}

function Get-DarStorageVolumeInventory {
    [CmdletBinding()]
    param([string[]]$Paths)
    $roots = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($path in @($Paths)) {
        if ([string]::IsNullOrWhiteSpace([string]$path)) { continue }
        try {
            $full = [System.IO.Path]::GetFullPath([string]$path)
            $driveRoot = [System.IO.Path]::GetPathRoot($full)
            if (-not [string]::IsNullOrWhiteSpace($driveRoot)) { [void]$roots.Add($driveRoot) }
        } catch { }
    }
    $volumes = New-Object 'System.Collections.Generic.List[object]'
    foreach ($root in @($roots | Sort-Object)) {
        $displayRoot = ConvertTo-DarStorageVolumeDisplayRoot -Root ([string]$root)
        try {
            $drive = [System.IO.DriveInfo]::new([string]$root)
            if (-not $drive.IsReady) {
                $volumes.Add([pscustomobject]@{ Root=$displayRoot; Format=''; TotalBytes=$null; FreeBytes=$null; AvailableBytes=$null; UsedBytes=$null; Status='NotReady'; FreeSpaceStatus='Unknown' })
                continue
            }
            [long]$total = $drive.TotalSize
            [long]$physicalFree = $drive.TotalFreeSpace
            [long]$availableToUser = $drive.AvailableFreeSpace
            $volumes.Add([pscustomobject]@{
                Root=$displayRoot; Format=[string]$drive.DriveFormat
                TotalBytes=$total; FreeBytes=$physicalFree; AvailableBytes=$availableToUser
                UsedBytes=([long]($total - $physicalFree)); Status='Ready'
                # Thresholds use space available to this Windows account, which may be lower under disk quotas.
                FreeSpaceStatus=(Get-DarStorageFreeSpaceStatus -AvailableBytes $availableToUser)
            })
        } catch {
            $volumes.Add([pscustomobject]@{ Root=$displayRoot; Format=''; TotalBytes=$null; FreeBytes=$null; AvailableBytes=$null; UsedBytes=$null; Status='Unknown'; FreeSpaceStatus='Unknown' })
        }
    }
    return @($volumes.ToArray() | Sort-Object Root)
}

function Get-DarStorageInventory {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)][string]$ProjectRoot,
        [Parameter(Mandatory=$true)]$LocalPaths,
        [ValidateRange(1,2000000)][int]$MaxFilesPerLocation = 200000,
        [ValidateRange(1,2000000)][int]$MaxDirectoriesPerLocation = 200000,
        [scriptblock]$OnProgress
    )

    $localBase = [string]$LocalPaths.Base
    $schedulerRoot = Join-Path $localBase 'System\BackupScheduler'
    $targets = @(
        [pscustomobject]@{ Id='program'; Category='Application'; Name='Program folder'; Path=$ProjectRoot; Description='Complete extracted application folder, including source and generated dependencies/builds.' },
        [pscustomobject]@{ Id='runtime'; Category='Runtime'; Name='PostgreSQL runtime and downloads'; Path=(Join-Path $localBase 'Runtime'); Description='PostgreSQL engine binaries and runtime preparation files.' },
        [pscustomobject]@{ Id='database'; Category='Database'; Name='Database cluster and WAL'; Path=[string]$LocalPaths.DatabaseFolder; Description='Physical PostgreSQL database folder; WAL is included in this size.' },
        [pscustomobject]@{ Id='backups'; Category='Backup'; Name='Active backup archives'; Path=[string]$LocalPaths.BackupFolder; Description='Current manual and scheduled PostgreSQL custom archives and manifests.' },
        [pscustomobject]@{ Id='logs'; Category='Logs'; Name='Application and system logs'; Path=[string]$LocalPaths.Logs; Description='API, launcher, PostgreSQL, Test Center and System Center logs.' },
        [pscustomobject]@{ Id='scheduler'; Category='Runtime'; Name='Backup scheduler payload'; Path=$schedulerRoot; Description='Independent Task Scheduler runner and schedule configuration.' }
    )
    $historyIndex = 0
    foreach ($historyEntry in @($LocalPaths.BackupFolderHistory)) {
        if ($null -eq $historyEntry -or [string]::IsNullOrWhiteSpace([string]$historyEntry.Path)) { continue }
        $historyIndex++
        $targets += [pscustomobject]@{ Id=('previous-backups-' + $historyIndex); Category='Backup'; Name=('Previous backup copy ' + $historyIndex); Path=[string]$historyEntry.Path; Description='Retained previous backup folder. Kept as a recovery copy; it is never deleted automatically.' }
    }

    $normalized = New-Object 'System.Collections.Generic.List[object]'
    foreach ($target in $targets) {
        $fullPath = [System.IO.Path]::GetFullPath([string]$target.Path)
        $normalized.Add([pscustomobject]@{
            Id=$target.Id; Category=$target.Category; Name=$target.Name; Path=$fullPath
            DisplayPath=(ConvertTo-DarStorageDisplayPath -Path $fullPath -ProjectRoot $ProjectRoot -LocalBase $localBase)
            Description=$target.Description
        })
    }

    # Do not count a nested location twice. The shortest parent path is measured first.
    $orderedTargets = @($normalized | Sort-Object { $_.Path.Length })
    $scannedRoots = New-Object 'System.Collections.Generic.List[object]'
    $locations = New-Object 'System.Collections.Generic.List[object]'
    $handles = New-Object 'System.Collections.Generic.List[object]'
    $largestAll = New-Object 'System.Collections.Generic.List[object]'
    foreach ($target in $orderedTargets) {
        if ($OnProgress) { & $OnProgress ('Measuring ' + $target.Name + '...') }
        $parent = $null
        foreach ($alreadyScanned in $scannedRoots) {
            if (Test-DarStoragePathContains -Parent $alreadyScanned.Path -Child $target.Path) { $parent = $alreadyScanned; break }
        }
        if ($parent) {
            $location = [pscustomobject][ordered]@{
                Id=$target.Id; Category=$target.Category; Name=$target.Name; Path=$target.DisplayPath
                Status='Included'; Complete=$false; Bytes=$null; FileCount=$null; DirectoryCount=$null
                ErrorCount=0; ReparsePointCount=0; VisitedFileEntries=0; VisitedDirectoryEntries=0
                Limited=$false; IncludedIn=$parent.Name
                Description=$target.Description; Note=('Nested path is already included in ' + $parent.Name + '; it is not added again. Review the parent scan status to determine completeness.')
                LargestFiles=@()
            }
        } else {
            $metrics = Get-DarStorageDirectoryInventory -Path $target.Path -DisplayPath $target.DisplayPath -MaxFiles $MaxFilesPerLocation -MaxDirectories $MaxDirectoriesPerLocation -LargestFileCount 10 -ProjectRoot $ProjectRoot -LocalBase $localBase -OnProgress $OnProgress
            $location = [pscustomobject][ordered]@{
                Id=$target.Id; Category=$target.Category; Name=$target.Name; Path=$target.DisplayPath
                Status=$metrics.Status; Complete=$metrics.Complete; Bytes=$metrics.Bytes
                FileCount=$metrics.FileCount; DirectoryCount=$metrics.DirectoryCount
                ErrorCount=$metrics.ErrorCount; ReparsePointCount=$metrics.ReparsePointCount
                VisitedFileEntries=$metrics.VisitedFileEntries; VisitedDirectoryEntries=$metrics.VisitedDirectoryEntries
                Limited=$metrics.Limited; IncludedIn=$null; Description=$target.Description
                Note=$metrics.Note; LargestFiles=@($metrics.LargestFiles)
            }
            if ($metrics.Exists -and $metrics.Status -ne 'UnsafeRoot') { $scannedRoots.Add($target) }
            foreach ($file in @($metrics.LargestFiles)) { $largestAll.Add($file) }
        }
        $locations.Add($location)
        # Actual file-system paths are retained only in a separate in-memory handle list;
        # the report/JSON contains display paths only.
        $handles.Add([pscustomobject]@{ Id=$target.Id; FullPath=$target.Path; Exists=(Test-Path -LiteralPath $target.Path -PathType Container) })
    }

    $componentSpecs = @(
        @{ Id='frontend-dependencies'; Name='Frontend dependencies'; Relative='frontend\node_modules' },
        @{ Id='frontend-output'; Name='Frontend build output'; Relative='frontend\dist' },
        @{ Id='api-build'; Name='API build output'; Relative='backend\DarEltahfeez.Api\bin' },
        @{ Id='api-publish'; Name='API publish output'; Relative='backend\DarEltahfeez.Api\publish' },
        @{ Id='desktop-build'; Name='Desktop build output'; Relative='desktop-host\bin' },
        @{ Id='desktop-publish'; Name='Desktop publish output'; Relative='desktop-host\publish' },
        @{ Id='webview-cache'; Name='WebView2 cache'; Relative='desktop-host\bin\Debug\net10.0-windows\DarEltahfeez.Desktop.exe.WebView2' }
    )
    $components = foreach ($component in $componentSpecs) {
        $componentPath = Join-Path $ProjectRoot $component.Relative
        [pscustomobject]@{
            Id=$component.Id; Name=$component.Name
            Path=(ConvertTo-DarStorageDisplayPath -Path $componentPath -ProjectRoot $ProjectRoot -LocalBase $localBase)
            Exists=(Test-Path -LiteralPath $componentPath -PathType Container)
            IncludedIn='program'; Measurement='Reference only; already included in Program folder size.'
        }
    }

    $measuredBytes = [long]0
    $incomplete = $false
    foreach ($location in $locations) {
        if ($location.Status -in @('Partial','UnsafeRoot','Missing')) { $incomplete = $true }
        if ($null -ne $location.Bytes) {
            if ([long]$location.Bytes -le ([long]::MaxValue - $measuredBytes)) { $measuredBytes += [long]$location.Bytes }
            else { $incomplete = $true }
        }
    }
    $volumePaths = @($orderedTargets | ForEach-Object { $_.Path })
    $volumes = @(Get-DarStorageVolumeInventory -Paths $volumePaths)
    $largestFiles = @($largestAll | Sort-Object -Property SizeBytes -Descending | Select-Object -First 20)
    $report = [pscustomobject][ordered]@{
        schemaVersion='1.0'
        applicationVersion='0.8.25.0'
        generatedAt=[DateTimeOffset]::Now.ToString('o')
        readOnly=$true
        scanPolicy=[pscustomobject]@{
            maxFilesPerLocation=$MaxFilesPerLocation
            maxDirectoriesPerLocation=$MaxDirectoriesPerLocation
            followsReparsePoints=$false
            readsFileContents=$false
            createsOrDeletesFiles=$false
            databaseConnections=$false
            sqlExecuted=$false
            overlappingPathsCountedOnce=$true
        }
        summary=[pscustomobject]@{
            measuredBytes=$measuredBytes
            measuredBytesIsLowerBound=$incomplete
            locationCount=$locations.Count
            completeLocations=@($locations | Where-Object { $_.Status -eq 'Complete' }).Count
            partialLocations=@($locations | Where-Object { $_.Status -eq 'Partial' -or $_.Status -eq 'UnsafeRoot' }).Count
            missingLocations=@($locations | Where-Object { $_.Status -eq 'Missing' }).Count
            includedLocations=@($locations | Where-Object { $_.Status -eq 'Included' }).Count
            readyVolumes=@($volumes | Where-Object { $_.Status -eq 'Ready' }).Count
            unavailableVolumes=@($volumes | Where-Object { $_.Status -ne 'Ready' }).Count
            criticalVolumes=@($volumes | Where-Object { $_.FreeSpaceStatus -eq 'Critical' }).Count
            warningVolumes=@($volumes | Where-Object { $_.FreeSpaceStatus -eq 'Warning' }).Count
        }
        locations=@($locations.ToArray())
        components=@($components)
        volumes=$volumes
        largestFiles=$largestFiles
        storageNotes=@(
            'WAL files are contained inside the PostgreSQL Database data directory and are not counted a second time.',
            'Payment receipts, user avatars and the school logo are stored as PostgreSQL BYTEA values; their storage is included in the Database cluster folder and is not a separate file directory.',
            'Frontend dist, node_modules, API/Desktop build outputs and WebView2 cache are subdirectories of the Program folder. They are shown as references and are not added again.',
            'Volume FreeBytes is physical free capacity; AvailableBytes is space available to the current Windows account and is used for warning thresholds because quotas may apply.',
            'Folder bytes are the logical sum of FileInfo.Length; NTFS compression, sparse allocation and file-system metadata can make allocated disk usage different.',
            'A partial scan is a lower-bound measurement because inaccessible entries, skipped reparse points, or either per-location file/directory-entry limit prevented a complete count.'
        )
    }
    return [pscustomobject]@{ Report=$report; LocationHandles=@($handles.ToArray()) }
}

function Get-DarStorageLocationHandle {
    param([Parameter(Mandatory=$true)]$Inventory,[Parameter(Mandatory=$true)][string]$Id)
    return @($Inventory.LocationHandles | Where-Object { $_.Id -eq $Id } | Select-Object -First 1)[0]
}
