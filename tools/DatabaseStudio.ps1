# Read-only PostgreSQL catalog explorer for Dar System Center.
# No user-authored SQL is accepted or executed by this module.

function Invoke-DarDatabaseStudioCatalogQuery {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)][string]$Sql,
        [Parameter(Mandatory=$true)]$Secrets
    )

    Assert-DarDatabaseSecrets -Secrets $Secrets
    if ([int]$Secrets.Port -ne 55432) { throw 'Database Studio only supports the validated Dar PostgreSQL port.' }
    if ([string]::IsNullOrWhiteSpace([string]$script:DarPgBin)) { throw 'The verified PostgreSQL runtime path is not initialized.' }
    if ([string]::IsNullOrWhiteSpace([string]$Secrets.Database) -or [string]$Secrets.Database -notmatch '^[a-z][a-z0-9_]{0,62}$') {
        throw 'The configured Dar database name is invalid.'
    }

    $query = $Sql.Trim()
    if ($query.EndsWith(';')) { $query = $query.Substring(0,$query.Length - 1).TrimEnd() }
    if ([string]::IsNullOrWhiteSpace($query) -or $query -notmatch '^(?is)SELECT\b') {
        throw 'Database Studio accepts only predefined SELECT catalog queries.'
    }
    if ($query.Contains(';') -or $query -match '(?i)\b(INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|COPY|CALL|DO|VACUUM|ANALYZE|REINDEX|REFRESH|SET|RESET|DISCARD|LOAD|SECURITY\s+LABEL|PG_TERMINATE_BACKEND|PG_CANCEL_BACKEND|PG_RELOAD_CONF|PG_ROTATE_LOGFILE|PG_SWITCH_WAL|PG_CREATE_RESTORE_POINT|PG_READ_FILE|PG_READ_BINARY_FILE|PG_LS_DIR|PG_SLEEP|PG_ADVISORY_LOCK|NEXTVAL|SETVAL|PG_NOTIFY|PG_STAT_RESET|LO_IMPORT|LO_EXPORT|DBLINK)\b') {
        throw 'The requested catalog statement is outside the read-only query policy.'
    }

    $psqlArguments = @(
        '-X','-q','-A','-t','-w',
        '-v','ON_ERROR_STOP=1',
        '-h','127.0.0.1','-p',[string]$Secrets.Port,
        '-U','postgres','-d',[string]$Secrets.Database
    )

    # Each call is a separate bounded, explicit read-only transaction.
    $readOnlySql = "BEGIN READ ONLY; SET LOCAL statement_timeout = '5000ms'; SET LOCAL lock_timeout = '1000ms'; $query; COMMIT;"
    $result = Invoke-DarPgTool -Tool 'psql' -Arguments ($psqlArguments + @('-c',$readOnlySql)) -Password ([string]$Secrets.PostgresAdminPassword) -ConnectTimeout 5
    $raw = (($result.Output | ForEach-Object { [string]$_ }) -join [Environment]::NewLine).Trim()
    if ([string]::IsNullOrWhiteSpace($raw)) { throw 'PostgreSQL returned an empty catalog response.' }

    try { $parsed = ConvertFrom-Json -InputObject $raw -ErrorAction Stop }
    catch { throw 'PostgreSQL returned an invalid JSON catalog response.' }

    [pscustomobject]@{
        Rows = @($parsed)
        SqlText = $query
        ReadOnly = $true
        CollectedAt = [DateTimeOffset]::Now.ToString('o')
    }
}

function Get-DarDatabaseStudioOverview {
    param([Parameter(Mandatory=$true)]$Secrets)
    $sql = @'
SELECT json_build_object(
    'database_name', current_database(),
    'database_user', current_user,
    'server_version', current_setting('server_version'),
    'server_version_num', current_setting('server_version_num')::integer,
    'server_port', current_setting('port')::integer,
    'server_started_at', pg_postmaster_start_time(),
    'database_size_bytes', pg_database_size(current_database()),
    'database_size_pretty', pg_size_pretty(pg_database_size(current_database())),
    'max_connections', current_setting('max_connections')::integer,
    'connection_count', (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND backend_type = 'client backend' AND pid <> pg_backend_pid()),
    'active_query_count', (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND backend_type = 'client backend' AND state = 'active' AND pid <> pg_backend_pid()),
    'transaction_read_only', current_setting('transaction_read_only')
)::text;
'@
    Invoke-DarDatabaseStudioCatalogQuery -Sql $sql -Secrets $Secrets
}

function Get-DarDatabaseStudioDatabases {
    param([Parameter(Mandatory=$true)]$Secrets)
    $sql = @'
SELECT COALESCE(json_agg(row_to_json(q) ORDER BY q.size_bytes DESC), '[]'::json)::text
FROM (
    SELECT d.datname AS database_name,
           pg_get_userbyid(d.datdba) AS owner_name,
           pg_encoding_to_char(d.encoding) AS encoding,
           pg_database_size(d.datname)::bigint AS size_bytes,
           pg_size_pretty(pg_database_size(d.datname)) AS size_pretty,
           d.datallowconn AS allows_connections,
           (SELECT count(*) FROM pg_stat_activity a WHERE a.datid = d.oid AND a.pid <> pg_backend_pid()) AS connection_count
    FROM pg_database d
    WHERE d.datallowconn = TRUE AND d.datistemplate = FALSE
    ORDER BY d.datname
    LIMIT 50
) q;
'@
    Invoke-DarDatabaseStudioCatalogQuery -Sql $sql -Secrets $Secrets
}

function Get-DarDatabaseStudioTables {
    param([Parameter(Mandatory=$true)]$Secrets)
    $sql = @'
SELECT COALESCE(json_agg(row_to_json(q) ORDER BY q.total_size_bytes DESC NULLS LAST, q.schema_name, q.table_name), '[]'::json)::text
FROM (
    SELECT n.nspname AS schema_name,
           c.relname AS table_name,
           CASE c.relkind WHEN 'r' THEN 'Table' WHEN 'p' THEN 'Partitioned table' WHEN 'm' THEN 'Materialized view' WHEN 'v' THEN 'View' END AS object_type,
           GREATEST(c.reltuples, 0)::bigint AS estimated_rows,
           CASE WHEN c.relkind IN ('v','p') THEN NULL::bigint ELSE pg_relation_size(c.oid)::bigint END AS table_size_bytes,
           CASE WHEN c.relkind IN ('v','p') THEN NULL::bigint ELSE pg_indexes_size(c.oid)::bigint END AS index_size_bytes,
           CASE WHEN c.relkind IN ('v','p') THEN NULL::bigint ELSE pg_total_relation_size(c.oid)::bigint END AS total_size_bytes,
           CASE WHEN c.relkind IN ('v','p') THEN NULL::text ELSE pg_size_pretty(pg_total_relation_size(c.oid)) END AS total_size_pretty,
           COALESCE(s.n_live_tup, 0)::bigint AS estimated_live_rows,
           COALESCE(s.n_dead_tup, 0)::bigint AS estimated_dead_rows
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
    WHERE n.nspname = 'public' AND c.relkind IN ('r','p','m','v')
    ORDER BY total_size_bytes DESC NULLS LAST, c.relname
    LIMIT 500
) q;
'@
    Invoke-DarDatabaseStudioCatalogQuery -Sql $sql -Secrets $Secrets
}

function ConvertTo-DarDatabaseStudioCatalogLiteral([string]$Value) {
    # The explorer currently exposes Dar's public schema and lowercase snake_case object names only.
    # This narrow allow-list is safe for SQL text sent through psql -c (which does not interpolate psql variables).
    if ([string]::IsNullOrWhiteSpace($Value) -or $Value.Length -gt 63 -or $Value -notmatch '^[a-z][a-z0-9_]{0,62}$') {
        throw 'اسم مخطط أو جدول قاعدة البيانات غير مدعوم في مستعرض الكتالوج.'
    }
    return ("'" + $Value.Replace("'", "''") + "'")
}

function Get-DarDatabaseStudioColumns {
    param([Parameter(Mandatory=$true)]$Secrets,[string]$SchemaName='public',[Parameter(Mandatory=$true)][string]$TableName)
    $schemaLiteral = ConvertTo-DarDatabaseStudioCatalogLiteral $SchemaName
    $tableLiteral = ConvertTo-DarDatabaseStudioCatalogLiteral $TableName
    $sql = @'
SELECT COALESCE(json_agg(row_to_json(q) ORDER BY q.ordinal_position), '[]'::json)::text
FROM (
    SELECT ordinal_position,
           column_name,
           data_type,
           udt_name,
           is_nullable,
           character_maximum_length,
           numeric_precision,
           numeric_scale
    FROM information_schema.columns
    WHERE table_schema = __SCHEMA_LITERAL__ AND table_name = __TABLE_LITERAL__
    ORDER BY ordinal_position
    LIMIT 500
) q;
'@
    $sql = $sql.Replace('__SCHEMA_LITERAL__',$schemaLiteral).Replace('__TABLE_LITERAL__',$tableLiteral)
    Invoke-DarDatabaseStudioCatalogQuery -Sql $sql -Secrets $Secrets
}

function Get-DarDatabaseStudioConstraints {
    param([Parameter(Mandatory=$true)]$Secrets,[string]$SchemaName='public',[Parameter(Mandatory=$true)][string]$TableName)
    $schemaLiteral = ConvertTo-DarDatabaseStudioCatalogLiteral $SchemaName
    $tableLiteral = ConvertTo-DarDatabaseStudioCatalogLiteral $TableName
    $sql = @'
SELECT COALESCE(json_agg(row_to_json(q) ORDER BY q.constraint_type, q.constraint_name), '[]'::json)::text
FROM (
    SELECT con.conname AS constraint_name,
           CASE con.contype WHEN 'p' THEN 'PRIMARY KEY' WHEN 'f' THEN 'FOREIGN KEY' WHEN 'u' THEN 'UNIQUE' WHEN 'c' THEN 'CHECK' WHEN 'x' THEN 'EXCLUSION' ELSE con.contype::text END AS constraint_type,
           pg_get_constraintdef(con.oid, TRUE) AS definition,
           con.convalidated AS is_validated,
           con.condeferrable AS is_deferrable,
           CASE WHEN con.confrelid <> 0 THEN con.confrelid::regclass::text ELSE NULL END AS referenced_relation
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = __SCHEMA_LITERAL__ AND c.relname = __TABLE_LITERAL__
    ORDER BY con.contype, con.conname
    LIMIT 250
) q;
'@
    $sql = $sql.Replace('__SCHEMA_LITERAL__',$schemaLiteral).Replace('__TABLE_LITERAL__',$tableLiteral)
    Invoke-DarDatabaseStudioCatalogQuery -Sql $sql -Secrets $Secrets
}

function Get-DarDatabaseStudioIndexes {
    param([Parameter(Mandatory=$true)]$Secrets,[string]$SchemaName='public',[Parameter(Mandatory=$true)][string]$TableName)
    $schemaLiteral = ConvertTo-DarDatabaseStudioCatalogLiteral $SchemaName
    $tableLiteral = ConvertTo-DarDatabaseStudioCatalogLiteral $TableName
    $sql = @'
SELECT COALESCE(json_agg(row_to_json(q) ORDER BY q.index_name), '[]'::json)::text
FROM (
    SELECT idx.relname AS index_name,
           i.indisprimary AS is_primary,
           i.indisunique AS is_unique,
           i.indisvalid AS is_valid,
           i.indisready AS is_ready,
           pg_relation_size(idx.oid)::bigint AS size_bytes,
           pg_size_pretty(pg_relation_size(idx.oid)) AS size_pretty,
           pg_get_indexdef(i.indexrelid) AS definition
    FROM pg_index i
    JOIN pg_class tbl ON tbl.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = tbl.relnamespace
    JOIN pg_class idx ON idx.oid = i.indexrelid
    WHERE n.nspname = __SCHEMA_LITERAL__ AND tbl.relname = __TABLE_LITERAL__
    ORDER BY idx.relname
    LIMIT 250
) q;
'@
    $sql = $sql.Replace('__SCHEMA_LITERAL__',$schemaLiteral).Replace('__TABLE_LITERAL__',$tableLiteral)
    Invoke-DarDatabaseStudioCatalogQuery -Sql $sql -Secrets $Secrets
}

function Get-DarDatabaseStudioConnections {
    param([Parameter(Mandatory=$true)]$Secrets)
    $sql = @'
SELECT COALESCE(json_agg(row_to_json(q) ORDER BY q.is_active DESC, q.elapsed_ms DESC NULLS LAST), '[]'::json)::text
FROM (
    SELECT a.pid,
           COALESCE(a.datname, '') AS database_name,
           COALESCE(a.usename, '') AS user_name,
           COALESCE(NULLIF(a.application_name, ''), 'Unknown') AS application_name,
           CASE WHEN a.client_addr IS NULL THEN 'Local' ELSE 'Loopback/Local' END AS client_location,
           COALESCE(a.state, 'Unknown') AS state,
           COALESCE(a.wait_event_type, '') AS wait_event_type,
           COALESCE(a.wait_event, '') AS wait_event,
           a.backend_start,
           a.query_start,
           CASE WHEN a.state = 'active' AND a.query_start IS NOT NULL THEN GREATEST(0, (EXTRACT(EPOCH FROM (clock_timestamp() - a.query_start)) * 1000)::bigint) ELSE NULL END AS elapsed_ms,
           (a.state = 'active') AS is_active
    FROM pg_stat_activity a
    WHERE a.backend_type = 'client backend' AND a.datname = current_database() AND a.pid <> pg_backend_pid()
    ORDER BY (a.state = 'active') DESC, a.query_start NULLS LAST
    LIMIT 100
) q;
'@
    Invoke-DarDatabaseStudioCatalogQuery -Sql $sql -Secrets $Secrets
}

function Get-DarDatabaseStudioViewQueryLabel([string]$ViewName) {
    switch ($ViewName) {
        'Databases' { return 'قواعد البيانات المحلية' }
        'Tables' { return 'الجداول والأحجام التقديرية' }
        'Columns' { return 'أعمدة الجدول المحدد' }
        'Constraints' { return 'العلاقات والقيود' }
        'Indexes' { return 'الفهارس' }
        'Connections' { return 'الاتصالات النشطة (دون نص SQL)' }
        default { return 'غير محدد' }
    }
}
