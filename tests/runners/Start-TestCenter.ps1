$ErrorActionPreference = 'Stop'
$logs = Join-Path $env:LOCALAPPDATA 'DarEltahfeez\Logs'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$crashLog = Join-Path $logs 'testcenter-crash.log'
$target = Join-Path $PSScriptRoot 'TestCenter.ps1'
try {
    if (-not (Test-Path -LiteralPath $target -PathType Leaf)) { throw 'TestCenter.ps1 is missing.' }
    & $target
    exit 0
} catch {
    $message = @(
        "[$(Get-Date -Format o)] Test Center startup failure"
        [string]$_.Exception.Message
        [string]$_.InvocationInfo.PositionMessage
        [string]$_.ScriptStackTrace
        ('-' * 72)
    ) -join [Environment]::NewLine
    [System.IO.File]::AppendAllText($crashLog, $message + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
    Write-Host 'Test Center failed. Details were saved to:' -ForegroundColor Red
    Write-Host $crashLog -ForegroundColor Yellow
    Write-Host $message
    try {
        Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
        [void][System.Windows.Forms.MessageBox]::Show("Test Center could not start.`r`n`r`n$($_.Exception.Message)`r`n`r`nDetails: $crashLog", 'Dar Eltahfeez Test Center', [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error)
    } catch { }
    exit 1
}
