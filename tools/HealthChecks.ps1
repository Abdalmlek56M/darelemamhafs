# Read-only health checks for Dar System Center.
# This module never starts/stops services, executes migrations, or changes database rows.

function New-DarHealthResult {
    param(
        [string]$CheckId,
        [string]$Category,
        [string]$Name,
        [ValidateSet('Healthy','Warning','Critical','Unknown')][string]$Status,
        [string]$Summary,
        [string]$Details = '',
        [string]$Evidence = '',
        [string]$Recommendation = '',
        [bool]$AffectsOverall = $true
    )
    $severity = switch ($Status) { 'Critical' {'High'} 'Warning' {'Medium'} 'Unknown' {'Undetermined'} default {'None'} }
    $localRoot = [string]$env:LOCALAPPDATA
    if (-not [string]::IsNullOrWhiteSpace($localRoot)) {
        $Details = $Details.Replace($localRoot,'%LOCALAPPDATA%')
        $Evidence = $Evidence.Replace($localRoot,'%LOCALAPPDATA%')
        $Recommendation = $Recommendation.Replace($localRoot,'%LOCALAPPDATA%')
    }
    [pscustomobject][ordered]@{
        checkId = $CheckId
        category = $Category
        name = $Name
        status = $Status
        severity = $severity
        checkedAt = [DateTimeOffset]::Now.ToString('o')
        summary = $Summary
        details = $Details
        evidence = $Evidence
        recommendation = $Recommendation
        affectsOverall = $AffectsOverall
    }
}

function Invoke-DarHealthQuery {
    param([Parameter(Mandatory=$true)][string]$Sql, [Parameter(Mandatory=$true)]$Secrets)
    Assert-DarDatabaseSecrets -Secrets $Secrets
    if ([string]::IsNullOrWhiteSpace([string]$script:DarPgBin)) {
        throw 'The verified PostgreSQL runtime path is not initialized.'
    }
    # One explicit read-only transaction is used for every Health SQL query.
    $readOnlySql = 'BEGIN READ ONLY; ' + $Sql.Trim().TrimEnd(';') + '; COMMIT;'
    $result = Invoke-DarPgTool -Tool 'psql' -Arguments @(
        '-X','-q','-A','-t','-F','|',
        '-h','127.0.0.1','-p',[string]$Secrets.Port,'-U','postgres','-d',[string]$Secrets.Database,
        '-v','ON_ERROR_STOP=1','-c',$readOnlySql
    ) -Password ([string]$Secrets.PostgresAdminPassword) -ConnectTimeout 5
    $lines = @($result.Output | ForEach-Object { ([string]$_).Trim() } | Where-Object {
        -not [string]::IsNullOrWhiteSpace($_) -and $_ -notmatch '^(BEGIN|COMMIT|ROLLBACK)$'
    })
    return ,$lines
}

function Get-DarHealthDirectoryMetrics {
    param([Parameter(Mandatory=$true)][string]$Path, [ValidateRange(1,2000000)][int]$MaxFiles = 200000)
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        return [pscustomobject]@{ Exists=$false; Complete=$true; Bytes=[long]0; FileCount=[long]0; DirectoryCount=[long]0; ErrorCount=0; Limited=$false }
    }
    $rootInfo = [System.IO.DirectoryInfo]::new([IO.Path]::GetFullPath($Path))
    if (($rootInfo.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        return [pscustomobject]@{ Exists=$true; Complete=$false; Bytes=[long]0; FileCount=[long]0; DirectoryCount=[long]0; ErrorCount=1; Limited=$false }
    }
    $bytes = [long]0; $fileCount = [long]0; $directoryCount = [long]0; $errors = 0; $limited = $false
    $pending = New-Object 'System.Collections.Generic.Stack[string]'
    $pending.Push($rootInfo.FullName)
    while ($pending.Count -gt 0) {
        $current = $pending.Pop()
        try {
            foreach ($file in [IO.Directory]::EnumerateFiles($current, '*', [IO.SearchOption]::TopDirectoryOnly)) {
                try {
                    $info = [System.IO.FileInfo]::new([string]$file)
                    if (($info.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { continue }
                    $bytes += [long]$info.Length
                    $fileCount++
                    if ($fileCount -ge $MaxFiles) { $limited = $true; break }
                } catch { $errors++ }
            }
        } catch { $errors++ }
        if ($limited) { break }
        try {
            foreach ($directory in [IO.Directory]::EnumerateDirectories($current, '*', [IO.SearchOption]::TopDirectoryOnly)) {
                try {
                    $info = [System.IO.DirectoryInfo]::new([string]$directory)
                    if (($info.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { continue }
                    $pending.Push($info.FullName)
                    $directoryCount++
                } catch { $errors++ }
            }
        } catch { $errors++ }
    }
    [pscustomobject]@{
        Exists=$true; Complete=($errors -eq 0 -and -not $limited); Bytes=$bytes; FileCount=$fileCount
        DirectoryCount=$directoryCount; ErrorCount=$errors; Limited=$limited
    }
}

function ConvertTo-DarHealthDisplayPath([string]$Path, $Paths) {
    if ([string]::IsNullOrWhiteSpace($Path)) { return '' }
    $base = [IO.Path]::GetFullPath([string]$Paths.Base).TrimEnd([char[]]@([char]92,[char]47))
    $full = [IO.Path]::GetFullPath($Path).TrimEnd([char[]]@([char]92,[char]47))
    if ($full.StartsWith($base, [StringComparison]::OrdinalIgnoreCase)) {
        return '%LOCALAPPDATA%\DarEltahfeez' + $full.Substring($base.Length)
    }
    return $full
}

function Test-DarHealthApi {
    $listener = $false
    try { $listener = @((Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort 5080 -State Listen -ErrorAction SilentlyContinue)).Count -gt 0 } catch { }
    if (-not $listener) {
        return (New-DarHealthResult -CheckId 'API-001' -Category 'Runtime' -Name 'Dar API' -Status 'Unknown' -Summary 'API is offline; this is expected while the desktop application is closed.' -Details 'The health endpoint on 127.0.0.1:5080 did not have a listener. This advisory does not reduce the overall System Center health status.' -Evidence 'TCP 127.0.0.1:5080: closed' -Recommendation 'Open Dar Eltahfeez when API-dependent features are required.' -AffectsOverall $false)
    }
    try {
        $response = Invoke-RestMethod -Uri 'http://127.0.0.1:5080/health' -Method Get -TimeoutSec 3 -ErrorAction Stop
        if ($response.status -eq 'ok' -and $response.service -eq 'DarEltahfeez.Api' -and $response.database -eq 'connected') {
            return (New-DarHealthResult -CheckId 'API-001' -Category 'Runtime' -Name 'Dar API' -Status 'Healthy' -Summary 'Dar API and its database health endpoint are responding.' -Details 'The local API returned status=ok and database=connected.' -Evidence 'GET http://127.0.0.1:5080/health → HTTP 200')
        }
        return (New-DarHealthResult -CheckId 'API-001' -Category 'Runtime' -Name 'Dar API' -Status 'Warning' -Summary 'The API is reachable but reports a degraded or unexpected state.' -Details 'The endpoint responded, but its status fields do not match the healthy contract.' -Evidence ('HTTP response status=' + [string]$response.status + '; database=' + [string]$response.database) -Recommendation 'Inspect the API and PostgreSQL logs before restarting services.')
    } catch {
        return (New-DarHealthResult -CheckId 'API-001' -Category 'Runtime' -Name 'Dar API' -Status 'Critical' -Summary 'The API listener exists but the health endpoint failed.' -Details ([string]$_.Exception.Message) -Evidence 'TCP 127.0.0.1:5080: listening; HTTP health request failed' -Recommendation 'Review api-*.jsonl and launcher logs; do not terminate an unknown process.')
    }
}

function Get-DarSystemHealthReport {
    param([Parameter(Mandatory=$true)][string]$ProjectRoot, $Secrets)
    $reportStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $checks = New-Object 'System.Collections.Generic.List[object]'
    $paths = Get-DarLocalPaths
    $progress = {
        param([string]$Message)
        if (Get-Command 'Write-Step' -ErrorAction SilentlyContinue) { Write-Step $Message }
    }

    & $progress 'Health Check: checking local API...'
    $checks.Add((Test-DarHealthApi))

    & $progress 'Health Check: verifying PostgreSQL runtime and database identity...'
    $pgCtlPath = if (-not [string]::IsNullOrWhiteSpace([string]$script:DarPgBin)) { Join-Path $script:DarPgBin 'pg_ctl.exe' } else { $null }
    if (-not $Secrets -or -not (Test-Path -LiteralPath $paths.Data -PathType Container) -or -not (Test-Path -LiteralPath (Join-Path $paths.Data 'PG_VERSION') -PathType Leaf)) {
        $checks.Add((New-DarHealthResult -CheckId 'PG-001' -Category 'PostgreSQL' -Name 'Local PostgreSQL cluster' -Status 'Critical' -Summary 'The expected local PostgreSQL data cluster is not prepared.' -Evidence 'Expected cluster: %LOCALAPPDATA%\DarEltahfeez\Database\data' -Recommendation 'Do not initialize a new cluster automatically. Verify the existing data directory and local secrets.'))
    } elseif (-not $pgCtlPath -or -not (Test-Path -LiteralPath $pgCtlPath -PathType Leaf)) {
        $checks.Add((New-DarHealthResult -CheckId 'PG-001' -Category 'PostgreSQL' -Name 'Local PostgreSQL runtime' -Status 'Critical' -Summary 'The PostgreSQL control utility is unavailable.' -Evidence 'Expected pg_ctl.exe in the verified PostgreSQL runtime.' -Recommendation 'Inspect the runtime folder; do not download or initialize a database from Health Check.'))
    } else {
        $requiredPgTools = @('postgres.exe','pg_ctl.exe','psql.exe','pg_dump.exe','pg_restore.exe')
        $missingPgTools = @($requiredPgTools | Where-Object { -not (Test-Path -LiteralPath (Join-Path $script:DarPgBin $_) -PathType Leaf) })
        if ($missingPgTools.Count -gt 0) {
            $checks.Add((New-DarHealthResult -CheckId 'PG-001' -Category 'PostgreSQL' -Name 'Local PostgreSQL runtime' -Status 'Critical' -Summary 'One or more required PostgreSQL runtime tools are missing.' -Details ('Missing files: ' + ($missingPgTools -join ', ')) -Evidence 'The configured PostgreSQL 17 runtime folder was inspected.' -Recommendation 'Restore the official runtime files from a trusted package; do not initialize or replace the database cluster.'))
        } else {
        try {
            $identity = Test-DarExpectedPostgresIdentity -Secrets $Secrets -Paths $paths
            if (-not $identity) { throw 'The listener or PostgreSQL identity does not match the expected local cluster.' }
            $checks.Add((New-DarHealthResult -CheckId 'PG-001' -Category 'PostgreSQL' -Name 'Local PostgreSQL cluster' -Status 'Healthy' -Summary 'The expected PostgreSQL 17 cluster is running and identified.' -Evidence 'Loopback 127.0.0.1:55432; expected local data directory confirmed.' ))
        } catch {
            $checks.Add((New-DarHealthResult -CheckId 'PG-001' -Category 'PostgreSQL' -Name 'Local PostgreSQL cluster' -Status 'Critical' -Summary 'PostgreSQL is unavailable or its identity does not match Dar.' -Details ([string]$_.Exception.Message) -Evidence 'Expected PostgreSQL 17; 127.0.0.1:55432; configured local data directory.' -Recommendation 'Inspect postgresql.log and the process owner; never stop postgres.exe blindly.'))
        }
        }
    }

    $databaseReady = $false
    if ($Secrets -and -not [string]::IsNullOrWhiteSpace([string]$script:DarPgBin)) {
        try {
            $identityRows = Invoke-DarHealthQuery -Secrets $Secrets -Sql "SELECT current_database() || '|' || current_setting('port') || '|' || current_setting('data_directory') || '|' || current_setting('server_version_num');"
            if ($identityRows.Count -gt 0) {
                $parts = ([string]$identityRows[0]).Split('|')
                if ($parts.Count -ge 4) {
                    $expectedData = [IO.Path]::GetFullPath($paths.Data).TrimEnd([char[]]@([char]92,[char]47)).Replace('\','/')
                    $actualData = [IO.Path]::GetFullPath(([string]$parts[2]).Replace('/','\')).TrimEnd([char[]]@([char]92,[char]47)).Replace('\','/')
                    $matches = ($parts[0] -eq [string]$Secrets.Database) -and ([int]$parts[1] -eq 55432) -and $actualData.Equals($expectedData,[StringComparison]::OrdinalIgnoreCase) -and ([int]$parts[3] -ge 170000)
                    if (-not $matches) { throw 'Connected PostgreSQL database, port, data directory or major version does not match the Dar local configuration.' }
                    $databaseReady = $true
                    $identityEvidence = 'Database=' + [string]$parts[0] + '; port=55432; PostgreSQL major=17; data directory=%LOCALAPPDATA%\DarEltahfeez\Database\data'
                    $identityResult = New-DarHealthResult -CheckId 'PG-002' -Category 'PostgreSQL' -Name 'Database identity' -Status 'Healthy' -Summary 'The connected database, port, data directory and PostgreSQL major version match the local configuration.' -Evidence $identityEvidence
                    $checks.Add($identityResult)
                } else { throw 'PostgreSQL returned an incomplete identity response.' }
            } else { throw 'PostgreSQL returned no identity result.' }
        } catch {
            $checks.Add((New-DarHealthResult -CheckId 'PG-002' -Category 'PostgreSQL' -Name 'Database identity' -Status 'Critical' -Summary 'Could not confirm the identity of the connected database.' -Details ([string]$_.Exception.Message) -Recommendation 'Do not run migrations or restore until the database identity is confirmed.'))
        }
    } else {
        $checks.Add((New-DarHealthResult -CheckId 'PG-002' -Category 'PostgreSQL' -Name 'Database identity' -Status 'Unknown' -Summary 'Identity could not be queried because the local PostgreSQL runtime or secrets are unavailable.'))
    }

    if ($databaseReady) {
        & $progress 'Health Check: reading PostgreSQL schema health...'
        try {
            $schemaSql = @"
SELECT
 (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE')::text || '|' ||
 (SELECT COUNT(*) FROM pg_constraint WHERE contype='f')::text || '|' ||
 (SELECT COUNT(*) FROM pg_constraint WHERE contype IN ('f','c') AND NOT convalidated)::text || '|' ||
 (SELECT COUNT(*) FROM pg_index WHERE NOT indisvalid OR NOT indisready)::text || '|' ||
 COALESCE((SELECT string_agg(required.table_name, ',') FROM (VALUES
 ('app_users'),('students'),('teachers'),('circles'),('circle_enrollments'),('monthly_charges'),('payments'),('teacher_attendance'),('student_attendance'),('circle_schedule_slots')
 ) AS required(table_name) WHERE to_regclass('public.' || required.table_name) IS NULL),'') || '|' ||
 COALESCE((SELECT string_agg(required.index_name, ',') FROM (VALUES
 ('uq_circle_enrollments_active_student_circle'),('uq_trash_active_entity'),('uq_circle_schedule_slots_not_trashed_day_time'),('ux_student_attendance_active_slot_date_enrollment')
 ) AS required(index_name) WHERE NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='i' AND c.relname=required.index_name)),'')
"@
            $schemaRows = Invoke-DarHealthQuery -Secrets $Secrets -Sql $schemaSql
            if ($schemaRows.Count -eq 0) { throw 'Schema inspection returned no result row.' }
            $schemaParts = ([string]$schemaRows[0]).Split('|')
            if ($schemaParts.Count -lt 6) { throw 'Schema inspection returned an incomplete result.' }
            $tableCount = [int]$schemaParts[0]; $foreignKeyCount = [int]$schemaParts[1]; $unvalidated = [int]$schemaParts[2]; $invalidIndexes = [int]$schemaParts[3]; $missingTables = [string]$schemaParts[4]; $missingIndexes = [string]$schemaParts[5]
            $schemaStatus = if ($missingTables) { 'Critical' } elseif ($unvalidated -gt 0 -or $invalidIndexes -gt 0 -or $missingIndexes -or $tableCount -lt 10) { 'Warning' } else { 'Healthy' }
            $schemaSummary = if ($schemaStatus -eq 'Healthy') { 'Core schema objects and expected uniqueness guards are present; constraints and indexes are valid.' } else { 'Schema inspection found missing core objects, missing safety indexes or non-validated database objects.' }
            $checks.Add((New-DarHealthResult -CheckId 'DB-001' -Category 'Database' -Name 'Schema and indexes' -Status $schemaStatus -Summary $schemaSummary -Details ('Public tables=' + $tableCount + '; Foreign Keys=' + $foreignKeyCount + '; unvalidated FK/CHECK constraints=' + $unvalidated + '; invalid/not-ready indexes=' + $invalidIndexes + '; missing core tables=' + $(if ($missingTables) {$missingTables} else {'none'}) + '; missing expected safety indexes=' + $(if ($missingIndexes) {$missingIndexes} else {'none'})) -Evidence 'Read-only catalog inspection of information_schema, pg_constraint, pg_index and required partial unique indexes.' -Recommendation $(if ($schemaStatus -eq 'Healthy') {''} else {'Review the migration history and expected schema objects. Do not repair constraints or rebuild indexes automatically.'})))
        } catch {
            $checks.Add((New-DarHealthResult -CheckId 'DB-001' -Category 'Database' -Name 'Schema and indexes' -Status 'Unknown' -Summary 'Schema health could not be determined.' -Details ([string]$_.Exception.Message)))
        }

        & $progress 'Health Check: checking data consistency rules...'
        try {
            $integritySql = @"
SELECT 'duplicate_active_enrollments' || '|' || COUNT(*)::text FROM (
 SELECT student_id,circle_id FROM circle_enrollments WHERE is_trashed=FALSE AND status='active' GROUP BY student_id,circle_id HAVING COUNT(*)>1
) q
UNION ALL
SELECT 'duplicate_schedule_slots' || '|' || COUNT(*)::text FROM (
 SELECT circle_id,day_of_week,starts_at FROM circle_schedule_slots WHERE is_trashed=FALSE GROUP BY circle_id,day_of_week,starts_at HAVING COUNT(*)>1
) q
UNION ALL
SELECT 'duplicate_student_attendance' || '|' || COUNT(*)::text FROM (
 SELECT schedule_slot_id,session_date,enrollment_id FROM student_attendance WHERE is_trashed=FALSE GROUP BY schedule_slot_id,session_date,enrollment_id HAVING COUNT(*)>1
) q
UNION ALL
SELECT 'payments_exceed_charge' || '|' || COUNT(*)::text FROM (
 SELECT mc.id FROM monthly_charges mc LEFT JOIN payments p ON p.monthly_charge_id=mc.id AND p.is_trashed=FALSE
 WHERE mc.is_trashed=FALSE GROUP BY mc.id,mc.amount_due HAVING COALESCE(SUM(p.amount),0)>mc.amount_due
) q
UNION ALL
SELECT 'teacher_payable_mismatch' || '|' || COUNT(*)::text FROM teacher_attendance ta
WHERE ta.is_trashed=FALSE AND (
 (ta.status='present' AND ABS(ta.payable_amount-ROUND(ta.hourly_rate_snapshot*ta.duration_minutes/60.0,2))>0.005)
 OR (ta.status IN ('absent','cancelled') AND ta.payable_amount<>0)
)
UNION ALL
SELECT 'orphan_core_relationships' || '|' || COUNT(*)::text FROM (
 SELECT ce.id FROM circle_enrollments ce WHERE NOT EXISTS (SELECT 1 FROM students s WHERE s.id=ce.student_id)
 UNION ALL SELECT ce.id FROM circle_enrollments ce WHERE NOT EXISTS (SELECT 1 FROM circles c WHERE c.id=ce.circle_id)
 UNION ALL SELECT mc.id FROM monthly_charges mc WHERE NOT EXISTS (SELECT 1 FROM circle_enrollments ce WHERE ce.id=mc.enrollment_id)
 UNION ALL SELECT p.id FROM payments p WHERE NOT EXISTS (SELECT 1 FROM monthly_charges mc WHERE mc.id=p.monthly_charge_id)
 UNION ALL SELECT ss.id FROM circle_schedule_slots ss WHERE NOT EXISTS (SELECT 1 FROM circles c WHERE c.id=ss.circle_id)
 UNION ALL SELECT ta.id FROM teacher_attendance ta WHERE NOT EXISTS (SELECT 1 FROM circles c WHERE c.id=ta.circle_id)
 UNION ALL SELECT ta.id FROM teacher_attendance ta WHERE NOT EXISTS (SELECT 1 FROM teachers t WHERE t.id=ta.teacher_id)
 UNION ALL SELECT sa.id FROM student_attendance sa WHERE NOT EXISTS (SELECT 1 FROM circle_schedule_slots ss WHERE ss.id=sa.schedule_slot_id)
 UNION ALL SELECT sa.id FROM student_attendance sa WHERE NOT EXISTS (SELECT 1 FROM circle_enrollments ce WHERE ce.id=sa.enrollment_id)
) orphaned
"@
            $integrityRows = Invoke-DarHealthQuery -Secrets $Secrets -Sql $integritySql
            $metrics = @{}
            foreach ($line in $integrityRows) { $pair = ([string]$line).Split('|'); if ($pair.Count -eq 2) { $metrics[$pair[0]] = [int]$pair[1] } }
            $issues = @($metrics.GetEnumerator() | Where-Object { $_.Value -gt 0 })
            $integrityStatus = if ($issues.Count -eq 0) { 'Healthy' } else { 'Warning' }
            $issueText = if ($issues.Count -eq 0) { 'No known anomalies were found in the checked rules.' } else { (($issues | ForEach-Object { $_.Key + '=' + $_.Value }) -join '; ') }
            $checks.Add((New-DarHealthResult -CheckId 'DB-002' -Category 'Data Integrity' -Name 'Business data consistency' -Status $integrityStatus -Summary $(if ($integrityStatus -eq 'Healthy') {'Checked business rules are consistent.'} else {'Possible data inconsistencies require review; no data was changed.'}) -Details $issueText -Evidence 'Read-only aggregate checks; no student names, phone numbers or payment references are included.' -Recommendation $(if ($integrityStatus -eq 'Healthy') {''} else {'Review affected records in the application and audit history. Do not auto-correct historical financial or attendance data.'})))
        } catch {
            $checks.Add((New-DarHealthResult -CheckId 'DB-002' -Category 'Data Integrity' -Name 'Business data consistency' -Status 'Unknown' -Summary 'Business data consistency checks could not be completed.' -Details ([string]$_.Exception.Message)))
        }

        try {
            $sizeRows = Invoke-DarHealthQuery -Secrets $Secrets -Sql "SELECT pg_database_size(current_database())::bigint::text || '|' || COALESCE(pg_size_pretty(pg_database_size(current_database())),'') || '|' || COALESCE((SELECT setting FROM pg_settings WHERE name='autovacuum'),'unknown');"
            $p = ([string]$sizeRows[0]).Split('|')
            $checks.Add((New-DarHealthResult -CheckId 'DB-003' -Category 'Database' -Name 'Database size and Autovacuum' -Status $(if ($p.Count -ge 3 -and $p[2] -eq 'on') {'Healthy'} else {'Warning'}) -Summary 'Database size and Autovacuum setting were read.' -Evidence ('Size=' + $p[1] + '; Autovacuum=' + $p[2]) -Recommendation $(if ($p.Count -ge 3 -and $p[2] -eq 'on') {''} else {'Review the PostgreSQL Autovacuum configuration; do not disable or force maintenance automatically.'})))
        } catch {
            $checks.Add((New-DarHealthResult -CheckId 'DB-003' -Category 'Database' -Name 'Database size and Autovacuum' -Status 'Unknown' -Summary 'Database size and Autovacuum could not be read.' -Details ([string]$_.Exception.Message)))
        }
        try {
            $walRows = Invoke-DarHealthQuery -Secrets $Secrets -Sql "SELECT COALESCE(SUM(size),0)::bigint::text || '|' || COUNT(*)::text FROM pg_ls_waldir();"
            if ($walRows.Count -eq 0) { throw 'PostgreSQL returned no WAL directory statistics.' }
            $walParts = ([string]$walRows[0]).Split('|')
            $walBytes = [long]$walParts[0]; $walFiles = [int]$walParts[1]
            $walStatus = if ($walBytes -gt 10GB) {'Warning'} else {'Healthy'}
            $checks.Add((New-DarHealthResult -CheckId 'DB-004' -Category 'Database' -Name 'WAL storage' -Status $walStatus -Summary ('WAL currently uses {0:N2} MiB across {1} files.' -f ($walBytes/1MB),$walFiles) -Evidence 'pg_ls_waldir() read-only aggregate; WAL is already included in Database data folder size and is not added again to any total.' -Recommendation $(if ($walStatus -eq 'Healthy') {''} else {'Review replication/archive settings and PostgreSQL logs; do not delete WAL files manually.'})))
        } catch {
            $checks.Add((New-DarHealthResult -CheckId 'DB-004' -Category 'Database' -Name 'WAL storage' -Status 'Unknown' -Summary 'WAL size could not be determined through pg_ls_waldir().' -Details ([string]$_.Exception.Message) -Recommendation 'The database data-folder size remains available as the broader storage measure; do not delete WAL files manually.'))
        }
    } else {
        foreach ($item in @(
            @{Id='DB-001'; Category='Database'; Name='Schema and indexes'},
            @{Id='DB-002'; Category='Data Integrity'; Name='Business data consistency'},
            @{Id='DB-003'; Category='Database'; Name='Database size and Autovacuum'},
            @{Id='DB-004'; Category='Database'; Name='WAL storage'}
        )) { $checks.Add((New-DarHealthResult -CheckId $item.Id -Category $item.Category -Name $item.Name -Status 'Unknown' -Summary 'Skipped because the local database identity has not been confirmed.')) }
    }

    & $progress 'Health Check: measuring known local storage folders...'
    $storageTargets = @(
        @{Id='ST-001'; Name='PostgreSQL runtime'; Path=$paths.Runtime; Display='%LOCALAPPDATA%\DarEltahfeez\Runtime\PostgreSQL\17'},
        @{Id='ST-002'; Name='Database data and WAL'; Path=$paths.Data; Display='%LOCALAPPDATA%\DarEltahfeez\Database\data'},
        @{Id='ST-003'; Name='Backup folder'; Path=$paths.BackupFolder; Display=if ($paths.BackupFolderIsCustom) { 'Configured backup location' } else { '%LOCALAPPDATA%\DarEltahfeez\Backups' } },
        @{Id='ST-004'; Name='Log folder'; Path=$paths.Logs; Display='%LOCALAPPDATA%\DarEltahfeez\Logs'},
        @{Id='ST-005'; Name='Backup scheduler files'; Path=(Join-Path $paths.Base 'System\BackupScheduler'); Display='%LOCALAPPDATA%\DarEltahfeez\System\BackupScheduler'},
        @{Id='ST-006'; Name='WebView2 cache'; Path=(Join-Path $ProjectRoot 'desktop-host\bin\Debug\net10.0-windows\DarEltahfeez.Desktop.exe.WebView2'); Display='Project build output\DarEltahfeez.Desktop.exe.WebView2'},
        @{Id='ST-007'; Name='API build output'; Path=(Join-Path $ProjectRoot 'backend\DarEltahfeez.Api\bin\Debug\net10.0'); Display='Project build output\backend\DarEltahfeez.Api\bin\Debug\net10.0'},
        @{Id='ST-008'; Name='Desktop host build output'; Path=(Join-Path $ProjectRoot 'desktop-host\bin\Debug\net10.0-windows'); Display='Project build output\desktop-host\bin\Debug\net10.0-windows'},
        @{Id='ST-009'; Name='Frontend build output'; Path=(Join-Path $ProjectRoot 'frontend\dist'); Display='Project build output\frontend\dist'}
    )
    foreach ($target in $storageTargets) {
        try {
            $metrics = Get-DarHealthDirectoryMetrics -Path $target.Path
            if (-not $metrics.Exists) {
                $status = if ($target.Id -in @('ST-003','ST-005','ST-006','ST-007','ST-008','ST-009')) {'Unknown'} else {'Warning'}
                $summary = 'Known storage folder has not been created yet.'
            } else {
                $status = if ($metrics.Complete) {'Healthy'} else {'Warning'}
                $summary = ('{0:N2} MiB across {1:N0} files.' -f ($metrics.Bytes/1MB),$metrics.FileCount)
            }
            $details = if ($metrics.Exists) { 'Subdirectories=' + $metrics.DirectoryCount + '; inaccessible entries=' + $metrics.ErrorCount + '; scan limit reached=' + $metrics.Limited } else { $target.Display }
            $checks.Add((New-DarHealthResult -CheckId $target.Id -Category 'Storage' -Name $target.Name -Status $status -Summary $summary -Details $details -Evidence $target.Display -Recommendation $(if ($metrics.Exists -and -not $metrics.Complete) {'Some entries could not be measured. Review folder permissions; no files were changed.'} else {''}) -AffectsOverall ([bool]($metrics.Exists -or $target.Id -notin @('ST-003','ST-005','ST-006','ST-007','ST-008','ST-009')))))
        } catch {
            $checks.Add((New-DarHealthResult -CheckId $target.Id -Category 'Storage' -Name $target.Name -Status 'Unknown' -Summary 'Storage size could not be measured.' -Details ([string]$_.Exception.Message) -Evidence $target.Display))
        }
    }
    try {
        $driveRoot = [IO.Path]::GetPathRoot([IO.Path]::GetFullPath($paths.Base))
        $drive = [System.IO.DriveInfo]::new([string]$driveRoot)
        if ($drive.IsReady) {
            $free = [long]$drive.AvailableFreeSpace
            $status = if ($free -lt 5GB) {'Critical'} elseif ($free -lt 15GB) {'Warning'} else {'Healthy'}
            $checks.Add((New-DarHealthResult -CheckId 'ST-010' -Category 'Storage' -Name 'Free disk space' -Status $status -Summary ('{0:N2} GiB free on the volume containing LocalAppData.' -f ($free/1GB)) -Evidence ('Drive=' + $driveRoot + '; freeBytes=' + $free) -Recommendation $(if ($status -eq 'Critical' -or $status -eq 'Warning') {'Free disk space before taking backups or updating the application.'} else {''})))
        } else { throw 'The LocalAppData volume is not ready.' }
    } catch {
        $checks.Add((New-DarHealthResult -CheckId 'ST-010' -Category 'Storage' -Name 'Free disk space' -Status 'Unknown' -Summary 'Free disk space could not be determined.' -Details ([string]$_.Exception.Message)))
    }

    & $progress 'Health Check: validating backup scheduler and latest backup...'
    $schedule = $null
    try {
        $schedule = Get-DarBackupScheduleState
        if ($schedule.Enabled -and $schedule.Registered -and $schedule.NextRunTime) {
            $checks.Add((New-DarHealthResult -CheckId 'BK-001' -Category 'Backup' -Name 'Automatic backup schedule' -Status 'Healthy' -Summary ('Daily backup is enabled; next run ' + ([DateTime]$schedule.NextRunTime).ToString('yyyy-MM-dd HH:mm')) -Evidence ('Task registered=' + [bool]$schedule.Registered + '; task state=' + [string]$schedule.TaskState + '; enabled=' + [bool]$schedule.Enabled)))
        } elseif (-not $schedule.Enabled) {
            $checks.Add((New-DarHealthResult -CheckId 'BK-001' -Category 'Backup' -Name 'Automatic backup schedule' -Status 'Warning' -Summary 'Automatic backups are currently disabled or not registered.' -Evidence ('Task registered=' + [bool]$schedule.Registered + '; task state=' + [string]$schedule.TaskState) -Recommendation 'Enable and verify a daily schedule from the Backup Schedule tab if automatic protection is required.'))
        } else {
            $checks.Add((New-DarHealthResult -CheckId 'BK-001' -Category 'Backup' -Name 'Automatic backup schedule' -Status 'Warning' -Summary 'Backup schedule exists but no next run time is available.' -Evidence ('Task registered=' + [bool]$schedule.Registered + '; task state=' + [string]$schedule.TaskState) -Recommendation 'Refresh or re-save the backup schedule from System Center.'))
        }
    } catch {
        $checks.Add((New-DarHealthResult -CheckId 'BK-001' -Category 'Backup' -Name 'Automatic backup schedule' -Status 'Unknown' -Summary 'Task Scheduler status could not be read.' -Details ([string]$_.Exception.Message)))
    }

    $allBackupFiles = @()
    try { $allBackupFiles = @(Get-ChildItem -LiteralPath $paths.BackupFolder -Filter '*.backup' -File -ErrorAction SilentlyContinue) } catch { $allBackupFiles = @() }
    foreach ($backupKind in @(
        @{ Id='BK-002'; Name='Latest automatic backup'; Automatic=$true },
        @{ Id='BK-003'; Name='Latest manual backup'; Automatic=$false }
    )) {
        try {
            if ($backupKind.Automatic) {
                $candidates = @($allBackupFiles | Where-Object { $_.Name -like 'DarEltahfeez_AUTO_*.backup' } | Sort-Object LastWriteTimeUtc -Descending)
            } else {
                $candidates = @($allBackupFiles | Where-Object { $_.Name -notlike 'DarEltahfeez_AUTO_*.backup' } | Sort-Object LastWriteTimeUtc -Descending)
            }
            if ($candidates.Count -eq 0) {
                if ($backupKind.Automatic -and $schedule -and $schedule.Enabled) {
                    $checks.Add((New-DarHealthResult -CheckId $backupKind.Id -Category 'Backup' -Name $backupKind.Name -Status 'Warning' -Summary 'Automatic backup schedule is enabled but no automatic archive was found.' -Evidence '%LOCALAPPDATA%\DarEltahfeez\Backups' -Recommendation 'Run a manual backup now and inspect backup-scheduler.jsonl.'))
                } else {
                    $checks.Add((New-DarHealthResult -CheckId $backupKind.Id -Category 'Backup' -Name $backupKind.Name -Status 'Unknown' -Summary 'No archive of this type was found in the configured backup folder.' -Evidence '%LOCALAPPDATA%\DarEltahfeez\Backups' -AffectsOverall $false))
                }
                continue
            }
            $latest = $candidates[0]
            $hash = (Get-FileHash -LiteralPath $latest.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
            $archiveValid = $false
            try { Test-DarBackupArchive -BackupPath $latest.FullName | Out-Null; $archiveValid = $true } catch { }
            $manifest = $null; $manifestValid = $false; $hashMatches = $false
            if ($backupKind.Automatic) {
                $manifestPath = $latest.FullName + '.json'
                if (Test-Path -LiteralPath $manifestPath -PathType Leaf) {
                    try { $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json } catch { }
                }
                if ($manifest) {
                    $manifestValid = ($manifest.Status -eq 'completed' -and $manifest.FileName -eq $latest.Name -and [long]$manifest.FileSizeBytes -eq [long]$latest.Length -and $manifest.ArchiveFormat -eq 'PostgreSQL Custom' -and $manifest.Validation -eq 'pg_restore --list passed' -and [string]$manifest.Sha256 -match '^[a-fA-F0-9]{64}$')
                    $hashMatches = $manifestValid -and [string]::Equals($hash,[string]$manifest.Sha256,[StringComparison]::OrdinalIgnoreCase)
                }
            }
            $ageHours = (New-TimeSpan -Start $latest.LastWriteTime -End (Get-Date)).TotalHours
            if (-not $archiveValid) { $backupStatus = 'Critical' }
            elseif ($backupKind.Automatic -and (-not $manifestValid -or -not $hashMatches)) { $backupStatus = 'Warning' }
            elseif ($backupKind.Automatic -and $schedule -and $schedule.Enabled -and $ageHours -gt 30) { $backupStatus = 'Warning' }
            else { $backupStatus = 'Healthy' }
            $summary = if ($backupStatus -eq 'Healthy') { 'The latest archive passed PostgreSQL archive validation and its metadata checks.' } elseif ($backupStatus -eq 'Critical') { 'The latest archive failed PostgreSQL custom-archive validation.' } elseif ($backupKind.Automatic -and (-not $manifestValid -or -not $hashMatches)) { 'The archive is readable, but its manifest, file size or SHA-256 metadata is missing or mismatched.' } else { 'The latest automatic backup is older than the expected daily schedule window.' }
            $evidence = 'File=' + $latest.Name + '; sizeBytes=' + [long]$latest.Length + '; ageHours=' + [Math]::Round($ageHours,1) + '; SHA-256=' + $hash + '; archiveValid=' + $archiveValid
            if ($backupKind.Automatic) { $evidence += '; manifestValid=' + $manifestValid + '; hashMatches=' + $hashMatches }
            $recommendation = if ($backupStatus -eq 'Healthy') { '' } elseif ($backupStatus -eq 'Critical') { 'Create a fresh verified backup. Keep this archive until it has been investigated.' } elseif ($backupKind.Automatic) { 'Create a fresh automatic backup and inspect its manifest and scheduler log. Do not delete this archive automatically.' } else { 'Review this archive manually; no files were changed.' }
            $checks.Add((New-DarHealthResult -CheckId $backupKind.Id -Category 'Backup' -Name $backupKind.Name -Status $backupStatus -Summary ($summary + (' Size={0:N2} MiB; age={1:N1} hours.' -f ($latest.Length/1MB),$ageHours)) -Evidence $evidence -Recommendation $recommendation))
        } catch {
            $checks.Add((New-DarHealthResult -CheckId $backupKind.Id -Category 'Backup' -Name $backupKind.Name -Status 'Unknown' -Summary 'Backup validation could not be completed.' -Details ([string]$_.Exception.Message)))
        }
    }

    $statuses = @($checks | ForEach-Object { $_.status })
    $blockingStatuses = @($checks | Where-Object { $_.affectsOverall -ne $false } | ForEach-Object { $_.status })
    $overall = if ($blockingStatuses -contains 'Critical') {'Critical'} elseif ($blockingStatuses -contains 'Warning') {'Warning'} elseif ($blockingStatuses -contains 'Unknown') {'Unknown'} else {'Healthy'}
    $reportStopwatch.Stop()
    [pscustomobject][ordered]@{
        product = 'Dar Eltahfeez'
        reportType = 'ReadOnlySystemHealth'
        reportVersion = '1.0'
        applicationVersion = '0.8.25.0'
        generatedAt = [DateTimeOffset]::Now.ToString('o')
        reportDurationMs = $reportStopwatch.ElapsedMilliseconds
        overallStatus = $overall
        checkCount = $checks.Count
        counts = [ordered]@{
            healthy = @($checks | Where-Object status -eq 'Healthy').Count
            warning = @($checks | Where-Object status -eq 'Warning').Count
            critical = @($checks | Where-Object status -eq 'Critical').Count
            unknown = @($checks | Where-Object status -eq 'Unknown').Count
        }
        readOnly = $true
        checks = @($checks.ToArray())
    }
}
