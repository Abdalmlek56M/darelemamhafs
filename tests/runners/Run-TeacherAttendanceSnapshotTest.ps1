#requires -Version 5.1
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$base = Join-Path $env:LOCALAPPDATA 'DarEltahfeez'
$secretsPath = Join-Path $base 'database-secrets.json'
$expectedData = Join-Path $base 'Database\data'
$expectedPort = 55432
$testDatabase = $null
$databaseCreated = $false
$previousPassword = $env:PGPASSWORD
$failure = $null

try {
    if (-not (Test-Path -LiteralPath $secretsPath -PathType Leaf)) {
        throw 'Local PostgreSQL secrets file is missing. Start Dar Eltahfeez once, then retry.'
    }
    $secrets = Get-Content -LiteralPath $secretsPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ([int]$secrets.Port -ne $expectedPort -or [string]::IsNullOrWhiteSpace([string]$secrets.PostgresAdminPassword)) {
        throw 'PostgreSQL settings do not match the expected local Dar engine. No changes were made.'
    }

    $binCandidates = @(
        (Join-Path $base 'Runtime\PostgreSQL\17\pgsql\bin'),
        (Join-Path $base 'Runtime\PostgreSQL\17\bin'),
        (Join-Path $projectRoot 'database-runtime\pgsql\bin'),
        (Join-Path $projectRoot 'database-runtime\bin')
    )
    $bin = $binCandidates | Where-Object { Test-Path -LiteralPath (Join-Path $_ 'psql.exe') } | Select-Object -First 1
    if (-not $bin) { throw 'Could not find psql.exe for the local PostgreSQL 17 runtime.' }
    $psql = Join-Path $bin 'psql.exe'
    $testFile = Join-Path $projectRoot 'tests\regression\sql\teacher_attendance_rate_snapshot.test.sql'
    if (-not (Test-Path -LiteralPath $testFile -PathType Leaf)) { throw 'Teacher rate snapshot SQL test file is missing.' }

    $env:PGPASSWORD = [string]$secrets.PostgresAdminPassword
    $identity = @(& $psql --no-psqlrc -h 127.0.0.1 -p $expectedPort -U postgres -d postgres -At -F '|' -v ON_ERROR_STOP=1 -c "SELECT current_setting('data_directory'), current_setting('port');" 2>&1)
    if ($LASTEXITCODE -ne 0) { throw ("Could not connect to the local PostgreSQL engine: " + ($identity -join [Environment]::NewLine)) }
    $identityLine = ($identity | Select-Object -Last 1).ToString().Trim()
    $identityParts = $identityLine.Split('|')
    if ($identityParts.Count -ne 2) { throw 'Could not verify PostgreSQL server identity. No test database was created.' }

    $actualData = [IO.Path]::GetFullPath($identityParts[0].Trim()).TrimEnd([char[]]@('\','/'))
    $expectedDataFull = [IO.Path]::GetFullPath($expectedData).TrimEnd([char[]]@('\','/'))
    if (-not $actualData.Equals($expectedDataFull, [StringComparison]::OrdinalIgnoreCase) -or [int]$identityParts[1] -ne $expectedPort) {
        throw "PostgreSQL identity does not match the expected Dar data directory and port 55432. No test database was created. Actual data directory: $actualData"
    }

    $testDatabase = 'dar_snapshot_test_' + [Guid]::NewGuid().ToString('N')
    Write-Host "Creating isolated temporary database: $testDatabase" -ForegroundColor Cyan
    & $psql --no-psqlrc -h 127.0.0.1 -p $expectedPort -U postgres -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $testDatabase OWNER postgres TEMPLATE template0 ENCODING 'UTF8';"
    if ($LASTEXITCODE -ne 0) { throw 'Failed to create the isolated temporary test database.' }
    $databaseCreated = $true

    Write-Host 'Running temporary-table regression checks...' -ForegroundColor Cyan
    & $psql --no-psqlrc -h 127.0.0.1 -p $expectedPort -U postgres -d $testDatabase -v ON_ERROR_STOP=1 -f $testFile
    if ($LASTEXITCODE -ne 0) { throw 'Teacher rate snapshot regression test failed. Review the PostgreSQL output above.' }
}
catch {
    $failure = $_.Exception.Message
}
finally {
    if ($databaseCreated -and $testDatabase) {
        Write-Host "Removing only the temporary test database: $testDatabase" -ForegroundColor DarkCyan
        & $psql --no-psqlrc -h 127.0.0.1 -p $expectedPort -U postgres -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $testDatabase WITH (FORCE);" 2>&1 | ForEach-Object { Write-Host $_ }
        if ($LASTEXITCODE -ne 0) {
            $failure = (($failure + ' ') + "Could not remove temporary test database $testDatabase; verify it is not in use before removing it manually.").Trim()
        }
    }
    if ($null -eq $previousPassword) { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
    else { $env:PGPASSWORD = $previousPassword }
}

if ($failure) {
    Write-Host "TEST FAILED: $failure" -ForegroundColor Red
    Write-Output 'DAR_TEST_RESULT=FAIL'
    exit 1
}
Write-Host 'PASS: teacher attendance rate snapshot regression test completed.' -ForegroundColor Green
Write-Output 'DAR_TEST_RESULT=PASS'
exit 0
