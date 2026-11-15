$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Root = Split-Path -Parent $PSScriptRoot
$Frontend = Join-Path $Root 'frontend'
$ApiDir = Join-Path $Root 'backend\DarEltahfeez.Api'
$ApiProject = Join-Path $ApiDir 'DarEltahfeez.Api.csproj'
$ApiDll = Join-Path $ApiDir 'bin\Debug\net10.0\DarEltahfeez.Api.dll'
$ApiOutputDirectory = Split-Path -Parent $ApiDll
$WebRoot = Join-Path $ApiDir 'wwwroot'
$ApiOutputWebRoot = Join-Path $ApiOutputDirectory 'wwwroot'
$DotnetExecutable = $null
$BuildSucceeded = $false
$BuildFailureMessage = $null
$BuildLogDirectory = Join-Path $env:LOCALAPPDATA 'DarEltahfeez\Logs'
New-Item -ItemType Directory -Force -Path $BuildLogDirectory | Out-Null
$BuildLogPath = Join-Path $BuildLogDirectory ('build-for-rehearsal-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '.log')
$TranscriptStarted = $false
try { Start-Transcript -Path $BuildLogPath -Force | Out-Null; $TranscriptStarted = $true } catch { Write-Warning ('Could not start build transcript: ' + $_.Exception.Message) }
Write-Host ('PROJECT_ROOT=' + $Root) -ForegroundColor Cyan
Write-Host ('BUILD_LOG_PATH=' + $BuildLogPath) -ForegroundColor Cyan

function Write-Step([string]$Message) { Write-Host ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'),$Message) -ForegroundColor Cyan }
function Invoke-Checked([string]$File,[string[]]$Arguments,[string]$WorkingDirectory) {
    Push-Location $WorkingDirectory
    try {
        & $File @Arguments
        if ($LASTEXITCODE -ne 0) { throw "Build command failed: $File $($Arguments -join ' ') (Exit $LASTEXITCODE)." }
    } finally { Pop-Location }
}

try {
    if (-not (Test-Path -LiteralPath (Join-Path $Frontend 'package.json') -PathType Leaf)) { throw 'frontend/package.json is missing. Re-extract the complete project.' }
    if (-not (Test-Path -LiteralPath $ApiProject -PathType Leaf)) { throw 'Dar API project is missing. Re-extract the complete project.' }

    $npm = Get-Command 'npm.cmd' -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $npm) { throw 'Node.js LTS (npm.cmd) is required. Install Node.js LTS, reopen the terminal, and run this build again. No database was touched.' }

    $dotnetCommand = Get-Command 'dotnet.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($dotnetCommand) { $DotnetExecutable = $dotnetCommand.Source }
    if (-not $DotnetExecutable) {
        $candidates = @((Join-Path $env:ProgramFiles 'dotnet\dotnet.exe'),(Join-Path ${env:ProgramFiles(x86)} 'dotnet\dotnet.exe')) | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf }
        $DotnetExecutable = $candidates | Select-Object -First 1
    }
    if (-not $DotnetExecutable) { throw 'The .NET 10 SDK is required. Install Microsoft.DotNet.SDK.10 and reopen the terminal. No database was touched.' }
    $sdks = @(& $DotnetExecutable --list-sdks 2>$null)
    if ($LASTEXITCODE -ne 0 -or -not ($sdks | Where-Object { $_ -match '^\s*10\.' })) { throw 'The .NET 10 SDK is required (not only a runtime). Install Microsoft.DotNet.SDK.10 and retry. No database was touched.' }

    $markers = @('node_modules\vite\bin\vite.js','node_modules\typescript\bin\tsc')
    $dependenciesReady = $true
    foreach ($marker in $markers) { if (-not (Test-Path -LiteralPath (Join-Path $Frontend $marker) -PathType Leaf)) { $dependenciesReady = $false; break } }
    if (-not $dependenciesReady) {
        Write-Step 'Installing frontend dependencies. Internet is needed only if packages are not cached.'
        Invoke-Checked $npm.Source @('install','--no-audit','--no-fund','--prefer-offline') $Frontend
    }

    Write-Step 'Building the React frontend assets for desktop mode...'
    Invoke-Checked $npm.Source @('run','build:desktop') $Frontend
    $dist = Join-Path $Frontend 'dist'
    $distIndex = Join-Path $dist 'index.html'
    if (-not (Test-Path -LiteralPath $distIndex -PathType Leaf)) { throw 'Frontend build did not produce frontend/dist/index.html.' }

    Write-Step 'Copying built frontend assets into the API wwwroot...'
    if (Test-Path -LiteralPath $WebRoot) { Remove-Item -LiteralPath $WebRoot -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $WebRoot | Out-Null
    Copy-Item -Path (Join-Path $dist '*') -Destination $WebRoot -Recurse -Force
    if (-not (Test-Path -LiteralPath (Join-Path $WebRoot 'index.html') -PathType Leaf)) { throw 'API wwwroot/index.html was not produced.' }

    Write-Step 'Building the local API (.NET 10)...'
    Invoke-Checked $DotnetExecutable @('build',$ApiProject,'-c','Debug','--nologo') $Root
    if (-not (Test-Path -LiteralPath $ApiDll -PathType Leaf)) { throw 'API build completed without producing the required net10.0 DLL.' }

    # Test 10 and Test 32 launch the compiled DLL with its output directory as the
    # working directory. ASP.NET Core therefore resolves its WebRoot at
    # bin\Debug\net10.0\wwwroot, not only at the source project's wwwroot.
    # Copy explicitly after build so the runtime artifact is deterministic even
    # when SDK static-web-assets copy behavior differs across build environments.
    $expectedOutputRoot = [IO.Path]::GetFullPath((Join-Path $ApiDir 'bin\Debug\net10.0'))
    $actualOutputRoot = [IO.Path]::GetFullPath($ApiOutputDirectory)
    if (-not $actualOutputRoot.Equals($expectedOutputRoot,[StringComparison]::OrdinalIgnoreCase)) { throw 'Refusing to copy frontend assets outside the expected API Debug output directory.' }
    if (Test-Path -LiteralPath $ApiOutputWebRoot) { Remove-Item -LiteralPath $ApiOutputWebRoot -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $ApiOutputWebRoot | Out-Null
    Copy-Item -Path (Join-Path $WebRoot '*') -Destination $ApiOutputWebRoot -Recurse -Force
    $runtimeIndex = Join-Path $ApiOutputWebRoot 'index.html'
    if (-not (Test-Path -LiteralPath $runtimeIndex -PathType Leaf)) { throw 'The compiled API runtime wwwroot/index.html is missing after explicit asset synchronization.' }
    $runtimeJs = @(Get-ChildItem -LiteralPath $ApiOutputWebRoot -Filter '*.js' -File -Recurse)
    $runtimeCss = @(Get-ChildItem -LiteralPath $ApiOutputWebRoot -Filter '*.css' -File -Recurse)
    if ($runtimeJs.Count -lt 1 -or $runtimeCss.Count -lt 1) { throw 'The compiled API runtime wwwroot is missing the React JavaScript or CSS bundle.' }

    Write-Host ''
    Write-Host 'PASS: API DLL and runtime wwwroot assets are ready for Test 10 and Test 32.' -ForegroundColor Green
    Write-Host ('API_DLL=' + $ApiDll) -ForegroundColor Cyan
    Write-Host ('API_SOURCE_WWWROOT_INDEX=' + (Join-Path $WebRoot 'index.html')) -ForegroundColor Cyan
    Write-Host ('API_OUTPUT_WWWROOT_INDEX=' + $runtimeIndex) -ForegroundColor Cyan
    Write-Host ('API_OUTPUT_JS_COUNT=' + $runtimeJs.Count) -ForegroundColor Cyan
    Write-Host ('API_OUTPUT_CSS_COUNT=' + $runtimeCss.Count) -ForegroundColor Cyan
    Write-Host ('FRONTEND_DIST_INDEX=' + $distIndex) -ForegroundColor Cyan
    Write-Host 'API and React assets are ready for Test 10 and Test 32.' -ForegroundColor Green
    Write-Host 'This build-only operation did not start Dar, PostgreSQL, an API process, or run database migrations.' -ForegroundColor Green
    Write-Host 'Close any running Dar process and ensure ports 5080, 5081 and 5082 are free before Test 32.' -ForegroundColor Yellow
    $BuildSucceeded = $true
} catch {
    $BuildFailureMessage = $_.Exception.ToString()
    Write-Host ('FAIL: ' + $_.Exception.Message) -ForegroundColor Red
    Write-Host 'No Dar application or PostgreSQL process was started by this build script.' -ForegroundColor Yellow
} finally {
    if ($TranscriptStarted) { try { Stop-Transcript | Out-Null } catch { } }
}

if ($BuildSucceeded) {
    Write-Host 'BUILD_RESULT=PASS' -ForegroundColor Green
    Write-Host ('BUILD_LOG_PATH=' + $BuildLogPath) -ForegroundColor Cyan
    try { [IO.File]::AppendAllText($BuildLogPath, [Environment]::NewLine + 'BUILD_RESULT=PASS' + [Environment]::NewLine + 'PROJECT_ROOT=' + $Root + [Environment]::NewLine + 'API_DLL=' + $ApiDll + [Environment]::NewLine + 'API_SOURCE_WWWROOT_INDEX=' + (Join-Path $WebRoot 'index.html') + [Environment]::NewLine + 'API_OUTPUT_WWWROOT_INDEX=' + (Join-Path $ApiOutputWebRoot 'index.html') + [Environment]::NewLine, [Text.UTF8Encoding]::new($false)) } catch { }
    exit 0
}
Write-Host 'BUILD_RESULT=FAIL' -ForegroundColor Red
if ($BuildFailureMessage) { Write-Host $BuildFailureMessage -ForegroundColor Red }
Write-Host ('BUILD_LOG_PATH=' + $BuildLogPath) -ForegroundColor Cyan
try { [IO.File]::AppendAllText($BuildLogPath, [Environment]::NewLine + 'BUILD_RESULT=FAIL' + [Environment]::NewLine + 'PROJECT_ROOT=' + $Root + [Environment]::NewLine + 'ERROR=' + [string]$BuildFailureMessage + [Environment]::NewLine, [Text.UTF8Encoding]::new($false)) } catch { }
exit 1
