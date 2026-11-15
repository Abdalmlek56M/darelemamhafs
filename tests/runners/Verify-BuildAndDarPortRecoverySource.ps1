#requires -Version 5.1
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
function Read-Source([string]$RelativePath) {
    $path = Join-Path $projectRoot $RelativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Required file is missing: $RelativePath" }
    return [IO.File]::ReadAllText($path,[Text.Encoding]::UTF8)
}
$buildBat = Read-Source 'BUILD_DAR_FOR_REHEARSAL.bat'
$buildPs = Read-Source 'tools\Build-DarForRehearsal.ps1'
$stopBat = Read-Source 'STOP_STALE_DAR_API.bat'
$stopPs = Read-Source 'tools\Stop-StaleDarApi.ps1'
$functional = Read-Source 'tests\runners\Verify-FunctionalApiAcceptance.ps1'
$tokens=$null; $errors=$null
[Management.Automation.Language.Parser]::ParseFile((Join-Path $projectRoot 'tools\Build-DarForRehearsal.ps1'),[ref]$tokens,[ref]$errors) | Out-Null
$buildParse = @($errors).Count -eq 0
$tokens=$null; $errors=$null
[Management.Automation.Language.Parser]::ParseFile((Join-Path $projectRoot 'tools\Stop-StaleDarApi.ps1'),[ref]$tokens,[ref]$errors) | Out-Null
$stopParse = @($errors).Count -eq 0
$tokens=$null; $errors=$null
[Management.Automation.Language.Parser]::ParseFile((Join-Path $projectRoot 'tests\runners\Verify-FunctionalApiAcceptance.ps1'),[ref]$tokens,[ref]$errors) | Out-Null
$functionalParse = @($errors).Count -eq 0
$checks = @(
    @{ Name='Build launcher prints project root and pauses after both successful and failed builds'; Pass=$buildBat.Contains('Project root: %CD%') -and $buildBat.Contains('pause') -and $buildBat.IndexOf('pause',[StringComparison]::OrdinalIgnoreCase) -gt $buildBat.IndexOf('powershell.exe',[StringComparison]::OrdinalIgnoreCase) -and $buildBat.Contains('BUILD_RESULT') },
    @{ Name='Build script writes a persistent transcript in Dar Logs'; Pass=$buildPs.Contains("DarEltahfeez\Logs") -and $buildPs.Contains('Start-Transcript') -and $buildPs.Contains('BUILD_LOG_PATH=') },
    @{ Name='Build script prints exact API DLL and source/runtime wwwroot artifact paths'; Pass=$buildPs.Contains('API_DLL=') -and $buildPs.Contains('API_SOURCE_WWWROOT_INDEX=') -and $buildPs.Contains('API_OUTPUT_WWWROOT_INDEX=') -and $buildPs.Contains('BUILD_RESULT=PASS') -and $buildPs.Contains('BUILD_RESULT=FAIL') },
    @{ Name='Build script explicitly synchronizes and verifies React assets beside the compiled API DLL'; Pass=$buildPs.Contains('$ApiOutputWebRoot') -and $buildPs.Contains('Copy-Item -Path (Join-Path $WebRoot') -and $buildPs.Contains('runtimeIndex') -and $buildPs.Contains('runtimeJs.Count -lt 1 -or $runtimeCss.Count -lt 1') -and $buildPs.Contains('Refusing to copy frontend assets outside the expected API Debug output directory.') },
    @{ Name='Build-only workflow does not start the app or PostgreSQL or run migrations'; Pass=$buildPs.Contains('ready for Test 10 and Test 32') -and $buildPs.Contains('did not start Dar, PostgreSQL') -and -not $buildPs.Contains('Start-DarPostgresServer') -and -not $buildPs.Contains('ApplyMigrations') },
    @{ Name='Build PowerShell script parses cleanly'; Pass=$buildParse },
    @{ Name='Stale API helper targets only port 5080'; Pass=$stopPs.Contains('$port = 5080') -and -not $stopPs.Contains('$port = 55432') },
    @{ Name='Stale API helper requires exact Dar API process identity before stopping'; Pass=$stopPs.Contains('DarEltahfeez\.Api') -and $stopPs.Contains('VERIFIED: port 5080 belongs to DarEltahfeez.Api') -and $stopPs.Contains('currentCommand -cne $commandLine') },
    @{ Name='Stale API helper requires explicit PID confirmation and never stops unrelated listeners'; Pass=$stopPs.Contains('Type STOP $ownerId') -and $stopPs.Contains('Nothing was stopped') -and $stopPs.Contains('Stop-Process -Id $ownerId') },
    @{ Name='Stale API batch launcher pauses and does not call taskkill'; Pass=$stopBat.Contains('pause') -and -not $stopBat.Contains('taskkill') },
    @{ Name='Stop helper PowerShell script parses cleanly'; Pass=$stopParse },
    @{ Name='Functional runner reports occupied port owners before build prerequisites'; Pass=$functional.IndexOf('$occupiedPortDetails',[StringComparison]::Ordinal) -lt $functional.IndexOf('$missingBuildArtifacts',[StringComparison]::Ordinal) -and $functional.Contains('Get-CimInstance Win32_Process') },
    @{ Name='Functional runner prints exact missing build artifact paths and project root'; Pass=$functional.Contains('$missingBuildArtifacts.Add($apiDll)') -and $functional.Contains('$missingBuildArtifacts.Add($apiIndex)') -and $functional.Contains('Project root: ') -and $functional.Contains('$projectRoot') },
    @{ Name='Functional runner parses cleanly after preflight diagnostics update'; Pass=$functionalParse },
    @{ Name='Test Center registers the build and stale-port recovery source guard'; Pass=(Read-Source 'tests\runners\TestCenter.ps1').Contains("Id='34'") -and (Read-Source 'tests\catalog.json').Contains('OPS-SRC-02') }
)
$failed=0
foreach($check in $checks){ if($check.Pass){Write-Host ('PASS: '+$check.Name) -ForegroundColor Green}else{Write-Host ('FAIL: '+$check.Name) -ForegroundColor Red;$failed++} }
Write-Host ("Build and Dar-port recovery source checks: PASS={0}; FAIL={1}" -f ($checks.Count-$failed),$failed)
if($failed -gt 0){Write-Output 'DAR_TEST_RESULT=FAIL';exit 1}
Write-Output 'DAR_TEST_RESULT=PASS';exit 0
