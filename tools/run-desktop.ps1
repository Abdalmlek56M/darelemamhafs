$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Root = Split-Path -Parent $PSScriptRoot
$Frontend = Join-Path $Root 'frontend'
$ApiDir = Join-Path $Root 'backend\DarEltahfeez.Api'
$ApiProject = Join-Path $ApiDir 'DarEltahfeez.Api.csproj'
$ApiDll = Join-Path $ApiDir 'bin\Debug\net10.0\DarEltahfeez.Api.dll'
$ApiPublishDir = Join-Path $ApiDir 'publish'
$ApiPublishExe = Join-Path $ApiPublishDir 'DarEltahfeez.Api.exe'
$ApiPublishIndex = Join-Path $ApiPublishDir 'wwwroot\index.html'
$DatabaseDir = Join-Path $Root 'database'
$DesktopDir = Join-Path $Root 'desktop-host'
$DesktopProject = Join-Path $DesktopDir 'DarEltahfeez.Desktop.csproj'
$DesktopIconPath = Join-Path $Root 'assets\dar-eltahfeez.ico'
$DesktopExe = Join-Path $DesktopDir 'bin\Debug\net10.0-windows\DarEltahfeez.Desktop.exe'
$DesktopPublishDir = Join-Path $DesktopDir 'publish'
$DesktopPublishExe = Join-Path $DesktopPublishDir 'DarEltahfeez.Desktop.exe'
$InstalledRelease = (Test-Path $ApiPublishExe) -and (Test-Path $DesktopPublishExe) -and (Test-Path $ApiPublishIndex)
$ApiRunPath = $null
$ApiRunArguments = @()
$ApiWorkingDirectory = $null
$DesktopRunPath = $null
$DesktopWorkingDirectory = $null
$DotnetExecutable = $null
$Logs = Join-Path $env:LOCALAPPDATA 'DarEltahfeez\Logs'
$ApiProcess = $null
$ApiStartedByThisLauncher = $false
New-Item -ItemType Directory -Force -Path $Logs | Out-Null
$RunStamp = Get-Date -Format 'yyyyMMdd_HHmmss_fff'
$ApiOutLog = Join-Path $Logs "api-console-$RunStamp-output.log"
$ApiErrLog = Join-Path $Logs "api-console-$RunStamp-error.log"
$LauncherLog = Join-Path $Logs 'launcher.log'

function Write-Step([string]$Message) {
    $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message"
    Write-Host "`n$line" -ForegroundColor Cyan
    try { [System.IO.File]::AppendAllText($LauncherLog, $line + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false)) } catch { }
}
$LocalPostgresScript = Join-Path $PSScriptRoot 'LocalPostgres.ps1'
if (-not (Test-Path -LiteralPath $LocalPostgresScript -PathType Leaf)) {
    throw 'The local PostgreSQL module is missing. Re-extract the complete Dar Eltahfeez package.'
}
. $LocalPostgresScript
if (-not (Get-Command 'Ensure-DarLocalPostgres' -CommandType Function -ErrorAction SilentlyContinue)) {
    throw 'The local PostgreSQL module could not be loaded. Re-extract the fixed package; no database was started or modified.'
}

function Invoke-Checked([string]$File, [string[]]$Arguments, [string]$WorkingDirectory) {
    Push-Location $WorkingDirectory
    try {
        & $File @Arguments
        if ($LASTEXITCODE -ne 0) { throw "Command failed: $File $($Arguments -join ' ') (Exit $LASTEXITCODE)." }
    } finally { Pop-Location }
}
function Stop-OldDarApi {
    $listeners = @(Get-NetTCPConnection -LocalPort 5080 -State Listen -ErrorAction SilentlyContinue)
    if (-not $listeners) { return }
    foreach ($listenerProcessId in @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)) {
        $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $listenerProcessId" -ErrorAction SilentlyContinue
        if (-not $processInfo) { continue }
        $command = [string]$processInfo.CommandLine
        $isDarApi = ($processInfo.Name -match '^DarEltahfeez\.Api(\.exe)?$') -or
            ($processInfo.Name -ieq 'dotnet.exe' -and $command -match 'DarEltahfeez\.Api\.dll|DarEltahfeez\.Api\.csproj')
        if (-not $isDarApi) {
            throw "Port 5080 is already used by another process ($($processInfo.Name)). Close that application and retry. The launcher did not stop an unrelated process."
        }
        Write-Step 'Stopping an older Dar API instance...'
        Stop-Process -Id $listenerProcessId -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 2
}
function Ensure-NodeDependencies([string]$Folder, [string[]]$Markers, [string]$Description) {
    $ready = $true
    foreach ($marker in $Markers) { if (-not (Test-Path (Join-Path $Folder $marker))) { $ready = $false; break } }
    if ($ready) { return }
    Write-Step "Installing $Description for the first time. An internet connection is required only for initial setup."
    Invoke-Checked 'npm.cmd' @('install', '--no-audit', '--no-fund', '--prefer-offline') $Folder
    foreach ($marker in $Markers) { if (-not (Test-Path (Join-Path $Folder $marker))) { throw "A required component was not installed: $marker" } }
}
function Test-SourceChanged([string]$Folder, [string]$OutputFile) {
    if (-not (Test-Path $OutputFile)) { return $true }
    $outputTime = (Get-Item $OutputFile).LastWriteTimeUtc
    $sourceFiles = Get-ChildItem -Path $Folder -File -Recurse -ErrorAction SilentlyContinue | Where-Object {
        $_.FullName -notmatch '[\\/](node_modules|dist|bin|obj|wwwroot|\.git)[\\/]'
    }
    foreach ($file in $sourceFiles) { if ($file.LastWriteTimeUtc -gt $outputTime) { return $true } }
    return $false
}
function Test-DarHealth {
    try {
        $health = Invoke-RestMethod 'http://127.0.0.1:5080/health' -TimeoutSec 3
        if ($health.status -ne 'ok' -or $health.database -ne 'connected' -or $health.service -ne 'DarEltahfeez.Api') { return $false }
        $response = Invoke-WebRequest 'http://127.0.0.1:5080/' -TimeoutSec 3 -UseBasicParsing
        if ($response.StatusCode -ne 200 -or $response.Content -match 'The web UI has not been built' -or $response.Content -notmatch "id\s*=\s*[`"']root[`"']") { return $false }
        $jsMatches = [regex]::Matches($response.Content, 'src\s*=\s*(?:\x22|\x27)([^\x22\x27]+\.js)(?:\x22|\x27)')
        $cssMatches = [regex]::Matches($response.Content, 'href\s*=\s*(?:\x22|\x27)([^\x22\x27]+\.css)(?:\x22|\x27)')
        if ($jsMatches.Count -lt 1 -or $cssMatches.Count -lt 1) { return $false }
        foreach ($match in @($jsMatches[0], $cssMatches[0])) {
            $assetPath = $match.Groups[1].Value
            if ($assetPath.StartsWith('/')) { $assetUrl = 'http://127.0.0.1:5080' + $assetPath }
            else { $assetUrl = 'http://127.0.0.1:5080/' + $assetPath }
            $assetResponse = Invoke-WebRequest $assetUrl -TimeoutSec 5 -UseBasicParsing
            if ($assetResponse.StatusCode -ne 200) { return $false }
        }
        return $true
    } catch { return $false }
}
function Stop-LauncherApi {
    if (-not $ApiStartedByThisLauncher -or -not $ApiProcess) { return }
    $ownedApiPid = [int]$ApiProcess.Id
    try {
        $ApiProcess.Refresh()
        if (-not $ApiProcess.HasExited) {
            Write-Step ("Stopping the Dar API process started by this launcher (PID {0})..." -f $ownedApiPid)
            Stop-Process -Id $ownedApiPid -Force -ErrorAction Stop
            try { Wait-Process -Id $ownedApiPid -Timeout 15 -ErrorAction SilentlyContinue } catch { }
        }
    } catch {
        Write-Host ("Warning: could not confirm shutdown of launcher-owned API PID {0}: {1}" -f $ownedApiPid,$_.Exception.Message) -ForegroundColor Yellow
    }
    $deadline = (Get-Date).AddSeconds(8)
    $listeners = @()
    $ownedListener = @()
    do {
        $ApiProcess.Refresh()
        $remainingOwnedProcess = Get-Process -Id $ownedApiPid -ErrorAction SilentlyContinue
        $listeners = @(Get-NetTCPConnection -LocalPort 5080 -State Listen -ErrorAction SilentlyContinue)
        $ownedListener = @($listeners | Where-Object { [int]$_.OwningProcess -eq $ownedApiPid })
        if (-not $remainingOwnedProcess -and $ownedListener.Count -eq 0) { break }
        Start-Sleep -Milliseconds 300
    } while ((Get-Date) -lt $deadline)
    $ApiProcess.Refresh()
    if ($ApiProcess.HasExited -and $ownedListener.Count -eq 0) {
        Write-Step ("Dar API process {0} stopped; port 5080 was released." -f $ownedApiPid)
    } else {
        $otherOwners = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)
        if ($otherOwners.Count -gt 0) {
            Write-Host ("Warning: port 5080 is still listening under PID(s): {0}. The launcher will not stop any process it did not start." -f ($otherOwners -join ', ')) -ForegroundColor Yellow
        } else {
            Write-Host ("Warning: API process {0} has not been confirmed stopped. Review launcher.log before retrying the rehearsal." -f $ownedApiPid) -ForegroundColor Yellow
        }
    }
}

try {
    if ($InstalledRelease) {
        Write-Host 'Dar Eltahfeez Desktop v0.8.25.0' -ForegroundColor Green
        Write-Host 'Installed release mode. Frontend and .NET components are prebuilt; source build tools are not required.'
        $ApiRunPath = $ApiPublishExe
        $ApiRunArguments = @()
        $ApiWorkingDirectory = $ApiPublishDir
        $DesktopRunPath = $DesktopPublishExe
        $DesktopWorkingDirectory = $DesktopPublishDir
        if (-not (Test-Path $ApiPublishIndex)) { throw 'The installed web interface files are incomplete. Repair or reinstall the application.' }
    } else {
        Write-Host 'Dar Eltahfeez Desktop Test v0.8.25.0' -ForegroundColor Green
        Write-Host 'Test mode: the source build workflow is unchanged. Keep this window open while the app is running.'
        if (-not (Get-Command 'npm.cmd' -ErrorAction SilentlyContinue)) {
            throw 'Node.js LTS (which supplies npm.cmd) was not found. Install the Windows LTS release from https://nodejs.org/, reopen Command Prompt, and retry. No database was changed.'
        }
        $DotnetCommand = Get-Command 'dotnet.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($DotnetCommand) { $DotnetExecutable = $DotnetCommand.Source }
        if (-not $DotnetExecutable) {
            $DotnetCandidates = @(
                (Join-Path $env:ProgramFiles 'dotnet\dotnet.exe'),
                (Join-Path ${env:ProgramFiles(x86)} 'dotnet\dotnet.exe')
            ) | Where-Object { Test-Path $_ }
            $DotnetExecutable = $DotnetCandidates | Select-Object -First 1
        }
        if (-not $DotnetExecutable) {
            throw 'The Test ZIP builds the Windows app from source and requires the .NET 10 SDK on Windows. The PostgreSQL runtime is prepared automatically and does not replace the Windows .NET SDK requirement. In Command Prompt run: winget install Microsoft.DotNet.SDK.10 . Then close and reopen Command Prompt and retry. Official download: https://dotnet.microsoft.com/en-us/download/dotnet/10.0. No database was changed.'
        }
        $InstalledSdks = @(& $DotnetExecutable --list-sdks 2>$null)
        if ($LASTEXITCODE -ne 0 -or -not ($InstalledSdks | Where-Object { $_ -match '^\s*10\.' })) {
            throw 'The Test ZIP requires the .NET 10 SDK, not only a runtime or older SDK. Run: winget install Microsoft.DotNet.SDK.10 . Then reopen Command Prompt and retry. Official download: https://dotnet.microsoft.com/en-us/download/dotnet/10.0. No database was changed.'
        }
        $ApiRunPath = $DotnetExecutable
        $ApiWorkingDirectory = $ApiDir
        $ApiRunArguments = @("`"$ApiDll`"")
        $DesktopRunPath = $DesktopExe
        $DesktopWorkingDirectory = $DesktopDir
    }

    Stop-OldDarApi
    if (-not $InstalledRelease) {
        Ensure-NodeDependencies $Frontend @('node_modules/vite/bin/vite.js','node_modules/typescript/bin/tsc') 'frontend dependencies'

        $FrontendIndex = Join-Path $Frontend 'dist\index.html'
        $BuildUi = Test-SourceChanged $Frontend $FrontendIndex
        if ($BuildUi) {
            Write-Step 'Building the shared React UI...'
            Invoke-Checked 'npm.cmd' @('run', 'build:desktop') $Frontend
        } else {
            Write-Step 'The React UI is already built; skipping the build.'
        }
        if (-not (Test-Path $FrontendIndex)) { throw 'The UI build did not produce frontend\dist\index.html. The desktop window will not open blank.' }

        $WebRoot = Join-Path $ApiDir 'wwwroot'
        $WebRootIndex = Join-Path $WebRoot 'index.html'
        $WebAssetsUpdated = $BuildUi -or -not (Test-Path $WebRootIndex)
        if ($WebAssetsUpdated) {
            Write-Step 'Updating the API web assets...'
            if (Test-Path $WebRoot) { Remove-Item $WebRoot -Recurse -Force }
            New-Item -ItemType Directory -Force -Path $WebRoot | Out-Null
            Copy-Item -Path (Join-Path $Frontend 'dist\*') -Destination $WebRoot -Recurse -Force
        }
        if (-not (Test-Path $WebRootIndex)) { throw 'The built UI was not copied to the API web root.' }

        $ApiBuildNeeded = $BuildUi -or $WebAssetsUpdated -or (Test-SourceChanged $ApiDir $ApiDll) -or (Test-SourceChanged $DatabaseDir $ApiDll)
        if ($ApiBuildNeeded) {
            Write-Step 'Building the local API...'
            Invoke-Checked $DotnetExecutable @('build', $ApiProject, '-c', 'Debug', '--nologo') $Root
        } else {
            Write-Step 'The API is already built; skipping the build.'
        }
        if (-not (Test-Path $ApiDll)) { throw 'The API assembly was not produced by the build.' }

        if (-not (Test-Path -LiteralPath $DesktopIconPath -PathType Leaf)) {
            Write-Host 'Warning: the optional branded icon is missing from assets\dar-eltahfeez.ico. The WPF host will build with the default Windows icon.' -ForegroundColor Yellow
        }
        $DesktopBuildNeeded = Test-SourceChanged $DesktopDir $DesktopExe
        if ($DesktopBuildNeeded) {
            Write-Step 'Building the WPF desktop host...'
            Invoke-Checked $DotnetExecutable @('build', $DesktopProject, '-c', 'Debug', '--nologo') $Root
        } else {
            Write-Step 'The WPF desktop host is already built; skipping the build.'
        }
        if (-not (Test-Path $DesktopExe)) { throw 'The WPF desktop executable was not produced by the build.' }
    }

    Ensure-DarLocalPostgres -ProjectRoot $Root

    Write-Step 'Starting the API in the background...'
    # Each run gets unique console files; previous diagnostics are preserved.
    $env:ASPNETCORE_URLS = 'http://127.0.0.1:5080'
    $env:ASPNETCORE_ENVIRONMENT = if ($InstalledRelease) { 'Production' } else { 'Development' }
    $env:DAR_DESKTOP_LOCAL_MODE = '1'
    $env:DAR_DESKTOP_LOCAL_CLIENT = '1'
    $env:DAR_DESKTOP_URL = 'http://127.0.0.1:5080'
    $ApiProcess = if ($ApiRunArguments.Count -gt 0) {
        Start-Process -FilePath $ApiRunPath -ArgumentList $ApiRunArguments -WorkingDirectory $ApiWorkingDirectory -PassThru -WindowStyle Hidden -RedirectStandardOutput $ApiOutLog -RedirectStandardError $ApiErrLog
    } else {
        Start-Process -FilePath $ApiRunPath -WorkingDirectory $ApiWorkingDirectory -PassThru -WindowStyle Hidden -RedirectStandardOutput $ApiOutLog -RedirectStandardError $ApiErrLog
    }
    $ApiStartedByThisLauncher = $true
    Write-Step ("Dar API started in background (PID {0}); it will be stopped when the desktop window closes." -f $ApiProcess.Id)

    $ApiReady = $false
    for ($i = 0; $i -lt 60; $i++) {
        if (Test-DarHealth) { $ApiReady = $true; break }
        if ($ApiProcess.HasExited) { break }
        Start-Sleep -Seconds 2
    }
    if (-not $ApiReady) {
        Write-Host "`nThe API or UI did not become ready. Recent API output:" -ForegroundColor Red
        if (Test-Path $ApiOutLog) { Get-Content $ApiOutLog -Tail 50 }
        if (Test-Path $ApiErrLog) { Get-Content $ApiErrLog -Tail 50 }
        throw 'The API and UI health checks did not pass. Review the messages above.'
    }

    Write-Step 'The API and UI passed the health checks. Opening the desktop app...'
    $DesktopProcess = Start-Process -FilePath $DesktopRunPath -WorkingDirectory $DesktopWorkingDirectory -PassThru -Wait
    if ($DesktopProcess.ExitCode -ne 0) { throw "The desktop app closed with exit code $($DesktopProcess.ExitCode)." }
    Write-Host "`nThe desktop app has closed. Local database data remains available." -ForegroundColor Green
}
catch {
    $failureMessage = [string]$_.Exception.Message
    $failureLocation = [string]$_.InvocationInfo.PositionMessage
    $failureStack = [string]$_.ScriptStackTrace
    Write-Host "`nDar startup failed: $failureMessage" -ForegroundColor Red
    try { Write-Host ('Failure location: ' + $failureLocation) -ForegroundColor DarkYellow; Write-Host ('Stack: ' + $failureStack) -ForegroundColor DarkYellow } catch { }
    Write-Host "Service logs: $Logs" -ForegroundColor Yellow
    try {
        $details = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] ERROR: $failureMessage`r`nLocation: $failureLocation`r`nStack: $failureStack`r`n"
        [System.IO.File]::AppendAllText($LauncherLog, $details, [System.Text.UTF8Encoding]::new($false))
    } catch { }
    if ($InstalledRelease) {
        try {
            Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
            [void][System.Windows.Forms.MessageBox]::Show("تعذر تشغيل دار الإمام حفص:`r`n$failureMessage`r`n`r`nيمكنك مراجعة سجل التشغيل في:`r`n$LauncherLog", 'دار الإمام حفص', [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error)
        } catch { }
    }
    if ($ApiStartedByThisLauncher) {
        if (Test-Path $ApiOutLog) { Write-Host "`nAPI output from this launch:"; Get-Content $ApiOutLog -Tail 30 }
        if (Test-Path $ApiErrLog) { Write-Host "`nAPI errors from this launch:"; Get-Content $ApiErrLog -Tail 30 }
    } else {
        Write-Host 'The API was not started during this attempt; no old API logs are shown.' -ForegroundColor Yellow
    }
    exit 1
}
finally {
    if ($ApiStartedByThisLauncher) { Stop-LauncherApi }
}
