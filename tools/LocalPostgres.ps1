# Local, Docker-free PostgreSQL runtime for Dar Eltahfeez Desktop.
# Uses EDB's official PostgreSQL 17.11-5 Windows x64 binaries archive.

$script:DarPgVersion = '17.11-5'
$script:DarPgArchiveUrl = 'https://get.enterprisedb.com/postgresql/postgresql-17.11-5-windows-x64-binaries.zip'
# SHA-256 published by EnterpriseDB staff for this exact official archive on 21 Oct 2026.
$script:DarPgArchiveSha256 = '80379b2c04d51c30225532e0ae04509899141e9957ed096fe749d7fd9df8f82f'
$script:DarPgPort = 55432
$script:DarPgDatabase = 'dar_eltahfeez'
$script:DarPgAppUser = 'dar_app'

function Test-DarLocalPathContains([string]$Parent, [string]$Child) {
    $parentFull = [System.IO.Path]::GetFullPath($Parent)
    $childFull = [System.IO.Path]::GetFullPath($Child)
    $parentRoot = [System.IO.Path]::GetPathRoot($parentFull)
    $childRoot = [System.IO.Path]::GetPathRoot($childFull)
    $parentKey = if ($parentFull.TrimEnd('\','/') -eq $parentRoot.TrimEnd('\','/')) { $parentRoot } else { $parentFull.TrimEnd('\','/') + [System.IO.Path]::DirectorySeparatorChar }
    $childKey = if ($childFull.TrimEnd('\','/') -eq $childRoot.TrimEnd('\','/')) { $childRoot } else { $childFull.TrimEnd('\','/') + [System.IO.Path]::DirectorySeparatorChar }
    if ([string]::Equals($parentKey.TrimEnd('\','/'),$childKey.TrimEnd('\','/'),[StringComparison]::OrdinalIgnoreCase)) { return $true }
    return $childKey.StartsWith($parentKey,[StringComparison]::OrdinalIgnoreCase)
}

function Get-DarBackupLocationConfiguration([string]$BasePath) {
    $defaultFolder = Join-Path $BasePath 'Backups'
    $configPath = Join-Path $BasePath 'storage-locations.json'
    if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
        return [pscustomobject]@{ ConfigPath=$configPath; BackupFolder=$defaultFolder; IsCustom=$false; History=@() }
    }
    try {
        $config = [System.IO.File]::ReadAllText($configPath,[System.Text.Encoding]::UTF8) | ConvertFrom-Json -ErrorAction Stop
    } catch {
        throw 'ملف إعداد مسارات التخزين غير صالح. أوقف النظام استخدام المسار الافتراضي تلقائيًا حتى لا تُكتب نسخ احتياطية في مكان غير متوقع. أغلق التطبيق ثم أعد تسمية storage-locations.json إلى storage-locations.json.invalid لمراجعة المسار الافتراضي؛ لا تحذف مجلد النسخ السابق.'
    }
    if ([int]$config.SchemaVersion -ne 1) { throw 'إصدار إعداد مسارات التخزين غير مدعوم. لم يتم تغيير أي مسار.' }
    $candidate = [string]$config.BackupFolder
    if ([string]::IsNullOrWhiteSpace($candidate) -or $candidate -notmatch '^[A-Za-z]:\\') {
        throw 'المسار المخصص للنسخ الاحتياطية غير صالح أو يشير إلى مشاركة شبكة. لم يتم تشغيل عمليات النسخ.'
    }
    try { $backupFolder = [System.IO.Path]::GetFullPath($candidate) } catch { throw 'تعذر تحليل المسار المخصص للنسخ الاحتياطية. لم يتم تغيير أي بيانات.' }
    $driveRoot = [System.IO.Path]::GetPathRoot($backupFolder)
    if ($driveRoot -notmatch '^[A-Za-z]:\\$') { throw 'المسار المخصص للنسخ يجب أن يكون داخل قرص Windows محلي؛ مشاركات الشبكة ومسارات الأجهزة غير مدعومة.' }
    $backupLeaf = [System.IO.Path]::GetFileName($backupFolder.TrimEnd('\','/'))
    if ($backupLeaf -notin @('Backups','DarEltahfeez-Backups')) { throw 'اسم مجلد النسخ المخصص غير معتمد؛ يجب أن يكون Backups أو DarEltahfeez-Backups.' }
    if ($backupFolder.TrimEnd('\','/') -eq $driveRoot.TrimEnd('\','/') ) { throw 'لا يمكن تعيين جذر القرص نفسه كمجلد للنسخ الاحتياطية.' }
    $defaultFull = [System.IO.Path]::GetFullPath($defaultFolder)
    $isCustom = -not [string]::Equals($backupFolder.TrimEnd('\','/'),$defaultFull.TrimEnd('\','/'),[StringComparison]::OrdinalIgnoreCase)
    if ($isCustom -and ((Test-DarLocalPathContains -Parent $BasePath -Child $backupFolder) -or (Test-DarLocalPathContains -Parent $backupFolder -Child $BasePath))) {
        throw 'المسار المخصص للنسخ الاحتياطية يتداخل مع مجلد بيانات دار التحفيظ الأساسي. تم إيقاف استخدامه لحماية قاعدة البيانات والأسرار والسجلات.'
    }
    $history = @()
    if ($null -ne $config.BackupFolderHistory) {
        foreach ($entry in @($config.BackupFolderHistory)) {
            $historyPath = [string]$entry.Path
            if ([string]::IsNullOrWhiteSpace($historyPath) -or $historyPath -notmatch '^[A-Za-z]:\\') { continue }
            try { $historyFull = [System.IO.Path]::GetFullPath($historyPath) } catch { continue }
            $historyRoot = [System.IO.Path]::GetPathRoot($historyFull)
            if ($historyRoot -notmatch '^[A-Za-z]:\\$') { continue }
            $historyLeaf = [System.IO.Path]::GetFileName($historyFull.TrimEnd('\','/'))
            if ($historyLeaf -notin @('Backups','DarEltahfeez-Backups')) { continue }
            $defaultHistory = [System.IO.Path]::GetFullPath($defaultFolder)
            $isDefaultHistory = [string]::Equals($historyFull.TrimEnd('\','/'),$defaultHistory.TrimEnd('\','/'),[StringComparison]::OrdinalIgnoreCase)
            if (-not $isDefaultHistory -and ((Test-DarLocalPathContains -Parent $BasePath -Child $historyFull) -or (Test-DarLocalPathContains -Parent $historyFull -Child $BasePath))) { continue }
            if ([string]::Equals($historyFull.TrimEnd('\','/'),$backupFolder.TrimEnd('\','/'),[StringComparison]::OrdinalIgnoreCase)) { continue }
            $history += [pscustomobject]@{ Path=$historyFull; RetainedAtUtc=[string]$entry.RetainedAtUtc; Reason=[string]$entry.Reason }
        }
    }
    return [pscustomobject]@{ ConfigPath=$configPath; BackupFolder=$backupFolder; IsCustom=$isCustom; History=@($history) }
}

function Get-DarLocalPaths {
    $localAppData = [string]$env:LOCALAPPDATA
    if ([string]::IsNullOrWhiteSpace($localAppData)) {
        $localAppData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
    }
    if ([string]::IsNullOrWhiteSpace($localAppData)) {
        throw 'Windows did not provide the current user Local AppData path. The operation was stopped without touching database files.'
    }
    $base = Join-Path $localAppData 'DarEltahfeez'
    $backupConfiguration = Get-DarBackupLocationConfiguration -BasePath $base
    [pscustomobject]@{
        Base = $base
        Runtime = Join-Path $base 'Runtime\PostgreSQL\17'
        Data = Join-Path $base 'Database\data'
        DatabaseFolder = Join-Path $base 'Database'
        Secrets = Join-Path $base 'database-secrets.json'
        AppSettings = Join-Path $base 'appsettings.json'
        Logs = Join-Path $base 'Logs'
        PostgresLog = Join-Path $base 'Logs\postgresql.log'
        BackupFolder = $backupConfiguration.BackupFolder
        BackupFolderIsCustom = $backupConfiguration.IsCustom
        BackupFolderHistory = @($backupConfiguration.History)
        StorageLocationsConfigPath = $backupConfiguration.ConfigPath
    }
}

function Write-DarAtomicJson([string]$Path, $Value) {
    $directory = Split-Path -Parent $Path
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
    $temporary = "$Path.tmp"
    $json = $Value | ConvertTo-Json -Depth 8
    [System.IO.File]::WriteAllText($temporary, $json, [System.Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporary -Destination $Path -Force
}

function New-DarStrongPassword {
    $bytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return ([System.BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant())
}

function Get-DarPostgresBin([string]$ProjectRoot, [switch]$DownloadIfMissing) {
    $localPaths = Get-DarLocalPaths
    $candidates = @(
        (Join-Path $ProjectRoot 'database-runtime\pgsql\bin'),
        (Join-Path $ProjectRoot 'database-runtime\bin'),
        (Join-Path $localPaths.Runtime 'pgsql\bin'),
        (Join-Path $localPaths.Runtime 'bin')
    )
    foreach ($candidate in $candidates) {
        if ((Test-Path (Join-Path $candidate 'pg_ctl.exe')) -and
            (Test-Path (Join-Path $candidate 'initdb.exe')) -and
            (Test-Path (Join-Path $candidate 'pg_dump.exe')) -and
            (Test-Path (Join-Path $candidate 'pg_restore.exe')) -and
            (Test-Path (Join-Path $candidate 'psql.exe'))) {
            return $candidate
        }
    }

    if (-not $DownloadIfMissing) { return $null }

    $paths = Get-DarLocalPaths
    $runtimeRoot = $paths.Runtime
    $downloadRoot = Join-Path $paths.Base 'Runtime\Downloads'
    New-Item -ItemType Directory -Force -Path $downloadRoot | Out-Null
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $runtimeRoot) | Out-Null
    $archive = Join-Path $downloadRoot "postgresql-$($script:DarPgVersion)-windows-x64-binaries.zip"
    $extract = Join-Path $downloadRoot 'extract-postgresql-17'

    if (-not (Test-Path $archive)) {
        Write-DarPostgresStep 'Downloading the official PostgreSQL 17 Windows runtime (one-time setup)...'
        try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }
        try {
            Invoke-WebRequest -Uri $script:DarPgArchiveUrl -OutFile $archive -UseBasicParsing
        } catch {
            Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue
            throw 'تعذر تنزيل محرك PostgreSQL الرسمي. تحقق من اتصال الإنترنت ثم أعد المحاولة. لم يتم إنشاء قاعدة البيانات أو تعديل بيانات موجودة.'
        }
    }

    Write-DarPostgresStep 'Verifying the PostgreSQL runtime download...'
    $actualHash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne $script:DarPgArchiveSha256) {
        Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue
        throw 'تعذر التحقق من سلامة حزمة PostgreSQL التي تم تنزيلها. لم يتم تشغيل أي ملف منها.'
    }

    if (Test-Path $extract) { Remove-Item -LiteralPath $extract -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $extract | Out-Null
    Write-DarPostgresStep 'Preparing the local PostgreSQL runtime...'
    Expand-Archive -LiteralPath $archive -DestinationPath $extract -Force
    $pgCtl = Get-ChildItem -LiteralPath $extract -Filter 'pg_ctl.exe' -File -Recurse | Select-Object -First 1
    if (-not $pgCtl) { throw 'حزمة PostgreSQL لم تحتوِ على pg_ctl.exe؛ تم إيقاف التجهيز دون تهيئة قاعدة البيانات.' }
    $bin = $pgCtl.Directory.FullName
    foreach ($required in @('initdb.exe','pg_dump.exe','pg_restore.exe','psql.exe','postgres.exe')) {
        if (-not (Test-Path (Join-Path $bin $required))) { throw "ملف PostgreSQL المطلوب غير موجود: $required" }
    }
    # Keep the complete EDB pgsql tree (bin, share, lib and runtime DLLs), not only the executables.
    $pgsqlRoot = Split-Path -Parent $bin
    if (Test-Path $runtimeRoot) { Remove-Item -LiteralPath $runtimeRoot -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
    Get-ChildItem -LiteralPath $pgsqlRoot -Force | Copy-Item -Destination $runtimeRoot -Recurse -Force
    Remove-Item -LiteralPath $extract -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue

    $resolved = Join-Path $runtimeRoot 'bin'
    if (-not (Test-Path (Join-Path $resolved 'pg_ctl.exe'))) {
        $resolved = Join-Path $runtimeRoot 'pgsql\bin'
    }
    if (-not (Test-Path (Join-Path $resolved 'pg_ctl.exe'))) { throw 'فشل تجهيز محرك PostgreSQL المحلي.' }
    return $resolved
}

function Get-DarDatabaseSecrets {
    $paths = Get-DarLocalPaths
    if (Test-Path $paths.Secrets) {
        try {
            $secrets = Get-Content -LiteralPath $paths.Secrets -Raw | ConvertFrom-Json
            if (-not [string]::IsNullOrWhiteSpace([string]$secrets.PostgresAdminPassword) -and
                -not [string]::IsNullOrWhiteSpace([string]$secrets.AppPassword)) { return $secrets }
        } catch { }
        throw 'ملف إعدادات قاعدة البيانات موجود لكنه غير صالح. لم يتم تعديل ملفات البيانات.'
    }

    if (Test-Path (Join-Path $paths.Data 'PG_VERSION')) {
        throw 'قاعدة البيانات المحلية موجودة، لكن ملف مفاتيح الاتصال مفقود. لحماية البيانات لم يتم إنشاء قاعدة جديدة أو تغيير القاعدة الحالية.'
    }

    $secrets = [pscustomobject]@{
        EngineVersion = $script:DarPgVersion
        Port = $script:DarPgPort
        Database = $script:DarPgDatabase
        AppUser = $script:DarPgAppUser
        PostgresAdminPassword = New-DarStrongPassword
        AppPassword = New-DarStrongPassword
        CreatedAtUtc = [DateTime]::UtcNow.ToString('o')
    }
    Write-DarAtomicJson -Path $paths.Secrets -Value $secrets
    return $secrets
}

function Assert-DarDatabaseSecrets($Secrets) {
    if ($null -eq $Secrets) { throw 'إعدادات قاعدة البيانات غير موجودة.' }
    if ([string]$Secrets.EngineVersion -notmatch '^17\.') {
        throw 'إعدادات قاعدة البيانات تشير إلى إصدار PostgreSQL غير مدعوم. لم يتم تشغيل المحرك.'
    }
    if ([int]$Secrets.Port -ne 55432) {
        throw 'منفذ قاعدة البيانات المحلي غير مطابق للإعداد المعتمد. لم يتم الاتصال بقاعدة غير معروفة.'
    }
    foreach ($entry in @(
        @{ Name = 'Database'; Value = [string]$Secrets.Database },
        @{ Name = 'AppUser'; Value = [string]$Secrets.AppUser }
    )) {
        if ($entry.Value -notmatch '^[a-z][a-z0-9_]{0,62}$') {
            throw "اسم $($entry.Name) في إعدادات قاعدة البيانات غير صالح. لم يتم تنفيذ أي SQL."
        }
    }
    foreach ($entry in @(
        @{ Name = 'PostgresAdminPassword'; Value = [string]$Secrets.PostgresAdminPassword },
        @{ Name = 'AppPassword'; Value = [string]$Secrets.AppPassword }
    )) {
        if ($entry.Value -notmatch '^[a-f0-9]{64}$') {
            throw "قيمة $($entry.Name) غير مكتملة أو غير صالحة. لم يتم تغيير قاعدة البيانات."
        }
    }
}

function Write-DarApiConnectionSettings($Secrets) {
    $paths = Get-DarLocalPaths
    $connection = "Host=127.0.0.1;Port=$($Secrets.Port);Database=$($Secrets.Database);Username=$($Secrets.AppUser);Password=$($Secrets.AppPassword);Pooling=true;Timeout=5;Command Timeout=60;Keepalive=30"
    $settings = [ordered]@{
        ConnectionStrings = [ordered]@{ DarDatabase = $connection }
        Database = [ordered]@{ ApplyMigrationsOnStartup = $true }
        Logging = [ordered]@{ LogLevel = [ordered]@{ Default = 'Information'; 'Microsoft.AspNetCore' = 'Warning' } }
        AllowedHosts = 'localhost;127.0.0.1'
    }
    Write-DarAtomicJson -Path $paths.AppSettings -Value $settings
}

function ConvertTo-DarWindowsArgument([string]$Argument) {
    if ($null -eq $Argument) { return '""' }
    if ($Argument.Length -gt 0 -and $Argument -notmatch '[\s"]') { return $Argument }

    # Quote one Windows command-line argument using the CommandLineToArgvW rules.
    $builder = New-Object System.Text.StringBuilder
    [void]$builder.Append('"')
    $backslashCount = 0
    foreach ($character in $Argument.ToCharArray()) {
        if ($character -eq [char]92) {
            $backslashCount++
            continue
        }
        if ($character -eq [char]34) {
            if ($backslashCount -gt 0) { [void]$builder.Append(('\' * (2 * $backslashCount))) }
            [void]$builder.Append('\"')
        } else {
            if ($backslashCount -gt 0) { [void]$builder.Append(('\' * $backslashCount)) }
            [void]$builder.Append($character)
        }
        $backslashCount = 0
    }
    if ($backslashCount -gt 0) { [void]$builder.Append(('\' * (2 * $backslashCount))) }
    [void]$builder.Append('"')
    return $builder.ToString()
}

function Invoke-DarNativeProcessCapture([string]$Executable, [string[]]$Arguments) {
    if ([string]::IsNullOrWhiteSpace($Executable) -or -not (Test-Path -LiteralPath $Executable -PathType Leaf)) {
        throw "Native executable is missing: $Executable"
    }

    # Windows PowerShell 5.1 can promote a native process' STDERR records to
    # terminating PowerShell errors when the caller uses $ErrorActionPreference='Stop'.
    # That bypasses Invoke-DarPgTool's -AllowFailure contract (notably the first
    # psql identity probe against an intentionally stopped local PostgreSQL server).
    # Capture STDERR as ordinary output for the duration of the native invocation,
    # then restore the caller's preference exactly.
    $previousErrorActionPreference = $ErrorActionPreference
    $rawOutput = @()
    $exitCode = -1
    try {
        $ErrorActionPreference = 'Continue'
        $rawOutput = @(& $Executable @Arguments 2>&1)
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }

    $normalizedOutput = @($rawOutput | ForEach-Object {
        if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.ToString() }
        else { [string]$_ }
    })
    return [pscustomobject]@{ ExitCode = [int]$exitCode; Output = $normalizedOutput }
}

function Write-DarPostgresStep([string]$Message) {
    # The desktop/System Center and scheduler provide their own Write-Step callback.
    # Standalone Test Center runners do not, so retain progress output without
    # making a cold-start attempt fail with "Write-Step is not recognized".
    $callback = Get-Command -Name 'Write-Step' -CommandType Function -ErrorAction SilentlyContinue
    if ($null -ne $callback) { Write-Step $Message }
    else { Write-Host ("[PostgreSQL] " + $Message) -ForegroundColor Cyan }
}

function Invoke-DarPgTool([string]$Tool, [string[]]$Arguments, [string]$Password, [switch]$AllowFailure, [int]$ConnectTimeout = 5) {
    if ([string]::IsNullOrWhiteSpace([string]$script:DarPgBin)) {
        throw 'PostgreSQL runtime path is not initialized. Resolve and assign the verified PostgreSQL bin directory before invoking database tools.'
    }
    $exe = Join-Path $script:DarPgBin "$Tool.exe"
    if (-not (Test-Path $exe)) { throw "PostgreSQL utility is missing: $Tool.exe" }
    $previousPassword = $env:PGPASSWORD
    $previousConnectTimeout = $env:PGCONNECT_TIMEOUT
    $output = @()
    $exitCode = -1
    $stdoutFile = $null
    $stderrFile = $null
    try {
        $env:PGPASSWORD = $Password
        $env:PGCONNECT_TIMEOUT = [string]$ConnectTimeout

        if ($Tool -ieq 'pg_ctl' -and $Arguments.Count -gt 0 -and $Arguments[0] -ieq 'start') {
            # pg_ctl starts a long-lived postgres.exe child. Capturing pg_ctl through
            # PowerShell's native-command pipeline can leave inherited pipe handles
            # open while the server is alive, making the launcher appear frozen even
            # after PostgreSQL has written "ready to accept connections". Use files
            # for stdout/stderr so the detached server cannot keep a PowerShell pipe open.
            $token = [Guid]::NewGuid().ToString('N')
            $stdoutFile = Join-Path ([IO.Path]::GetTempPath()) "dar-pgctl-$token.out"
            $stderrFile = Join-Path ([IO.Path]::GetTempPath()) "dar-pgctl-$token.err"
            $argumentLine = (@($Arguments | ForEach-Object { ConvertTo-DarWindowsArgument -Argument ([string]$_) }) -join ' ')
            $process = Start-Process -FilePath $exe -ArgumentList $argumentLine -WorkingDirectory $script:DarPgBin -WindowStyle Hidden -RedirectStandardOutput $stdoutFile -RedirectStandardError $stderrFile -PassThru
            $finished = $process.WaitForExit(75000)
            if (-not $finished) {
                # Stop only the pg_ctl client process, never postgres.exe. The caller
                # independently verifies the server's data_directory and port next.
                try { $process.Kill() } catch { }
                try { $process.WaitForExit() } catch { }
                $exitCode = 124
                $output += 'pg_ctl client exceeded its 75-second safety limit; the PostgreSQL server process was not terminated.'
            } else {
                $exitCode = $process.ExitCode
            }
            if (Test-Path -LiteralPath $stdoutFile) { $output += @(Get-Content -LiteralPath $stdoutFile -ErrorAction SilentlyContinue) }
            if (Test-Path -LiteralPath $stderrFile) { $output += @(Get-Content -LiteralPath $stderrFile -ErrorAction SilentlyContinue) }
        } else {
            $nativeResult = Invoke-DarNativeProcessCapture -Executable $exe -Arguments $Arguments
            $output = @($nativeResult.Output)
            $exitCode = [int]$nativeResult.ExitCode
        }
    } finally {
        if ($null -eq $previousPassword) { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue } else { $env:PGPASSWORD = $previousPassword }
        if ($null -eq $previousConnectTimeout) { Remove-Item Env:PGCONNECT_TIMEOUT -ErrorAction SilentlyContinue } else { $env:PGCONNECT_TIMEOUT = $previousConnectTimeout }
        if ($stdoutFile) { Remove-Item -LiteralPath $stdoutFile -Force -ErrorAction SilentlyContinue }
        if ($stderrFile) { Remove-Item -LiteralPath $stderrFile -Force -ErrorAction SilentlyContinue }
    }
    if (-not $AllowFailure -and $exitCode -ne 0) {
        $detail = ($output | ForEach-Object { [string]$_ }) -join [Environment]::NewLine
        throw "$Tool failed (exit $exitCode). $detail"
    }
    return [pscustomobject]@{ ExitCode = $exitCode; Output = $output }
}

function Test-DarBackupArchive([string]$BackupPath, [string[]]$RequiredTables = @('app_users','students','teachers','circles')) {
    if (-not (Test-Path -LiteralPath $BackupPath -PathType Leaf)) { throw 'ملف النسخة الاحتياطية غير موجود.' }
    $file = Get-Item -LiteralPath $BackupPath -ErrorAction Stop
    if ($file.Length -lt 128) { throw 'ملف النسخة الاحتياطية أصغر من الحد الأدنى المتوقع.' }
    $result = Invoke-DarPgTool -Tool 'pg_restore' -Arguments @('--list', $BackupPath) -Password '' -AllowFailure
    if ($result.ExitCode -ne 0) { throw 'الملف المحدد ليس نسخة PostgreSQL قابلة للقراءة، أو أن الملف تالف.' }
    $listing = ($result.Output | ForEach-Object { [string]$_ }) -join "`n"
    $required = @($RequiredTables | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique)
    if ($required.Count -eq 0) { throw 'لم يتم تحديد جداول مطلوبة للتحقق من اكتمال الأرشيف.' }
    foreach ($table in $required) {
        $escaped = [regex]::Escape($table)
        if ($listing -notmatch ("(?m)^\s*\d+;[^\r\n]*\bTABLE\s+public\s+" + $escaped + "(?:\s|$)")) {
            throw "النسخة المحددة لا تحتوي تعريف الجدول المطلوب '$table'. قد تكون نسخة جزئية وليست نسخة كاملة قابلة للنقل."
        }
        if ($listing -notmatch ("(?m)^\s*\d+;[^\r\n]*\bTABLE\s+DATA\s+public\s+" + $escaped + "(?:\s|$)")) {
            throw "النسخة المحددة لا تحتوي قسم بيانات الجدول المطلوب '$table'. لن يتم اعتبار نسخة Schema-only أو نسخة جزئية نسخة كاملة قابلة للنقل."
        }
    }
    return $true
}

function Get-DarVerifiedBackupManifest([string]$BackupPath, $Secrets) {
    if (-not (Test-Path -LiteralPath $BackupPath -PathType Leaf)) { throw 'ملف النسخة الاحتياطية غير موجود.' }
    if ($null -eq $Secrets) { throw 'بيانات اتصال قاعدة البيانات مطلوبة للتحقق من Manifest النسخة.' }
    $file = Get-Item -LiteralPath $BackupPath -ErrorAction Stop
    $manifestPath = $BackupPath + '.json'
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        throw ("Backup manifest sidecar is missing. Expected file: $manifestPath. Select a full backup from the active Dar Backups folder with its matching .backup.json file, or create a new full backup from the current System Center.")
    }
    try { $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop }
    catch { throw ('تعذر قراءة Manifest النسخة الاحتياطية: ' + $_.Exception.Message) }
    if ([int]$manifest.SchemaVersion -ne 1) { throw 'إصدار Manifest النسخة غير مدعوم.' }
    if ([string]$manifest.Status -cne 'completed') { throw 'Manifest لا يثبت اكتمال النسخة الاحتياطية.' }
    if ([string]$manifest.FileName -cne [IO.Path]::GetFileName($BackupPath)) { throw 'اسم ملف النسخة لا يطابق الاسم المسجل في Manifest.' }
    if ([string]$manifest.DatabaseName -cne [string]$Secrets.Database) { throw 'Manifest النسخة لا يخص قاعدة Dar الحالية.' }
    if ([int]$manifest.PostgreSqlMajorVersion -ne 17) { throw 'نسخة PostgreSQL المسجلة في Manifest لا تطابق Runtime PostgreSQL 17 المعتمد لهذا الإصدار.' }
    if ([string]$manifest.ArchiveFormat -cne 'PostgreSQL Custom' -or [string]$manifest.Validation -cne 'pg_restore --list passed') {
        throw 'Manifest لا يثبت أن الملف PostgreSQL Custom وأن pg_restore --list اجتاز التحقق.'
    }
    if ([long]$manifest.FileSizeBytes -ne [long]$file.Length) { throw 'حجم ملف النسخة لا يطابق الحجم المسجل في Manifest؛ ربما تغير الملف بعد إنشائه.' }
    if ([string]$manifest.Sha256 -notmatch '^[a-fA-F0-9]{64}$') { throw 'بصمة SHA-256 في Manifest غير صالحة.' }
    $actualHash = (Get-FileHash -LiteralPath $BackupPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if (-not [string]::Equals($actualHash,[string]$manifest.Sha256,[StringComparison]::OrdinalIgnoreCase)) { throw 'بصمة SHA-256 للنسخة لا تطابق Manifest؛ لن تتم الاستعادة.' }
    $createdAt = [DateTimeOffset]::MinValue
    if (-not [DateTimeOffset]::TryParse([string]$manifest.CreatedAtUtc,[ref]$createdAt)) { throw 'تاريخ إنشاء النسخة في Manifest غير صالح.' }
    if ($createdAt -gt [DateTimeOffset]::UtcNow.AddMinutes(5)) { throw 'تاريخ إنشاء النسخة في Manifest يقع في المستقبل.' }
    return [pscustomobject]@{
        Path = $manifestPath
        Manifest = $manifest
        CreatedAtUtc = $createdAt
        FileSizeBytes = [long]$file.Length
        Sha256 = $actualHash
    }
}

function New-DarBackupManifest([string]$BackupPath, $Secrets) {
    Assert-DarDatabaseSecrets -Secrets $Secrets
    if (-not (Test-Path -LiteralPath $BackupPath -PathType Leaf)) { throw 'Backup archive is missing; its manifest was not written.' }

    # Re-validate the finished archive before issuing metadata that marks it completed.
    Test-DarBackupArchive -BackupPath $BackupPath | Out-Null
    $file = Get-Item -LiteralPath $BackupPath -ErrorAction Stop
    $majorVersion = [int](([string]$Secrets.EngineVersion -split '\.')[0])
    if ($majorVersion -ne 17) { throw 'Cannot issue a Dar backup manifest for an unsupported PostgreSQL major version.' }
    $hash = (Get-FileHash -LiteralPath $BackupPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $manifest = [ordered]@{
        SchemaVersion = 1
        Status = 'completed'
        FileName = $file.Name
        CreatedAtUtc = [DateTimeOffset]::UtcNow.ToString('o')
        ComputerName = $env:COMPUTERNAME
        DatabaseName = [string]$Secrets.Database
        PostgreSqlMajorVersion = $majorVersion
        ArchiveFormat = 'PostgreSQL Custom'
        Validation = 'pg_restore --list passed'
        FileSizeBytes = [long]$file.Length
        Sha256 = $hash
    }
    $manifestPath = $BackupPath + '.json'
    Write-DarAtomicJson -Path $manifestPath -Value $manifest
    return [pscustomobject]@{
        Path = $manifestPath
        FileName = $file.Name
        FileSizeBytes = [long]$file.Length
        Sha256 = $hash
        Validation = [string]$manifest.Validation
        CreatedAtUtc = [string]$manifest.CreatedAtUtc
        Manifest = $manifest
    }
}

function Get-DarLatestBackupWithManifest([string]$BackupFolder, $Secrets) {
    if ([string]::IsNullOrWhiteSpace($BackupFolder) -or -not (Test-Path -LiteralPath $BackupFolder -PathType Container)) { return $null }
    $files = @(Get-ChildItem -LiteralPath $BackupFolder -Filter '*.backup' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTimeUtc -Descending)
    foreach ($file in $files) {
        $manifestPath = $file.FullName + '.json'
        if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { continue }
        try {
            $manifest = [System.IO.File]::ReadAllText($manifestPath,[System.Text.Encoding]::UTF8) | ConvertFrom-Json -ErrorAction Stop
            if ([int]$manifest.SchemaVersion -ne 1 -or
                [string]$manifest.Status -cne 'completed' -or
                [string]$manifest.FileName -cne $file.Name -or
                [string]$manifest.DatabaseName -cne [string]$Secrets.Database -or
                [int]$manifest.PostgreSqlMajorVersion -ne 17 -or
                [string]$manifest.ArchiveFormat -cne 'PostgreSQL Custom' -or
                [string]$manifest.Validation -cne 'pg_restore --list passed' -or
                [long]$manifest.FileSizeBytes -ne [long]$file.Length -or
                [string]$manifest.Sha256 -notmatch '^[a-fA-F0-9]{64}$') { continue }
            $createdAt = [DateTimeOffset]::MinValue
            if (-not [DateTimeOffset]::TryParse([string]$manifest.CreatedAtUtc,[ref]$createdAt) -or $createdAt -gt [DateTimeOffset]::UtcNow.AddMinutes(5)) { continue }
            # Verify the hash before proposing a candidate in either interactive restore flow.
            $actualHash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
            if (-not [string]::Equals($actualHash,[string]$manifest.Sha256,[StringComparison]::OrdinalIgnoreCase)) { continue }
            return $file.FullName
        } catch { continue }
    }
    return $null
}

function Get-DarExpectedSchemaForMigrations([string[]]$AppliedMigrations) {
    $migrationTables = [ordered]@{
        '001_initial_schema' = @('app_users','roles','permissions','role_permissions','user_roles','students','teachers','circles','circle_enrollments','monthly_charges','payments','audit_log')
        '002_management_security' = @('student_notes','user_permissions','collection_reports')
        '003_schedule_attendance_ads_receipts' = @('circle_schedule_slots','teacher_attendance','advertising_expenses')
        '004_operating_expenses' = @('operating_expenses')
        '005_system_admin' = @('school_settings','trash_items','system_backups')
        '006_student_attendance' = @('student_attendance')
        '007_student_attendance_active_unique' = @()
        '008_schedule_slot_active_unique' = @()
        '009_teacher_notes' = @('teacher_notes')
        '010_circle_start_date' = @()
        '011_enrollment_lifecycle_audit_index' = @()
        '012_teacher_schedule_no_overlap' = @()
    }
    if ($AppliedMigrations -notcontains '001_initial_schema') {
        throw 'قاعدة الاستعادة لا تحتوي سجل الترحيل الأساسي 001_initial_schema؛ لا يمكن إثبات مخططها أو ترقية النسخة بأمان.'
    }
    $unknown = @($AppliedMigrations | Where-Object { -not $migrationTables.Contains($_) })
    if ($unknown.Count -gt 0) {
        throw ('قاعدة الاستعادة تحتوي ترحيلات غير معروفة لهذا الإصدار: ' + ($unknown -join ', ') + '. قد تكون النسخة أحدث من التطبيق الحالي.')
    }

    $migrationGapFound = $false
    foreach ($migration in $migrationTables.Keys) {
        if ($AppliedMigrations -contains $migration) {
            if ($migrationGapFound) { throw ('سجل schema_migrations غير متسلسل؛ الترحيل ' + $migration + ' موجود بينما يوجد ترحيل أقدم مفقود.') }
        }
        else { $migrationGapFound = $true }
    }

    $expectedTables = [System.Collections.Generic.List[string]]::new()
    $expectedColumns = [System.Collections.Generic.List[string]]::new()
    $expectedForeignKeys = [System.Collections.Generic.List[string]]::new()
    $expectedForeignKeySpecifications = [System.Collections.Generic.List[object]]::new()
    $expectedIndexes = [System.Collections.Generic.List[string]]::new()
    $expectedIndexSpecifications = [System.Collections.Generic.List[object]]::new()
    $expectedFunctionSpecifications = [System.Collections.Generic.List[object]]::new()
    $expectedTriggerSpecifications = [System.Collections.Generic.List[object]]::new()
    $columnsByMigration = [ordered]@{
        '001_initial_schema' = @('app_users.id', 'app_users.username', 'app_users.display_name', 'app_users.password_hash', 'app_users.is_active', 'app_users.created_at', 'app_users.updated_at', 'roles.id', 'roles.code', 'roles.name_ar', 'permissions.id', 'permissions.code', 'permissions.name_ar', 'role_permissions.role_id', 'role_permissions.permission_id', 'user_roles.user_id', 'user_roles.role_id', 'user_roles.assigned_at', 'students.id', 'students.student_code', 'students.full_name', 'students.phone', 'students.guardian_name', 'students.guardian_phone', 'students.joined_on', 'students.status', 'students.notes', 'students.created_at', 'students.updated_at', 'teachers.id', 'teachers.teacher_code', 'teachers.full_name', 'teachers.phone', 'teachers.status', 'teachers.notes', 'teachers.created_at', 'teachers.updated_at', 'circles.id', 'circles.circle_code', 'circles.name', 'circles.teacher_id', 'circles.monthly_fee', 'circles.schedule_text', 'circles.is_active', 'circles.created_at', 'circles.updated_at', 'circle_enrollments.id', 'circle_enrollments.student_id', 'circle_enrollments.circle_id', 'circle_enrollments.starts_on', 'circle_enrollments.ends_on', 'circle_enrollments.agreed_monthly_fee', 'circle_enrollments.status', 'circle_enrollments.created_at', 'monthly_charges.id', 'monthly_charges.enrollment_id', 'monthly_charges.billing_month', 'monthly_charges.amount_due', 'monthly_charges.note', 'monthly_charges.created_at', 'payments.id', 'payments.monthly_charge_id', 'payments.amount', 'payments.paid_at', 'payments.method', 'payments.reference', 'payments.note', 'payments.recorded_by', 'payments.created_at', 'audit_log.id', 'audit_log.actor_user_id', 'audit_log.action_code', 'audit_log.entity_type', 'audit_log.entity_id', 'audit_log.occurred_at', 'audit_log.details')
        '002_management_security' = @('student_notes.id', 'student_notes.student_id', 'student_notes.note_text', 'student_notes.created_by', 'student_notes.created_at', 'user_permissions.user_id', 'user_permissions.permission_code', 'user_permissions.assigned_at', 'collection_reports.id', 'collection_reports.title', 'collection_reports.billing_month', 'collection_reports.snapshot', 'collection_reports.saved_by', 'collection_reports.created_at', 'students.age_years', 'teachers.hourly_rate')
        '003_schedule_attendance_ads_receipts' = @('circle_schedule_slots.id', 'circle_schedule_slots.circle_id', 'circle_schedule_slots.day_of_week', 'circle_schedule_slots.starts_at', 'circle_schedule_slots.duration_minutes', 'circle_schedule_slots.is_active', 'circle_schedule_slots.created_at', 'teacher_attendance.id', 'teacher_attendance.schedule_slot_id', 'teacher_attendance.circle_id', 'teacher_attendance.teacher_id', 'teacher_attendance.session_date', 'teacher_attendance.scheduled_start', 'teacher_attendance.duration_minutes', 'teacher_attendance.status', 'teacher_attendance.hourly_rate_snapshot', 'teacher_attendance.payable_amount', 'teacher_attendance.note', 'teacher_attendance.marked_by', 'teacher_attendance.marked_at', 'advertising_expenses.id', 'advertising_expenses.circle_id', 'advertising_expenses.platform', 'advertising_expenses.start_date', 'advertising_expenses.days_count', 'advertising_expenses.daily_cost', 'advertising_expenses.total_amount', 'advertising_expenses.note', 'advertising_expenses.recorded_by', 'advertising_expenses.created_at', 'payments.receipt_file_name', 'payments.receipt_content_type', 'payments.receipt_data', 'payments.receipt_uploaded_at')
        '004_operating_expenses' = @('operating_expenses.id', 'operating_expenses.expense_date', 'operating_expenses.category', 'operating_expenses.description', 'operating_expenses.amount', 'operating_expenses.circle_id', 'operating_expenses.note', 'operating_expenses.recorded_by', 'operating_expenses.updated_by', 'operating_expenses.created_at', 'operating_expenses.updated_at')
        '005_system_admin' = @('school_settings.id', 'school_settings.brand_name', 'school_settings.logo_data', 'school_settings.logo_content_type', 'school_settings.facebook_url', 'school_settings.tiktok_url', 'school_settings.whatsapp_url', 'school_settings.trash_retention_days', 'school_settings.backup_interval_hours', 'school_settings.auto_backup_enabled', 'school_settings.updated_by', 'school_settings.updated_at', 'trash_items.id', 'trash_items.entity_type', 'trash_items.entity_id', 'trash_items.display_name', 'trash_items.record_snapshot', 'trash_items.parent_trash_id', 'trash_items.deleted_by', 'trash_items.deleted_by_name', 'trash_items.deleted_at', 'trash_items.expires_at', 'trash_items.restored_at', 'trash_items.purged_at', 'trash_items.purge_error', 'system_backups.id', 'system_backups.backup_file_name', 'system_backups.backup_path', 'system_backups.scope_codes', 'system_backups.backup_format', 'system_backups.status', 'system_backups.file_size_bytes', 'system_backups.started_at', 'system_backups.completed_at', 'system_backups.created_by', 'system_backups.created_by_name', 'system_backups.error_message', 'audit_log.before_data', 'audit_log.after_data', 'audit_log.actor_display_name', 'audit_log.request_path', 'audit_log.http_method', 'audit_log.can_restore', 'audit_log.restored_at', 'students.is_trashed', 'teachers.is_trashed', 'circles.is_trashed', 'student_notes.is_trashed', 'circle_enrollments.is_trashed', 'monthly_charges.is_trashed', 'payments.is_trashed', 'collection_reports.is_trashed', 'circle_schedule_slots.is_trashed', 'teacher_attendance.is_trashed', 'advertising_expenses.is_trashed', 'operating_expenses.is_trashed', 'app_users.avatar_data', 'app_users.avatar_content_type')
        '006_student_attendance' = @('student_attendance.id', 'student_attendance.schedule_slot_id', 'student_attendance.enrollment_id', 'student_attendance.session_date', 'student_attendance.status', 'student_attendance.note', 'student_attendance.marked_by', 'student_attendance.marked_at', 'student_attendance.is_trashed')
        '009_teacher_notes' = @('teacher_notes.id', 'teacher_notes.teacher_id', 'teacher_notes.note_text', 'teacher_notes.created_by', 'teacher_notes.created_at', 'teacher_notes.is_trashed')
        '010_circle_start_date' = @('circles.starts_on')
        '011_enrollment_lifecycle_audit_index' = @()
        '012_teacher_schedule_no_overlap' = @()
    }
    $foreignKeysByMigration = @{
        '001_initial_schema' = @('role_permissions_role_id_fkey','role_permissions_permission_id_fkey','user_roles_user_id_fkey','user_roles_role_id_fkey','circles_teacher_id_fkey','circle_enrollments_student_id_fkey','circle_enrollments_circle_id_fkey','monthly_charges_enrollment_id_fkey','payments_monthly_charge_id_fkey','payments_recorded_by_fkey','audit_log_actor_user_id_fkey')
        '002_management_security' = @('student_notes_student_id_fkey','student_notes_created_by_fkey','user_permissions_user_id_fkey','collection_reports_saved_by_fkey')
        '003_schedule_attendance_ads_receipts' = @('circle_schedule_slots_circle_id_fkey','teacher_attendance_schedule_slot_id_fkey','teacher_attendance_circle_id_fkey','teacher_attendance_teacher_id_fkey','teacher_attendance_marked_by_fkey','advertising_expenses_circle_id_fkey','advertising_expenses_recorded_by_fkey')
        '004_operating_expenses' = @('operating_expenses_circle_id_fkey','operating_expenses_recorded_by_fkey','operating_expenses_updated_by_fkey')
        '005_system_admin' = @('school_settings_updated_by_fkey','trash_items_parent_trash_id_fkey','trash_items_deleted_by_fkey','system_backups_created_by_fkey')
        '006_student_attendance' = @('student_attendance_schedule_slot_id_fkey','student_attendance_enrollment_id_fkey','student_attendance_marked_by_fkey')
        '009_teacher_notes' = @('teacher_notes_teacher_id_fkey','teacher_notes_created_by_fkey')
    }
    $foreignKeySpecifications = @{
        'role_permissions_role_id_fkey' = [pscustomobject]@{ Table='role_permissions'; Column='role_id'; TargetTable='roles'; TargetColumn='id' }
        'role_permissions_permission_id_fkey' = [pscustomobject]@{ Table='role_permissions'; Column='permission_id'; TargetTable='permissions'; TargetColumn='id' }
        'user_roles_user_id_fkey' = [pscustomobject]@{ Table='user_roles'; Column='user_id'; TargetTable='app_users'; TargetColumn='id' }
        'user_roles_role_id_fkey' = [pscustomobject]@{ Table='user_roles'; Column='role_id'; TargetTable='roles'; TargetColumn='id' }
        'circles_teacher_id_fkey' = [pscustomobject]@{ Table='circles'; Column='teacher_id'; TargetTable='teachers'; TargetColumn='id' }
        'circle_enrollments_student_id_fkey' = [pscustomobject]@{ Table='circle_enrollments'; Column='student_id'; TargetTable='students'; TargetColumn='id' }
        'circle_enrollments_circle_id_fkey' = [pscustomobject]@{ Table='circle_enrollments'; Column='circle_id'; TargetTable='circles'; TargetColumn='id' }
        'monthly_charges_enrollment_id_fkey' = [pscustomobject]@{ Table='monthly_charges'; Column='enrollment_id'; TargetTable='circle_enrollments'; TargetColumn='id' }
        'payments_monthly_charge_id_fkey' = [pscustomobject]@{ Table='payments'; Column='monthly_charge_id'; TargetTable='monthly_charges'; TargetColumn='id' }
        'payments_recorded_by_fkey' = [pscustomobject]@{ Table='payments'; Column='recorded_by'; TargetTable='app_users'; TargetColumn='id' }
        'audit_log_actor_user_id_fkey' = [pscustomobject]@{ Table='audit_log'; Column='actor_user_id'; TargetTable='app_users'; TargetColumn='id' }
        'student_notes_student_id_fkey' = [pscustomobject]@{ Table='student_notes'; Column='student_id'; TargetTable='students'; TargetColumn='id' }
        'student_notes_created_by_fkey' = [pscustomobject]@{ Table='student_notes'; Column='created_by'; TargetTable='app_users'; TargetColumn='id' }
        'user_permissions_user_id_fkey' = [pscustomobject]@{ Table='user_permissions'; Column='user_id'; TargetTable='app_users'; TargetColumn='id' }
        'collection_reports_saved_by_fkey' = [pscustomobject]@{ Table='collection_reports'; Column='saved_by'; TargetTable='app_users'; TargetColumn='id' }
        'circle_schedule_slots_circle_id_fkey' = [pscustomobject]@{ Table='circle_schedule_slots'; Column='circle_id'; TargetTable='circles'; TargetColumn='id' }
        'teacher_attendance_schedule_slot_id_fkey' = [pscustomobject]@{ Table='teacher_attendance'; Column='schedule_slot_id'; TargetTable='circle_schedule_slots'; TargetColumn='id' }
        'teacher_attendance_circle_id_fkey' = [pscustomobject]@{ Table='teacher_attendance'; Column='circle_id'; TargetTable='circles'; TargetColumn='id' }
        'teacher_attendance_teacher_id_fkey' = [pscustomobject]@{ Table='teacher_attendance'; Column='teacher_id'; TargetTable='teachers'; TargetColumn='id' }
        'teacher_attendance_marked_by_fkey' = [pscustomobject]@{ Table='teacher_attendance'; Column='marked_by'; TargetTable='app_users'; TargetColumn='id' }
        'advertising_expenses_circle_id_fkey' = [pscustomobject]@{ Table='advertising_expenses'; Column='circle_id'; TargetTable='circles'; TargetColumn='id' }
        'advertising_expenses_recorded_by_fkey' = [pscustomobject]@{ Table='advertising_expenses'; Column='recorded_by'; TargetTable='app_users'; TargetColumn='id' }
        'operating_expenses_circle_id_fkey' = [pscustomobject]@{ Table='operating_expenses'; Column='circle_id'; TargetTable='circles'; TargetColumn='id' }
        'operating_expenses_recorded_by_fkey' = [pscustomobject]@{ Table='operating_expenses'; Column='recorded_by'; TargetTable='app_users'; TargetColumn='id' }
        'operating_expenses_updated_by_fkey' = [pscustomobject]@{ Table='operating_expenses'; Column='updated_by'; TargetTable='app_users'; TargetColumn='id' }
        'school_settings_updated_by_fkey' = [pscustomobject]@{ Table='school_settings'; Column='updated_by'; TargetTable='app_users'; TargetColumn='id' }
        'trash_items_parent_trash_id_fkey' = [pscustomobject]@{ Table='trash_items'; Column='parent_trash_id'; TargetTable='trash_items'; TargetColumn='id' }
        'trash_items_deleted_by_fkey' = [pscustomobject]@{ Table='trash_items'; Column='deleted_by'; TargetTable='app_users'; TargetColumn='id' }
        'system_backups_created_by_fkey' = [pscustomobject]@{ Table='system_backups'; Column='created_by'; TargetTable='app_users'; TargetColumn='id' }
        'student_attendance_schedule_slot_id_fkey' = [pscustomobject]@{ Table='student_attendance'; Column='schedule_slot_id'; TargetTable='circle_schedule_slots'; TargetColumn='id' }
        'student_attendance_enrollment_id_fkey' = [pscustomobject]@{ Table='student_attendance'; Column='enrollment_id'; TargetTable='circle_enrollments'; TargetColumn='id' }
        'student_attendance_marked_by_fkey' = [pscustomobject]@{ Table='student_attendance'; Column='marked_by'; TargetTable='app_users'; TargetColumn='id' }
        'teacher_notes_teacher_id_fkey' = [pscustomobject]@{ Table='teacher_notes'; Column='teacher_id'; TargetTable='teachers'; TargetColumn='id' }
        'teacher_notes_created_by_fkey' = [pscustomobject]@{ Table='teacher_notes'; Column='created_by'; TargetTable='app_users'; TargetColumn='id' }
    }
    $indexesByMigration = @{
        '002_management_security' = @('uq_circle_enrollments_active_student_circle')
        '005_system_admin' = @('uq_trash_active_entity')
        '007_student_attendance_active_unique' = @('ux_student_attendance_active_slot_date_enrollment')
        '008_schedule_slot_active_unique' = @('uq_circle_schedule_slots_not_trashed_day_time')
        '011_enrollment_lifecycle_audit_index' = @('ix_audit_log_enrollment_lifecycle')
        '012_teacher_schedule_no_overlap' = @('ix_schedule_slots_active_day_lookup')
    }
    $indexSpecifications = @{
        'uq_circle_enrollments_active_student_circle' = [pscustomobject]@{ Table='circle_enrollments'; Columns='student_id,circle_id'; PredicatePattern="status\)?\s*(?:::\s*text)?\s*=\s*'active'"; Unique=$true }
        'uq_trash_active_entity' = [pscustomobject]@{ Table='trash_items'; Columns='entity_type,entity_id'; PredicatePattern='restored_at\s+IS\s+NULL.*purged_at\s+IS\s+NULL'; Unique=$true }
        'ux_student_attendance_active_slot_date_enrollment' = [pscustomobject]@{ Table='student_attendance'; Columns='schedule_slot_id,session_date,enrollment_id'; PredicatePattern='is_trashed\s*=\s*false'; Unique=$true }
        'uq_circle_schedule_slots_not_trashed_day_time' = [pscustomobject]@{ Table='circle_schedule_slots'; Columns='circle_id,day_of_week,starts_at'; PredicatePattern='is_trashed\s*=\s*false'; Unique=$true }
        'ix_audit_log_enrollment_lifecycle' = [pscustomobject]@{ Table='audit_log'; Columns='entity_type,entity_id,action_code,occurred_at,id'; PredicatePattern='^$'; Unique=$false }
        'ix_schedule_slots_active_day_lookup' = [pscustomobject]@{ Table='circle_schedule_slots'; Columns='day_of_week,starts_at,circle_id,duration_minutes'; PredicatePattern='is_active.*is_trashed'; Unique=$false }
    }
    $functionsByMigration = @{
        '011_enrollment_lifecycle_audit_index' = @('dar_enrollment_status_at_date','dar_enrollment_is_attendance_eligible_on_date','dar_enrollment_has_active_day_in_month')
        '012_teacher_schedule_no_overlap' = @('dar_teacher_has_schedule_overlap')
    }
    $functionSpecifications = @{
        'dar_enrollment_status_at_date' = [pscustomobject]@{ Arguments='uuid, date'; Result='text'; Volatility='s' }
        'dar_enrollment_is_attendance_eligible_on_date' = [pscustomobject]@{ Arguments='uuid, date'; Result='boolean'; Volatility='s' }
        'dar_enrollment_has_active_day_in_month' = [pscustomobject]@{ Arguments='uuid, date'; Result='boolean'; Volatility='s' }
        'dar_teacher_has_schedule_overlap' = [pscustomobject]@{ Arguments='uuid, smallint, time without time zone, integer, uuid, uuid'; Result='boolean'; Volatility='v' }
    }
    $triggersByMigration = @{
        '012_teacher_schedule_no_overlap' = @('trg_circle_schedule_slots_teacher_overlap','trg_circles_teacher_schedule_overlap')
    }
    $triggerSpecifications = @{
        'trg_circle_schedule_slots_teacher_overlap' = [pscustomobject]@{ Table='circle_schedule_slots'; Function='dar_guard_schedule_slot_teacher_overlap' }
        'trg_circles_teacher_schedule_overlap' = [pscustomobject]@{ Table='circles'; Function='dar_guard_circle_teacher_schedule_overlap' }
    }
    foreach ($migration in $migrationTables.Keys) {
        if ($AppliedMigrations -contains $migration) {
            foreach ($table in $migrationTables[$migration]) { if (-not $expectedTables.Contains($table)) { $expectedTables.Add($table) } }
            if ($columnsByMigration.Contains($migration)) {
                foreach ($column in $columnsByMigration[$migration]) { if (-not $expectedColumns.Contains($column)) { $expectedColumns.Add($column) } }
            }
            if ($foreignKeysByMigration.ContainsKey($migration)) {
                foreach ($name in $foreignKeysByMigration[$migration]) {
                    if (-not $expectedForeignKeys.Contains($name)) { $expectedForeignKeys.Add($name) }
                    if ($foreignKeySpecifications.ContainsKey($name)) {
                        $specification = $foreignKeySpecifications[$name]
                        $expectedForeignKeySpecifications.Add([pscustomobject]@{ Name=$name; Table=$specification.Table; Column=$specification.Column; TargetTable=$specification.TargetTable; TargetColumn=$specification.TargetColumn })
                    }
                }
            }
            if ($indexesByMigration.ContainsKey($migration)) {
                foreach ($name in $indexesByMigration[$migration]) {
                    if (-not $expectedIndexes.Contains($name)) { $expectedIndexes.Add($name) }
                    if ($indexSpecifications.ContainsKey($name)) {
                        $specification = $indexSpecifications[$name]
                        $expectedIndexSpecifications.Add([pscustomobject]@{ Name=$name; Table=$specification.Table; Columns=$specification.Columns; PredicatePattern=$specification.PredicatePattern; Unique=$specification.Unique })
                    }
                }
            }
            if ($functionsByMigration.ContainsKey($migration)) {
                foreach ($name in $functionsByMigration[$migration]) {
                    if ($functionSpecifications.ContainsKey($name)) {
                        $specification = $functionSpecifications[$name]
                        $expectedFunctionSpecifications.Add([pscustomobject]@{ Name=$name; Arguments=$specification.Arguments; Result=$specification.Result; Volatility=$specification.Volatility })
                    }
                }
            }
            if ($triggersByMigration.ContainsKey($migration)) {
                foreach ($name in $triggersByMigration[$migration]) {
                    if ($triggerSpecifications.ContainsKey($name)) {
                        $specification = $triggerSpecifications[$name]
                        $expectedTriggerSpecifications.Add([pscustomobject]@{ Name=$name; Table=$specification.Table; Function=$specification.Function })
                    }
                }
            }
        }
    }
    $expectedTables.Add('schema_migrations')
    foreach ($column in @('schema_migrations.version', 'schema_migrations.applied_at')) { if (-not $expectedColumns.Contains($column)) { $expectedColumns.Add($column) } }
    return [pscustomobject]@{
        MigrationCount = $AppliedMigrations.Count
        AppliedMigrations = @($AppliedMigrations)
        RequiredTables = @($expectedTables)
        RequiredColumns = @($expectedColumns)
        RequiredForeignKeys = @($expectedForeignKeys)
        RequiredForeignKeySpecifications = @($expectedForeignKeySpecifications)
        RequiredIndexes = @($expectedIndexes)
        RequiredIndexSpecifications = @($expectedIndexSpecifications)
        RequiredFunctionSpecifications = @($expectedFunctionSpecifications)
        RequiredTriggerSpecifications = @($expectedTriggerSpecifications)
    }
}

function Test-DarDatabaseExists($Secrets, [string]$DatabaseName) {
    if ($DatabaseName -notmatch '^[a-z][a-z0-9_]{0,62}$') { throw 'اسم قاعدة البيانات غير صالح.' }
    $result = Invoke-DarPgTool -Tool 'psql' -Arguments @('-h','127.0.0.1','-p',[string]$Secrets.Port,'-U','postgres','-d','postgres','-At','-v','ON_ERROR_STOP=1','-c',("SELECT 1 FROM pg_database WHERE datname='$DatabaseName';")) -Password $Secrets.PostgresAdminPassword -AllowFailure
    if ($result.ExitCode -ne 0) {
        $detail = ($result.Output | ForEach-Object { [string]$_ }) -join [Environment]::NewLine
        throw "تعذر التحقق من وجود قاعدة البيانات '$DatabaseName'. $detail"
    }
    return ((($result.Output | ForEach-Object { [string]$_ }) -join '').Trim() -eq '1')
}

function New-DarDatabase([string]$DatabaseName, $Secrets) {
    if ($DatabaseName -notmatch '^[a-z][a-z0-9_]{0,62}$') { throw 'اسم قاعدة البيانات غير صالح.' }
    $sql = "CREATE DATABASE $DatabaseName OWNER $($Secrets.AppUser) ENCODING 'UTF8' TEMPLATE template0;"
    Invoke-DarPgTool -Tool 'psql' -Arguments @('-h','127.0.0.1','-p',[string]$Secrets.Port,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c',$sql) -Password $Secrets.PostgresAdminPassword | Out-Null
}

function Get-DarDatabaseRestoreReport($Secrets, [string]$DatabaseName) {
    if ($DatabaseName -notmatch '^[a-z][a-z0-9_]{0,62}$') { throw 'اسم قاعدة البيانات غير صالح لفحص الاستعادة.' }
    $tableResult = Invoke-DarPgTool -Tool 'psql' -Arguments @('-h','127.0.0.1','-p',[string]$Secrets.Port,'-U',$Secrets.AppUser,'-d',$DatabaseName,'-At','-v','ON_ERROR_STOP=1','-c',"SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name;") -Password $Secrets.AppPassword
    $tableNames = @($tableResult.Output | ForEach-Object { ([string]$_).Trim() } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    if ($tableNames -notcontains 'schema_migrations') {
        throw 'قاعدة الاستعادة لا تحتوي schema_migrations؛ لا يمكن تحديد إصدار المخطط أو إثبات اكتماله.'
    }

    $migrationResult = Invoke-DarPgTool -Tool 'psql' -Arguments @('-h','127.0.0.1','-p',[string]$Secrets.Port,'-U',$Secrets.AppUser,'-d',$DatabaseName,'-At','-v','ON_ERROR_STOP=1','-c','SELECT version FROM public.schema_migrations ORDER BY version;') -Password $Secrets.AppPassword
    $appliedMigrations = @($migrationResult.Output | ForEach-Object { ([string]$_).Trim() } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    if ($appliedMigrations.Count -eq 0) { throw 'سجل schema_migrations فارغ؛ لا يمكن إثبات إصدار القاعدة.' }
    $expectedSchema = Get-DarExpectedSchemaForMigrations -AppliedMigrations $appliedMigrations
    $missingTables = @($expectedSchema.RequiredTables | Where-Object { $tableNames -notcontains $_ })
    if ($missingTables.Count -gt 0) {
        throw ('قاعدة الاستعادة ناقصة الجداول المطلوبة وفق الترحيلات المسجلة: ' + ($missingTables -join ', ') + '.')
    }

    $missingColumns = @()
    if ($expectedSchema.RequiredColumns.Count -gt 0) {
        $columnValues = ($expectedSchema.RequiredColumns | ForEach-Object {
            $parts = $_.Split('.', 2)
            "('" + $parts[0].Replace("'", "''") + "','" + $parts[1].Replace("'", "''") + "')"
        }) -join ','
        $columnSql = "SELECT required.table_name || '.' || required.column_name FROM (VALUES $columnValues) AS required(table_name,column_name) WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema='public' AND c.table_name=required.table_name AND c.column_name=required.column_name);"
        $columnResult = Invoke-DarPgTool -Tool 'psql' -Arguments @('-h','127.0.0.1','-p',[string]$Secrets.Port,'-U',$Secrets.AppUser,'-d',$DatabaseName,'-At','-v','ON_ERROR_STOP=1','-c',$columnSql) -Password $Secrets.AppPassword
        $missingColumns = @($columnResult.Output | ForEach-Object { ([string]$_).Trim() } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    }
    if ($missingColumns.Count -gt 0) { throw ('قاعدة الاستعادة تفتقد أعمدة مطلوبة وفق الترحيلات المسجلة: ' + ($missingColumns -join ', ') + '.') }

    $countQueries = @()
    foreach ($tableName in $tableNames) {
        $literalName = $tableName.Replace("'", "''")
        $quotedIdentifier = '"' + $tableName.Replace('"','""') + '"'
        $countQueries += "SELECT '$literalName' AS table_name, COUNT(*)::bigint AS row_count FROM public.$quotedIdentifier"
    }
    $countSql = $countQueries -join ' UNION ALL '
    $countResult = Invoke-DarPgTool -Tool 'psql' -Arguments @('-h','127.0.0.1','-p',[string]$Secrets.Port,'-U',$Secrets.AppUser,'-d',$DatabaseName,'-At','-F','|','-v','ON_ERROR_STOP=1','-c',$countSql) -Password $Secrets.AppPassword
    $tableCounts = [ordered]@{}
    foreach ($lineObject in @($countResult.Output)) {
        $line = ([string]$lineObject).Trim()
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        $parts = $line.Split('|')
        if ($parts.Count -ge 2) {
            $rowCount = [long]0
            if (-not [long]::TryParse($parts[1], [ref]$rowCount)) { throw "تعذر قراءة عدد سجلات الجدول '$($parts[0])'." }
            $tableCounts[[string]$parts[0]] = $rowCount
        }
    }
    if ($tableCounts.Count -ne $tableNames.Count) { throw 'تعذر استخراج أعداد السجلات لكل جداول قاعدة الاستعادة.' }

    $metadataSql = "SELECT pg_encoding_to_char(encoding) || '|' || (SELECT COUNT(*) FROM pg_constraint WHERE connamespace='public'::regnamespace AND contype='f') || '|' || (SELECT COUNT(*) FROM pg_constraint WHERE connamespace='public'::regnamespace AND contype='f' AND NOT convalidated) || '|' || (SELECT COUNT(*) FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND (NOT i.indisvalid OR NOT i.indisready)) || '|' || pg_database_size(oid)::text FROM pg_database WHERE datname=current_database();"
    $metadataResult = Invoke-DarPgTool -Tool 'psql' -Arguments @('-h','127.0.0.1','-p',[string]$Secrets.Port,'-U',$Secrets.AppUser,'-d',$DatabaseName,'-At','-v','ON_ERROR_STOP=1','-c',$metadataSql) -Password $Secrets.AppPassword
    $metadataLine = @($metadataResult.Output | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ -match '\|' } | Select-Object -First 1)
    if ($metadataLine.Count -eq 0) { throw 'تعذر قراءة بيانات ترميز قاعدة الاستعادة والقيود والفهارس.' }
    $metadata = ([string]$metadataLine[0]).Split('|')
    if ($metadata.Count -ne 5) { throw 'بيانات تقرير سلامة قاعدة الاستعادة غير مكتملة.' }
    $foreignKeyCount = [int]$metadata[1]
    $unvalidatedForeignKeys = [int]$metadata[2]
    $invalidIndexes = [int]$metadata[3]
    $sizeBytes = [long]$metadata[4]
    if ($metadata[0] -ne 'UTF8') { throw "ترميز قاعدة الاستعادة هو '$($metadata[0])' وليس UTF8." }
    if ($unvalidatedForeignKeys -gt 0) { throw "توجد $unvalidatedForeignKeys قيود Foreign Key غير متحقق منها في قاعدة الاستعادة." }
    if ($invalidIndexes -gt 0) { throw "توجد $invalidIndexes فهارس غير صالحة أو غير جاهزة في قاعدة الاستعادة." }

    $missingFkNames = @()
    if ($expectedSchema.RequiredForeignKeySpecifications.Count -gt 0) {
        $foreignKeyValues = @($expectedSchema.RequiredForeignKeySpecifications | ForEach-Object {
            "('" + $_.Name.Replace("'", "''") + "','" + $_.Table.Replace("'", "''") + "','" + $_.Column.Replace("'", "''") + "','" + $_.TargetTable.Replace("'", "''") + "','" + $_.TargetColumn.Replace("'", "''") + "')"
        }) -join ','
        $fkSql = "SELECT required.name FROM (VALUES $foreignKeyValues) AS required(name,table_name,source_column,target_table,target_column) WHERE NOT EXISTS (SELECT 1 FROM pg_constraint constraint_row JOIN pg_class source_table ON source_table.oid=constraint_row.conrelid JOIN pg_namespace source_schema ON source_schema.oid=source_table.relnamespace JOIN pg_class target_table ON target_table.oid=constraint_row.confrelid JOIN pg_namespace target_schema ON target_schema.oid=target_table.relnamespace JOIN pg_attribute source_attribute ON source_attribute.attrelid=source_table.oid AND source_attribute.attname::text=required.source_column AND NOT source_attribute.attisdropped JOIN pg_attribute target_attribute ON target_attribute.attrelid=target_table.oid AND target_attribute.attname::text=required.target_column AND NOT target_attribute.attisdropped WHERE source_schema.nspname='public' AND target_schema.nspname='public' AND constraint_row.contype='f' AND constraint_row.conname=required.name AND source_table.relname=required.table_name AND target_table.relname=required.target_table AND cardinality(constraint_row.conkey)=1 AND cardinality(constraint_row.confkey)=1 AND constraint_row.conkey[1]=source_attribute.attnum AND constraint_row.confkey[1]=target_attribute.attnum);"
        $fkResult = Invoke-DarPgTool -Tool 'psql' -Arguments @('-h','127.0.0.1','-p',[string]$Secrets.Port,'-U',$Secrets.AppUser,'-d',$DatabaseName,'-At','-v','ON_ERROR_STOP=1','-c',$fkSql) -Password $Secrets.AppPassword
        $missingFkNames = @($fkResult.Output | ForEach-Object { ([string]$_).Trim() } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    }
    if ($missingFkNames.Count -gt 0) { throw ('قاعدة الاستعادة تفتقد علاقات Foreign Key مطلوبة وفق الترحيلات: ' + ($missingFkNames -join ', ') + '.') }

    $missingIndexNames = @()
    if ($expectedSchema.RequiredIndexSpecifications.Count -gt 0) {
        $indexValues = @($expectedSchema.RequiredIndexSpecifications | ForEach-Object {
            $uniqueLiteral = ([string]$_.Unique).ToLowerInvariant()
            "('" + $_.Name.Replace("'", "''") + "','" + $_.Table.Replace("'", "''") + "','" + $_.Columns.Replace("'", "''") + "','" + $_.PredicatePattern.Replace("'", "''") + "'," + $uniqueLiteral + ")"
        }) -join ','
        $indexSql = "SELECT required.name FROM (VALUES $indexValues) AS required(name,table_name,key_columns,predicate_pattern,is_unique) WHERE NOT EXISTS (SELECT 1 FROM pg_class index_class JOIN pg_namespace index_schema ON index_schema.oid=index_class.relnamespace JOIN pg_index i ON i.indexrelid=index_class.oid JOIN pg_class table_class ON table_class.oid=i.indrelid WHERE index_schema.nspname='public' AND index_class.relname=required.name AND index_class.relkind='i' AND table_class.relname=required.table_name AND i.indisunique=required.is_unique AND i.indisvalid AND i.indisready AND (SELECT string_agg(attribute.attname::text, ',' ORDER BY key_column.ordinality) FROM unnest(i.indkey) WITH ORDINALITY AS key_column(attnum,ordinality) JOIN pg_attribute attribute ON attribute.attrelid=i.indrelid AND attribute.attnum=key_column.attnum WHERE key_column.ordinality <= i.indnkeyatts)=required.key_columns AND COALESCE(pg_get_expr(i.indpred,i.indrelid),'') ~* required.predicate_pattern);"
        $indexResult = Invoke-DarPgTool -Tool 'psql' -Arguments @('-h','127.0.0.1','-p',[string]$Secrets.Port,'-U',$Secrets.AppUser,'-d',$DatabaseName,'-At','-v','ON_ERROR_STOP=1','-c',$indexSql) -Password $Secrets.AppPassword
        $missingIndexNames = @($indexResult.Output | ForEach-Object { ([string]$_).Trim() } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    }
    if ($missingIndexNames.Count -gt 0) { throw ('قاعدة الاستعادة تفتقد فهارس مطلوبة أو بها فهرس غير صالح أو غير مطابق: ' + ($missingIndexNames -join ', ') + '.') }

    $missingFunctionNames = @()
    if ($expectedSchema.RequiredFunctionSpecifications.Count -gt 0) {
        $functionValues = @($expectedSchema.RequiredFunctionSpecifications | ForEach-Object {
            "('" + $_.Name.Replace("'","''") + "','" + $_.Arguments.Replace("'","''") + "','" + $_.Result.Replace("'","''") + "','" + $_.Volatility.Replace("'","''") + "')"
        }) -join ','
        $functionSql = "SELECT required.name FROM (VALUES $functionValues) AS required(name,argument_types,result_type,volatility) WHERE NOT EXISTS (SELECT 1 FROM pg_proc procedure_row JOIN pg_namespace procedure_schema ON procedure_schema.oid=procedure_row.pronamespace WHERE procedure_schema.nspname='public' AND procedure_row.proname=required.name AND procedure_row.prokind='f' AND oidvectortypes(procedure_row.proargtypes)=required.argument_types AND pg_get_function_result(procedure_row.oid)=required.result_type AND procedure_row.provolatile=required.volatility AND procedure_row.prosecdef=FALSE);"
        $functionResult = Invoke-DarPgTool -Tool 'psql' -Arguments @('-h','127.0.0.1','-p',[string]$Secrets.Port,'-U',$Secrets.AppUser,'-d',$DatabaseName,'-At','-v','ON_ERROR_STOP=1','-c',$functionSql) -Password $Secrets.AppPassword
        $missingFunctionNames = @($functionResult.Output | ForEach-Object { ([string]$_).Trim() } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    }
    if ($missingFunctionNames.Count -gt 0) { throw ('قاعدة الاستعادة تفتقد دوال المخطط المطلوبة أو أن توقيعها/صلاحيتها غير مطابق: ' + ($missingFunctionNames -join ', ') + '.') }

    $missingTriggerNames = @()
    if ($expectedSchema.RequiredTriggerSpecifications.Count -gt 0) {
        $triggerValues = @($expectedSchema.RequiredTriggerSpecifications | ForEach-Object {
            "('" + $_.Name.Replace("'","''") + "','" + $_.Table.Replace("'","''") + "','" + $_.Function.Replace("'","''") + "')"
        }) -join ','
        $triggerSql = "SELECT required.name FROM (VALUES $triggerValues) AS required(name,table_name,function_name) WHERE NOT EXISTS (SELECT 1 FROM pg_trigger trigger_row JOIN pg_class table_class ON table_class.oid=trigger_row.tgrelid JOIN pg_namespace table_schema ON table_schema.oid=table_class.relnamespace JOIN pg_proc trigger_function ON trigger_function.oid=trigger_row.tgfoid JOIN pg_namespace function_schema ON function_schema.oid=trigger_function.pronamespace WHERE table_schema.nspname='public' AND function_schema.nspname='public' AND table_class.relname=required.table_name AND trigger_function.proname=required.function_name AND trigger_row.tgname=required.name AND NOT trigger_row.tgisinternal AND trigger_row.tgenabled IN ('O','A'));"
        $triggerResult = Invoke-DarPgTool -Tool 'psql' -Arguments @('-h','127.0.0.1','-p',[string]$Secrets.Port,'-U',$Secrets.AppUser,'-d',$DatabaseName,'-At','-v','ON_ERROR_STOP=1','-c',$triggerSql) -Password $Secrets.AppPassword
        $missingTriggerNames = @($triggerResult.Output | ForEach-Object { ([string]$_).Trim() } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    }
    if ($missingTriggerNames.Count -gt 0) { throw ('قاعدة الاستعادة تفتقد مشغلات حماية تداخل مواعيد المعلمات أو أنها معطلة: ' + ($missingTriggerNames -join ', ') + '.') }

    return [pscustomobject]@{
        DatabaseName = $DatabaseName
        Encoding = [string]$metadata[0]
        TableCount = $tableNames.Count
        RequiredTableCount = $expectedSchema.RequiredTables.Count
        AppliedMigrationCount = $expectedSchema.MigrationCount
        AppliedMigrations = $expectedSchema.AppliedMigrations
        RequiredTables = $expectedSchema.RequiredTables
        RequiredColumnCount = $expectedSchema.RequiredColumns.Count
        RequiredColumns = $expectedSchema.RequiredColumns
        MissingColumns = @($missingColumns)
        ForeignKeyCount = $foreignKeyCount
        RequiredForeignKeyCount = $expectedSchema.RequiredForeignKeys.Count
        RequiredForeignKeySpecifications = $expectedSchema.RequiredForeignKeySpecifications
        MissingForeignKeys = @($missingFkNames)
        UnvalidatedForeignKeyCount = $unvalidatedForeignKeys
        InvalidIndexCount = $invalidIndexes
        RequiredIndexes = $expectedSchema.RequiredIndexes
        RequiredIndexSpecifications = $expectedSchema.RequiredIndexSpecifications
        MissingRequiredIndexes = @($missingIndexNames)
        RequiredFunctions = @($expectedSchema.RequiredFunctionSpecifications | ForEach-Object { $_.Name })
        RequiredFunctionCount = $expectedSchema.RequiredFunctionSpecifications.Count
        RequiredTriggers = @($expectedSchema.RequiredTriggerSpecifications | ForEach-Object { $_.Name })
        RequiredTriggerCount = $expectedSchema.RequiredTriggerSpecifications.Count
        RequiredTriggerSpecifications = @($expectedSchema.RequiredTriggerSpecifications)
        MissingRequiredTriggers = @($missingTriggerNames)
        DatabaseSizeBytes = $sizeBytes
        TableCounts = $tableCounts
    }
}

function Test-DarRestoredSchema($Secrets, [string]$DatabaseName) {
    try { [void](Get-DarDatabaseRestoreReport -Secrets $Secrets -DatabaseName $DatabaseName); return $true }
    catch { throw "فشل فحص سلامة قاعدة الاستعادة '$DatabaseName': $($_.Exception.Message)" }
}

function ConvertTo-DarPathKey([string]$Path) {
    $fullPath = [System.IO.Path]::GetFullPath($Path).Replace('/', '\')
    return $fullPath.TrimEnd([char[]]@('\')).ToLowerInvariant()
}

function Test-DarTcpPortListening([int]$Port) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $pending = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
        if (-not $pending.AsyncWaitHandle.WaitOne(700)) { return $false }
        $client.EndConnect($pending)
        return $client.Connected
    } catch {
        return $false
    } finally {
        $client.Close()
    }
}

function Get-DarPostmasterPid($Paths) {
    $pidFile = Join-Path $Paths.Data 'postmaster.pid'
    if (-not (Test-Path -LiteralPath $pidFile -PathType Leaf)) { return $null }
    $firstLine = (Get-Content -LiteralPath $pidFile -TotalCount 1 -ErrorAction Stop | Select-Object -First 1)
    $parsedPid = 0
    if (-not [int]::TryParse(([string]$firstLine).Trim(), [ref]$parsedPid) -or $parsedPid -le 0) {
        throw "ملف postmaster.pid موجود لكنه لا يحتوي رقم عملية صالحًا: $pidFile. لم يتم حذف الملف أو تعديل البيانات."
    }
    return $parsedPid
}

function Get-DarRunningPostgresIdentity($Secrets) {
    $sql = "SELECT current_setting('data_directory') || '|' || current_setting('port');"
    $result = Invoke-DarPgTool -Tool 'psql' -Arguments @('-h','127.0.0.1','-p',[string]$Secrets.Port,'-U','postgres','-d','postgres','-At','-F','|','-v','ON_ERROR_STOP=1','-c',$sql) -Password $Secrets.PostgresAdminPassword -AllowFailure -ConnectTimeout 5
    if ($result.ExitCode -ne 0) { return $null }
    foreach ($line in @($result.Output)) {
        $value = ([string]$line).Trim()
        if ($value -match '^(.+)\|([0-9]+)$') {
            return [pscustomobject]@{ DataDirectory = $matches[1]; Port = [int]$matches[2] }
        }
    }
    return $null
}

function Test-DarExpectedPostgresIdentity($Secrets, $Paths) {
    $identity = Get-DarRunningPostgresIdentity -Secrets $Secrets
    if ($null -eq $identity) { return $false }
    $expectedPath = ConvertTo-DarPathKey -Path $Paths.Data
    $actualPath = ConvertTo-DarPathKey -Path $identity.DataDirectory
    if ($identity.Port -ne [int]$Secrets.Port -or $actualPath -ne $expectedPath) {
        throw "المنفذ المحلي $($Secrets.Port) مستخدم بالفعل بواسطة PostgreSQL آخر أو بواسطة مجلد بيانات مختلف:`r`n$($identity.DataDirectory)`r`nلم يتم إيقاف أي عملية أو حذف أي ملف. أغلق الخادم الآخر أو غيّر إعداده يدويًا بعد التأكد من مصدره."
    }
    return $true
}

function Get-DarPostgresLogTail($Paths) {
    if (-not (Test-Path -LiteralPath $Paths.PostgresLog -PathType Leaf)) {
        return "لم يُنشأ سجل PostgreSQL بعد: $($Paths.PostgresLog)"
    }
    $lines = @(Get-Content -LiteralPath $Paths.PostgresLog -Tail 35 -ErrorAction SilentlyContinue)
    return "آخر رسائل PostgreSQL ($($Paths.PostgresLog)):`r`n" + ($lines -join [Environment]::NewLine)
}

function Wait-DarPostgresReady($Secrets, $Paths, [int]$TimeoutSeconds = 60) {
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        if (Test-DarTcpPortListening -Port ([int]$Secrets.Port)) {
            if (Test-DarExpectedPostgresIdentity -Secrets $Secrets -Paths $Paths) { return $true }
        }
        Start-Sleep -Seconds 1
    } while ([DateTime]::UtcNow -lt $deadline)
    return $false
}

function Start-DarPostgresServer($Secrets, $Paths) {
    $status = Invoke-DarPgTool -Tool 'pg_ctl' -Arguments @('status','-D',$Paths.Data) -Password '' -AllowFailure
    if ($status.ExitCode -eq 0) {
        if (Wait-DarPostgresReady -Secrets $Secrets -Paths $Paths -TimeoutSeconds 60) { return }
        throw "pg_ctl يرى أن PostgreSQL يعمل، لكن تعذر إثبات أن الاتصال يعود إلى قاعدة دار التحفيظ المتوقعة على المنفذ $($Secrets.Port). لم يتم تشغيل نسخة ثانية.`r`n$(Get-DarPostgresLogTail -Paths $Paths)"
    }

    $pidFile = Join-Path $Paths.Data 'postmaster.pid'
    $recordedPid = Get-DarPostmasterPid -Paths $Paths
    if ($null -ne $recordedPid) {
        $recordedProcess = Get-Process -Id $recordedPid -ErrorAction SilentlyContinue
        if ($null -ne $recordedProcess) {
            if (Wait-DarPostgresReady -Secrets $Secrets -Paths $Paths -TimeoutSeconds 60) { return }
            throw "ملف PostgreSQL يسجل PID=$recordedPid وهذه العملية ما زالت موجودة، لكن لم أستطع إثبات أنها خادم دار التحفيظ على المنفذ $($Secrets.Port). حفاظًا على البيانات لم أوقف العملية ولم أحذف postmaster.pid.`r`n$(Get-DarPostgresLogTail -Paths $Paths)"
        }

        if (Test-DarTcpPortListening -Port ([int]$Secrets.Port)) {
            if (Test-DarExpectedPostgresIdentity -Secrets $Secrets -Paths $Paths) { return }
            throw "ملف postmaster.pid يشير إلى عملية غير موجودة (PID=$recordedPid)، لكن المنفذ $($Secrets.Port) ما زال مستخدمًا بواسطة خدمة لم أتمكن من التحقق منها. لم يتم حذف الملف أو تشغيل خادم آخر."
        }

        # Recheck immediately before preserving the stale lock file to avoid racing another launcher.
        $statusAgain = Invoke-DarPgTool -Tool 'pg_ctl' -Arguments @('status','-D',$Paths.Data) -Password '' -AllowFailure
        if ($statusAgain.ExitCode -eq 0 -and (Wait-DarPostgresReady -Secrets $Secrets -Paths $Paths -TimeoutSeconds 10)) { return }
        $stalePidFile = "$pidFile.stale.$(Get-Date -Format 'yyyyMMdd_HHmmss_fff')"
        Move-Item -LiteralPath $pidFile -Destination $stalePidFile -ErrorAction Stop
        Write-DarPostgresStep "A stale PostgreSQL PID file was preserved as $([System.IO.Path]::GetFileName($stalePidFile)); its process is not running and the local port is free."
    } elseif (Test-DarTcpPortListening -Port ([int]$Secrets.Port)) {
        if (Test-DarExpectedPostgresIdentity -Secrets $Secrets -Paths $Paths) { return }
        throw "المنفذ $($Secrets.Port) مستخدم بالفعل ولا توجد هوية PostgreSQL مطابقة لقاعدة دار التحفيظ. لم يتم تشغيل خادم إضافي."
    }

    Write-DarPostgresStep 'Starting the local PostgreSQL database engine...'
    $options = "-h 127.0.0.1 -p $($Secrets.Port) -c listen_addresses=127.0.0.1 -c password_encryption=scram-sha-256"
    $startResult = Invoke-DarPgTool -Tool 'pg_ctl' -Arguments @('start','-D',$Paths.Data,'-l',$Paths.PostgresLog,'-o',$options,'-w','-t','60') -Password '' -AllowFailure
    Write-DarPostgresStep 'The PostgreSQL start command returned. Verifying the local server identity and database connection...'
    if (Wait-DarPostgresReady -Secrets $Secrets -Paths $Paths -TimeoutSeconds 60) {
        Write-DarPostgresStep 'PostgreSQL is ready and its data directory matches Dar Eltahfeez.'
        return
    }

    $startOutput = (@($startResult.Output) | ForEach-Object { [string]$_ }) -join [Environment]::NewLine
    if ([string]::IsNullOrWhiteSpace($startOutput)) { $startOutput = 'لم يُرجع pg_ctl تفاصيل إضافية.' }
    throw "تعذر بدء PostgreSQL المحلي (Exit $($startResult.ExitCode)).`r`n$startOutput`r`n$(Get-DarPostgresLogTail -Paths $Paths)"
}

function Initialize-DarApplicationDatabase($Secrets, $Paths, [string]$BackupPath) {
    $roleCheck = Invoke-DarPgTool -Tool 'psql' -Arguments @('-h','127.0.0.1','-p',[string]$Secrets.Port,'-U','postgres','-d','postgres','-At','-v','ON_ERROR_STOP=1','-c',("SELECT 1 FROM pg_roles WHERE rolname='$($Secrets.AppUser)';")) -Password $Secrets.PostgresAdminPassword
    $roleExists = ((($roleCheck.Output | ForEach-Object { [string]$_ }) -join '').Trim() -eq '1')
    $roleSql = if ($roleExists) {
        "ALTER ROLE $($Secrets.AppUser) WITH LOGIN PASSWORD '$($Secrets.AppPassword)';"
    } else {
        "CREATE ROLE $($Secrets.AppUser) LOGIN PASSWORD '$($Secrets.AppPassword)';"
    }
    Invoke-DarPgTool -Tool 'psql' -Arguments @('-h','127.0.0.1','-p',[string]$Secrets.Port,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c',$roleSql) -Password $Secrets.PostgresAdminPassword | Out-Null

    if ([string]::IsNullOrWhiteSpace($BackupPath)) {
        New-DarDatabase -DatabaseName $Secrets.Database -Secrets $Secrets
        return
    }

    Test-DarBackupArchive -BackupPath $BackupPath | Out-Null
    $stageDatabase = 'dar_restore_' + (Get-Date -Format 'yyyyMMdd_HHmmss')
    if (Test-DarDatabaseExists -Secrets $Secrets -DatabaseName $stageDatabase) {
        throw "قاعدة مؤقتة باسم $stageDatabase موجودة بالفعل. لم يتم حذفها أو استبدالها."
    }
    New-DarDatabase -DatabaseName $stageDatabase -Secrets $Secrets
    Write-DarPostgresStep 'Restoring the selected full backup into a temporary database...'
    Invoke-DarPgTool -Tool 'pg_restore' -Arguments @('--no-owner','--no-privileges','--exit-on-error','--single-transaction','-h','127.0.0.1','-p',[string]$Secrets.Port,'-U',$Secrets.AppUser,'-d',$stageDatabase,$BackupPath) -Password $Secrets.AppPassword | Out-Null
    if (-not (Test-DarRestoredSchema -Secrets $Secrets -DatabaseName $stageDatabase)) {
        throw 'فشل فحص الجداول الأساسية بعد الاستعادة. تم الاحتفاظ بقاعدة الاستعادة المؤقتة ولم يتم اعتمادها للتشغيل.'
    }
    Invoke-DarPgTool -Tool 'psql' -Arguments @('-h','127.0.0.1','-p',[string]$Secrets.Port,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c',"ALTER DATABASE $stageDatabase RENAME TO $($Secrets.Database);") -Password $Secrets.PostgresAdminPassword | Out-Null
    Write-DarPostgresStep 'The database backup was restored and passed the required table checks.'
}

function Get-DarFirstRunBackupChoice {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $choice = [System.Windows.Forms.MessageBox]::Show(
        "لم يتم العثور على قاعدة بيانات دار التحفيظ على هذا الجهاز.`r`n`r`nنعم: استعادة نسخة احتياطية كاملة من الجهاز السابق.`r`nلا: إنشاء دار جديدة بقاعدة فارغة.`r`nإلغاء: الخروج دون إنشاء قاعدة بيانات.",
        'إعداد قاعدة بيانات دار التحفيظ',
        [System.Windows.Forms.MessageBoxButtons]::YesNoCancel,
        [System.Windows.Forms.MessageBoxIcon]::Question)
    if ($choice -eq [System.Windows.Forms.DialogResult]::Cancel) { return [pscustomobject]@{ Cancelled = $true; BackupPath = $null } }
    if ($choice -eq [System.Windows.Forms.DialogResult]::No) { return [pscustomobject]@{ Cancelled = $false; BackupPath = $null } }

    $dialog = New-Object System.Windows.Forms.OpenFileDialog
    $dialog.Title = 'اختر النسخة الاحتياطية الكاملة لدار التحفيظ'
    $dialog.Filter = 'PostgreSQL Backup (*.backup;*.dump)|*.backup;*.dump|All files (*.*)|*.*'
    $dialog.CheckFileExists = $true
    $dialog.Multiselect = $false
    if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { return [pscustomobject]@{ Cancelled = $true; BackupPath = $null } }
    return [pscustomobject]@{ Cancelled = $false; BackupPath = $dialog.FileName }
}

function Initialize-DarLocalPostgresLocked([string]$ProjectRoot) {
    $paths = Get-DarLocalPaths
    New-Item -ItemType Directory -Force -Path $paths.DatabaseFolder,$paths.Logs | Out-Null
    if (-not $paths.BackupFolderIsCustom) { New-Item -ItemType Directory -Force -Path $paths.BackupFolder | Out-Null }
    $script:DarPgBin = Get-DarPostgresBin -ProjectRoot $ProjectRoot -DownloadIfMissing
    $versionResult = Invoke-DarPgTool -Tool 'pg_ctl' -Arguments @('--version') -Password ''
    if ((($versionResult.Output | ForEach-Object { [string]$_ }) -join ' ') -notmatch '17\.') {
        throw 'محرك PostgreSQL المرفق ليس من الإصدار الرئيسي 17 المتوافق مع قاعدة بيانات الدار.'
    }

    $secrets = Get-DarDatabaseSecrets
    Assert-DarDatabaseSecrets -Secrets $secrets
    $hasCluster = Test-Path (Join-Path $paths.Data 'PG_VERSION')
    if (-not $hasCluster) {
        $entries = @(Get-ChildItem -LiteralPath $paths.Data -Force -ErrorAction SilentlyContinue)
        if ($entries.Count -gt 0) {
            throw 'مجلد قاعدة البيانات يحتوي ملفات لكنه ليس عنقود PostgreSQL مكتملًا. لم يتم حذف أو تهيئة أي ملف.'
        }
        $choice = Get-DarFirstRunBackupChoice
        if ($choice.Cancelled) { throw 'تم إلغاء الإعداد دون إنشاء قاعدة بيانات أو تعديل أي بيانات موجودة.' }
        $backupPath = $choice.BackupPath
        if ($backupPath) { Test-DarBackupArchive -BackupPath $backupPath | Out-Null }

        $passwordFile = Join-Path $paths.DatabaseFolder 'initdb-password.tmp'
        [System.IO.File]::WriteAllText($passwordFile, [string]$secrets.PostgresAdminPassword, [System.Text.UTF8Encoding]::new($false))
        try {
            Write-DarPostgresStep 'Initializing the private local PostgreSQL data directory...'
            Invoke-DarPgTool -Tool 'initdb' -Arguments @('-D',$paths.Data,'-U','postgres','--encoding=UTF8','--no-locale','--auth-host=scram-sha-256','--auth-local=scram-sha-256',"--pwfile=$passwordFile") -Password '' | Out-Null
        } finally { Remove-Item -LiteralPath $passwordFile -Force -ErrorAction SilentlyContinue }
    }

    Start-DarPostgresServer -Secrets $secrets -Paths $paths
    $databaseExists = Test-DarDatabaseExists -Secrets $secrets -DatabaseName $secrets.Database
    if (-not $databaseExists) {
        if ($hasCluster) {
            $choice = Get-DarFirstRunBackupChoice
            if ($choice.Cancelled) { throw 'تم إلغاء الاستعادة. قاعدة البيانات الحالية لم يتم حذفها أو تغييرها.' }
            Initialize-DarApplicationDatabase -Secrets $secrets -Paths $paths -BackupPath $choice.BackupPath
        } else {
            Initialize-DarApplicationDatabase -Secrets $secrets -Paths $paths -BackupPath $backupPath
        }
    }

    $check = Invoke-DarPgTool -Tool 'psql' -Arguments @('-h','127.0.0.1','-p',[string]$secrets.Port,'-U',$secrets.AppUser,'-d',$secrets.Database,'-At','-v','ON_ERROR_STOP=1','-c','SELECT 1;') -Password $secrets.AppPassword
    if ((($check.Output | ForEach-Object { [string]$_ }) -join '').Trim() -ne '1') {
        throw 'تم تشغيل محرك قاعدة البيانات لكن فشل اختبار الاتصال بقاعدة دار التحفيظ.'
    }

    Write-DarApiConnectionSettings -Secrets $secrets
    $env:DAR_POSTGRES_BIN = $script:DarPgBin
    $env:DAR_DATABASE_PORT = [string]$secrets.Port
    Write-DarPostgresStep 'The local PostgreSQL engine and Dar database are ready. Docker is not used.'
}

function Ensure-DarLocalPostgres([string]$ProjectRoot) {
    $mutex = [System.Threading.Mutex]::new($false, 'Global\DarEltahfeez_Postgres_55432')
    $ownsMutex = $false
    try {
        try {
            $ownsMutex = $mutex.WaitOne([TimeSpan]::FromSeconds(30))
        } catch [System.Threading.AbandonedMutexException] {
            # The previous launcher exited unexpectedly; this process now owns the mutex.
            $ownsMutex = $true
        }
        if (-not $ownsMutex) {
            throw 'هناك عملية أخرى تقوم بتهيئة قاعدة بيانات دار التحفيظ الآن. انتظر إغلاق نافذتها ثم أعد المحاولة.'
        }
        Initialize-DarLocalPostgresLocked -ProjectRoot $ProjectRoot
    } finally {
        if ($ownsMutex) { $mutex.ReleaseMutex() }
        if ($null -ne $mutex) { $mutex.Dispose() }
    }
}

function Assert-DarApplicationClosed {
    $listeners = @(Get-NetTCPConnection -LocalPort 5080 -State Listen -ErrorAction SilentlyContinue)
    if ($listeners.Count -gt 0) {
        throw 'أغلق تطبيق دار التحفيظ بالكامل قبل الاستعادة. يجب إيقاف نافذة التطبيق والخادم المحلي أولًا حتى لا تتغير البيانات أثناء النقل.'
    }
}

function New-DarDatabaseBackup([string]$DestinationPath, $Secrets) {
    Assert-DarDatabaseSecrets -Secrets $Secrets
    $backupMutex = [System.Threading.Mutex]::new($false,'Global\DarEltahfeez.AutomaticBackup')
    $ownsBackupMutex = $false
    try {
        try { $ownsBackupMutex = $backupMutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $ownsBackupMutex = $true }
        if (-not $ownsBackupMutex) { throw 'توجد عملية نسخ احتياطي أو نقل لمجلد النسخ قيد التنفيذ. انتظر اكتمالها ثم أعد المحاولة.' }
        $destinationFolder = Split-Path -Parent $DestinationPath
        if (-not [string]::IsNullOrWhiteSpace($destinationFolder)) { New-Item -ItemType Directory -Force -Path $destinationFolder | Out-Null }
        if (Test-Path -LiteralPath $DestinationPath) { throw 'الملف الوجهة موجود بالفعل. اختر اسمًا آخر حتى لا يتم استبدال نسخة سابقة.' }
        try {
            $arguments = @(
                '--host','127.0.0.1','--port',[string]$Secrets.Port,
                '--username',$Secrets.AppUser,'--dbname',$Secrets.Database,
                '--format=custom','--no-owner','--no-privileges','--file',$DestinationPath
            )
            Invoke-DarPgTool -Tool 'pg_dump' -Arguments $arguments -Password $Secrets.AppPassword | Out-Null
            $file = Get-Item -LiteralPath $DestinationPath
            if ($file.Length -lt 128) { throw 'ملف النسخة الاحتياطية أصغر من الحجم المتوقع؛ لم يتم اعتماد النسخة.' }
            Test-DarBackupArchive -BackupPath $DestinationPath | Out-Null
            return $file
        } catch {
            Remove-Item -LiteralPath $DestinationPath -Force -ErrorAction SilentlyContinue
            throw
        }
    } finally {
        if ($ownsBackupMutex) { try { $backupMutex.ReleaseMutex() } catch { } }
        $backupMutex.Dispose()
    }
}

function Rename-DarDatabase([string]$FromName, [string]$ToName, $Secrets) {
    foreach ($name in @($FromName,$ToName)) {
        if ($name -notmatch '^[a-z][a-z0-9_]{0,62}$') { throw 'اسم قاعدة البيانات غير صالح لعملية إعادة التسمية.' }
    }
    Invoke-DarPgTool -Tool 'psql' -Arguments @('-h','127.0.0.1','-p',[string]$Secrets.Port,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c',"ALTER DATABASE $FromName RENAME TO $ToName;") -Password $Secrets.PostgresAdminPassword | Out-Null
}

function Switch-DarRestoredDatabase($Secrets, [string]$StageDatabase, [string]$TargetDatabase, [string]$PreviousDatabase, [scriptblock]$StageRenameTestAction = $null) {
    $switchNames = @($StageDatabase,$TargetDatabase,$PreviousDatabase)
    foreach ($name in $switchNames) {
        if ($name -notmatch '^[a-z][a-z0-9_]{0,62}$') { throw 'اسم قاعدة البيانات غير صالح لعملية التبديل.' }
    }
    if (@($switchNames | Select-Object -Unique).Count -ne 3) { throw 'يجب أن تكون أسماء قاعدة الاستعادة والقاعدة الهدف والقاعدة السابقة مختلفة.' }
    if (-not (Test-DarDatabaseExists -Secrets $Secrets -DatabaseName $StageDatabase)) { throw "قاعدة الاستعادة المؤقتة '$StageDatabase' غير موجودة." }
    $targetExists = Test-DarDatabaseExists -Secrets $Secrets -DatabaseName $TargetDatabase
    if ($targetExists -and (Test-DarDatabaseExists -Secrets $Secrets -DatabaseName $PreviousDatabase)) {
        throw "اسم قاعدة البيانات السابقة '$PreviousDatabase' مستخدم بالفعل. لم يتم بدء التبديل."
    }

    if ($targetExists) {
        $terminateSql = "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$TargetDatabase' AND pid <> pg_backend_pid();"
        Invoke-DarPgTool -Tool 'psql' -Arguments @('-h','127.0.0.1','-p',[string]$Secrets.Port,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c',$terminateSql) -Password $Secrets.PostgresAdminPassword | Out-Null
        Rename-DarDatabase -FromName $TargetDatabase -ToName $PreviousDatabase -Secrets $Secrets
    }

    try {
        if ($null -ne $StageRenameTestAction) {
            # Test-only injection point. Production restore never supplies this script block.
            & $StageRenameTestAction
        } else {
            Rename-DarDatabase -FromName $StageDatabase -ToName $TargetDatabase -Secrets $Secrets
        }
    } catch {
        $switchError = $_.Exception.Message
        if ($targetExists -and (Test-DarDatabaseExists -Secrets $Secrets -DatabaseName $PreviousDatabase) -and -not (Test-DarDatabaseExists -Secrets $Secrets -DatabaseName $TargetDatabase)) {
            try {
                Rename-DarDatabase -FromName $PreviousDatabase -ToName $TargetDatabase -Secrets $Secrets
                throw "فشل تفعيل قاعدة الاستعادة، وتمت إعادة قاعدة الجهاز السابقة إلى اسمها الأصلي بنجاح. السبب: $switchError"
            } catch {
                if ($_.Exception.Message -like 'فشل تفعيل قاعدة الاستعادة*') { throw }
                throw "فشل تفعيل قاعدة الاستعادة، كما تعذر إرجاع القاعدة السابقة تلقائيًا. القاعدة السابقة ما زالت محفوظة باسم '$PreviousDatabase'. خطأ التبديل: $switchError. خطأ الرجوع: $($_.Exception.Message)"
            }
        }
        throw "فشل تفعيل قاعدة الاستعادة. لم يتم حذف القاعدة السابقة. خطأ التبديل: $switchError"
    }

    if ($targetExists) { return $PreviousDatabase }
    return $null
}

function Restore-DarDatabaseBackup([string]$BackupPath, $Secrets) {
    Assert-DarDatabaseSecrets -Secrets $Secrets
    Assert-DarApplicationClosed
    Test-DarBackupArchive -BackupPath $BackupPath | Out-Null

    $stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
    $token = [Guid]::NewGuid().ToString('N').Substring(0,12)
    $stageDatabase = "dar_restore_$token"
    $previousDatabase = "dar_before_restore_$token"
    if (Test-DarDatabaseExists -Secrets $Secrets -DatabaseName $stageDatabase) { throw "قاعدة الاستعادة المؤقتة '$stageDatabase' موجودة بالفعل. لم يتم لمسها أو استبدالها." }

    New-DarDatabase -DatabaseName $stageDatabase -Secrets $Secrets
    Write-DarPostgresStep 'Restoring the backup into an isolated temporary database...'
    try {
        Invoke-DarPgTool -Tool 'pg_restore' -Arguments @('--no-owner','--no-privileges','--exit-on-error','--single-transaction','-h','127.0.0.1','-p',[string]$Secrets.Port,'-U',$Secrets.AppUser,'-d',$stageDatabase,$BackupPath) -Password $Secrets.AppPassword | Out-Null
        $restoreReport = Get-DarDatabaseRestoreReport -Secrets $Secrets -DatabaseName $stageDatabase
        Test-DarBackupArchive -BackupPath $BackupPath -RequiredTables $restoreReport.RequiredTables | Out-Null
        Write-DarPostgresStep ("Restore validation passed: tables=$($restoreReport.TableCount); required tables=$($restoreReport.RequiredTableCount); applied migrations=$($restoreReport.AppliedMigrationCount); foreign keys=$($restoreReport.ForeignKeyCount); required foreign keys=$($restoreReport.RequiredForeignKeyCount); database size=$($restoreReport.DatabaseSizeBytes) bytes.")
    } catch {
        throw "فشلت استعادة أو مراجعة النسخة داخل القاعدة المؤقتة '$stageDatabase'. القاعدة الأصلية لم تتغير، وتم الاحتفاظ بالقاعدة المؤقتة للتشخيص. السبب: $($_.Exception.Message)"
    }

    if (Test-DarDatabaseExists -Secrets $Secrets -DatabaseName $Secrets.Database) {
        $paths = Get-DarLocalPaths
        $safetyBackup = Join-Path $paths.BackupFolder "DarEltahfeez_PRE_RESTORE_$stamp`_$token.backup"
        Write-DarPostgresStep 'Creating and validating a safety backup of the current database before switching...'
        New-DarDatabaseBackup -DestinationPath $safetyBackup -Secrets $Secrets | Out-Null
        New-DarBackupManifest -BackupPath $safetyBackup -Secrets $Secrets | Out-Null
    }

    $previous = Switch-DarRestoredDatabase -Secrets $Secrets -StageDatabase $stageDatabase -TargetDatabase $Secrets.Database -PreviousDatabase $previousDatabase
    Write-DarApiConnectionSettings -Secrets $Secrets
    Write-DarPostgresStep 'The restored database is now active. The previous database remains preserved under its backup name.'
    return $previous
}

