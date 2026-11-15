$ErrorActionPreference = 'Stop'
$port = 5080
Write-Host "Dar API listener diagnostic — TCP port $port" -ForegroundColor Cyan
$connections = @()
try { $connections = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) } catch { }
$owners = @($connections | Select-Object -ExpandProperty OwningProcess -Unique)
if ($owners.Count -eq 0) {
    Write-Host "No process is listening on port $port." -ForegroundColor Green
    exit 0
}
foreach ($ownerId in $owners) {
    $proc = Get-Process -Id ([int]$ownerId) -ErrorAction SilentlyContinue
    $info = $null
    try { $info = Get-CimInstance Win32_Process -Filter "ProcessId = $ownerId" -ErrorAction SilentlyContinue } catch { }
    Write-Host ''
    Write-Host ("PID: {0}" -f $ownerId) -ForegroundColor Yellow
    Write-Host ("Process: {0}" -f $(if ($proc) { $proc.ProcessName } elseif ($info) { $info.Name } else { 'Unknown' }))
    if ($info) { Write-Host ("Executable: {0}" -f $info.ExecutablePath); Write-Host ("Command line: {0}" -f $info.CommandLine) }
    if ($info -and $info.CommandLine -match 'DarEltahfeez\.Api\.(dll|exe)') {
        Write-Host 'Classification: Dar API listener.' -ForegroundColor Green
    } else {
        Write-Host 'Classification: Not confirmed as Dar API. Do not stop it based only on the port.' -ForegroundColor Red
    }
}
Write-Host ''
Write-Host 'Safe shutdown:' -ForegroundColor Cyan
Write-Host '1. Close the Dar desktop window.'
Write-Host '2. Wait for the START_DAR console to print that the desktop app has closed and return to the prompt.'
Write-Host '3. Re-run this diagnostic. Port 5080 should be free.'
Write-Host '4. Do not stop postgres.exe; PostgreSQL uses port 55432 and is a separate service.'
Write-Host 'This diagnostic is read-only. It never stops or changes any process.' -ForegroundColor Yellow
