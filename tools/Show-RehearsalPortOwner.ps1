$ErrorActionPreference = 'Stop'
$port = 5081
Write-Host "Dar Migration Rehearsal API diagnostic — TCP port $port" -ForegroundColor Cyan
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
    Write-Host "`nPID: $ownerId" -ForegroundColor Yellow
    Write-Host ('Process: ' + $(if ($proc) { $proc.ProcessName } elseif ($info) { [IO.Path]::GetFileNameWithoutExtension($info.Name) } else { 'Unknown' }))
    if ($info) {
        Write-Host ('Executable: ' + $info.ExecutablePath)
        Write-Host ('Command line: ' + $info.CommandLine)
        if ($info.CommandLine -match 'DarEltahfeez\.Api\.(dll|exe)' -and $info.CommandLine -match '--urls\s+http://127\.0\.0\.1:5081') {
            Write-Host 'Classification: possible Dar isolated migration rehearsal API.' -ForegroundColor Yellow
        } else {
            Write-Host 'Classification: not verified as the Dar migration rehearsal API. Do not stop it.' -ForegroundColor Red
        }
    }
}
Write-Host "`nThis diagnostic is read-only. It never stops or changes any process."
