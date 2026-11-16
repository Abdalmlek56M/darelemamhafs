$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$localPostgresPath = Join-Path $projectRoot 'tools\LocalPostgres.ps1'
if (-not (Test-Path -LiteralPath $localPostgresPath -PathType Leaf)) { throw 'LocalPostgres.ps1 is missing.' }
. $localPostgresPath

# LocalPostgres.ps1 emits progress through this host callback when starting the engine.
function Write-Step([string]$Message) { Write-Host ('[PostgreSQL] ' + $Message) -ForegroundColor Cyan }

function Invoke-TestSql([string]$DatabaseName,[string]$Sql) {
    Invoke-DarPgTool -Tool 'psql' -Arguments @('-h','127.0.0.1','-p',[string]$script:testSecrets.Port,'-U',$script:testSecrets.AppUser,'-d',$DatabaseName,'-At','-v','ON_ERROR_STOP=1','-c',$Sql) -Password $script:testSecrets.AppPassword
}
function New-TestDatabase([string]$Name) {
    if ($Name -notmatch '^dar_(restore_test|swap_test)_[a-f0-9]{16}$') { throw "Test database name did not match the safety allow-list: $Name" }
    if (Test-DarDatabaseExists -Secrets $script:testSecrets -DatabaseName $Name) { throw "Unexpected test database collision: $Name" }
    New-DarDatabase -DatabaseName $Name -Secrets $script:testSecrets
}
function Remove-TestDatabase([string]$Name) {
    if ([string]::IsNullOrWhiteSpace($Name) -or $Name -notmatch '^dar_(restore_test|swap_test)_[a-f0-9]{16}$') { throw "Refusing to drop a database outside the test-name allow-list: $Name" }
    if (Test-DarDatabaseExists -Secrets $script:testSecrets -DatabaseName $Name) {
        # DROP DATABASE ... WITH (FORCE) is sent as a standalone command because
        # DROP DATABASE cannot run inside a transaction block.
        Invoke-DarPgTool -Tool 'psql' -Arguments @('-h','127.0.0.1','-p',[string]$script:testSecrets.Port,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c',"DROP DATABASE IF EXISTS $Name WITH (FORCE);") -Password $script:testSecrets.PostgresAdminPassword | Out-Null
    }
    if (Test-DarDatabaseExists -Secrets $script:testSecrets -DatabaseName $Name) { throw "Temporary test database remains after cleanup: $Name" }
}
function Get-DatabaseSignature($Report) {
    $tableLines = foreach ($key in ($Report.TableCounts.Keys | Sort-Object)) { "table:${key}:$($Report.TableCounts[$key])" }
    $migrationLines = foreach ($version in @($Report.AppliedMigrations)) { "migration:$version" }
    $triggerLines = foreach ($name in @($Report.RequiredTriggers | Sort-Object)) { "trigger:$name" }
    $indexLines = foreach ($name in @($Report.RequiredIndexes | Sort-Object)) { "index:$name" }
    $functionLines = foreach ($name in @($Report.RequiredFunctions | Sort-Object)) { "function:$name" }
    $requiredTableLines = foreach ($name in @($Report.RequiredTables | Sort-Object)) { "required-table:$name" }
    $requiredColumnLines = foreach ($name in @($Report.RequiredColumns | Sort-Object)) { "required-column:$name" }
    $requiredForeignKeyLines = foreach ($name in @($Report.RequiredForeignKeys | Sort-Object)) { "required-fk:$name" }
    $requiredForeignKeySpecLines = foreach ($item in @($Report.RequiredForeignKeySpecifications | Sort-Object Name)) { "fk-spec:$($item.Name):$($item.Table).$($item.Column)->$($item.TargetTable).$($item.TargetColumn)" }
    $signatureParts = @(
        $Report.DatabaseName,$Report.Encoding,$Report.TableCount,
        $Report.RequiredTableCount,$Report.RequiredColumnCount,
        $Report.ForeignKeyCount,$Report.RequiredForeignKeyCount,
        $Report.UnvalidatedForeignKeyCount,$Report.InvalidIndexCount,
        $Report.AppliedMigrationCount,$Report.RequiredFunctionCount,$Report.RequiredTriggerCount
    )
    $signatureParts += @($migrationLines)
    $signatureParts += @($indexLines)
    $signatureParts += @($triggerLines)
    $signatureParts += @($functionLines)
    $signatureParts += @($requiredTableLines)
    $signatureParts += @($requiredColumnLines)
    $signatureParts += @($requiredForeignKeyLines)
    $signatureParts += @($requiredForeignKeySpecLines)
    $signatureParts += @($tableLines)
    return ($signatureParts -join "`n")
}
function Compare-DatabaseSnapshot($SourceReport,$RestoredReport) {
    $differences = New-Object System.Collections.Generic.List[string]
    $sourceMigrations = @($SourceReport.AppliedMigrations | ForEach-Object { [string]$_ })
    $restoredMigrations = @($RestoredReport.AppliedMigrations | ForEach-Object { [string]$_ })
    if (($sourceMigrations -join '|') -cne ($restoredMigrations -join '|')) {
        $differences.Add(('Migration history differs. Source=[' + ($sourceMigrations -join ', ') + ']; Backup=[' + ($restoredMigrations -join ', ') + ']'))
    }
    $sourceTables = @($SourceReport.TableCounts.Keys | ForEach-Object { [string]$_ } | Sort-Object)
    $restoredTables = @($RestoredReport.TableCounts.Keys | ForEach-Object { [string]$_ } | Sort-Object)
    if (($sourceTables -join '|') -cne ($restoredTables -join '|')) {
        $differences.Add(('Public table set differs. Source=[' + ($sourceTables -join ', ') + ']; Backup=[' + ($restoredTables -join ', ') + ']'))
    }
    $allTables = @($sourceTables) + @($restoredTables)
    foreach ($tableName in @($allTables | Select-Object -Unique | Sort-Object)) {
        $sourceCount = if ($SourceReport.TableCounts.Contains($tableName)) { [long]$SourceReport.TableCounts[$tableName] } else { -1L }
        $restoredCount = if ($RestoredReport.TableCounts.Contains($tableName)) { [long]$RestoredReport.TableCounts[$tableName] } else { -1L }
        if ($sourceCount -ne $restoredCount) {
            $differences.Add(('Row count mismatch for ' + $tableName + ': source=' + $sourceCount + '; backup=' + $restoredCount))
        }
    }
    foreach ($property in @('Encoding','TableCount','RequiredTableCount','RequiredColumnCount','ForeignKeyCount','RequiredForeignKeyCount','UnvalidatedForeignKeyCount','InvalidIndexCount','RequiredFunctionCount','RequiredTriggerCount')) {
        if ([string]$SourceReport.$property -cne [string]$RestoredReport.$property) {
            $differences.Add(('Schema/integrity metadata mismatch for ' + $property + ': source=' + $SourceReport.$property + '; backup=' + $RestoredReport.$property))
        }
    }
    foreach ($field in @('RequiredTables','RequiredColumns','RequiredForeignKeys','RequiredIndexes','RequiredFunctions','RequiredTriggers')) {
        $sourceValues = @($SourceReport.$field | ForEach-Object { [string]$_ } | Sort-Object)
        $restoredValues = @($RestoredReport.$field | ForEach-Object { [string]$_ } | Sort-Object)
        if (($sourceValues -join '|') -cne ($restoredValues -join '|')) {
            $differences.Add(('Required schema-object inventory differs for ' + $field + '.'))
        }
    }
    return @($differences)
}
function Get-ListeningProcessSummary([int]$Port) {
    $connections = @()
    try { $connections = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) } catch { }
    $owners = @($connections | Select-Object -ExpandProperty OwningProcess -Unique)
    if ($owners.Count -eq 0) { return "Port $Port is no longer listening." }
    $items = foreach ($ownerId in $owners) {
        $process = Get-Process -Id ([int]$ownerId) -ErrorAction SilentlyContinue
        $processInfo = $null
        try { $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $ownerId" -ErrorAction SilentlyContinue } catch { }
        $name = if ($process) { $process.ProcessName } elseif ($processInfo) { [System.IO.Path]::GetFileNameWithoutExtension($processInfo.Name) } else { 'Unknown process' }
        $role = if ($processInfo -and $processInfo.CommandLine -match 'DarEltahfeez\.Api\.(dll|exe)') { ' — Dar API' } else { '' }
        '{0} (PID {1}){2}' -f $name,$ownerId,$role
    }
    return ('Port {0} is listening under: {1}. Close the Dar window and wait for the START_DAR console to finish cleanup. If it remains, inspect tools\Show-DarPortOwner.ps1; stop only a verified Dar API process and never postgres.exe.' -f $Port,($items -join '; '))
}

$script:DarPgBin = $null
$script:testSecrets = $null
$createdDatabases = New-Object System.Collections.Generic.List[string]
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ('DarRestoreValidation_' + [Guid]::NewGuid().ToString('N'))
$result = 'FAIL'
$failureMessage = $null
$skipMessage = $null
$cleanupFailures = New-Object System.Collections.Generic.List[string]
$pendingAcceptedBackupReference = $null
$acceptedBackupReferencePath = Join-Path $env:LOCALAPPDATA 'DarEltahfeez\TestRuns\test8-accepted-backup.json'
try {
    do {
        # Remove any prior acceptance token first. Test 10 may only use a backup accepted by this exact Test 8 run.
        if (Test-Path -LiteralPath $acceptedBackupReferencePath -PathType Leaf) { Remove-Item -LiteralPath $acceptedBackupReferencePath -Force }
        $paths = Get-DarLocalPaths
        if (-not (Test-Path -LiteralPath $paths.Secrets -PathType Leaf)) { $result='SKIP'; $skipMessage='Local database secrets are missing.'; break }
        $script:testSecrets = Get-DarDatabaseSecrets
        Assert-DarDatabaseSecrets -Secrets $script:testSecrets
        if (-not (Test-Path -LiteralPath (Join-Path $paths.Data 'PG_VERSION') -PathType Leaf)) { $result='SKIP'; $skipMessage='The existing local PostgreSQL data cluster is not prepared (PG_VERSION is missing). The test will not initialize a new cluster.'; break }
        if (Test-DarTcpPortListening -Port 5080) { $result='SKIP'; $skipMessage=(Get-ListeningProcessSummary 5080) + ' The test requires a stable production signature.'; break }
        $script:DarPgBin = Get-DarPostgresBin -ProjectRoot $projectRoot
        if ([string]::IsNullOrWhiteSpace([string]$script:DarPgBin)) { $result='SKIP'; $skipMessage='Bundled PostgreSQL runtime is unavailable. Open Dar Eltahfeez once to prepare the runtime, then retry.'; break }

        # The test may start the already-initialized local cluster without starting
        # the Dar API. It never runs initdb and uses the same cross-process mutex
        # as the desktop launcher and the independent backup scheduler.
        New-Item -ItemType Directory -Force -Path $paths.Logs | Out-Null
        $startupMutex = [System.Threading.Mutex]::new($false,'Global\DarEltahfeez_Postgres_55432')
        $ownsStartupMutex = $false
        try {
            try { $ownsStartupMutex = $startupMutex.WaitOne([TimeSpan]::FromSeconds(30)) }
            catch [System.Threading.AbandonedMutexException] { $ownsStartupMutex = $true }
            if (-not $ownsStartupMutex) { throw 'Another process is starting or initializing local PostgreSQL. Retry the isolated restore test after it finishes.' }
            if (-not (Test-DarExpectedPostgresIdentity -Secrets $script:testSecrets -Paths $paths)) {
                Start-DarPostgresServer -Secrets $script:testSecrets -Paths $paths
            }
        } finally {
            if ($ownsStartupMutex) { $startupMutex.ReleaseMutex() }
            $startupMutex.Dispose()
        }
        if (-not (Test-DarExpectedPostgresIdentity -Secrets $script:testSecrets -Paths $paths)) { throw 'The local PostgreSQL identity could not be verified after startup. No test database was created.' }
        if (-not (Test-DarDatabaseExists -Secrets $script:testSecrets -DatabaseName $script:testSecrets.Database)) { throw 'The Dar production database does not exist; restore verification was stopped.' }
        if (Test-DarTcpPortListening -Port 5080) {
            $result='SKIP'; $skipMessage=(Get-ListeningProcessSummary 5080) + ' The test requires a stable production signature.'; break
        }

        # Use the newest verified full backup automatically. The previous file dialog allowed
        # an older .backup without a sidecar manifest to override the valid preselected candidate.
        # Test 10 will consume the exact backup path/hash accepted by this Test 8 run.
        $latestManifestBackup = Get-DarLatestBackupWithManifest -BackupFolder $paths.BackupFolder -Secrets $script:testSecrets
        if ([string]::IsNullOrWhiteSpace([string]$latestManifestBackup)) {
            $result='SKIP'; $skipMessage=("No completed full backup with a matching .backup.json manifest and SHA-256 was found in the active Dar backup folder: $($paths.BackupFolder). Create a new full backup from Dar System Center or Backup Scheduler, then retry Test 8."); break
        }
        $backupPath = [IO.Path]::GetFullPath($latestManifestBackup)
        Write-Host ("Using latest verified full backup automatically: $backupPath") -ForegroundColor Green
        $backupInfo = Get-Item -LiteralPath $backupPath -ErrorAction Stop
        $verifiedManifest = Get-DarVerifiedBackupManifest -BackupPath $backupPath -Secrets $script:testSecrets
        $backupHash = [string]$verifiedManifest.Sha256

        Write-Host 'Step 1: Validate backup manifest, SHA-256, archive structure and required table/data sections.'
        Test-DarBackupArchive -BackupPath $backupPath | Out-Null
        Write-Host ("PASS: Backup archive and manifest are valid. Created={0:o}; Size={1} bytes; SHA-256={2}" -f $verifiedManifest.CreatedAtUtc,$backupInfo.Length,$backupHash)

        Write-Host 'Step 2: Capture a read-only signature of the current Dar production database.'
        $productionBefore = Get-DarDatabaseRestoreReport -Secrets $script:testSecrets -DatabaseName $script:testSecrets.Database
        $productionSignatureBefore = Get-DatabaseSignature $productionBefore
        $expectedCurrentMigrations = @(
            '001_initial_schema','002_management_security','003_schedule_attendance_ads_receipts',
            '004_operating_expenses','005_system_admin','006_student_attendance',
            '007_student_attendance_active_unique','008_schedule_slot_active_unique',
            '009_teacher_notes','010_circle_start_date','011_enrollment_lifecycle_audit_index',
            '012_teacher_schedule_no_overlap'
        )
        if (@($productionBefore.AppliedMigrations).Count -ne $expectedCurrentMigrations.Count -or (@($productionBefore.AppliedMigrations) -join '|') -cne ($expectedCurrentMigrations -join '|')) {
            throw ('The current Dar database is not at the expected 14-migration release schema. Applied=[' + (@($productionBefore.AppliedMigrations) -join ', ') + ']. Start Dar once to apply the supported migrations before creating the acceptance backup.')
        }
        Write-Host ("PASS: Production database signature captured. Tables={0}; Migrations={1}/14; RequiredFunctions={2}; RequiredTriggers={3}." -f $productionBefore.TableCount,$productionBefore.AppliedMigrationCount,$productionBefore.RequiredFunctionCount,$productionBefore.RequiredTriggerCount)

        $suffix = [Guid]::NewGuid().ToString('N').Substring(0,16)
        $restoreTestDatabase = "dar_restore_test_$suffix"
        New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null
        Write-Host ("Step 3: Create isolated restore database {0}." -f $restoreTestDatabase)
        New-TestDatabase $restoreTestDatabase
        $createdDatabases.Add($restoreTestDatabase)
        Invoke-DarPgTool -Tool 'pg_restore' -Arguments @('--no-owner','--no-privileges','--exit-on-error','--single-transaction','-h','127.0.0.1','-p',[string]$script:testSecrets.Port,'-U',$script:testSecrets.AppUser,'-d',$restoreTestDatabase,$backupPath) -Password $script:testSecrets.AppPassword | Out-Null
        $restoreReport = Get-DarDatabaseRestoreReport -Secrets $script:testSecrets -DatabaseName $restoreTestDatabase
        Test-DarBackupArchive -BackupPath $backupPath -RequiredTables $restoreReport.RequiredTables | Out-Null
        if ($restoreReport.AppliedMigrationCount -ne $productionBefore.AppliedMigrationCount -or (@($restoreReport.AppliedMigrations) -join '|') -cne (@($productionBefore.AppliedMigrations) -join '|')) {
            throw ('The selected backup is not from the current Dar schema. Production migrations=[' + (@($productionBefore.AppliedMigrations) -join ', ') + ']; backup migrations=[' + (@($restoreReport.AppliedMigrations) -join ', ') + ']. Create a new backup after the current application has started successfully.')
        }
        $snapshotDifferences = @(Compare-DatabaseSnapshot -SourceReport $productionBefore -RestoredReport $restoreReport)
        if ($snapshotDifferences.Count -gt 0) {
            throw ('The restored backup does not match the current read-only Dar snapshot. ' + ($snapshotDifferences -join ' | ') + '. Create a new full backup while operations are paused, close Dar, and rerun Test 8 with that archive.')
        }
        Write-Host ("PASS: Restore matches current production snapshot. Tables={0}; RequiredTables={1}; ForeignKeys={2}; RequiredForeignKeys={3}; RequiredFunctions={4}; RequiredTriggers={5}; Migrations={6}/14; Size={7} bytes." -f $restoreReport.TableCount,$restoreReport.RequiredTableCount,$restoreReport.ForeignKeyCount,$restoreReport.RequiredForeignKeyCount,$restoreReport.RequiredFunctionCount,$restoreReport.RequiredTriggerCount,$restoreReport.AppliedMigrationCount,$restoreReport.DatabaseSizeBytes)
        Write-Host 'PASS: Every public base-table row count and the complete 14-migration history match the current Dar database.'
        foreach ($tableName in @('app_users','students','teachers','circles','circle_enrollments','monthly_charges','payments','student_attendance','teacher_attendance')) {
            if ($restoreReport.TableCounts.Contains($tableName)) { Write-Host ("  {0}: {1} rows" -f $tableName,$restoreReport.TableCounts[$tableName]) }
        }
        Write-Host 'PASS: Database encoding, required tables, row counts, foreign keys and indexes were checked.'

        Write-Host 'Step 4: Reject a deliberately invalid archive without touching the production database.'
        $invalidPath = Join-Path $tempRoot 'not-a-postgresql-backup.backup'
        [IO.File]::WriteAllText($invalidPath,'This is intentionally not a PostgreSQL archive.',[Text.UTF8Encoding]::new($false))
        $rejected = $false
        try { Test-DarBackupArchive -BackupPath $invalidPath | Out-Null } catch { $rejected = $true }
        if (-not $rejected) { throw 'The deliberately invalid archive was not rejected.' }
        Write-Host 'PASS: Invalid archive was rejected before any restore database operation.'

        Write-Host 'Step 5: Test database rename rollback using disposable databases only.'
        $swapTarget = "dar_swap_test_$suffix"
        $swapStage = "dar_swap_test_$([Guid]::NewGuid().ToString('N').Substring(0,16))"
        $swapPrevious = "dar_swap_test_$([Guid]::NewGuid().ToString('N').Substring(0,16))"
        New-TestDatabase $swapTarget; $createdDatabases.Add($swapTarget)
        New-TestDatabase $swapStage; $createdDatabases.Add($swapStage)
        if (Test-DarDatabaseExists -Secrets $script:testSecrets -DatabaseName $swapPrevious) { throw 'Unexpected previous-database test-name collision; no existing database was touched.' }
        # The previous-name DB is created by renaming the original disposable target.
        # Register the known-absent name before the switch so cleanup removes it too.
        $createdDatabases.Add($swapPrevious)
        Invoke-TestSql -DatabaseName $swapTarget -Sql "CREATE TABLE restore_probe(value text NOT NULL); INSERT INTO restore_probe VALUES ('ORIGINAL');" | Out-Null
        Invoke-TestSql -DatabaseName $swapStage -Sql "CREATE TABLE restore_probe(value text NOT NULL); INSERT INTO restore_probe VALUES ('RESTORED');" | Out-Null
        $injectedFailureObserved = $false
        try {
            Switch-DarRestoredDatabase -Secrets $script:testSecrets -StageDatabase $swapStage -TargetDatabase $swapTarget -PreviousDatabase $swapPrevious -StageRenameTestAction { throw 'INTENTIONAL_TEST_FAILURE_AFTER_OLD_DATABASE_RENAME' } | Out-Null
        } catch {
            if ($_.Exception.Message -like '*INTENTIONAL_TEST_FAILURE_AFTER_OLD_DATABASE_RENAME*' -or $_.Exception.Message -like '*previous database was restored*' -or $_.Exception.Message -like '*قاعدة الجهاز السابقة*') { $injectedFailureObserved = $true }
            else { throw }
        }
        if (-not $injectedFailureObserved) { throw 'The injected swap failure did not occur as expected.' }
        if (-not (Test-DarDatabaseExists -Secrets $script:testSecrets -DatabaseName $swapTarget)) { throw 'Rollback failed: the original temporary database name was not restored.' }
        if (Test-DarDatabaseExists -Secrets $script:testSecrets -DatabaseName $swapPrevious) { throw 'Rollback failed: the previous temporary database remains under the backup name.' }
        $marker = ((Invoke-TestSql -DatabaseName $swapTarget -Sql 'SELECT value FROM restore_probe;').Output | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ }) -join ''
        if ($marker -ne 'ORIGINAL') { throw "Rollback restored an unexpected marker value: $marker" }
        Write-Host 'PASS: Forced swap failure restored the original temporary database and its data.'

        Write-Host 'Step 6: Verify a successful switch using disposable databases only.'
        $previousName = Switch-DarRestoredDatabase -Secrets $script:testSecrets -StageDatabase $swapStage -TargetDatabase $swapTarget -PreviousDatabase $swapPrevious
        if ($previousName -ne $swapPrevious) { throw 'Successful switch did not return the preserved previous database name.' }
        $newMarker = ((Invoke-TestSql -DatabaseName $swapTarget -Sql 'SELECT value FROM restore_probe;').Output | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ }) -join ''
        $oldMarker = ((Invoke-TestSql -DatabaseName $swapPrevious -Sql 'SELECT value FROM restore_probe;').Output | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ }) -join ''
        if ($newMarker -ne 'RESTORED' -or $oldMarker -ne 'ORIGINAL') { throw 'Successful switch did not preserve the restored and previous database contents as expected.' }
        Write-Host 'PASS: Successful switch activated the staged database and preserved the previous one.'

        Write-Host 'Step 7: Verify the production database signature remains unchanged.'
        $productionAfter = Get-DarDatabaseRestoreReport -Secrets $script:testSecrets -DatabaseName $script:testSecrets.Database
        $productionSignatureAfter = Get-DatabaseSignature $productionAfter
        if ($productionSignatureBefore -cne $productionSignatureAfter) { throw 'Production database signature changed during the isolated restore test.' }
        Write-Host 'PASS: Production Dar database read-only signature is unchanged.'
        $pendingAcceptedBackupReference = [ordered]@{
            SchemaVersion = 1
            AcceptedBy = 'Test 8'
            AcceptedAtUtc = [DateTimeOffset]::UtcNow.ToString('o')
            BackupPath = [IO.Path]::GetFullPath($backupPath)
            ManifestPath = [IO.Path]::GetFullPath($verifiedManifest.Path)
            DatabaseName = [string]$script:testSecrets.Database
            Sha256 = [string]$verifiedManifest.Sha256
            CreatedAtUtc = $verifiedManifest.CreatedAtUtc.ToString('o')
        }
        $result = 'PASS'
    } while ($false)
}
catch {
    $result = 'FAIL'
    $failureMessage = $_.Exception.Message
}
finally {
    if ($script:testSecrets) {
        foreach ($databaseName in @($createdDatabases | Select-Object -Unique)) {
            try { Remove-TestDatabase -Name $databaseName }
            catch { $cleanupFailures.Add("$databaseName — $($_.Exception.Message)") }
        }
    }
    if (Test-Path -LiteralPath $tempRoot) { Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue }
}

if ($cleanupFailures.Count -gt 0) {
    $result = 'FAIL'
    $cleanupText = 'Cleanup failed for temporary test databases: ' + ($cleanupFailures -join '; ')
    if ($failureMessage) { $failureMessage += ' | ' + $cleanupText } else { $failureMessage = $cleanupText }
}
if ($result -eq 'PASS' -and $null -ne $pendingAcceptedBackupReference) {
    try {
        $acceptedDirectory = Split-Path -Parent $acceptedBackupReferencePath
        New-Item -ItemType Directory -Force -Path $acceptedDirectory | Out-Null
        Write-DarAtomicJson -Path $acceptedBackupReferencePath -Value $pendingAcceptedBackupReference
        Write-Host ("PASS: Test 8 acceptance reference saved for Test 10: {0}" -f $acceptedBackupReferencePath) -ForegroundColor Green
    } catch {
        $result = 'FAIL'
        $failureMessage = 'Test 8 passed its database checks, but could not persist the Test 10 acceptance reference: ' + $_.Exception.Message
    }
}
if ($result -eq 'FAIL') {
    Write-Host ("FAIL: Backup restore isolation test failed: " + $failureMessage) -ForegroundColor Red
    Write-Output 'DAR_TEST_RESULT=FAIL'
    exit 1
}
if ($result -eq 'SKIP') {
    Write-Host ("SKIP: $skipMessage")
    Write-Output 'DAR_TEST_RESULT=SKIP'
    exit 2
}
Write-Host 'PASS: Isolated backup restore, invalid archive rejection, successful switch and rollback checks completed.'
Write-Output 'DAR_TEST_RESULT=PASS'
exit 0
