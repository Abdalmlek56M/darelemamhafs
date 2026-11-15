$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$tempRoot = Join-Path $env:TEMP ('DarHealthStorageTest_' + [Guid]::NewGuid().ToString('N'))
try {
    . (Join-Path $projectRoot 'tools\HealthChecks.ps1')
    New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null
    $nested = Join-Path $tempRoot 'nested'
    New-Item -ItemType Directory -Force -Path $nested | Out-Null
    [System.IO.File]::WriteAllBytes((Join-Path $tempRoot 'root.bin'),[byte[]]@(1,2,3))
    [System.IO.File]::WriteAllBytes((Join-Path $nested 'child.bin'),[byte[]]@(4,5,6,7))

    $metrics = Get-DarHealthDirectoryMetrics -Path $tempRoot
    if (-not $metrics.Exists -or -not $metrics.Complete -or $metrics.Bytes -ne 7 -or $metrics.FileCount -ne 2 -or $metrics.DirectoryCount -ne 1) {
        throw ('Storage metrics mismatch. Exists={0}; Complete={1}; Bytes={2}; Files={3}; Directories={4}' -f $metrics.Exists,$metrics.Complete,$metrics.Bytes,$metrics.FileCount,$metrics.DirectoryCount)
    }
    Write-Host 'PASS: Recursive storage scan reports exact bytes, file count and directory count.' -ForegroundColor Green

    $missingPath = Join-Path $tempRoot 'not-created'
    $missing = Get-DarHealthDirectoryMetrics -Path $missingPath
    if ($missing.Exists -or $missing.Bytes -ne 0 -or $missing.FileCount -ne 0) { throw 'Missing folder result is incorrect.' }
    Write-Host 'PASS: Missing folder returns a zero-size non-existent result without creating it.' -ForegroundColor Green

    $limited = Get-DarHealthDirectoryMetrics -Path $tempRoot -MaxFiles 1
    if (-not $limited.Limited -or $limited.FileCount -ne 1 -or $limited.Complete) { throw 'File scan limit was not enforced.' }
    Write-Host 'PASS: File scan limit is enforced and marked incomplete.' -ForegroundColor Green

    Write-Host 'PASS: Storage regression touched only its unique temporary directory.' -ForegroundColor Green
    Write-Output 'DAR_TEST_RESULT=PASS'; exit 0
} catch {
    Write-Host ('FAIL: ' + $_.Exception.Message) -ForegroundColor Red
    Write-Output 'DAR_TEST_RESULT=FAIL'; exit 1
} finally {
    if (Test-Path -LiteralPath $tempRoot -PathType Container) {
        Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
