$ErrorActionPreference = 'Stop'
$logRoot = Join-Path $env:LOCALAPPDATA 'DarEltahfeez\Logs'
if (-not (Test-Path -LiteralPath $logRoot -PathType Container)) { throw "Log folder does not exist: $logRoot" }
$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$stage = Join-Path $env:TEMP "DarDiagnostics_$stamp"
$desktop = [Environment]::GetFolderPath('Desktop')
$zipPath = Join-Path $desktop "DarEltahfeez_Diagnostics_$stamp.zip"
New-Item -ItemType Directory -Force -Path $stage | Out-Null
function Copy-RecentLog([string]$Name, [int]$TailLines=400) {
    $path = Join-Path $logRoot $Name
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return }
    $dest = Join-Path $stage $Name
    Get-Content -LiteralPath $path -Tail $TailLines -ErrorAction SilentlyContinue | Set-Content -LiteralPath $dest -Encoding UTF8
}
try {
    Copy-RecentLog 'launcher.log' 400
    Copy-RecentLog 'system-center.log' 400
    Copy-RecentLog 'system-center-crash.log' 250
    Copy-RecentLog 'testcenter-crash.log' 250
    Copy-RecentLog 'desktop-crash.log' 250
    Copy-RecentLog 'postgresql.log' 300
    $apiFiles = Get-ChildItem -LiteralPath $logRoot -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match '^api-console-.*-(output|error)\.log$' } |
        Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 6
    foreach ($file in $apiFiles) {
        Get-Content -LiteralPath $file.FullName -Tail 300 -ErrorAction SilentlyContinue |
            Set-Content -LiteralPath (Join-Path $stage $file.Name) -Encoding UTF8
    }
    $apiStructured = Get-ChildItem -LiteralPath $logRoot -Filter 'api-*.jsonl' -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
    if ($apiStructured) {
        Get-Content -LiteralPath $apiStructured.FullName -Tail 500 -ErrorAction SilentlyContinue |
            Set-Content -LiteralPath (Join-Path $stage $apiStructured.Name) -Encoding UTF8
    }
    $testRunRoot = Join-Path $env:LOCALAPPDATA 'DarEltahfeez\TestRuns'
    if (Test-Path -LiteralPath $testRunRoot -PathType Container) {
        $testStage = Join-Path $stage 'TestRuns'
        New-Item -ItemType Directory -Force -Path $testStage | Out-Null
        $testFiles = Get-ChildItem -LiteralPath $testRunRoot -File -Filter '*.log' -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 12
        foreach ($file in $testFiles) {
            Get-Content -LiteralPath $file.FullName -Tail 300 -ErrorAction SilentlyContinue |
                Set-Content -LiteralPath (Join-Path $testStage $file.Name) -Encoding UTF8
        }
    }
    $metadata = @(
        'Dar Eltahfeez diagnostic bundle'
        ('Created: ' + (Get-Date -Format o))
        ('Computer: ' + $env:COMPUTERNAME)
        ('OS: ' + [Environment]::OSVersion.VersionString)
        ('PowerShell: ' + $PSVersionTable.PSVersion.ToString())
        'Included: recent launcher, API console, structured API, PostgreSQL, WPF desktop, System Center and Test Center logs plus test runner outputs when present.'
        'Excluded: database files, backups, secrets, appsettings credentials, and user document folders.'
    ) -join [Environment]::NewLine
    [System.IO.File]::WriteAllText((Join-Path $stage 'bundle-info.txt'),$metadata,[System.Text.UTF8Encoding]::new($false))
    if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
    Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zipPath -CompressionLevel Optimal
    Write-Host 'Diagnostic bundle created:' -ForegroundColor Green
    Write-Host $zipPath -ForegroundColor Cyan
    Write-Host 'The bundle excludes database files, backup archives and secret configuration.'
}
finally {
    if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue }
}
