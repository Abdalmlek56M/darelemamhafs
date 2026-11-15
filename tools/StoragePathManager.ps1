# Safe backup-folder relocation and path configuration for Dar System Center.
# Only PostgreSQL backup archives are relocatable in this release. Database, Runtime and Logs remain fixed.

function Test-DarStoragePathContainsPath([string]$Parent,[string]$Child) {
    $parentFull = [IO.Path]::GetFullPath($Parent)
    $childFull = [IO.Path]::GetFullPath($Child)
    $parentRoot = [IO.Path]::GetPathRoot($parentFull)
    $childRoot = [IO.Path]::GetPathRoot($childFull)
    $parentKey = if ($parentFull.TrimEnd('\','/') -eq $parentRoot.TrimEnd('\','/')) { $parentRoot } else { $parentFull.TrimEnd('\','/') + [IO.Path]::DirectorySeparatorChar }
    $childKey = if ($childFull.TrimEnd('\','/') -eq $childRoot.TrimEnd('\','/')) { $childRoot } else { $childFull.TrimEnd('\','/') + [IO.Path]::DirectorySeparatorChar }
    if ([string]::Equals($parentKey.TrimEnd('\','/'),$childKey.TrimEnd('\','/'),[StringComparison]::OrdinalIgnoreCase)) { return $true }
    return $childKey.StartsWith($parentKey,[StringComparison]::OrdinalIgnoreCase)
}


function Test-DarStorageTargetPathLength([string]$TargetFolder,$Manifest,[int]$MaximumLength = 250) {
    $targetFull = [IO.Path]::GetFullPath($TargetFolder)
    $longestRelativePath = 0
    foreach ($manifestFile in @($Manifest.Files)) {
        $relativeLength = ([string]$manifestFile.RelativePath).Length
        if ($relativeLength -gt $longestRelativePath) { $longestRelativePath = $relativeLength }
    }
    $targetDirectoryLength = $targetFull.TrimEnd('\','/').Length
    $targetLongestFilePath = $targetDirectoryLength + 1 + $longestRelativePath

    # The temporary stage name is longer than the final folder name and is used
    # while every file is copied. Check it too, including the 32-character GUID.
    $targetParent = [IO.Path]::GetDirectoryName($targetFull)
    $stageNamePrefix = '.DarEltahfeez-Backups-stage-'
    $stageDirectoryLength = $targetParent.TrimEnd('\','/').Length + 1 + $stageNamePrefix.Length + 32
    $stageLongestFilePath = $stageDirectoryLength + 1 + $longestRelativePath
    return ($targetDirectoryLength -le $MaximumLength -and
            $stageDirectoryLength -le $MaximumLength -and
            $targetLongestFilePath -le $MaximumLength -and
            $stageLongestFilePath -le $MaximumLength)
}

function Get-DarStoragePathReparseAncestor([string]$Path) {
    $full = [IO.Path]::GetFullPath($Path)
    $cursor = $full
    while (-not [string]::IsNullOrWhiteSpace($cursor)) {
        if (Test-Path -LiteralPath $cursor) {
            try {
                $item = Get-Item -LiteralPath $cursor -Force -ErrorAction Stop
                if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { return $cursor }
            } catch { return $cursor }
        }
        $parent = [IO.Directory]::GetParent($cursor)
        if ($null -eq $parent) { break }
        $next = $parent.FullName
        if ([string]::Equals($next,$cursor,[StringComparison]::OrdinalIgnoreCase)) { break }
        $cursor = $next
    }
    return $null
}

function Get-DarStorageTreeManifest {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)][string]$Root,
        [ValidateRange(1,1000000)][int]$MaxFiles = 200000,
        [ValidateRange(1,1000000)][int]$MaxDirectories = 200000
    )
    $rootFull = [IO.Path]::GetFullPath($Root)
    if (-not (Test-Path -LiteralPath $rootFull -PathType Container)) { throw 'مجلد النسخ الحالي غير موجود أو غير متاح.' }
    $unsafe = Get-DarStoragePathReparseAncestor -Path $rootFull
    if ($unsafe) { throw ('تم رفض مسار النسخ لأنه يمر عبر Reparse Point: ' + $unsafe) }
    $files = New-Object 'System.Collections.Generic.List[object]'
    $directories = New-Object 'System.Collections.Generic.List[string]'
    $stack = New-Object 'System.Collections.Generic.Stack[string]'
    $stack.Push($rootFull)
    [long]$totalBytes = 0
    while ($stack.Count -gt 0) {
        $current = $stack.Pop()
        foreach ($entry in [IO.Directory]::EnumerateFileSystemEntries($current)) {
            $attributes = [IO.File]::GetAttributes($entry)
            if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw ('تم رفض النقل لوجود Reparse Point داخل مجلد النسخ: ' + [IO.Path]::GetFileName($entry)) }
            if (($attributes -band [IO.FileAttributes]::Directory) -ne 0) {
                if ($directories.Count -ge $MaxDirectories) { throw ('تجاوز مجلد النسخ حد المجلدات ' + $MaxDirectories + '; لم يبدأ النقل.') }
                $directories.Add($entry)
                $stack.Push($entry)
            } else {
                if ($files.Count -ge $MaxFiles) { throw ('تجاوز مجلد النسخ حد الملفات ' + $MaxFiles + '; لم يبدأ النقل.') }
                $fileInfo = New-Object IO.FileInfo($entry)
                if ($fileInfo.Name -match '(?i)(\.partial|\.tmp|\.new)$') { throw ('توجد نسخة أو عملية مؤقتة غير مكتملة داخل مجلد النسخ: ' + $fileInfo.Name + '. أنهِ العملية أولًا.') }
                if ([long]$fileInfo.Length -gt ([long]::MaxValue - $totalBytes)) { throw 'إجمالي أحجام الملفات يتجاوز الحد الرقمي المدعوم.' }
                $hash = (Get-FileHash -LiteralPath $entry -Algorithm SHA256 -ErrorAction Stop).Hash.ToLowerInvariant()
                $relative = $entry.Substring($rootFull.TrimEnd('\','/').Length).TrimStart('\','/')
                $files.Add([pscustomobject]@{ SourcePath=$entry; RelativePath=$relative; Length=[long]$fileInfo.Length; Sha256=$hash; LastWriteTimeUtc=$fileInfo.LastWriteTimeUtc })
                $totalBytes += [long]$fileInfo.Length
            }
        }
    }
    return [pscustomobject]@{ Root=$rootFull; Files=@($files.ToArray()); Directories=@($directories.ToArray()); FileCount=$files.Count; DirectoryCount=$directories.Count; TotalBytes=$totalBytes }
}

function Get-DarBackupFolderMovePlan {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)][string]$SourceFolder,
        [Parameter(Mandatory=$true)][string]$TargetFolder,
        [Parameter(Mandatory=$true)][string]$LocalBase,
        [Parameter(Mandatory=$true)][string]$ProjectRoot
    )
    $issues = New-Object 'System.Collections.Generic.List[string]'
    $manifest = $null
    $sourceFull = $null
    $targetFull = $null
    try { $sourceFull = [IO.Path]::GetFullPath($SourceFolder) } catch { $issues.Add('مسار النسخ الحالي غير صالح.'); }
    # Validate the caller's original input BEFORE GetFullPath. GetFullPath would
    # resolve drive-relative paths (for example C:folder) against process state.
    # Only a fully-qualified local drive path is eligible for normalization.
    if ($TargetFolder -notmatch '^[A-Za-z]:\\') {
        $issues.Add('الوجهة يجب أن تكون مسارًا مطلقًا يبدأ بحرف قرص ثم \؛ تم رفض المسارات النسبية ومشاركات الشبكة.');
    } else {
        try { $targetFull = [IO.Path]::GetFullPath($TargetFolder) } catch { $issues.Add('مسار الوجهة غير صالح.'); }
    }
    if ($sourceFull -and -not (Test-Path -LiteralPath $sourceFull -PathType Container)) { $issues.Add('مجلد النسخ الحالي غير موجود.'); }
    if ($targetFull) {
        $targetLeaf = [IO.Path]::GetFileName($targetFull.TrimEnd('\','/'))
        if ($targetLeaf -ne 'DarEltahfeez-Backups') { $issues.Add('اسم مجلد الوجهة يجب أن يكون DarEltahfeez-Backups؛ اختر المجلد الأب من نافذة الاختيار.') }
        if ($targetFull -match '^(?:\\\\|//)') { $issues.Add('مشاركات الشبكة غير مدعومة في هذه المرحلة؛ اختر قرصًا محليًا.'); }
        if (-not [IO.Path]::IsPathRooted($targetFull) -or [IO.Path]::GetPathRoot($targetFull) -notmatch '^[A-Za-z]:\\$') { $issues.Add('الوجهة يجب أن تكون داخل قرص Windows محلي بحرف محرك.'); }
        $root = [IO.Path]::GetPathRoot($targetFull)
        if ($targetFull.TrimEnd('\','/') -eq $root.TrimEnd('\','/')) { $issues.Add('لا يمكن اختيار جذر القرص وجهةً للنسخ.'); }
        if (Test-Path -LiteralPath $targetFull) { $issues.Add('مجلد الوجهة موجود بالفعل؛ اختر مكانًا جديدًا حتى لا يتم دمج الملفات أو استبدالها.'); }
        $targetParent = [IO.Path]::GetDirectoryName($targetFull)
        if (-not (Test-Path -LiteralPath $targetParent -PathType Container)) { $issues.Add('المجلد الأب للوجهة غير موجود.'); }
        elseif (Get-DarStoragePathReparseAncestor -Path $targetParent) { $issues.Add('المجلد الأب للوجهة أو أحد أسلافه Reparse Point؛ تم رفض النقل.'); }
        if (Test-Path -LiteralPath $targetParent -PathType Container) {
            $abandonedStages = @(Get-ChildItem -LiteralPath $targetParent -Directory -Force -Filter '.DarEltahfeez-Backups-stage-*' -ErrorAction SilentlyContinue)
            if ($abandonedStages.Count -gt 0) { $issues.Add('عُثر على مجلد تجهيز من محاولة نقل سابقة غير مكتملة. لم يُحذف تلقائيًا؛ راجعه يدويًا قبل إعادة المحاولة.'); }
        }
        if ($sourceFull -and ((Test-DarStoragePathContainsPath -Parent $sourceFull -Child $targetFull) -or (Test-DarStoragePathContainsPath -Parent $targetFull -Child $sourceFull))) { $issues.Add('الوجهة تتداخل مع مجلد النسخ الحالي.'); }
        if ((Test-DarStoragePathContainsPath -Parent $LocalBase -Child $targetFull) -or (Test-DarStoragePathContainsPath -Parent $targetFull -Child $LocalBase)) { $issues.Add('الوجهة تتداخل مع بيانات دار التحفيظ الأساسية؛ اختر مكانًا مستقلًا.'); }
        if ((Test-DarStoragePathContainsPath -Parent $ProjectRoot -Child $targetFull) -or (Test-DarStoragePathContainsPath -Parent $targetFull -Child $ProjectRoot)) { $issues.Add('الوجهة تتداخل مع مجلد البرنامج؛ اختر مكانًا مستقلًا.'); }
        if ($targetFull.Length -gt 220) { $issues.Add('مسار الوجهة طويل جدًا بالنسبة لبعض أدوات Windows PowerShell 5.1.'); }
    }
    if ($sourceFull -and (Test-Path -LiteralPath $sourceFull -PathType Container)) {
        try { $manifest = Get-DarStorageTreeManifest -Root $sourceFull } catch { $issues.Add($_.Exception.Message) }
    }
    if ($targetFull -and $manifest -and -not (Test-DarStorageTargetPathLength -TargetFolder $targetFull -Manifest $manifest -MaximumLength 250)) {
        $issues.Add('أحد أسماء الملفات سيجعل المسار النهائي أطول من حد الأمان 250 حرفًا في Windows PowerShell 5.1؛ اختر مجلدًا أقرب إلى جذر القرص.')
    }
    $driveFormat = ''
    $driveType = ''
    [long]$availableBytes = 0
    [long]$requiredBytes = 0
    if ($targetFull -and [IO.Path]::GetPathRoot($targetFull) -match '^[A-Za-z]:\\$') {
        try {
            $drive = [System.IO.DriveInfo]::new([IO.Path]::GetPathRoot($targetFull))
            if (-not $drive.IsReady) { $issues.Add('القرص الهدف غير متاح حاليًا.'); }
            else {
                $driveFormat = [string]$drive.DriveFormat
                $driveType = [string]$drive.DriveType
                $availableBytes = [long]$drive.AvailableFreeSpace
                if ($driveFormat -ne 'NTFS') { $issues.Add('يجب أن يكون القرص الهدف NTFS لحماية صلاحيات الوصول إلى النسخ الاحتياطية.'); }
                if ($driveType -notin @('Fixed','Removable')) { $issues.Add('نوع القرص غير مدعوم لتخزين نسخ الدار.'); }
            }
        } catch { $issues.Add('تعذر قراءة معلومات القرص الهدف: ' + $_.Exception.Message) }
    }
    if ($manifest) {
        $reserve = [long][Math]::Max(128MB,[Math]::Ceiling([double]$manifest.TotalBytes * 0.05))
        if ($manifest.TotalBytes -gt ([long]::MaxValue - $reserve)) { $requiredBytes = [long]::MaxValue } else { $requiredBytes = [long]($manifest.TotalBytes + $reserve) }
        if ($availableBytes -lt $requiredBytes) { $issues.Add('المساحة المتاحة على القرص الهدف لا تكفي لحجم النسخ مع هامش أمان 5% أو 128 MiB أيهما أكبر.') }
    }
    $fileCount = 0; $directoryCount = 0; [long]$totalBytes = 0
    if ($manifest) { $fileCount = [int]$manifest.FileCount; $directoryCount = [int]$manifest.DirectoryCount; $totalBytes = [long]$manifest.TotalBytes }
    return [pscustomobject]@{
        Ready=($issues.Count -eq 0); Issues=@($issues.ToArray()); SourceFolder=$sourceFull; TargetFolder=$targetFull
        FileCount=$fileCount
        DirectoryCount=$directoryCount
        TotalBytes=$totalBytes
        RequiredBytes=$requiredBytes; AvailableBytes=$availableBytes; DriveFormat=$driveFormat; DriveType=$driveType
        Manifest=$manifest
    }
}

function Set-DarStorageDirectoryPrivateAcl([string]$Path) {
    $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    if ($null -eq $currentSid) { throw 'تعذر تحديد حساب Windows الحالي لتأمين مجلد النسخ.' }
    $systemSid = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
    $adminsSid = [Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
    $acl = [Security.AccessControl.DirectorySecurity]::new()
    $acl.SetAccessRuleProtection($true,$false)
    $acl.SetOwner($currentSid)
    $inheritance = [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit
    foreach ($sid in @($currentSid,$systemSid,$adminsSid)) {
        $rule = [Security.AccessControl.FileSystemAccessRule]::new($sid,[Security.AccessControl.FileSystemRights]::FullControl,$inheritance,[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow)
        [void]$acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $Path -AclObject $acl -ErrorAction Stop
}

function Copy-DarStorageTreeWithVerification {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)]$Manifest,
        [Parameter(Mandatory=$true)][string]$DestinationRoot,
        [scriptblock]$OnProgress
    )
    if (Test-Path -LiteralPath $DestinationRoot) { throw 'مجلد التجهيز موجود بالفعل؛ لن يتم استبداله.' }
    $destinationParent = Split-Path -Parent $DestinationRoot
    if (Get-DarStoragePathReparseAncestor -Path $destinationParent) { throw 'تم رفض النسخ لأن المجلد الأب للوجهة أو أحد أسلافه أصبح Reparse Point.' }
    if (Get-DarStoragePathReparseAncestor -Path $Manifest.Root) { throw 'تم رفض النسخ لأن مسار المصدر أو أحد أسلافه أصبح Reparse Point بعد إنشاء الخطة.' }
    New-Item -ItemType Directory -Path $DestinationRoot -ErrorAction Stop | Out-Null
    Set-DarStorageDirectoryPrivateAcl -Path $DestinationRoot
    foreach ($relativeDirectory in @($Manifest.Directories)) {
        $targetDirectory = Join-Path $DestinationRoot ($relativeDirectory.Substring($Manifest.Root.TrimEnd('\','/').Length).TrimStart('\','/'))
        New-Item -ItemType Directory -Path $targetDirectory -Force -ErrorAction Stop | Out-Null
    }
    $copied = 0
    [long]$copiedBytes = 0
    foreach ($file in @($Manifest.Files)) {
        $targetFile = Join-Path $DestinationRoot $file.RelativePath
        $targetParent = Split-Path -Parent $targetFile
        if (-not (Test-Path -LiteralPath $targetParent -PathType Container)) { New-Item -ItemType Directory -Path $targetParent -Force -ErrorAction Stop | Out-Null }
        if (Test-Path -LiteralPath $targetFile) { throw ('ملف الوجهة موجود بالفعل ولن يتم استبداله: ' + $file.RelativePath) }
        $sourceAttributes = [IO.File]::GetAttributes([string]$file.SourcePath)
        if (($sourceAttributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw ('تم إيقاف النقل لأن ملف المصدر أصبح Reparse Point: ' + $file.RelativePath) }
        $currentSourceHash = (Get-FileHash -LiteralPath $file.SourcePath -Algorithm SHA256 -ErrorAction Stop).Hash.ToLowerInvariant()
        if ($currentSourceHash -ne $file.Sha256) { throw ('تغير ملف المصدر بعد إنشاء خطة النقل: ' + $file.RelativePath) }
        [IO.File]::Copy($file.SourcePath,$targetFile,$false)
        [IO.File]::SetLastWriteTimeUtc($targetFile,[DateTime]$file.LastWriteTimeUtc)
        $targetInfo = New-Object IO.FileInfo($targetFile)
        $targetHash = (Get-FileHash -LiteralPath $targetFile -Algorithm SHA256 -ErrorAction Stop).Hash.ToLowerInvariant()
        if ([long]$targetInfo.Length -ne [long]$file.Length -or $targetHash -ne $file.Sha256) { throw ('فشل التحقق من النسخة المنقولة بواسطة الحجم أو SHA-256: ' + $file.RelativePath) }
        $copied++; $copiedBytes += [long]$file.Length
        if ($OnProgress) { & $OnProgress ([pscustomobject]@{ CopiedFiles=$copied; TotalFiles=$Manifest.FileCount; CopiedBytes=$copiedBytes; TotalBytes=[long]$Manifest.TotalBytes; RelativePath=$file.RelativePath }) }
    }
    if ($copied -ne $Manifest.FileCount -or $copiedBytes -ne [long]$Manifest.TotalBytes) { throw 'أعداد الملفات أو إجمالي البايتات بعد النقل لا يطابق المصدر.' }
    # Verify PostgreSQL archives with the installed pg_restore reader before the location switch.
    $archives = @($Manifest.Files | Where-Object { [IO.Path]::GetExtension([string]$_.RelativePath) -ieq '.backup' })
    if ($archives.Count -gt 0) {
        foreach ($archive in $archives) {
            $targetArchive = Join-Path $DestinationRoot $archive.RelativePath
            Test-DarBackupArchive -BackupPath $targetArchive | Out-Null
        }
    }
    return [pscustomobject]@{ FileCount=$copied; TotalBytes=$copiedBytes; ArchiveCount=$archives.Count; Sha256Verified=$true; ArchivesValidated=$true }
}

function Invoke-DarBackupFolderRelocation {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)][string]$TargetFolder,
        [Parameter(Mandatory=$true)][string]$ProjectRoot,
        [Parameter(Mandatory=$true)][string]$SourceToolsPath,
        [scriptblock]$OnProgress,
        [string]$MutexName = 'Global\DarEltahfeez.AutomaticBackup'
    )
    $paths = Get-DarLocalPaths
    $sourceBeforeLock = [IO.Path]::GetFullPath($paths.BackupFolder)
    if (Get-NetTCPConnection -LocalPort 5080 -State Listen -ErrorAction SilentlyContinue) { throw 'أغلق تطبيق دار التحفيظ وAPI على المنفذ 5080 قبل نقل مجلد النسخ. يظل System Center مفتوحًا.' }

    if ([string]::IsNullOrWhiteSpace($MutexName)) { throw 'اسم قفل النقل غير صالح.' }
    $mutex = [System.Threading.Mutex]::new($false,$MutexName)
    $ownsMutex = $false
    $stagePath = $null
    $targetCreated = $false
    $configCommitted = $false
    try {
        try { $ownsMutex = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $ownsMutex = $true }
        if (-not $ownsMutex) { throw 'توجد عملية نسخ احتياطي قيد التنفيذ. أوقف المحاولة وانتظر اكتمالها ثم أعد النقل.' }
        # Re-check the source after acquiring the shared backup lock.
        $paths = Get-DarLocalPaths
        if (-not [string]::Equals([IO.Path]::GetFullPath($paths.BackupFolder),$sourceBeforeLock,[StringComparison]::OrdinalIgnoreCase)) { throw 'تغير مسار النسخ الحالي أثناء التحضير. أعد فتح Storage Center وأعد المحاولة.' }
        # The user-facing preflight already presented the summary. Rebuild the
        # authoritative manifest once under the shared backup lock before copying.
        $plan = Get-DarBackupFolderMovePlan -SourceFolder $paths.BackupFolder -TargetFolder $TargetFolder -LocalBase $paths.Base -ProjectRoot $ProjectRoot
        if (-not $plan.Ready) { throw ('فشل فحص ما قبل النقل بعد الحصول على القفل:' + [Environment]::NewLine + ($plan.Issues -join [Environment]::NewLine)) }
        $targetParent = [IO.Path]::GetDirectoryName($plan.TargetFolder)
        $token = [Guid]::NewGuid().ToString('N')
        $stagePath = Join-Path $targetParent ('.DarEltahfeez-Backups-stage-' + $token)
        $copyResult = Copy-DarStorageTreeWithVerification -Manifest $plan.Manifest -DestinationRoot $stagePath -OnProgress $OnProgress
        if (Get-DarStoragePathReparseAncestor -Path $targetParent) { throw 'تم إيقاف تبديل المسار لأن المجلد الأب للوجهة تغير وأصبح Reparse Point.' }
        if (Test-Path -LiteralPath $plan.TargetFolder) { throw 'ظهرت وجهة موجودة أثناء النقل؛ تم رفض الدمج أو الاستبدال، وسيظل المسار القديم نشطًا.' }
        # Directory.Move is a same-volume rename and fails if the destination
        # appeared after preflight; it cannot silently nest/merge the stage folder.
        [System.IO.Directory]::Move($stagePath,$plan.TargetFolder)
        $stagePath = $null
        $targetCreated = $true
        # Refresh the independent scheduled-backup payload before committing the active path.
        if (Get-Command 'Update-DarBackupSchedulerPayload' -CommandType Function -ErrorAction SilentlyContinue) {
            [void](Update-DarBackupSchedulerPayload -SourceToolsPath $SourceToolsPath)
        } else { throw 'تعذر تحديث Runner النسخ المستقل؛ لم يتم تبديل مسار النسخ الحالي.' }

        $history = New-Object 'System.Collections.Generic.List[object]'
        foreach ($entry in @($paths.BackupFolderHistory)) {
            if ($entry -and -not [string]::IsNullOrWhiteSpace([string]$entry.Path)) { $history.Add([ordered]@{ Path=[string]$entry.Path; RetainedAtUtc=[string]$entry.RetainedAtUtc; Reason=[string]$entry.Reason }) }
        }
        $alreadyRecorded = $false
        foreach ($entry in $history) { if ([string]::Equals([string]$entry.Path,$plan.SourceFolder,[StringComparison]::OrdinalIgnoreCase)) { $alreadyRecorded=$true; break } }
        if (-not $alreadyRecorded) {
            $history.Add([ordered]@{ Path=$plan.SourceFolder; RetainedAtUtc=[DateTime]::UtcNow.ToString('o'); Reason='Previous backup folder retained as a verified safety copy after copy-and-switch relocation.' })
        }
        $config = [ordered]@{ SchemaVersion=1; BackupFolder=$plan.TargetFolder; BackupFolderHistory=@($history.ToArray()); UpdatedAtUtc=[DateTime]::UtcNow.ToString('o') }
        Write-DarAtomicJson -Path $paths.StorageLocationsConfigPath -Value $config
        $configCommitted = $true

        $schedulerMetadataWarning = $null
        try {
            $schedulerPaths = Get-DarBackupSchedulerPaths
            if (Test-Path -LiteralPath $schedulerPaths.Config -PathType Leaf) {
                $schedule = Get-Content -LiteralPath $schedulerPaths.Config -Raw -Encoding UTF8 | ConvertFrom-Json
                $schedule.BackupFolder = $plan.TargetFolder
                Write-DarAtomicJson -Path $schedulerPaths.Config -Value $schedule
            }
        } catch { $schedulerMetadataWarning = $_.Exception.Message }
        return [pscustomobject]@{
            PreviousFolder=$plan.SourceFolder; ActiveFolder=$plan.TargetFolder; FileCount=$copyResult.FileCount; TotalBytes=$copyResult.TotalBytes
            ArchiveCount=$copyResult.ArchiveCount; Sha256Verified=$copyResult.Sha256Verified; ArchivesValidated=$copyResult.ArchivesValidated
            PreviousCopyRetained=$true; SchedulerMetadataWarning=$schedulerMetadataWarning
        }
    } catch {
        if ($stagePath -and (Test-Path -LiteralPath $stagePath -PathType Container) -and -not (Get-DarStoragePathReparseAncestor -Path $stagePath)) {
            try { Remove-Item -LiteralPath $stagePath -Recurse -Force -ErrorAction Stop } catch { }
        }
        if ($targetCreated -and -not $configCommitted -and (Test-Path -LiteralPath $plan.TargetFolder -PathType Container) -and -not (Get-DarStoragePathReparseAncestor -Path $plan.TargetFolder)) {
            # The target was proven absent and created by this operation. Remove only this uncommitted copy.
            try { Remove-Item -LiteralPath $plan.TargetFolder -Recurse -Force -ErrorAction Stop } catch { }
        }
        throw
    } finally {
        if ($ownsMutex) { try { $mutex.ReleaseMutex() } catch { } }
        $mutex.Dispose()
    }
}
