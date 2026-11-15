$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$failed = New-Object System.Collections.Generic.List[string]
try {
    $modulePath = Join-Path $projectRoot 'tools\PostgresMaintenance.ps1'
    $databaseStudioPath = Join-Path $projectRoot 'tools\DatabaseStudio.ps1'
    $centerPath = Join-Path $projectRoot 'tools\SystemCenter.ps1'
    foreach ($path in @($modulePath,$databaseStudioPath,$centerPath)) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw ('Required PostgreSQL maintenance file is missing: ' + $path) }
        $tokens = $null
        $parseErrors = $null
        [void][System.Management.Automation.Language.Parser]::ParseFile($path,[ref]$tokens,[ref]$parseErrors)
        if ($parseErrors -and $parseErrors.Count -gt 0) {
            $first = $parseErrors[0]
            throw ('PowerShell parse error in {0}:{1}:{2}: {3}' -f $path,$first.Extent.StartLineNumber,$first.Extent.StartColumnNumber,$first.Message)
        }
    }
    Write-Host 'PASS: PostgreSQL maintenance module, catalog helper and System Center passed PowerShell AST parsing.' -ForegroundColor Green

    $module = Get-Content -LiteralPath $modulePath -Raw -Encoding UTF8
    $databaseStudio = Get-Content -LiteralPath $databaseStudioPath -Raw -Encoding UTF8
    $center = Get-Content -LiteralPath $centerPath -Raw -Encoding UTF8
    $checks = @(
        @{ Name='System Center loads PostgreSQL maintenance module'; Text=$center; Pattern='PostgresMaintenance\.ps1[\s\S]*?\.\s+\$PostgresMaintenanceModule' },
        @{ Name='PostgreSQL maintenance tab is registered'; Text=$center; Pattern="postgresMaintenancePage\.Text\s*=\s*'صيانة PostgreSQL'" },
        @{ Name='Maintenance tab loads diagnostics lazily'; Text=$center; Pattern='SelectedTab -eq \$postgresMaintenancePage[\s\S]*?postgresMaintenanceRefreshButton\.PerformClick' },
        @{ Name='Maintenance UI grid is read-only'; Text=$center; Pattern='postgresMaintenanceGrid\.ReadOnly\s*=\s*\$true' },
        @{ Name='Maintenance grid sizes columns by content and allows horizontal scrolling'; Text=$center; Pattern='postgresMaintenanceGrid\.AutoSizeColumnsMode\s*=\s*\[System\.Windows\.Forms\.DataGridViewAutoSizeColumnsMode\]::DisplayedCells[\s\S]*?postgresMaintenanceGrid\.ScrollBars\s*=\s*\[System\.Windows\.Forms\.ScrollBars\]::Both' },
        @{ Name='Maintenance UI exposes refresh but no maintenance execution controls'; Text=$center; Pattern='postgresMaintenanceRefreshButton\.Add_Click' },
        @{ Name='Maintenance UI reports the database with the oldest XID age'; Text=$center; Pattern='oldest_database_name' },
        @{ Name='Autovacuum worker summary explicitly scopes count to the current database'; Text=$center; Pattern='عمال Autovacuum \(القاعدة الحالية\)' },
        @{ Name='Table statistics query is limited to 250 rows'; Text=$module; Pattern='pg_stat_user_tables[\s\S]*?LIMIT 250' },
        @{ Name='Settings and vacuum progress queries each cap output to 50 rows'; Text=$module; Pattern='pg_settings[\s\S]*?LIMIT 50[\s\S]*?pg_stat_progress_vacuum[\s\S]*?LIMIT 50' },
        @{ Name='Maintenance page has no VACUUM/ANALYZE/REINDEX execution button'; Text=$center; Pattern='(Button\.Text|RefreshButton\.Text)\s*=\s*[^\r\n]*(VACUUM|ANALYZE|REINDEX)'; Negative=$true },
        @{ Name='Maintenance report requires all query results to be read-only'; Text=$module; Pattern='foreach \(\$result in @\(\$overviewResult,\$tablesResult,\$settingsResult,\$progressResult\)\)[\s\S]*?\$result\.ReadOnly -ne \$true' },
        @{ Name='Overview reads Autovacuum and track_counts settings'; Text=$module; Pattern="current_setting\('autovacuum'\)[\s\S]*?current_setting\('track_counts'\)" },
        @{ Name='Overview reads XID freeze age and maximum age'; Text=$module; Pattern='oldest_xid_age[\s\S]*?autovacuum_freeze_max_age' },
        @{ Name='Overview reads database transaction and buffer statistics'; Text=$module; Pattern='xact_commit[\s\S]*?xact_rollback[\s\S]*?blks_read[\s\S]*?blks_hit[\s\S]*?deadlocks' },
        @{ Name='Table diagnostics label live/dead tuples and modifications as estimates'; Text=$module; Pattern='estimated_live_tuples[\s\S]*?estimated_dead_tuples[\s\S]*?modified_since_analyze' },
        @{ Name='Table diagnostics expose manual and automatic vacuum/analyze timestamps'; Text=$module; Pattern='last_vacuum[\s\S]*?last_autovacuum[\s\S]*?last_analyze[\s\S]*?last_autoanalyze' },
        @{ Name='Table diagnostics respect table-level autovacuum disable option'; Text=$module; Pattern="autovacuum_enabled=false" },
        @{ Name='Settings view includes source and pending restart metadata'; Text=$module; Pattern='source,[\s\r\n]*pending_restart' },
        @{ Name='Vacuum progress view does not expose query text or client addresses'; Text=$module; Pattern='pg_stat_progress_vacuum[\s\S]*?heap_blks_scanned[\s\S]*?heap_blks_vacuumed' },
        @{ Name='VACUUM progress uses PostgreSQL 17 dead-item and index-progress column names'; Text=$module; Pattern='pg_stat_progress_vacuum[\s\S]*?v\.dead_tuple_bytes[\s\S]*?v\.max_dead_tuple_bytes[\s\S]*?v\.num_dead_item_ids[\s\S]*?v\.indexes_total[\s\S]*?v\.indexes_processed' },
        @{ Name='VACUUM progress does not reference nonexistent dead-tuple count columns'; Text=$module; Pattern='v\.num_dead_tuples|v\.max_dead_tuples'; Negative=$true },
        @{ Name='All diagnostics call the bounded shared READ ONLY catalog wrapper'; Text=$module; Pattern='Invoke-DarDatabaseStudioCatalogQuery -Sql \$sql -Secrets \$Secrets' },
        @{ Name='All four maintenance reads use the shared catalog wrapper'; Text=$module; Pattern='Invoke-DarDatabaseStudioCatalogQuery -Sql \$sql -Secrets \$Secrets'; Count=4 },
        @{ Name='Maintenance module never invokes PostgreSQL tools directly'; Text=$module; Pattern='Invoke-DarPgTool|Start-Process|Ensure-DarLocalPostgres|Start-DarPostgresServer|Stop-DarPostgresServer'; Negative=$true },
        @{ Name='Maintenance module contains no VACUUM/ANALYZE/REINDEX command execution'; Text=$module; Pattern='(?im)^\s*(VACUUM|ANALYZE|REINDEX)\s'; Negative=$true },
        @{ Name='Maintenance module contains no DDL or DML'; Text=$module; Pattern='(?im)^\s*(INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE)\s'; Negative=$true },
        @{ Name='Shared catalog wrapper enforces explicit read-only transaction and timeouts'; Text=$databaseStudio; Pattern="BEGIN READ ONLY; SET LOCAL statement_timeout = '5000ms'; SET LOCAL lock_timeout = '1000ms'" },
        @{ Name='Shared catalog wrapper rejects maintenance commands'; Text=$databaseStudio; Pattern='VACUUM\|ANALYZE\|REINDEX' }
    )
    foreach ($check in $checks) {
        $matched = [regex]::IsMatch([string]$check.Text,[string]$check.Pattern,[System.Text.RegularExpressions.RegexOptions]::Singleline)
        if ($check.ContainsKey('Count')) { $actualCount = [regex]::Matches([string]$check.Text,[string]$check.Pattern,[System.Text.RegularExpressions.RegexOptions]::Singleline).Count; $matched = ($actualCount -eq [int]$check.Count) }
        if ($check.Negative) { $matched = -not $matched }
        if ($matched) { Write-Host ('PASS: ' + $check.Name) -ForegroundColor Green }
        else { Write-Host ('FAIL: ' + $check.Name) -ForegroundColor Red; $failed.Add([string]$check.Name) }
    }
    if ($failed.Count -gt 0) { throw ('PostgreSQL maintenance source checks failed: ' + ($failed -join '; ')) }
    Write-Host ('PASS: PostgreSQL maintenance source guards. Assertions=' + $checks.Count) -ForegroundColor Green
    Write-Output 'DAR_TEST_RESULT=PASS'
    exit 0
} catch {
    Write-Host ('FAIL: ' + $_.Exception.Message) -ForegroundColor Red
    Write-Output 'DAR_TEST_RESULT=FAIL'
    exit 1
}
