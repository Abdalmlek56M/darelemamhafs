$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
. (Join-Path $projectRoot 'tools\BackupScheduler.ps1')
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ('DarBackupRetentionTest_' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null
try {
    for ($i=0; $i -lt 5; $i++) {
        $stamp = (Get-Date).AddDays(-$i).ToString('yyyyMMdd_HHmmss')
        $name = "DarEltahfeez_AUTO_$stamp.backup"
        $path = Join-Path $tempRoot $name
        [IO.File]::WriteAllText($path,('verified-dummy-backup-' + $i),[Text.UTF8Encoding]::new($false))
        $info = Get-Item -LiteralPath $path
        $manifest = [ordered]@{
            Status='completed'
            FileName=$name
            CreatedAtUtc=(Get-Date).AddDays(-$i).ToUniversalTime().ToString('o')
            FileSizeBytes=[long]$info.Length
            Sha256=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
            Validation='pg_restore --list passed'
            ArchiveFormat='PostgreSQL Custom'
        }
        [IO.File]::WriteAllText(($path + '.json'),($manifest | ConvertTo-Json -Depth 4),[Text.UTF8Encoding]::new($false))
    }
    $unmanagedPath = Join-Path $tempRoot 'DarEltahfeez_AUTO_20260101_010101.backup'
    [IO.File]::WriteAllText($unmanagedPath,'unmanaged',[Text.UTF8Encoding]::new($false))
    $tamperedPath = Join-Path $tempRoot 'DarEltahfeez_AUTO_20251231_010101.backup'
    [IO.File]::WriteAllText($tamperedPath,'tampered',[Text.UTF8Encoding]::new($false))
    $tamperedInfo = Get-Item -LiteralPath $tamperedPath
    $tamperedManifest = [ordered]@{
        Status='completed'
        FileName=[IO.Path]::GetFileName($tamperedPath)
        CreatedAtUtc=(Get-Date).AddDays(-20).ToUniversalTime().ToString('o')
        FileSizeBytes=[long]$tamperedInfo.Length
        Sha256=('0' * 64)
        Validation='pg_restore --list passed'
        ArchiveFormat='PostgreSQL Custom'
    }
    [IO.File]::WriteAllText(($tamperedPath + '.json'),($tamperedManifest | ConvertTo-Json -Depth 4),[Text.UTF8Encoding]::new($false))
    $manualPath = Join-Path $tempRoot 'DarEltahfeez_FULL_manual.backup'
    [IO.File]::WriteAllText($manualPath,'manual',[Text.UTF8Encoding]::new($false))

    $plan = Get-DarBackupRetentionPlan -BackupFolder $tempRoot -KeepLast 3
    if (@($plan.Keep).Count -ne 3) { throw "Expected 3 retained backups; got $(@($plan.Keep).Count)." }
    if (@($plan.Delete).Count -ne 2) { throw "Expected 2 deletion candidates; got $(@($plan.Delete).Count)." }
    if (@($plan.Unmanaged).Count -ne 2) { throw "Expected 2 unverified/tampered automatic backups to be protected; got $(@($plan.Unmanaged).Count)." }
    foreach ($candidate in $plan.Delete) {
        if ([IO.Path]::GetFileName($candidate.Path) -notmatch '^DarEltahfeez_AUTO_\d{8}_\d{6}\.backup$') { throw 'Retention plan included a non-automatic backup.' }
    }
    if (-not (Test-Path -LiteralPath $manualPath) -or -not (Test-Path -LiteralPath $unmanagedPath) -or -not (Test-Path -LiteralPath $tamperedPath)) { throw 'The plan-only test unexpectedly removed an unmanaged, tampered or manual backup.' }
    if (@(Get-ChildItem -LiteralPath $tempRoot -File -Filter '*.backup').Count -ne 8) { throw 'The plan-only test unexpectedly deleted an archive.' }
    Write-Host 'PASS: Retention plan keeps the latest verified backups.' -ForegroundColor Green
    Write-Host 'PASS: Retention plan only marks older verified AUTO backups for deletion.' -ForegroundColor Green
    Write-Host 'PASS: Manual, unverified and SHA-256-mismatched backups remain protected.' -ForegroundColor Green
    Write-Output 'DAR_TEST_RESULT=PASS'
}
catch {
    Write-Error $_
    Write-Output 'DAR_TEST_RESULT=FAIL'
    exit 1
}
finally {
    if (Test-Path -LiteralPath $tempRoot) { Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue }
}
