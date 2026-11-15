$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Root = Split-Path -Parent $PSScriptRoot
function Write-Step([string]$Message) { Write-Host "`n$Message" -ForegroundColor Cyan }
. (Join-Path $PSScriptRoot 'LocalPostgres.ps1')

Write-Host 'Preparing an offline PostgreSQL runtime bundle for Dar Eltahfeez...' -ForegroundColor Green
$bin = Get-DarPostgresBin -ProjectRoot $Root -DownloadIfMissing
$sourceRoot = Split-Path -Parent $bin
$destination = Join-Path $Root 'database-runtime\pgsql'
if ([string]::Equals([IO.Path]::GetFullPath($sourceRoot), [IO.Path]::GetFullPath($destination), [StringComparison]::OrdinalIgnoreCase)) {
    Write-Host 'The official PostgreSQL runtime is already bundled in this project.' -ForegroundColor Green
    exit 0
}
if (Test-Path $destination) {
    throw "The bundle destination already exists: $destination. Move or rename it manually before preparing a different runtime."
}
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
New-Item -ItemType Directory -Force -Path $destination | Out-Null
Get-ChildItem -LiteralPath $sourceRoot -Force | Copy-Item -Destination $destination -Recurse -Force
foreach ($required in @('bin\pg_ctl.exe','bin\initdb.exe','bin\pg_dump.exe','bin\pg_restore.exe','bin\psql.exe')) {
    if (-not (Test-Path (Join-Path $destination $required))) {
        throw "Offline runtime bundle is incomplete: $required"
    }
}
Write-Host "Offline PostgreSQL runtime prepared successfully:`n$destination" -ForegroundColor Green
Write-Host 'Include the database-runtime folder when creating the app release ZIP.' -ForegroundColor Yellow
