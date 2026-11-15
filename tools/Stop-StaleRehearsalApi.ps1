param([switch]$StopVerifiedListener)
$ErrorActionPreference = 'Stop'
$port = 5081
Write-Host "Dar Migration Rehearsal API cleanup — TCP port $port" -ForegroundColor Cyan
$connections = @()
try { $connections = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) } catch { }
$owners = @($connections | Select-Object -ExpandProperty OwningProcess -Unique)
if ($owners.Count -eq 0) {
    Write-Host "No process is listening on port $port. Nothing to stop." -ForegroundColor Green
    exit 0
}
if ($owners.Count -ne 1) {
    Write-Host 'More than one process owns port 5081. Refusing to stop anything.' -ForegroundColor Red
    exit 2
}
$ownerId = [int]$owners[0]
$process = Get-Process -Id $ownerId -ErrorAction SilentlyContinue
$info = $null
try { $info = Get-CimInstance Win32_Process -Filter "ProcessId = $ownerId" -ErrorAction SilentlyContinue } catch { }
$processName = if ($process) { $process.ProcessName } elseif ($info) { [IO.Path]::GetFileNameWithoutExtension($info.Name) } else { '' }
$commandLine = if ($info) { [string]$info.CommandLine } else { '' }
Write-Host "`nPID: $ownerId"
Write-Host "Process: $processName"
if ($info) {
    Write-Host ('Executable: ' + $info.ExecutablePath)
    Write-Host ('Command line: ' + $commandLine)
}
$isVerified = ($processName -ieq 'dotnet') -and ($commandLine -match '(?i)DarEltahfeez\.Api\.dll') -and ($commandLine -match '(?i)--urls\s+http://127\.0\.0\.1:5081')
if (-not $isVerified) {
    Write-Host 'NOT VERIFIED: this is not clearly the Dar isolated rehearsal API. No process was stopped.' -ForegroundColor Red
    exit 3
}
Write-Host 'VERIFIED: this is a Dar API listener on the isolated rehearsal port 5081.' -ForegroundColor Yellow
if (-not $StopVerifiedListener) {
    Write-Host 'Read-only inspection complete. Re-run with -StopVerifiedListener only when you intend to stop this isolated API.'
    exit 0
}
$confirmation = Read-Host "Type STOP $ownerId to terminate this verified isolated API process"
if ($confirmation -cne "STOP $ownerId") {
    Write-Host 'Confirmation did not match. Nothing was stopped.' -ForegroundColor Yellow
    exit 4
}
# Revalidate the same PID and command line immediately before termination.
$currentProcess = Get-Process -Id $ownerId -ErrorAction SilentlyContinue
$currentInfo = $null
try { $currentInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $ownerId" -ErrorAction SilentlyContinue } catch { }
$currentCommandLine = if ($currentInfo) { [string]$currentInfo.CommandLine } else { '' }
if (-not $currentProcess -or $currentProcess.ProcessName -ine 'dotnet' -or $currentCommandLine -notmatch '(?i)DarEltahfeez\.Api\.dll' -or $currentCommandLine -notmatch '(?i)--urls\s+http://127\.0\.0\.1:5081') {
    Write-Host 'The listener identity changed after confirmation. Nothing was stopped.' -ForegroundColor Red
    exit 6
}
Stop-Process -Id $ownerId -Force -ErrorAction Stop
try { Wait-Process -Id $ownerId -Timeout 15 -ErrorAction SilentlyContinue } catch { }
Start-Sleep -Milliseconds 500
$remaining = @()
try { $remaining = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) } catch { }
if ($remaining.Count -gt 0) {
    Write-Host 'The process stop was requested, but port 5081 is still occupied. Do not delete any staging database.' -ForegroundColor Red
    exit 5
}
Write-Host 'The verified isolated API process stopped and port 5081 is free. PostgreSQL on 55432 was not touched.' -ForegroundColor Green
exit 0
