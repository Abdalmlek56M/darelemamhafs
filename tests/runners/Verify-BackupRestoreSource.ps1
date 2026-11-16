$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$localDbPath = Join-Path $projectRoot 'tools\LocalPostgres.ps1'
$restoreTestPath = Join-Path $PSScriptRoot 'Verify-BackupRestoreIsolation.ps1'
$testCenterPath = Join-Path $PSScriptRoot 'TestCenter.ps1'
foreach ($path in @($localDbPath,$restoreTestPath,$testCenterPath)) { if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "FAIL: Missing restore validation file: $path" } }
$localDb = Get-Content -LiteralPath $localDbPath -Raw -Encoding UTF8
$runner = Get-Content -LiteralPath $restoreTestPath -Raw -Encoding UTF8
$center = Get-Content -LiteralPath $testCenterPath -Raw -Encoding UTF8
$checks = @(
    @{ Name='Backup validation requires PostgreSQL custom archive listing'; Text=$localDb; Pattern="pg_restore.*--list" },
    @{ Name='Backup validation requires data sections for core tables'; Text=$localDb; Pattern='TABLE\\s\+DATA\\s\+public\\s\+' },
    @{ Name='Restore validation follows applied schema migrations'; Text=$localDb; Pattern='SELECT version FROM public\.schema_migrations ORDER BY version;[\s\S]*?Get-DarExpectedSchemaForMigrations -AppliedMigrations \$appliedMigrations' },
    @{ Name='Restore rejects migration identifiers not supported by this application'; Text=$localDb; Pattern='function Get-DarExpectedSchemaForMigrations[\s\S]*?\$unknown = @\(\$AppliedMigrations \| Where-Object \{ -not \$migrationTables\.Contains\(\$_\) \}\)[\s\S]*?ترحيلات غير معروفة' },
    @{ Name='Restore validation verifies migration-required foreign key names'; Text=$localDb; Pattern='RequiredForeignKeys[\s\S]*?missingFkNames[\s\S]*?MissingForeignKeys' },
    @{ Name='Restore rejects migration history gaps'; Text=$localDb; Pattern='migrationGapFound[\s\S]*?سجل schema_migrations غير متسلسل' },
    @{ Name='Restore validates migration-required columns'; Text=$localDb; Pattern='RequiredColumns[\s\S]*?missingColumns[\s\S]*?MissingColumns' },
    @{ Name='Restore validation verifies required safety indexes'; Text=$localDb; Pattern='uq_trash_active_entity[\s\S]*?MissingRequiredIndexes' },
    @{ Name='Restore validates each required index uniqueness, validity and readiness'; Text=$localDb; Pattern='i\.indisunique=required\.is_unique AND i\.indisvalid AND i\.indisready' },
    @{ Name='Restore requires date-effective attendance eligibility function'; Text=$localDb; Pattern='dar_enrollment_is_attendance_eligible_on_date[\s\S]*?Arguments=''uuid, date''[\s\S]*?Result=''boolean''' },
    @{ Name='Restore validates every schema column introduced by supported migrations'; Text=$localDb; Pattern='columnsByMigration = \[ordered\]@\{[\s\S]*?app_users\.password_hash[\s\S]*?teacher_notes\.is_trashed[\s\S]*?RequiredColumnCount = \$expectedSchema\.RequiredColumns\.Count' },
    @{ Name='Restore verifies required foreign key ownership and target columns'; Text=$localDb; Pattern='RequiredForeignKeySpecifications[\s\S]*?source_table\.relname=required\.table_name[\s\S]*?target_table\.relname=required\.target_table[\s\S]*?constraint_row\.conkey\[1\]=source_attribute\.attnum[\s\S]*?constraint_row\.confkey\[1\]=target_attribute\.attnum' },
    @{ Name='Restore verifies partial safety index table, key columns and predicate'; Text=$localDb; Pattern='RequiredIndexSpecifications[\s\S]*?table_class\.relname=required\.table_name[\s\S]*?indnkeyatts[\s\S]*?pg_get_expr\(i\.indpred,i\.indrelid\)' },
    @{ Name='Enrollment partial-index validation tolerates PostgreSQL VARCHAR-to-text deparser casts'; Text=$localDb; Pattern='PredicatePattern=.*status.*active' },
    @{ Name='Restore schema map recognizes migration 011 and its lifecycle index'; Text=$localDb; Pattern='011_enrollment_lifecycle_audit_index[\s\S]*?ix_audit_log_enrollment_lifecycle[\s\S]*?Unique=\$false' },
    @{ Name='Restore index verification validates both unique and non-unique index specifications'; Text=$localDb; Pattern='ix_audit_log_enrollment_lifecycle[\s\S]*?Unique=\$false[\s\S]*?uniqueLiteral[\s\S]*?required\(name,table_name,key_columns,predicate_pattern,is_unique\)[\s\S]*?i\.indisunique=required\.is_unique' },
    @{ Name='Restore schema map recognizes all three lifecycle helper functions'; Text=$localDb; Pattern='functionsByMigration[\s\S]*?011_enrollment_lifecycle_audit_index[\s\S]*?dar_enrollment_status_at_date[\s\S]*?dar_enrollment_is_attendance_eligible_on_date[\s\S]*?dar_enrollment_has_active_day_in_month' },
    @{ Name='Restore schema map recognizes migration 012 schedule-overlap index and helper'; Text=$localDb; Pattern='012_teacher_schedule_no_overlap[\s\S]*?ix_schedule_slots_active_day_lookup[\s\S]*?dar_teacher_has_schedule_overlap' },
    @{ Name='Restore schema map validates both schedule-overlap protection triggers'; Text=$localDb; Pattern="trg_circle_schedule_slots_teacher_overlap[\s\S]*?trg_circles_teacher_schedule_overlap[\s\S]*?tgenabled IN \('O','A'\)[\s\S]*?MissingRequiredTriggers" },
    @{ Name='Restore validates lifecycle function signatures, result types, stability and invoker security'; Text=$localDb; Pattern='RequiredFunctionSpecifications[\s\S]*?oidvectortypes\(procedure_row\.proargtypes\)=required\.argument_types[\s\S]*?pg_get_function_result\(procedure_row\.oid\)=required\.result_type[\s\S]*?procedure_row\.provolatile=required\.volatility[\s\S]*?procedure_row\.prosecdef=FALSE[\s\S]*?RequiredFunctionCount' },
    @{ Name='Restore validates archive table data sections for all migration-required tables'; Text=$localDb; Pattern='Test-DarBackupArchive -BackupPath \$BackupPath -RequiredTables \$restoreReport\.RequiredTables' },
    @{ Name='Interactive restore test validates archive data sections for the restored schema'; Text=$runner; Pattern='Get-DarDatabaseRestoreReport[\s\S]*?Test-DarBackupArchive -BackupPath \$backupPath -RequiredTables \$restoreReport\.RequiredTables' },
    @{ Name='Restore uses a unique temporary database'; Text=$localDb; Pattern='dar_restore_\$token' },
    @{ Name='Restore validates database encoding, foreign keys and indexes'; Text=$localDb; Pattern='UnvalidatedForeignKeyCount|InvalidIndexCount' },
    @{ Name='Restore validates row counts for every public base table'; Text=$localDb; Pattern='COUNT\(\*\)::bigint AS row_count' },
    @{ Name='Restore creates a safety backup before switching'; Text=$localDb; Pattern='Creating and validating a safety backup' },
    @{ Name='Restore switch preserves the previous database'; Text=$localDb; Pattern='dar_before_restore_\$token' },
    @{ Name='Restore switch contains an explicit rollback path'; Text=$localDb; Pattern='Rename-DarDatabase -FromName \$PreviousDatabase -ToName \$TargetDatabase' },
    @{ Name='Isolation test uses a uniquely named temporary restore database'; Text=$runner; Pattern='dar_restore_test_\$suffix' },
    @{ Name='Restore isolation checks the live production API listener before reading the production signature'; Text=$runner; Pattern='Test-DarTcpPortListening\s+-Port\s+5080' },
    @{ Name='Restore isolation reports the listener owner when production API is active'; Text=$runner; Pattern='Get-ListeningProcessSummary\s+5080' },
    @{ Name='Restore isolation reports production migration version and required lifecycle functions'; Text=$runner; Pattern='Production database signature captured\. Tables=\{0\}; Migrations=\{1\}/14; RequiredFunctions=\{2\}; RequiredTriggers=\{3\}' },
    @{ Name='Test Center preflight blocks restore while production API port 5080 is listening'; Text=$center; Pattern='Test-TcpPort\s+5080' },
    @{ Name='Restore isolation starts only an existing cluster and never initializes a new one'; Text=$runner; Pattern='PG_VERSION.*Start-DarPostgresServer|Start-DarPostgresServer.*PG_VERSION' },
    @{ Name='Restore isolation uses the shared PostgreSQL startup mutex'; Text=$runner; Pattern='Global\\DarEltahfeez_Postgres_55432' },
    @{ Name='Test Center allows isolated restore when prepared cluster is offline'; Text=$center; Pattern='Test-RestoreClusterPrepared' },
    @{ Name='Test Center blocks restore test while API port 5080 is listening'; Text=$center; Pattern="Test-TcpPort 5080" },
    @{ Name='Test cleanup drops only its own disposable database using standalone DROP DATABASE WITH FORCE'; Text=$runner; Pattern='DROP DATABASE IF EXISTS \$Name WITH \(FORCE\)' },
    @{ Name='Isolation test compares production database before and after'; Text=$runner; Pattern='productionSignatureBefore.*productionSignatureAfter' },
    @{ Name='Restore acceptance requires the exact current 14-migration schema'; Text=$runner; Pattern='expectedCurrentMigrations[\s\S]*?012_teacher_schedule_no_overlap[\s\S]*?AppliedMigrations' },
    @{ Name='Restore acceptance requires a completed sidecar manifest for the selected backup'; Text=$localDb; Pattern='function Get-DarVerifiedBackupManifest[\s\S]*?Status -cne .completed.[\s\S]*?FileName' },
    @{ Name='Restore failure emits a durable FAIL marker without Write-Error terminating first'; Text=$runner; Pattern='Write-Host \("FAIL: Backup restore isolation test failed:[\s\S]*?Write-Output .DAR_TEST_RESULT=FAIL.[\s\S]*?exit 1' },
    @{ Name='Restore acceptance verifies backup size and SHA-256 against manifest'; Text=$localDb; Pattern='Get-DarVerifiedBackupManifest[\s\S]*?FileSizeBytes[\s\S]*?Get-FileHash[\s\S]*?manifest\.Sha256' },
    @{ Name='Restore acceptance compares every public table row count with the current database snapshot'; Text=$runner; Pattern='function Compare-DatabaseSnapshot[\s\S]*?TableCounts[\s\S]*?snapshotDifferences' },
    @{ Name='Production signature includes applied migrations and trigger metadata'; Text=$runner; Pattern='function Get-DatabaseSignature[\s\S]*?AppliedMigrations[\s\S]*?RequiredTriggerCount' },
    @{ Name='Shared backup manifest verifier checks current PostgreSQL major version and archive format'; Text=$localDb; Pattern='Get-DarVerifiedBackupManifest[\s\S]*?PostgreSqlMajorVersion -ne 17[\s\S]*?PostgreSQL Custom' },
    @{ Name='Restore signature also protects required functions, indexes and triggers'; Text=$runner; Pattern='function Get-DatabaseSignature[\s\S]*?RequiredFunctions[\s\S]*?RequiredIndexes[\s\S]*?RequiredTriggers' },
    @{ Name='Isolation test validates a deliberately invalid archive'; Text=$runner; Pattern='not-a-postgresql-backup\.backup' },
    @{ Name='Isolation test injects failure to exercise rollback'; Text=$runner; Pattern='INTENTIONAL_TEST_FAILURE_AFTER_OLD_DATABASE_RENAME' },
    @{ Name='Isolation test only drops its own temporary databases'; Text=$runner; Pattern='notmatch.*dar_\(restore_test\|swap_test\)_' },
    @{ Name='Isolation test registers the renamed previous database for cleanup'; Text=$runner; Pattern='createdDatabases\.Add\(\$swapPrevious\)' },
    @{ Name='Interactive restore validation is skipped by Run All'; Text=$center; Pattern='\$test\.Interactive -and \$script:RunAllMode' }
)
$failedChecks = New-Object System.Collections.Generic.List[string]
foreach ($check in $checks) {
    if (-not [regex]::IsMatch($check.Text,$check.Pattern,[System.Text.RegularExpressions.RegexOptions]::Singleline)) {
        Write-Host "FAIL: $($check.Name)" -ForegroundColor Red
        $failedChecks.Add([string]$check.Name)
    }
    else {
        Write-Host "PASS: $($check.Name)" -ForegroundColor Green
    }
}
if ($failedChecks.Count -gt 0) {
    Write-Output ('DAR_TEST_RESULT=FAIL')
    exit 1
}
Write-Output 'DAR_TEST_RESULT=PASS'
exit 0
