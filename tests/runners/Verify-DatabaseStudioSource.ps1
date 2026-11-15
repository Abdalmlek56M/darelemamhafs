$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$failed = New-Object System.Collections.Generic.List[string]
try {
    $modulePath = Join-Path $projectRoot 'tools\DatabaseStudio.ps1'
    $centerPath = Join-Path $projectRoot 'tools\SystemCenter.ps1'
    $desktopProjectPath = Join-Path $projectRoot 'desktop-host\DarEltahfeez.Desktop.csproj'
    if (-not (Test-Path -LiteralPath $modulePath -PathType Leaf)) { throw 'DatabaseStudio.ps1 is missing.' }
    if (-not (Test-Path -LiteralPath $centerPath -PathType Leaf)) { throw 'SystemCenter.ps1 is missing.' }
    if (-not (Test-Path -LiteralPath $desktopProjectPath -PathType Leaf)) { throw 'DarEltahfeez.Desktop.csproj is missing.' }
    $module = Get-Content -LiteralPath $modulePath -Raw -Encoding UTF8
    $center = Get-Content -LiteralPath $centerPath -Raw -Encoding UTF8
    $desktopProject = Get-Content -LiteralPath $desktopProjectPath -Raw -Encoding UTF8
    try { [xml]$desktopProjectXml = $desktopProject } catch { throw 'DarEltahfeez.Desktop.csproj is not valid XML.' }

    foreach ($parsePath in @($modulePath,$centerPath,$MyInvocation.MyCommand.Path)) {
        $tokens = $null; $errors = $null
        [void][System.Management.Automation.Language.Parser]::ParseFile($parsePath,[ref]$tokens,[ref]$errors)
        if ($errors -and $errors.Count -gt 0) {
            $first = $errors[0]
            throw ('PowerShell parse error in {0}:{1}:{2}: {3}' -f $parsePath,$first.Extent.StartLineNumber,$first.Extent.StartColumnNumber,$first.Message)
        }
    }
    Write-Host 'PASS: Database Studio PowerShell module, System Center UI and source runner parse successfully.' -ForegroundColor Green

    # WinForms label map is a PowerShell hashtable: duplicate keys are a parse-time error.
    # Keep this focused regression guard so new labels cannot silently collide (case-insensitively).
    $labelMapMatch = [regex]::Match($center,'(?s)\$script:databaseStudioColumnLabels\s*=\s*@\{(?<body>.*?)\r?\n\}')
    if (-not $labelMapMatch.Success) { throw 'Database Studio column-label hashtable was not found.' }
    $labelKeyMatches = [regex]::Matches($labelMapMatch.Groups['body'].Value,'(?m)(?:^|;)\s*([A-Za-z_][A-Za-z0-9_]*)\s*=')
    $seenLabelKeys = @{}
    foreach ($labelKeyMatch in $labelKeyMatches) {
        $labelKey = [string]$labelKeyMatch.Groups[1].Value
        if ($seenLabelKeys.ContainsKey($labelKey)) { throw ("Duplicate Database Studio column-label key: {0}" -f $labelKey) }
        $seenLabelKeys[$labelKey] = $true
    }
    if (-not $seenLabelKeys.ContainsKey('definition')) { throw 'Database Studio column-label map is missing the definition label.' }
    Write-Host ('PASS: Database Studio column-label hashtable contains unique keys. Keys=' + $seenLabelKeys.Count) -ForegroundColor Green

    $expectedIconProperty = '<ApplicationIcon Condition="Exists(''$(DarApplicationIconPath)'')">$(DarApplicationIconPath)</ApplicationIcon>'
    if (-not $desktopProject.Contains($expectedIconProperty) -or -not $desktopProject.Contains('WarnIfDarApplicationIconMissing') -or -not $desktopProject.Contains('Continuing with the default Windows executable icon')) {
        throw 'WPF application icon fallback is missing; an absent optional ICO must not block desktop startup.'
    }
    foreach ($versionTag in @('<Version>0.8.25.0</Version>','<AssemblyVersion>0.8.25.0</AssemblyVersion>','<FileVersion>0.8.25.0</FileVersion>')) {
        if (-not $desktopProject.Contains($versionTag)) { throw ('WPF project version metadata is stale: ' + $versionTag) }
    }
    Write-Host 'PASS: WPF application icon is optional and desktop assembly version metadata is current.' -ForegroundColor Green

    $checks = @( 
        @{ Name='System Center imports the dedicated Database Studio module'; Text=$center; Pattern='DatabaseStudio\.ps1[\s\S]*?\.\s+\$DatabaseStudioModule' },
        @{ Name='Database Studio tab is registered'; Text=$center; Pattern="databaseStudioPage\.Text\s*=\s*'قاعدة البيانات'" },
        @{ Name='Database Studio is loaded on demand when the tab is selected'; Text=$center; Pattern='SelectedTab -eq \$databaseStudioPage[\s\S]*?databaseStudioRefreshButton\.PerformClick' },
        @{ Name='Database Studio grid is read-only and disallows row editing'; Text=$center; Pattern='databaseStudioGrid\.ReadOnly\s*=\s*\$true[\s\S]*?AllowUserToAddRows\s*=\s*\$false[\s\S]*?AllowUserToDeleteRows\s*=\s*\$false' },
        @{ Name='SQL viewer is permanently read-only'; Text=$center; Pattern='databaseStudioSqlText\.ReadOnly\s*=\s*\$true' },
        @{ Name='SQL viewer displays query text without accepting user input'; Text=$center; Pattern='databaseStudioSqlText\.Text\s*=\s*\$result\.SqlText' },
        @{ Name='Database Studio uses a fixed view allow-list'; Text=$center; Pattern="databaseStudioViewKeys\s*=\s*@\('Tables','Databases','Columns','Constraints','Indexes','Connections'\)" },
        @{ Name='Table selector renders the friendly DisplayName property'; Text=$center; Pattern="databaseStudioTableCombo\.DisplayMember\s*=\s*'DisplayName'" },
        @{ Name='Database grid formats byte columns before adding the value to the row collection'; Text=$center; Pattern='\$formattedSize = Format-DarDatabaseStudioSize -Value \$value[\s\S]*?\[void\]\$values\.Add\(\$formattedSize\)' },
        @{ Name='Every system-center page has a background card entry'; Text=$center; Pattern='Page=\$healthPage[\s\S]*?Page=\$storagePage[\s\S]*?Page=\$databaseStudioPage' },
        @{ Name='Overview confirms the PostgreSQL read-only transaction'; Text=$center; Pattern='\$overview\.transaction_read_only\s*-ne\s*''on'''  },
        @{ Name='Catalog query validates local database secrets'; Text=$module; Pattern='function Invoke-DarDatabaseStudioCatalogQuery[\s\S]*?Assert-DarDatabaseSecrets -Secrets \$Secrets' },
        @{ Name='Catalog query uses the loopback host and explicit port argument'; Text=$module; Pattern='-h[^\r\n]*127\.0\.0\.1[^\r\n]*-p' },
        @{ Name='Catalog query takes the port from validated database secrets'; Text=$module; Pattern='\[string\]\$Secrets\.Port' },
        @{ Name='Catalog query disables interactive password prompts'; Text=$module; Pattern="'-X','-q','-A','-t','-w'" },
        @{ Name='Every Database Studio query is explicitly READ ONLY'; Text=$module; Pattern='BEGIN READ ONLY; SET LOCAL statement_timeout' },
        @{ Name='Catalog queries have a statement timeout and lock timeout'; Text=$module; Pattern="statement_timeout = '5000ms'; SET LOCAL lock_timeout = '1000ms'" },
        @{ Name='Catalog query rejects statements that do not begin with SELECT'; Text=$module; Pattern=[regex]::Escape('$query -notmatch ''^(?is)SELECT\b''') },
        @{ Name='Catalog query rejects multiple SQL statements'; Text=$module; Pattern=[regex]::Escape('$query.Contains('';'')') },
        @{ Name='Catalog query denies data mutation and administrative keywords'; Text=$module; Pattern='INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE' },
        @{ Name='Dangerous side-effect functions are denied by the query guard'; Text=$module; Pattern='PG_TERMINATE_BACKEND|PG_CANCEL_BACKEND|PG_READ_FILE|PG_SLEEP|NEXTVAL|PG_ADVISORY_LOCK' },
        @{ Name='Table metadata is limited to public relations and a bounded result count'; Text=$module; Pattern="n\.nspname = 'public' AND c\.relkind IN \('r','p','m','v'\)[\s\S]*?LIMIT 500" },
        @{ Name='Views and partitioned parents do not report physical size; stored relations use size functions'; Text=$module; Pattern="CASE WHEN c\.relkind IN \('v','p'\) THEN NULL::bigint ELSE pg_relation_size\(c\.oid\)::bigint END AS table_size_bytes[\s\S]*?CASE WHEN c\.relkind IN \('v','p'\) THEN NULL::bigint ELSE pg_indexes_size\(c\.oid\)::bigint END AS index_size_bytes[\s\S]*?CASE WHEN c\.relkind IN \('v','p'\) THEN NULL::bigint ELSE pg_total_relation_size\(c\.oid\)::bigint END AS total_size_bytes" },
        @{ Name='Table catalog ordering uses guarded size metadata and places non-stored views last'; Text=$module; Pattern='q\.total_size_bytes DESC NULLS LAST[\s\S]*?ORDER BY total_size_bytes DESC NULLS LAST' },
        @{ Name='Table catalog never orders ordinary views by an unguarded relation size function'; Text=$module; Pattern='ORDER BY pg_total_relation_size\(c\.oid\)'; Negative=$true },
        @{ Name='Database Studio verifies PostgreSQL major version and Dar local port before showing results'; Text=$center; Pattern='overview\.server_port -ne 55432[\s\S]*?overview\.server_version -notmatch' },
        @{ Name='Database listing has a bounded result count'; Text=$module; Pattern='FROM pg_database d[\s\S]*?LIMIT 50' },
        @{ Name='Connection counts exclude the transient Database Studio query itself'; Text=$module; Pattern='pid <> pg_backend_pid\(\)' },
        @{ Name='Catalog schema and table names pass a strict allow-list before literal construction'; Text=$module; Pattern='function ConvertTo-DarDatabaseStudioCatalogLiteral[\s\S]*?\^\[a-z\]\[a-z0-9_\]\{0,62\}\$[\s\S]*?ConvertTo-DarDatabaseStudioCatalogLiteral \$SchemaName[\s\S]*?ConvertTo-DarDatabaseStudioCatalogLiteral \$TableName' },
        @{ Name='Column, constraint and index queries inject only validated quoted catalog literals'; Text=$module; Pattern='__SCHEMA_LITERAL__[\s\S]*?__TABLE_LITERAL__[\s\S]*?\$sql = \$sql\.Replace\(''__SCHEMA_LITERAL__'',\$schemaLiteral\)\.Replace\(''__TABLE_LITERAL__'',\$tableLiteral\)' },
        @{ Name='Column query validates schema and table names before SQL replacement'; Text=$module; Pattern='function Get-DarDatabaseStudioColumns[\s\S]*?ConvertTo-DarDatabaseStudioCatalogLiteral \$SchemaName[\s\S]*?ConvertTo-DarDatabaseStudioCatalogLiteral \$TableName[\s\S]*?__SCHEMA_LITERAL__[\s\S]*?__TABLE_LITERAL__' },
        @{ Name='Constraint query validates schema and table names before SQL replacement'; Text=$module; Pattern='function Get-DarDatabaseStudioConstraints[\s\S]*?ConvertTo-DarDatabaseStudioCatalogLiteral \$SchemaName[\s\S]*?ConvertTo-DarDatabaseStudioCatalogLiteral \$TableName[\s\S]*?__SCHEMA_LITERAL__[\s\S]*?__TABLE_LITERAL__' },
        @{ Name='Index query validates schema and table names before SQL replacement'; Text=$module; Pattern='function Get-DarDatabaseStudioIndexes[\s\S]*?ConvertTo-DarDatabaseStudioCatalogLiteral \$SchemaName[\s\S]*?ConvertTo-DarDatabaseStudioCatalogLiteral \$TableName[\s\S]*?__SCHEMA_LITERAL__[\s\S]*?__TABLE_LITERAL__' },
        @{ Name='Database Studio does not rely on psql variable interpolation in -c SQL'; Text=$module; Pattern='(?::''studio_schema''|:''studio_table''|-Variables)'; Negative=$true },
        @{ Name='Constraint definitions are read from catalog metadata'; Text=$module; Pattern='pg_get_constraintdef\(con\.oid, TRUE\)' },
        @{ Name='Index definitions and validity are read from catalog metadata'; Text=$module; Pattern='i\.indisvalid[\s\S]*?i\.indisready[\s\S]*?pg_get_indexdef\(i\.indexrelid\)' },
        @{ Name='Connection view hides SQL text and limits result count'; Text=$module; Pattern='pg_stat_activity a[\s\S]*?LIMIT 100'; Negative=$false },
        @{ Name='Connection view does not select the SQL query text'; Text=$module; Pattern='a\.query([,\s]|$)'; Negative=$true },
        @{ Name='Connection view masks client addresses'; Text=$module; Pattern="CASE WHEN a\.client_addr IS NULL THEN 'Local' ELSE 'Loopback/Local' END" },
        @{ Name='Database Studio module contains no data mutation SQL'; Text=$module; Pattern='(?im)^\s*(INSERT|UPDATE|DELETE|ALTER|VACUUM|REINDEX|CREATE|DROP|TRUNCATE|GRANT|REVOKE)\s'; Negative=$true },
        @{ Name='Database Studio never starts or stops services or migrations'; Text=$module; Pattern='Ensure-DarLocalPostgres|Start-DarPostgresServer|Stop-DarPostgresServer|initdb|pg_ctl|Start-Process'; Negative=$true },
        @{ Name='Database Studio does not serialize secret assignments or connection strings'; Text=$module; Pattern='PostgresAdminPassword\s*=|AppPassword\s*=|ConnectionString\s*=|ConvertTo-Json'; Negative=$true }
    )

    foreach ($check in $checks) {
        $matched = [regex]::IsMatch([string]$check.Text,[string]$check.Pattern,[System.Text.RegularExpressions.RegexOptions]::Singleline)
        if ($check.Negative) { $matched = -not $matched }
        if ($matched) { Write-Host ('PASS: ' + $check.Name) -ForegroundColor Green }
        else { Write-Host ('FAIL: ' + $check.Name) -ForegroundColor Red; $failed.Add([string]$check.Name) }
    }

    if ($failed.Count -gt 0) { Write-Output 'DAR_TEST_RESULT=FAIL'; exit 1 }
    Write-Host ('PASS: Database Studio source guard completed. Assertions=' + $checks.Count) -ForegroundColor Green
    Write-Output 'DAR_TEST_RESULT=PASS'; exit 0
} catch {
    Write-Host ('FAIL: Database Studio source checker error: ' + $_.Exception.Message) -ForegroundColor Red
    Write-Output 'DAR_TEST_RESULT=FAIL'; exit 1
}
