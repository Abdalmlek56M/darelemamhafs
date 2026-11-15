$ErrorActionPreference = 'Stop'
$runnerRoot = $PSScriptRoot
$projectRoot = Split-Path -Parent (Split-Path -Parent $runnerRoot)

function Test-TcpPort([int]$Port) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $async = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
        if (-not $async.AsyncWaitHandle.WaitOne(800)) { return $false }
        $client.EndConnect($async)
        return $true
    } catch { return $false } finally { $client.Close() }
}
function Test-ApiReady {
    try {
        $health = Invoke-RestMethod -Uri 'http://127.0.0.1:5080/health' -TimeoutSec 3
        return ($health.status -eq 'ok' -and $health.service -eq 'DarEltahfeez.Api')
    } catch { return $false }
}
function Test-SnapshotReady {
    return ((Test-TcpPort 55432) -and (Test-Path -LiteralPath (Join-Path $env:LOCALAPPDATA 'DarEltahfeez\database-secrets.json') -PathType Leaf))
}
function Show-Menu {
    Clear-Host
    Write-Host 'DAR ELTAHFEEZ - TEST CENTER (CLI FALLBACK)' -ForegroundColor Cyan
    Write-Host '1) Verify System Center source (safe; app not required)'
    Write-Host '2) Test FileSystemWatcher in an isolated temporary folder (safe)'
    Write-Host '3) Test API logger (requires Dar API running on port 5080)'
    Write-Host '4) Test teacher rate snapshot (requires local PostgreSQL on port 55432)'
    Write-Host '5) Verify backup scheduler source (safe; no database changes)'
    Write-Host '6) Test backup retention planning with dummy files in a temporary folder'
    Write-Host '7) Run all applicable tests; unavailable dependencies are SKIPPED'
    Write-Host '0) Exit'
}
function Invoke-TestFile([string]$FileName) {
    $path = Join-Path $runnerRoot $FileName
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        Write-Host "FAIL: Missing test file: $FileName" -ForegroundColor Red
        return 'FAIL'
    }
    try {
        & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $path
        $code = $LASTEXITCODE
        if ($code -eq 0) { Write-Host "PASS: $FileName" -ForegroundColor Green; return 'PASS' }
        if ($code -eq 2) { Write-Host "SKIP: $FileName prerequisite unavailable." -ForegroundColor Yellow; return 'SKIP' }
        Write-Host "FAIL: $FileName (ExitCode=$code)" -ForegroundColor Red
        return 'FAIL'
    } catch {
        Write-Host "FAIL: Could not run $FileName. $($_.Exception.Message)" -ForegroundColor Red
        return 'FAIL'
    }
}
function Show-Summary([string[]]$Results) {
    $pass = @($Results | Where-Object { $_ -eq 'PASS' }).Count
    $fail = @($Results | Where-Object { $_ -eq 'FAIL' }).Count
    $skip = @($Results | Where-Object { $_ -eq 'SKIP' }).Count
    Write-Host ''
    Write-Host ("SUMMARY: PASS={0}; FAIL={1}; SKIP={2}" -f $pass, $fail, $skip) -ForegroundColor Cyan
}

do {
    Show-Menu
    $choice = Read-Host 'Select a test'
    try {
        switch ($choice) {
            '1' { [void](Invoke-TestFile 'Verify-SystemCenterSource.ps1') }
            '2' { [void](Invoke-TestFile 'Verify-SystemCenterWatcher.ps1') }
            '3' {
                if (-not (Test-ApiReady)) {
                    Write-Host 'SKIP: Dar API is offline. Start Dar Eltahfeez and retry this test.' -ForegroundColor Yellow
                } else { [void](Invoke-TestFile 'Verify-LoggingPipeline.ps1') }
            }
            '4' {
                if (-not (Test-SnapshotReady)) {
                    Write-Host 'SKIP: Local PostgreSQL or its local secret file is unavailable.' -ForegroundColor Yellow
                } else { [void](Invoke-TestFile 'Run-TeacherAttendanceSnapshotTest.ps1') }
            }
            '5' { [void](Invoke-TestFile 'Verify-BackupSchedulerSource.ps1') }
            '6' { [void](Invoke-TestFile 'Verify-BackupRetention.ps1') }
            '7' {
                $results = @()
                $results += Invoke-TestFile 'Verify-SystemCenterSource.ps1'
                $results += Invoke-TestFile 'Verify-SystemCenterWatcher.ps1'
                if (Test-ApiReady) { $results += Invoke-TestFile 'Verify-LoggingPipeline.ps1' }
                else { Write-Host 'SKIP: Logger test requires Dar API on port 5080.' -ForegroundColor Yellow; $results += 'SKIP' }
                if (Test-SnapshotReady) { $results += Invoke-TestFile 'Run-TeacherAttendanceSnapshotTest.ps1' }
                else { Write-Host 'SKIP: Snapshot test requires local PostgreSQL on port 55432 and its secret file.' -ForegroundColor Yellow; $results += 'SKIP' }
                $results += Invoke-TestFile 'Verify-BackupSchedulerSource.ps1'
                $results += Invoke-TestFile 'Verify-BackupRetention.ps1'
                Show-Summary -Results $results
            }
            '0' { break }
            default { Write-Host 'Invalid selection.' -ForegroundColor Yellow }
        }
    } catch {
        Write-Host ('TEST RUNNER ERROR: ' + $_.Exception.Message) -ForegroundColor Red
    }
    if ($choice -ne '0') { [void](Read-Host 'Press Enter to return to the menu') }
} while ($choice -ne '0')
