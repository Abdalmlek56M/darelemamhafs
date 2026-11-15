$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
try {
    . (Join-Path $projectRoot 'tools\LocalPostgres.ps1')
    . (Join-Path $projectRoot 'tools\DatabaseStudio.ps1')
    . (Join-Path $projectRoot 'tools\PostgresMaintenance.ps1')

    $secretPath = Join-Path $env:LOCALAPPDATA 'DarEltahfeez\database-secrets.json'
    if (-not (Test-Path -LiteralPath $secretPath -PathType Leaf)) {
        Write-Host 'SKIP: Local Dar database secrets are not prepared. Start Dar Eltahfeez first.' -ForegroundColor Yellow
        Write-Output 'DAR_TEST_RESULT=SKIP'; exit 2
    }
    try { $script:DarPgBin = Get-DarPostgresBin -ProjectRoot $projectRoot } catch { $script:DarPgBin = $null }
    if ([string]::IsNullOrWhiteSpace([string]$script:DarPgBin)) {
        Write-Host 'SKIP: Verified PostgreSQL 17 client binaries were not found.' -ForegroundColor Yellow
        Write-Output 'DAR_TEST_RESULT=SKIP'; exit 2
    }

    $secrets = Get-DarDatabaseSecrets
    Assert-DarDatabaseSecrets -Secrets $secrets
    $socket = New-Object System.Net.Sockets.TcpClient
    try {
        $async = $socket.BeginConnect('127.0.0.1',[int]$secrets.Port,$null,$null)
        if (-not $async.AsyncWaitHandle.WaitOne(1000)) { throw 'Local PostgreSQL is not accepting connections on the configured port.' }
        $socket.EndConnect($async)
    } finally { $socket.Close() }

    $report = Get-DarPostgresMaintenanceReport -Secrets $secrets
    if ($report.ReadOnly -ne $true) { throw 'Maintenance report did not declare itself read-only.' }
    $overview = $report.Overview
    if ([string]$overview.database_name -ne [string]$secrets.Database) { throw 'Maintenance report connected to an unexpected database.' }
    if ([int]$overview.server_port -ne 55432 -or [string]$overview.server_version -notmatch '^17\.') { throw 'Maintenance report returned an unexpected PostgreSQL identity.' }
    if ([string]$overview.transaction_read_only -ne 'on') { throw 'PostgreSQL did not confirm transaction_read_only=on.' }
    if ($overview.autovacuum_enabled -isnot [bool] -or $overview.track_counts_enabled -isnot [bool]) { throw 'Autovacuum or track_counts settings were not returned as booleans.' }
    if ($null -eq $overview.active_autovacuum_workers -or $null -eq $overview.freeze_max_age -or $null -eq $overview.oldest_xid_age) { throw 'Autovacuum worker or transaction ID freeze metrics are incomplete.' }
    Write-Host 'PASS: Maintenance overview confirms Dar identity, PostgreSQL 17, port 55432, READ ONLY, Autovacuum and XID age metrics.' -ForegroundColor Green

    if (@($report.Tables).Count -lt 1) { throw 'No user table statistics were returned.' }
    $studentRows = @($report.Tables | Where-Object { [string]$_.schema_name -eq 'public' -and [string]$_.table_name -eq 'students' })
    if ($studentRows.Count -ne 1) { throw 'The public.students statistics row was not returned.' }
    foreach ($property in @('estimated_live_tuples','estimated_dead_tuples','dead_tuple_percent','modified_since_analyze','last_vacuum','last_autovacuum','last_analyze','last_autoanalyze')) {
        if ($null -eq $studentRows[0].PSObject.Properties[$property]) { throw ('Missing table statistics field: ' + $property) }
    }
    if ([long]$studentRows[0].estimated_live_tuples -lt 0 -or [long]$studentRows[0].estimated_dead_tuples -lt 0) { throw 'Estimated tuple counts cannot be negative.' }
    Write-Host ('PASS: Table maintenance statistics returned ' + @($report.Tables).Count + ' rows including public.students with estimated tuple, dead-row and analyze/vacuum timestamps.') -ForegroundColor Green

    $settingNames = @($report.Settings | ForEach-Object { [string]$_.name })
    foreach ($requiredName in @('autovacuum','track_counts','autovacuum_naptime','autovacuum_vacuum_threshold','autovacuum_analyze_threshold','autovacuum_freeze_max_age')) {
        if ($settingNames -notcontains $requiredName) { throw ('Missing PostgreSQL maintenance setting: ' + $requiredName) }
    }
    Write-Host ('PASS: Autovacuum settings and configuration source metadata returned ' + @($report.Settings).Count + ' rows.') -ForegroundColor Green

    if ($null -eq $report.PSObject.Properties['VacuumProgress']) { throw 'VACUUM progress result property was not returned; an empty array is valid.' }
    Write-Host ('PASS: Active VACUUM progress query completed safely. Active operations=' + @($report.VacuumProgress).Count) -ForegroundColor Green
    Write-Host 'PASS: All PostgreSQL maintenance queries were bounded READ ONLY catalog/statistics reads; no VACUUM, ANALYZE, REINDEX, DDL or DML was executed.' -ForegroundColor Green
    Write-Output 'DAR_TEST_RESULT=PASS'
    exit 0
} catch {
    Write-Host ('FAIL: PostgreSQL maintenance live regression failed: ' + $_.Exception.Message) -ForegroundColor Red
    Write-Output 'DAR_TEST_RESULT=FAIL'
    exit 1
}
