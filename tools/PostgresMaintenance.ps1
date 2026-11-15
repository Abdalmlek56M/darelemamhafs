# Read-only PostgreSQL maintenance monitor for Dar System Center.
# This module only reads PostgreSQL settings/statistics. It never runs VACUUM, ANALYZE, REINDEX or service commands.

function Get-DarPostgresMaintenanceOverview {
    [CmdletBinding()]
    param([Parameter(Mandatory=$true)]$Secrets)

    $sql = @'
SELECT json_build_object(
    'database_name', current_database(),
    'server_version', current_setting('server_version'),
    'server_port', current_setting('port')::integer,
    'transaction_read_only', current_setting('transaction_read_only'),
    'autovacuum_enabled', current_setting('autovacuum') = 'on',
    'track_counts_enabled', current_setting('track_counts') = 'on',
    'autovacuum_naptime', current_setting('autovacuum_naptime'),
    'autovacuum_max_workers', current_setting('autovacuum_max_workers')::integer,
    'vacuum_threshold', current_setting('autovacuum_vacuum_threshold')::integer,
    'vacuum_scale_factor', current_setting('autovacuum_vacuum_scale_factor')::numeric,
    'vacuum_insert_threshold', current_setting('autovacuum_vacuum_insert_threshold')::integer,
    'vacuum_insert_scale_factor', current_setting('autovacuum_vacuum_insert_scale_factor')::numeric,
    'analyze_threshold', current_setting('autovacuum_analyze_threshold')::integer,
    'analyze_scale_factor', current_setting('autovacuum_analyze_scale_factor')::numeric,
    'freeze_max_age', current_setting('autovacuum_freeze_max_age')::bigint,
    'active_autovacuum_workers', (
        SELECT count(*)::integer
        FROM pg_stat_activity
        WHERE backend_type = 'autovacuum worker'
          AND datname = current_database()
    ),
    'active_vacuum_operations', (
        SELECT count(*)::integer
        FROM pg_stat_progress_vacuum v
        JOIN pg_database db ON db.oid = v.datid
        WHERE db.datname = current_database()
    ),
    'oldest_database_name', (
        SELECT db.datname
        FROM pg_database db
        WHERE db.datallowconn
        ORDER BY age(db.datfrozenxid) DESC
        LIMIT 1
    ),
    'oldest_xid_age', (
        SELECT max(age(db.datfrozenxid))::bigint
        FROM pg_database db
        WHERE db.datallowconn
    ),
    'freeze_age_percent', (
        SELECT round(
            100.0 * max(age(db.datfrozenxid))::numeric /
            NULLIF(current_setting('autovacuum_freeze_max_age')::numeric, 0),
            2
        )
        FROM pg_database db
        WHERE db.datallowconn
    ),
    'num_backends', d.numbackends,
    'transactions_committed', d.xact_commit,
    'transactions_rolled_back', d.xact_rollback,
    'blocks_read', d.blks_read,
    'blocks_hit', d.blks_hit,
    'buffer_cache_hit_percent', CASE
        WHEN (d.blks_hit + d.blks_read) > 0
        THEN round(100.0 * d.blks_hit::numeric / (d.blks_hit + d.blks_read), 2)
        ELSE NULL
    END,
    'temporary_files', d.temp_files,
    'temporary_bytes', d.temp_bytes,
    'deadlocks', d.deadlocks,
    'statistics_reset_at', d.stats_reset
)::text
FROM pg_stat_database d
WHERE d.datname = current_database();
'@
    Invoke-DarDatabaseStudioCatalogQuery -Sql $sql -Secrets $Secrets
}

function Get-DarPostgresMaintenanceTableStats {
    [CmdletBinding()]
    param([Parameter(Mandatory=$true)]$Secrets)

    $sql = @'
SELECT COALESCE(json_agg(row_to_json(q) ORDER BY q.dead_tuple_percent DESC NULLS LAST, q.estimated_dead_tuples DESC, q.total_size_bytes DESC), '[]'::json)::text
FROM (
    SELECT s.schemaname AS schema_name,
           s.relname AS table_name,
           GREATEST(COALESCE(c.reltuples, 0), 0)::bigint AS estimated_rows,
           COALESCE(s.n_live_tup, 0)::bigint AS estimated_live_tuples,
           COALESCE(s.n_dead_tup, 0)::bigint AS estimated_dead_tuples,
           CASE
               WHEN (COALESCE(s.n_live_tup, 0) + COALESCE(s.n_dead_tup, 0)) > 0
               THEN round(100.0 * s.n_dead_tup::numeric / (s.n_live_tup + s.n_dead_tup), 2)
               ELSE 0::numeric
           END AS dead_tuple_percent,
           COALESCE(s.n_mod_since_analyze, 0)::bigint AS modified_since_analyze,
           s.last_vacuum,
           s.last_autovacuum,
           s.last_analyze,
           s.last_autoanalyze,
           s.vacuum_count,
           s.autovacuum_count,
           s.analyze_count,
           s.autoanalyze_count,
           COALESCE(c.reloptions, ARRAY[]::text[]) @> ARRAY['autovacuum_enabled=false']::text[] AS autovacuum_disabled_for_table,
           COALESCE(array_to_string(c.reloptions, ', '), '') AS table_storage_options,
           pg_total_relation_size(c.oid)::bigint AS total_size_bytes
    FROM pg_stat_user_tables s
    JOIN pg_class c ON c.oid = s.relid
    WHERE c.relkind IN ('r','m')
    ORDER BY s.n_dead_tup DESC, c.relname
    LIMIT 250
) q;
'@
    Invoke-DarDatabaseStudioCatalogQuery -Sql $sql -Secrets $Secrets
}

function Get-DarPostgresMaintenanceSettings {
    [CmdletBinding()]
    param([Parameter(Mandatory=$true)]$Secrets)

    $sql = @'
SELECT COALESCE(json_agg(row_to_json(q) ORDER BY q.name), '[]'::json)::text
FROM (
    SELECT name,
           setting,
           COALESCE(unit, '') AS unit,
           source,
           pending_restart
    FROM pg_settings
    WHERE name = ANY (ARRAY[
        'autovacuum',
        'track_counts',
        'autovacuum_naptime',
        'autovacuum_max_workers',
        'autovacuum_vacuum_threshold',
        'autovacuum_vacuum_scale_factor',
        'autovacuum_vacuum_insert_threshold',
        'autovacuum_vacuum_insert_scale_factor',
        'autovacuum_analyze_threshold',
        'autovacuum_analyze_scale_factor',
        'autovacuum_freeze_max_age',
        'autovacuum_multixact_freeze_max_age',
        'vacuum_cost_delay',
        'vacuum_cost_limit',
        'maintenance_work_mem',
        'log_autovacuum_min_duration'
    ]::text[])
    LIMIT 50
) q;
'@
    Invoke-DarDatabaseStudioCatalogQuery -Sql $sql -Secrets $Secrets
}

function Get-DarPostgresMaintenanceVacuumProgress {
    [CmdletBinding()]
    param([Parameter(Mandatory=$true)]$Secrets)

    $sql = @'
SELECT COALESCE(json_agg(row_to_json(q) ORDER BY q.schema_name, q.table_name), '[]'::json)::text
FROM (
    SELECT COALESCE(n.nspname, '') AS schema_name,
           COALESCE(c.relname, 'غير معروف') AS table_name,
           v.phase,
           v.heap_blks_total,
           v.heap_blks_scanned,
           v.heap_blks_vacuumed,
           CASE
               WHEN v.heap_blks_total > 0
               THEN round(100.0 * v.heap_blks_scanned::numeric / v.heap_blks_total, 2)
               ELSE 0::numeric
           END AS scan_progress_percent,
           v.index_vacuum_count,
           v.dead_tuple_bytes,
           v.max_dead_tuple_bytes,
           v.num_dead_item_ids,
           v.indexes_total,
           v.indexes_processed
    FROM pg_stat_progress_vacuum v
    JOIN pg_database db ON db.oid = v.datid
    LEFT JOIN pg_class c ON c.oid = v.relid
    LEFT JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE db.datname = current_database()
    ORDER BY n.nspname, c.relname
    LIMIT 50
) q;
'@
    Invoke-DarDatabaseStudioCatalogQuery -Sql $sql -Secrets $Secrets
}

function Get-DarPostgresMaintenanceReport {
    [CmdletBinding()]
    param([Parameter(Mandatory=$true)]$Secrets)

    $overviewResult = Get-DarPostgresMaintenanceOverview -Secrets $Secrets
    $tablesResult = Get-DarPostgresMaintenanceTableStats -Secrets $Secrets
    $settingsResult = Get-DarPostgresMaintenanceSettings -Secrets $Secrets
    $progressResult = Get-DarPostgresMaintenanceVacuumProgress -Secrets $Secrets

    foreach ($result in @($overviewResult,$tablesResult,$settingsResult,$progressResult)) {
        if ($result.ReadOnly -ne $true) { throw 'PostgreSQL maintenance diagnostics did not confirm a read-only result.' }
    }
    if (@($overviewResult.Rows).Count -ne 1) { throw 'PostgreSQL maintenance overview did not return exactly one row.' }

    [pscustomobject]@{
        ReadOnly = $true
        CollectedAt = [DateTimeOffset]::Now.ToString('o')
        Overview = $overviewResult.Rows[0]
        Tables = @($tablesResult.Rows)
        Settings = @($settingsResult.Rows)
        VacuumProgress = @($progressResult.Rows)
    }
}
