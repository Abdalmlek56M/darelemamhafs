param([int]$TimeoutSeconds = 15)
$ErrorActionPreference = 'Stop'
$logs = Join-Path $env:LOCALAPPDATA 'DarEltahfeez\Logs'
$baseUrl = 'http://127.0.0.1:5080'

function Get-HttpStatusCode($Exception) {
    try { return [int]$Exception.Response.StatusCode } catch { return $null }
}

if (-not (Test-Path -LiteralPath $logs -PathType Container)) {
    Write-Host 'SKIP: The Dar logs folder does not exist yet. Start Dar Eltahfeez first.' -ForegroundColor Yellow
    Write-Output 'DAR_TEST_RESULT=SKIP'
    exit 2
}

try {
    $health = Invoke-RestMethod -Uri "$baseUrl/health" -Method Get -TimeoutSec 3
    if ($health.status -ne 'ok' -or $health.service -ne 'DarEltahfeez.Api') {
        Write-Host 'SKIP: The Dar API is reachable but its health check is not ready.' -ForegroundColor Yellow
        Write-Output 'DAR_TEST_RESULT=SKIP'
    exit 2
    }
} catch {
    Write-Host 'SKIP: Dar API is not running at 127.0.0.1:5080. Start Dar Eltahfeez, keep it open, then rerun this test.' -ForegroundColor Yellow
    Write-Output 'DAR_TEST_RESULT=SKIP'
    exit 2
}

$before = Get-ChildItem -LiteralPath $logs -Filter 'api-*.jsonl' -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
$beforePath = if ($before) { $before.FullName } else { $null }
$beforeLength = if ($before) { $before.Length } else { 0L }

$status = $null
try {
    Invoke-WebRequest -Uri "$baseUrl/api/admin/settings" -Method Get -TimeoutSec 5 -UseBasicParsing | Out-Null
    $status = 200
} catch {
    $status = Get-HttpStatusCode $_.Exception
}
if ($status -notin @(401, 403)) {
    Write-Host "FAIL: Expected HTTP 401/403 from the protected settings endpoint; received HTTP $status." -ForegroundColor Red
    Write-Output 'DAR_TEST_RESULT=FAIL'
    exit 1
}

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$found = $false
while ((Get-Date) -lt $deadline -and -not $found) {
    $latest = Get-ChildItem -LiteralPath $logs -Filter 'api-*.jsonl' -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
    if ($latest) {
        $lines = Get-Content -LiteralPath $latest.FullName -Tail 200 -Encoding UTF8 -ErrorAction SilentlyContinue
        $found = [bool]($lines | Where-Object {
            $_ -match 'HTTP GET .*/api/admin/settings.*(401|403)' -or
            $_ -match '"Path":"/api/admin/settings".*"StatusCode":(401|403)'
        })
    }
    if (-not $found) { Start-Sleep -Milliseconds 350 }
}
if (-not $found) {
    Write-Host 'FAIL: The API rejected the request, but no matching structured log entry appeared.' -ForegroundColor Red
    Write-Host "Log folder: $logs"
    Write-Output 'DAR_TEST_RESULT=FAIL'
    exit 1
}
Write-Host 'PASS: API request was recorded in the structured log.' -ForegroundColor Green
Write-Host "Log folder: $logs"
Write-Output 'DAR_TEST_RESULT=PASS'
exit 0
