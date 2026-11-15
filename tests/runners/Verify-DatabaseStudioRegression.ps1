$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
try {
    . (Join-Path $projectRoot 'tools\LocalPostgres.ps1')
    . (Join-Path $projectRoot 'tools\DatabaseStudio.ps1')

    $secretPath = Join-Path $env:LOCALAPPDATA 'DarEltahfeez\database-secrets.json'
    if (-not (Test-Path -LiteralPath $secretPath -PathType Leaf)) {
        Write-Host 'SKIP: Local Dar database secrets are not prepared. Start Dar Eltahfeez first.' -ForegroundColor Yellow
        Write-Output 'DAR_TEST_RESULT=SKIP'; exit 2
    }
    try { $script:DarPgBin = Get-DarPostgresBin -ProjectRoot $projectRoot } catch { $script:DarPgBin = $null }
    if ([string]::IsNullOrWhiteSpace([string]$script:DarPgBin)) {
        Write-Host 'SKIP: Verified local PostgreSQL 17 client binaries were not found.' -ForegroundColor Yellow
        Write-Output 'DAR_TEST_RESULT=SKIP'; exit 2
    }

    $secrets = Get-DarDatabaseSecrets
    Assert-DarDatabaseSecrets -Secrets $secrets
    $port = New-Object System.Net.Sockets.TcpClient
    try {
        $async = $port.BeginConnect('127.0.0.1',[int]$secrets.Port,$null,$null)
        if (-not $async.AsyncWaitHandle.WaitOne(1000)) { throw 'Local PostgreSQL port is not accepting connections.' }
        $port.EndConnect($async)
    } finally { $port.Close() }

    $overview = Get-DarDatabaseStudioOverview -Secrets $secrets
    if (@($overview.Rows).Count -ne 1) { throw 'Overview did not return exactly one row.' }
    if ($overview.ReadOnly -ne $true) { throw 'Overview result is not marked read-only.' }
    $summary = $overview.Rows[0]
    if ([string]$summary.transaction_read_only -ne 'on') { throw 'PostgreSQL did not confirm transaction_read_only=on.' }
    if ([string]$summary.database_name -ne [string]$secrets.Database) { throw 'Database Studio connected to an unexpected database.' }
    if ([int]$summary.server_port -ne 55432 -or [string]$summary.server_version -notmatch '^17\.') { throw 'Database Studio returned an unexpected PostgreSQL identity.' }
    if ([long]$summary.database_size_bytes -le 0) { throw 'Database size must be positive for the prepared Dar database.' }
    Write-Host 'PASS: Overview confirms the Dar database identity, PostgreSQL 17, local port 55432 and transaction_read_only=on.' -ForegroundColor Green

    $databases = Get-DarDatabaseStudioDatabases -Secrets $secrets
    if ($databases.ReadOnly -ne $true) { throw 'Database list result is not marked read-only.' }
    if (@($databases.Rows).Count -lt 1 -or -not (@($databases.Rows | Where-Object { [string]$_.database_name -eq [string]$secrets.Database }).Count -eq 1)) {
        throw 'Database catalog did not include the configured Dar database.'
    }
    Write-Host 'PASS: Database list is readable and includes the active Dar database.' -ForegroundColor Green

    $tables = Get-DarDatabaseStudioTables -Secrets $secrets
    if ($tables.ReadOnly -ne $true) { throw 'Table catalog result is not marked read-only.' }
    if (@($tables.Rows).Count -lt 1) { throw 'The public schema contains no visible table metadata.' }
    $students = @($tables.Rows | Where-Object { [string]$_.schema_name -eq 'public' -and [string]$_.table_name -eq 'students' })
    if ($students.Count -ne 1) { throw 'The public.students table was not found in the catalog list.' }
    if ([long]$students[0].total_size_bytes -lt 0) { throw 'Student table size metadata is invalid.' }
    Write-Host ('PASS: Public table catalog returned ' + @($tables.Rows).Count + ' relations and includes public.students.') -ForegroundColor Green
    foreach ($viewRow in @($tables.Rows | Where-Object { [string]$_.object_type -eq 'View' })) {
        if ($null -ne $viewRow.total_size_bytes -or $null -ne $viewRow.table_size_bytes -or $null -ne $viewRow.index_size_bytes) {
            throw 'An ordinary view reported physical storage even though it has no stored relation data.'
        }
    }
    foreach ($parentRow in @($tables.Rows | Where-Object { [string]$_.object_type -eq 'Partitioned table' })) {
        if ($null -ne $parentRow.total_size_bytes -or $null -ne $parentRow.table_size_bytes -or $null -ne $parentRow.index_size_bytes) {
            throw 'A partitioned parent reported storage that belongs to its physical partitions.'
        }
    }
    Write-Host 'PASS: Views and partitioned parents do not claim physical storage of their own.' -ForegroundColor Green

    $columns = Get-DarDatabaseStudioColumns -Secrets $secrets -SchemaName 'public' -TableName 'students'
    if ($columns.ReadOnly -ne $true) { throw 'Column catalog result is not marked read-only.' }
    if (@($columns.Rows).Count -lt 1 -or -not (@($columns.Rows | Where-Object { [string]$_.column_name -eq 'full_name' }).Count -eq 1)) {
        throw 'Student column metadata did not contain the expected full_name column.'
    }
    Write-Host 'PASS: Allow-listed catalog literal returns public.students columns.' -ForegroundColor Green

    $injectionRejected = $false
    try { [void](Get-DarDatabaseStudioColumns -Secrets $secrets -SchemaName 'public' -TableName 'students;DROP_TABLE') }
    catch { $injectionRejected = $true }
    if (-not $injectionRejected) { throw 'An unsupported SQL-like table name was not rejected before query execution.' }
    $schemaRejected = $false
    try { [void](Get-DarDatabaseStudioColumns -Secrets $secrets -SchemaName 'public;DROP' -TableName 'students') }
    catch { $schemaRejected = $true }
    if (-not $schemaRejected) { throw 'An unsupported SQL-like schema name was not rejected before query execution.' }
    Write-Host 'PASS: Unsupported schema/table names are rejected before PostgreSQL invocation.' -ForegroundColor Green

    $constraints = Get-DarDatabaseStudioConstraints -Secrets $secrets -SchemaName 'public' -TableName 'students'
    if ($constraints.ReadOnly -ne $true) { throw 'Constraint catalog result is not marked read-only.' }
    if (@($constraints.Rows).Count -lt 1 -or -not (@($constraints.Rows | Where-Object { [string]$_.constraint_type -eq 'PRIMARY KEY' }).Count -ge 1)) {
        throw 'Student constraint metadata did not include a primary key.'
    }
    Write-Host 'PASS: Student primary key and constraints are visible through the read-only catalog query.' -ForegroundColor Green

    $indexes = Get-DarDatabaseStudioIndexes -Secrets $secrets -SchemaName 'public' -TableName 'students'
    if ($indexes.ReadOnly -ne $true) { throw 'Index catalog result is not marked read-only.' }
    if (@($indexes.Rows).Count -lt 1 -or -not (@($indexes.Rows | Where-Object { [string]$_.index_name -eq 'idx_students_name' }).Count -eq 1)) {
        throw 'Student index metadata did not include idx_students_name.'
    }
    Write-Host 'PASS: Student indexes and validity flags are visible through the read-only catalog query.' -ForegroundColor Green

    $connections = Get-DarDatabaseStudioConnections -Secrets $secrets
    if ($null -eq $connections -or $connections.ReadOnly -ne $true) { throw 'Connection inventory did not return a read-only result.' }
    foreach ($connection in @($connections.Rows)) {
        if ($connection.PSObject.Properties.Name -contains 'query') { throw 'Connection inventory unexpectedly exposed raw SQL text.' }
        if ([string]$connection.client_location -notin @('Local','Loopback/Local')) { throw 'Connection inventory exposed an unmasked client address.' }
    }
    Write-Host ('PASS: Connection inventory returned ' + @($connections.Rows).Count + ' rows without SQL text or client IP addresses.') -ForegroundColor Green

    Write-Host 'PASS: Database Studio read-only catalog regression completed. The runner did not write business rows or execute DDL/DML.' -ForegroundColor Green
    Write-Output 'DAR_TEST_RESULT=PASS'; exit 0
} catch {
    Write-Host ('FAIL: Database Studio regression: ' + $_.Exception.Message) -ForegroundColor Red
    Write-Output 'DAR_TEST_RESULT=FAIL'; exit 1
}
