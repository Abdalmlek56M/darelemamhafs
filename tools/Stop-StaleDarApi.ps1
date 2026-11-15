#requires -Version 5.1
param([switch]$StopVerifiedListener)
$ErrorActionPreference = 'Stop'
$port = 5080
Write-Host "Dar API listener diagnostic / safe cleanup — TCP port $port" -ForegroundColor Cyan
$listeners = @()
try { $listeners = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) } catch { }
$owners = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)
if ($owners.Count -eq 0) {
    Write-Host "No process is listening on port $port." -ForegroundColor Green
    exit 0
}
if ($owners.Count -ne 1) {
    Write-Host 'Multiple processes/listeners own port 5080. Refusing to stop anything.' -ForegroundColor Red
    exit 2
}
$ownerId = [int]$owners[0]
$proc = Get-Process -Id $ownerId -ErrorAction SilentlyContinue
$info = $null
try { $info = Get-CimInstance Win32_Process -Filter "ProcessId = $ownerId" -ErrorAction SilentlyContinue } catch { }
$name = if ($info) { [string]$info.Name } elseif ($proc) { $proc.ProcessName } else { '' }
$commandLine = if ($info) { [string]$info.CommandLine } else { '' }
Write-Host "PID: $ownerId"
Write-Host "Process: $name"
if ($info) {
    Write-Host ('Executable: ' + [string]$info.ExecutablePath)
    Write-Host ('Command line: ' + $commandLine)
}
$isDarApi = ($name -match '(?i)^DarEltahfeez\.Api(\.exe)?$') -or
    (($name -ieq 'dotnet.exe' -or $name -ieq 'dotnet') -and $commandLine -match '(?i)(^|[\\/])DarEltahfeez\.Api\.dll(?:\s|$)')
if (-not $isDarApi) {
    Write-Host 'NOT VERIFIED: listener is not clearly DarEltahfeez.Api. Nothing was stopped.' -ForegroundColor Red
    exit 3
}
Write-Host 'VERIFIED: port 5080 belongs to DarEltahfeez.Api.' -ForegroundColor Yellow
if (-not $StopVerifiedListener) {
    Write-Host 'Read-only mode. Re-run through STOP_STALE_DAR_API.bat only if you intend to stop this confirmed stale Dar API.'
    exit 0
}
$confirmation = Read-Host "Type STOP $ownerId to stop only this verified Dar API process"
if ($confirmation -cne "STOP $ownerId") {
    Write-Host 'Confirmation did not match. Nothing was stopped.' -ForegroundColor Yellow
    exit 4
}
# Revalidate exact PID, image and command line immediately before stopping.
$current = Get-Process -Id $ownerId -ErrorAction SilentlyContinue
$currentInfo = $null
try { $currentInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $ownerId" -ErrorAction SilentlyContinue } catch { }
$currentName = if ($currentInfo) { [string]$currentInfo.Name } else { '' }
$currentCommand = if ($currentInfo) { [string]$currentInfo.CommandLine } else { '' }
$currentIsDarApi = ($currentName -match '(?i)^DarEltahfeez\.Api(\.exe)?$') -or
    (($currentName -ieq 'dotnet.exe' -or $currentName -ieq 'dotnet') -and $currentCommand -match '(?i)(^|[\\/])DarEltahfeez\.Api\.dll(?:\s|$)')
if (-not $current -or -not $currentIsDarApi -or $currentCommand -cne $commandLine) {
    Write-Host 'Listener identity changed since inspection. Nothing was stopped.' -ForegroundColor Red
    exit 5
}
Stop-Process -Id $ownerId -Force -ErrorAction Stop
try { Wait-Process -Id $ownerId -Timeout 15 -ErrorAction SilentlyContinue } catch { }
$deadline = (Get-Date).AddSeconds(10)
do {
    $remaining = @()
    try { $remaining = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) } catch { }
    if ($remaining.Count -eq 0) { break }
    Start-Sleep -Milliseconds 250
} while ((Get-Date) -lt $deadline)
if ($remaining.Count -gt 0) {
    Write-Host 'Dar API stop was requested but port 5080 remains occupied. Inspect the new owner; no other process was stopped.' -ForegroundColor Red
    exit 6
}
Write-Host 'Verified Dar API stopped; port 5080 is free. PostgreSQL on 55432 was not touched.' -ForegroundColor Green
exit 0
