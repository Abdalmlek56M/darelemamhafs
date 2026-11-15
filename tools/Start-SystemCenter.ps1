$ErrorActionPreference = 'Stop'
$logs = Join-Path $env:LOCALAPPDATA 'DarEltahfeez\Logs'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$crashLog = Join-Path $logs 'system-center-crash.log'
$target = Join-Path $PSScriptRoot 'SystemCenter.ps1'
try {
    if (-not (Test-Path -LiteralPath $target -PathType Leaf)) { throw 'SystemCenter.ps1 is missing. Re-extract the complete package.' }
    & $target
    exit 0
}
catch {
    $message = @(
        "[$(Get-Date -Format o)] System Center startup failure"
        [string]$_.Exception.Message
        [string]$_.InvocationInfo.PositionMessage
        [string]$_.ScriptStackTrace
        ('-' * 72)
    ) -join [Environment]::NewLine
    [System.IO.File]::AppendAllText($crashLog, $message + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
    Write-Host 'Dar System Center failed. Diagnostic details were saved to:' -ForegroundColor Red
    Write-Host $crashLog -ForegroundColor Yellow
    Write-Host $message
    Write-Host 'No default Windows dialog was opened. Use the diagnostic path above.' -ForegroundColor DarkGray
    exit 1
}
