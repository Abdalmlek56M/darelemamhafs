#requires -Version 5.1
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$localPostgresPath = Join-Path $projectRoot 'tools\LocalPostgres.ps1'
if (-not (Test-Path -LiteralPath $localPostgresPath -PathType Leaf)) { throw 'LocalPostgres.ps1 is missing.' }
. $localPostgresPath

$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ('DarNativeProcessProbe_' + [Guid]::NewGuid().ToString('N'))
$originalBin = $script:DarPgBin
$failure = $null
try {
    $commandProcessor = [string]$env:ComSpec
    if ([string]::IsNullOrWhiteSpace($commandProcessor) -or -not (Test-Path -LiteralPath $commandProcessor -PathType Leaf)) {
        $commandProcessor = Join-Path $env:WINDIR 'System32\cmd.exe'
    }
    if (-not (Test-Path -LiteralPath $commandProcessor -PathType Leaf)) { throw 'Windows cmd.exe is unavailable; the native STDERR probe cannot run.' }

    New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null
    $fakePsql = Join-Path $tempRoot 'psql.exe'
    Copy-Item -LiteralPath $commandProcessor -Destination $fakePsql -ErrorAction Stop
    $script:DarPgBin = $tempRoot

    $arguments = @('/d','/c','echo DAR_NATIVE_STDERR_PROBE 1>&2 & exit /b 7')
    $allowedFailure = Invoke-DarPgTool -Tool 'psql' -Arguments $arguments -Password '' -AllowFailure
    if ($allowedFailure.ExitCode -ne 7) { throw "Expected -AllowFailure to return exit code 7; received $($allowedFailure.ExitCode)." }
    $joinedOutput = @($allowedFailure.Output | ForEach-Object { [string]$_ }) -join "`n"
    if ($joinedOutput -notmatch 'DAR_NATIVE_STDERR_PROBE') { throw 'Native STDERR text was not preserved in the returned output.' }
    if ($ErrorActionPreference -ne 'Stop') { throw 'The caller ErrorActionPreference was not restored after -AllowFailure.' }

    $expectedThrowObserved = $false
    try {
        Invoke-DarPgTool -Tool 'psql' -Arguments $arguments -Password '' | Out-Null
    } catch {
        $expectedThrowObserved = $_.Exception.Message -match 'psql failed \(exit 7\)' -and $_.Exception.Message -match 'DAR_NATIVE_STDERR_PROBE'
    }
    if (-not $expectedThrowObserved) { throw 'A non-allowed native failure did not produce the expected PostgreSQL tool error.' }
    if ($ErrorActionPreference -ne 'Stop') { throw 'The caller ErrorActionPreference was not restored after the expected failure.' }

    Write-Host 'PASS: Native STDERR does not bypass Invoke-DarPgTool -AllowFailure under ErrorActionPreference=Stop.' -ForegroundColor Green
    Write-Host 'PASS: Non-allowed native failures retain STDERR text and the real exit code.' -ForegroundColor Green
    Write-Host 'PASS: Caller ErrorActionPreference is restored after both success and failure paths.' -ForegroundColor Green
}
catch {
    $failure = $_.Exception.Message
}
finally {
    $script:DarPgBin = $originalBin
    if (Test-Path -LiteralPath $tempRoot) { Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue }
}

if ($failure) {
    Write-Host ('FAIL: PostgreSQL native process handling regression: ' + $failure) -ForegroundColor Red
    Write-Output 'DAR_TEST_RESULT=FAIL'
    exit 1
}
Write-Output 'DAR_TEST_RESULT=PASS'
exit 0
