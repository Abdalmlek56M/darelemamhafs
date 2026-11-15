$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$failed = New-Object System.Collections.Generic.List[string]
try {
    $modulePath = Join-Path $projectRoot 'tools\HealthChecks.ps1'
    $centerPath = Join-Path $projectRoot 'tools\SystemCenter.ps1'
    if (-not (Test-Path -LiteralPath $modulePath -PathType Leaf)) { throw 'HealthChecks.ps1 is missing.' }
    if (-not (Test-Path -LiteralPath $centerPath -PathType Leaf)) { throw 'SystemCenter.ps1 is missing.' }
    $localPostgresPath = Join-Path $projectRoot 'tools\LocalPostgres.ps1'
    $storageModulePath = Join-Path $projectRoot 'tools\StorageCenter.ps1'
    $storagePathManagerPath = Join-Path $projectRoot 'tools\StoragePathManager.ps1'
    $backupRunnerPath = Join-Path $projectRoot 'tools\Invoke-AutomatedBackup.ps1'
    $databaseStudioPath = Join-Path $projectRoot 'tools\DatabaseStudio.ps1'
    $databaseStudioSourceRunnerPath = Join-Path $projectRoot 'tests\runners\Verify-DatabaseStudioSource.ps1'
    $databaseStudioRegressionRunnerPath = Join-Path $projectRoot 'tests\runners\Verify-DatabaseStudioRegression.ps1'
    $postgresMaintenancePath = Join-Path $projectRoot 'tools\PostgresMaintenance.ps1'
    $postgresMaintenanceSourceRunnerPath = Join-Path $projectRoot 'tests\runners\Verify-PostgresMaintenanceSource.ps1'
    $postgresMaintenanceRegressionRunnerPath = Join-Path $projectRoot 'tests\runners\Verify-PostgresMaintenanceRegression.ps1'
    $systemCenterSourceRunnerPath = Join-Path $projectRoot 'tests\runners\Verify-SystemCenterSource.ps1'
    $financialRoundingRunnerPath = Join-Path $projectRoot 'tests\runners\Verify-FinancialRounding.ps1'
    $currencyNormalizationRunnerPath = Join-Path $projectRoot 'tests\runners\Verify-CurrencyInputNormalization.ps1'
    $financeRedactionRunnerPath = Join-Path $projectRoot 'tests\runners\Verify-FinanceReadRedactionSource.ps1'
    $enrollmentLifecycleRunnerPath = Join-Path $projectRoot 'tests\runners\Verify-EnrollmentLifecycleAndCreateOnlyFinanceSource.ps1'
    $enrollmentBillingRunnerPath = Join-Path $projectRoot 'tests\runners\Verify-EnrollmentBillingLifecycleRegression.ps1'
    $domainEndpointsPath = Join-Path $projectRoot 'backend\DarEltahfeez.Api\DomainEndpoints.cs'
    $moneyRulesPath = Join-Path $projectRoot 'backend\DarEltahfeez.Api\MoneyRules.cs'
    $financeSchemaPath = Join-Path $projectRoot 'database\001_initial_schema.sql'
    if (-not (Test-Path -LiteralPath $localPostgresPath -PathType Leaf)) { throw 'LocalPostgres.ps1 is missing.' }
    $module = Get-Content -LiteralPath $modulePath -Raw -Encoding UTF8
    $center = Get-Content -LiteralPath $centerPath -Raw -Encoding UTF8
    $localPostgres = Get-Content -LiteralPath $localPostgresPath -Raw -Encoding UTF8
    if (-not (Test-Path -LiteralPath $storageModulePath -PathType Leaf)) { throw 'StorageCenter.ps1 is missing.' }
    if (-not (Test-Path -LiteralPath $storagePathManagerPath -PathType Leaf)) { throw 'StoragePathManager.ps1 is missing.' }
    if (-not (Test-Path -LiteralPath $backupRunnerPath -PathType Leaf)) { throw 'Invoke-AutomatedBackup.ps1 is missing.' }
    foreach ($requiredDatabaseStudioFile in @($databaseStudioPath,$databaseStudioSourceRunnerPath,$databaseStudioRegressionRunnerPath)) {
        if (-not (Test-Path -LiteralPath $requiredDatabaseStudioFile -PathType Leaf)) { throw ('Database Studio dependency is missing: ' + $requiredDatabaseStudioFile) }
    }
    foreach ($requiredMaintenanceFile in @($postgresMaintenancePath,$postgresMaintenanceSourceRunnerPath,$postgresMaintenanceRegressionRunnerPath)) {
        if (-not (Test-Path -LiteralPath $requiredMaintenanceFile -PathType Leaf)) { throw ('PostgreSQL maintenance dependency is missing: ' + $requiredMaintenanceFile) }
    }
    $storageModule = Get-Content -LiteralPath $storageModulePath -Raw -Encoding UTF8
    $storagePathManager = Get-Content -LiteralPath $storagePathManagerPath -Raw -Encoding UTF8
    $backupRunner = Get-Content -LiteralPath $backupRunnerPath -Raw -Encoding UTF8
    $databaseStudio = Get-Content -LiteralPath $databaseStudioPath -Raw -Encoding UTF8
    if (-not (Test-Path -LiteralPath $domainEndpointsPath -PathType Leaf)) { throw 'DomainEndpoints.cs is missing.' }
    if (-not (Test-Path -LiteralPath $moneyRulesPath -PathType Leaf)) { throw 'MoneyRules.cs is missing.' }
    if (-not (Test-Path -LiteralPath $financeSchemaPath -PathType Leaf)) { throw 'Initial finance schema migration is missing.' }
    $domainEndpoints = Get-Content -LiteralPath $domainEndpointsPath -Raw -Encoding UTF8
    $moneyRules = Get-Content -LiteralPath $moneyRulesPath -Raw -Encoding UTF8
    $financeSchema = Get-Content -LiteralPath $financeSchemaPath -Raw -Encoding UTF8
    # Parse every script loaded on the System Center startup path with the host parser.
    # This catches syntax errors (for example unmatched parentheses) that regex source guards cannot detect.
    $parseTargets = @(
        $modulePath,
        $centerPath,
        (Join-Path $projectRoot 'tools\Start-SystemCenter.ps1'),
        (Join-Path $projectRoot 'tools\LocalPostgres.ps1'),
        (Join-Path $projectRoot 'tools\BackupScheduler.ps1'),
        (Join-Path $projectRoot 'tools\run-desktop.ps1'),
        $storageModulePath,
        $storagePathManagerPath,
        $backupRunnerPath,
        (Join-Path $projectRoot 'tests\runners\Verify-StoragePathManager.ps1'),
        $databaseStudioPath,
        $databaseStudioSourceRunnerPath,
        $databaseStudioRegressionRunnerPath,
        $postgresMaintenancePath,
        $postgresMaintenanceSourceRunnerPath,
        $postgresMaintenanceRegressionRunnerPath,
        $systemCenterSourceRunnerPath,
        $financialRoundingRunnerPath,
        $currencyNormalizationRunnerPath,
        $financeRedactionRunnerPath,
        $enrollmentLifecycleRunnerPath,
        $enrollmentBillingRunnerPath
    )
    foreach ($parseTarget in $parseTargets) {
        if (-not (Test-Path -LiteralPath $parseTarget -PathType Leaf)) { throw ('PowerShell startup dependency is missing: ' + $parseTarget) }
        $tokens = $null
        $parseErrors = $null
        [void][System.Management.Automation.Language.Parser]::ParseFile($parseTarget, [ref]$tokens, [ref]$parseErrors)
        if ($parseErrors -and $parseErrors.Count -gt 0) {
            $firstError = $parseErrors[0]
            throw ('PowerShell parse error in {0}:{1}:{2}: {3}' -f $parseTarget, $firstError.Extent.StartLineNumber, $firstError.Extent.StartColumnNumber, $firstError.Message)
        }
    }
    Write-Host ('PASS: PowerShell parser accepted all ' + $parseTargets.Count + ' System Center startup, storage and maintenance scripts.') -ForegroundColor Green
    Write-Host 'PASS: Test 1 System Center source runner is included in AST parsing.' -ForegroundColor Green
    Write-Host 'PASS: Test 21 currency normalization runner is included in AST parsing.' -ForegroundColor Green
    Write-Host 'PASS: Test 22 finance permission redaction runner is included in AST parsing.' -ForegroundColor Green
    Write-Host 'PASS: Test 23 enrollment lifecycle runner is included in AST parsing.' -ForegroundColor Green
    Write-Host 'PASS: Test 24 enrollment billing regression runner is included in AST parsing.' -ForegroundColor Green
    $checks = @(
        @{ Name='System Center loads the Health Checks module'; Text=$center; Pattern='HealthChecks\.ps1' },
        @{ Name='Both payment endpoints normalize currency before validating and persisting'; Text=$domainEndpoints; Pattern='MapPost\("/api/payments"[\s\S]*?TryNormalizePaymentAmount\(request\.Amount, out var paymentAmount\)[\s\S]*?ExceedsOutstanding\(paymentAmount, due, paid\)[\s\S]*?AddWithValue\("amount",paymentAmount\)[\s\S]*?MapPost\("/api/payments/with-receipt"[\s\S]*?TryNormalizePaymentAmount\(parsedAmount, out var amount\)[\s\S]*?ExceedsOutstanding\(amount, due, paid\)[\s\S]*?AddWithValue\("amount",amount\)' },
        @{ Name='Payment endpoints no longer allow a half-cent overpayment tolerance'; Text=$domainEndpoints; Pattern='0\.005m'; Negative=$true },
        @{ Name='Currency rounding matches PostgreSQL NUMERIC midpoint behavior'; Text=$moneyRules; Pattern='decimal\.Round\(amount, CurrencyScale, MidpointRounding\.AwayFromZero\)' },
        @{ Name='Payment amounts respect the NUMERIC(12,2) maximum'; Text=$moneyRules; Pattern='MaximumNumeric12Currency = 9_999_999_999\.99m[\s\S]*?MaximumPaymentAmount = MaximumNumeric12Currency' },
        @{ Name='Currency normalization rules expose NUMERIC(14,2) maximum and both sign policies'; Text=$moneyRules; Pattern='MaximumNumeric14Currency = 999_999_999_999\.99m[\s\S]*?TryNormalizeNonNegativeCurrency[\s\S]*?TryNormalizePositiveCurrency' },
        @{ Name='Teacher payable is bounded by the stored NUMERIC(12,2) amount'; Text=$moneyRules; Pattern='TryCalculateTeacherPayableAmount[\s\S]*?TryNormalizeNonNegativeCurrency\(calculatedAmount, out payableAmount\)' },
        @{ Name='Payment and charge columns remain NUMERIC(12,2)'; Text=$financeSchema; Pattern='amount_due NUMERIC\(12,2\)[\s\S]*?CREATE TABLE IF NOT EXISTS payments[\s\S]*?amount NUMERIC\(12,2\)' },
        @{ Name='Financial rounding regression exercises the production MoneyRules source'; Text=(Get-Content -LiteralPath (Join-Path $projectRoot 'tests\regression\financial-rounding\FinancialRoundingRegression.csproj') -Raw -Encoding UTF8); Pattern='Compile Include="\.\./\.\./\.\./backend/DarEltahfeez\.Api/MoneyRules\.cs"' },
        @{ Name='Currency normalization regression exercises the production MoneyRules source'; Text=(Get-Content -LiteralPath (Join-Path $projectRoot 'tests\regression\currency-input-normalization\CurrencyInputNormalizationRegression.csproj') -Raw -Encoding UTF8); Pattern='Compile Include="\.\./\.\./\.\./backend/DarEltahfeez\.Api/MoneyRules\.cs"' },
        @{ Name='System Center loads the Storage Center module'; Text=$center; Pattern='StorageCenter\.ps1' },
        @{ Name='System Center loads the backup path manager'; Text=$center; Pattern='StoragePathManager\.ps1' },
        @{ Name='System Center loads the dedicated Database Studio module'; Text=$center; Pattern='DatabaseStudio\.ps1[\s\S]*?\.\s+\$DatabaseStudioModule' },
        @{ Name='Database Studio page is registered'; Text=$center; Pattern="databaseStudioPage\.Text\s*=\s*'قاعدة البيانات'" },
        @{ Name='Database Studio uses a read-only DataGridView'; Text=$center; Pattern='databaseStudioGrid\.ReadOnly\s*=\s*\$true' },
        @{ Name='Database Studio SQL display is not editable'; Text=$center; Pattern='databaseStudioSqlText\.ReadOnly\s*=\s*\$true' },
        @{ Name='Database Studio requires read-only transaction confirmation'; Text=$center; Pattern='\$overview\.transaction_read_only\s*-ne\s*''on'''  },
        @{ Name='Backup path manager resolver fails closed on corrupt or unsupported configuration'; Text=$localPostgres; Pattern='Get-DarBackupLocationConfiguration[\s\S]*?SchemaVersion -ne 1[\s\S]*?لم يتم تغيير أي مسار' },
        @{ Name='Custom backup path cannot overlap the Dar LocalAppData data root'; Text=$localPostgres; Pattern='isCustom -and \(\(Test-DarLocalPathContains -Parent \$BasePath' },
        @{ Name='Backup relocation refuses non-NTFS destinations and unsafe path roots'; Text=$storagePathManager; Pattern="\`$driveFormat -ne 'NTFS'[\s\S]*?Get-DarStoragePathReparseAncestor" },
        @{ Name='Backup relocation rejects relative and drive-relative target paths before normalization'; Text=$storagePathManager; Pattern='if \(\$TargetFolder -notmatch ''\^\[A-Za-z\]:\\\\''\)[\s\S]*?else\s*\{\s*try\s*\{\s*\$targetFull = \[IO\.Path\]::GetFullPath\(\$TargetFolder\)' },
        @{ Name='Backup relocation detects abandoned staging folders without deleting them'; Text=$storagePathManager; Pattern='\.DarEltahfeez-Backups-stage-\*' },
        @{ Name='Backup relocation checks the complete target file path length'; Text=$storagePathManager; Pattern='Test-DarStorageTargetPathLength[\s\S]*?MaximumLength 250' },
        @{ Name='Backup relocation checks both final and longer staging paths'; Text=$storagePathManager; Pattern='targetLongestFilePath[\s\S]*?stageLongestFilePath[\s\S]*?MaximumLength 250' },
        @{ Name='Backup relocation uses collision-safe same-volume directory rename'; Text=$storagePathManager; Pattern='Test-Path -LiteralPath \$plan\.TargetFolder[\s\S]*?\[System\.IO\.Directory\]::Move' },
        @{ Name='Backup relocation verifies every copied file with SHA-256'; Text=$storagePathManager; Pattern='Get-FileHash -LiteralPath \$targetFile -Algorithm SHA256' },
        @{ Name='Backup relocation validates PostgreSQL archives before changing the active path'; Text=$storagePathManager; Pattern='Test-DarBackupArchive -BackupPath \$targetArchive[\s\S]*?Update-DarBackupSchedulerPayload[\s\S]*?Write-DarAtomicJson' },
        @{ Name='Backup relocation holds the shared scheduler/manual backup mutex'; Text=$storagePathManager; Pattern='Global\\DarEltahfeez\.AutomaticBackup[\s\S]*?WaitOne\(0\)' },
        @{ Name='Backup relocation retains the previous source and never deletes it'; Text=$storagePathManager; Pattern='PreviousCopyRetained=\$true'; Negative=$false },
        @{ Name='Backup relocation source folder is never passed to Remove-Item'; Text=$storagePathManager; Pattern='Remove-Item[^\r\n]*\$plan\.SourceFolder'; Negative=$true },
        @{ Name='Scheduled backup re-resolves the active backup path after taking the shared mutex'; Text=$backupRunner; Pattern='WaitOne\(0\)[\s\S]*?\$paths = Get-DarLocalPaths[\s\S]*?New-Item -ItemType Directory -Force -Path \$paths\.BackupFolder' },
        @{ Name='Storage Center tab exists'; Text=$center; Pattern="storagePage\.Text\s*=\s*'التخزين'" },
        @{ Name='Storage Center uses the read-only inventory service'; Text=$center; Pattern='Get-DarStorageInventory\s+-ProjectRoot' },
        @{ Name='Storage Center exports the sanitized JSON report'; Text=$center; Pattern='storageInventory\.Report\s*\|\s*ConvertTo-Json' },
        @{ Name='Storage Center does not export internal absolute location handles'; Text=$center; Pattern='storageInventory\s*\|\s*ConvertTo-Json'; Negative=$true },
        @{ Name='Health dashboard tab exists'; Text=$center; Pattern="healthPage\.Text\s*=\s*'صحة النظام'" },
        @{ Name='Health dashboard runs the unified report'; Text=$center; Pattern='Get-DarSystemHealthReport\s+-ProjectRoot' },
        @{ Name='Health report export is available'; Text=$center; Pattern='healthReport\s*\|\s*ConvertTo-Json' },
        @{ Name='Health result model supports all four statuses'; Text=$module; Pattern='Healthy.*Warning.*Critical.*Unknown' },
        @{ Name='Health result model records whether a check affects overall status'; Text=$module; Pattern='affectsOverall = \$AffectsOverall' },
        @{ Name='Every database query is explicitly read-only'; Text=$module; Pattern='BEGIN READ ONLY' },
        @{ Name='Database Studio catalog queries use read-only transactions with bounded timeouts'; Text=$databaseStudio; Pattern="BEGIN READ ONLY; SET LOCAL statement_timeout = '5000ms'; SET LOCAL lock_timeout = '1000ms'" },
        @{ Name='Database Studio catalog connection is loopback-only and port-validated'; Text=$databaseStudio; Pattern='-h[^\r\n]*127\.0\.0\.1[^\r\n]*-p[^\r\n]*\[string\]\$Secrets\.Port' },
        @{ Name='Database Studio catalog identifiers use strict allow-listed SQL literals'; Text=$databaseStudio; Pattern='function ConvertTo-DarDatabaseStudioCatalogLiteral[\s\S]*?__SCHEMA_LITERAL__[\s\S]*?__TABLE_LITERAL__' },
        @{ Name='Database Studio does not rely on psql variable interpolation inside -c'; Text=$databaseStudio; Pattern='(?::''studio_schema''|:''studio_table''|-Variables)'; Negative=$true },
        @{ Name='Database Studio excludes raw SQL text from connection inventory'; Text=$databaseStudio; Pattern='a\.query([,\s]|$)'; Negative=$true },
        @{ Name='Database query is restricted to loopback'; Text=$module; Pattern="'-h','127\.0\.0\.1'" },
        @{ Name='Health query validates database secrets before invoking PostgreSQL'; Text=$module; Pattern='function Invoke-DarHealthQuery[\s\S]*?Assert-DarDatabaseSecrets\s+-Secrets\s+\$Secrets[\s\S]*?Invoke-DarPgTool' },
        @{ Name='Database query uses the Dar PostgreSQL port from validated secrets'; Text=$module; Pattern='''-p'',\[string\]\$Secrets\.Port' },
        @{ Name='Validated database secrets enforce the Dar PostgreSQL port'; Text=$localPostgres; Pattern='function Assert-DarDatabaseSecrets[\s\S]*?\[int\]\$Secrets\.Port -ne 55432' },
        @{ Name='PostgreSQL identity verifies the local data directory and major version'; Text=$module; Pattern='data_directory.*server_version_num' },
        @{ Name='PostgreSQL runtime checks all required binaries'; Text=$module; Pattern='postgres\.exe.*pg_ctl\.exe.*psql\.exe.*pg_dump\.exe.*pg_restore\.exe' },
        @{ Name='Schema health checks all required core tables'; Text=$module; Pattern="\('app_users'\).*\('student_attendance'\)" },
        @{ Name='Schema health checks expected partial unique safety indexes'; Text=$module; Pattern='uq_circle_enrollments_active_student_circle.*uq_trash_active_entity.*uq_circle_schedule_slots_not_trashed_day_time.*ux_student_attendance_active_slot_date_enrollment' },
        @{ Name='Schema health detects invalid and unvalidated indexes/constraints'; Text=$module; Pattern='NOT convalidated.*NOT indisvalid OR NOT indisready' },
        @{ Name='Data integrity checks payment totals'; Text=$module; Pattern='payments_exceed_charge' },
        @{ Name='Data integrity flags every positive-cent overpayment without a tolerance'; Text=$module; Pattern='payments_exceed_charge[\s\S]*?HAVING COALESCE\(SUM\(p\.amount\),0\)>mc\.amount_due' },
        @{ Name='Data integrity does not ignore a one-cent overpayment'; Text=$module; Pattern='payments_exceed_charge[\s\S]*?mc\.amount_due\+0\.01'; Negative=$true },
        @{ Name='Data integrity checks historic teacher rate snapshots'; Text=$module; Pattern='teacher_payable_mismatch.*hourly_rate_snapshot' },
        @{ Name='Data integrity checks core orphan relationships'; Text=$module; Pattern='orphan_core_relationships' },
        @{ Name='WAL inspection uses PostgreSQL read-only directory function'; Text=$module; Pattern='pg_ls_waldir' },
        @{ Name='Storage scan skips reparse points'; Text=$module; Pattern='FileAttributes\]::ReparsePoint' },
        @{ Name='Storage inventory declares itself read-only'; Text=$storageModule; Pattern='readOnly=\$true' },
        @{ Name='Storage inventory has a bounded per-location scan'; Text=$storageModule; Pattern='MaxFilesPerLocation = 200000' },
        @{ Name='Storage inventory bounds directory entries'; Text=$storageModule; Pattern='MaxDirectories = 200000' },
        @{ Name='Top-level inventory passes a directory-entry limit'; Text=$storageModule; Pattern='MaxDirectoriesPerLocation = 200000[\s\S]*?-MaxDirectories \$MaxDirectoriesPerLocation' },
        @{ Name='Storage inventory prevents overlapping paths from being double-counted'; Text=$storageModule; Pattern='Test-DarStoragePathContains[\s\S]*?IncludedIn' },
        @{ Name='Storage inventory hides absolute project and LocalAppData paths'; Text=$storageModule; Pattern='ConvertTo-DarStorageDisplayPath[\s\S]*?Project[\s\S]*?LOCALAPPDATA' },
        @{ Name='Storage inventory records WAL and BYTEA attachment accounting'; Text=$storageModule; Pattern='WAL files are contained[\s\S]*?BYTEA values' },
        @{ Name='Storage report distinguishes logical file length from allocated disk usage'; Text=$storageModule; Pattern='logical sum of FileInfo\.Length.*NTFS compression.*sparse allocation' },
        @{ Name='Storage inventory does not mutate files or start services'; Text=$storageModule; Pattern='(?im)^\s*(New-Item|Remove-Item|Move-Item|Copy-Item|Start-Process|Stop-Process|Start-Service|Stop-Service)\b'; Negative=$true },
        @{ Name='Storage inventory does not connect to PostgreSQL or execute SQL'; Text=$storageModule; Pattern='Invoke-DarPgTool|psql\.exe|BEGIN READ ONLY|SELECT .*FROM'; Negative=$true },
        @{ Name='Storage scan rejects reparse-point ancestors as well as the root'; Text=$storageModule; Pattern='Get-DarStorageReparseAncestor[\s\S]*?DirectoryInfo[\s\S]*?ReparsePoint' },
        @{ Name='Missing and partial locations make the total a lower bound'; Text=$storageModule; Pattern="Status -in @\('Partial','UnsafeRoot','Missing'\)" },
        @{ Name='Storage volume roots are de-duplicated with a case-insensitive set'; Text=$storageModule; Pattern='HashSet\[string\]\]::new.*OrdinalIgnoreCase' },
        @{ Name='Storage Center uses 5 GB Critical and 15 GB Warning thresholds'; Text=$storageModule; Pattern='Get-DarStorageFreeSpaceStatus[\s\S]*?5GB[\s\S]*?15GB' },
        @{ Name='Storage volume used bytes are based on physical free space'; Text=$storageModule; Pattern='TotalFreeSpace[\s\S]*?UsedBytes=\(\[long\]\(\$total - \$physicalFree\)\)' },
        @{ Name='Storage volume distinguishes physical free from user-available space'; Text=$storageModule; Pattern='AvailableFreeSpace[\s\S]*?AvailableBytes=\$availableToUser' },
        @{ Name='Storage pressure threshold uses current-user available bytes'; Text=$storageModule; Pattern='Get-DarStorageFreeSpaceStatus -AvailableBytes \$availableToUser' },
        @{ Name='Storage volume masks UNC server and share names'; Text=$storageModule; Pattern='ConvertTo-DarStorageVolumeDisplayRoot[\s\S]*?Network volume' },
        @{ Name='Storage volume HashSet enumeration is Windows PowerShell compatible'; Text=$storageModule; Pattern='HashSet\[string\].*foreach \(\$root in @\(\$roots \| Sort-Object\)\)' },
        @{ Name='Storage volume enumeration does not depend on an unavailable HashSet ToArray method'; Text=$storageModule; Pattern='roots\.ToArray\(\)'; Negative=$true },
        @{ Name='Storage volume report hides user-defined drive labels'; Text=$storageModule; Pattern='VolumeLabel'; Negative=$true },
        @{ Name='Storage scan refuses a reparse-point root'; Text=$module; Pattern='rootInfo\.Attributes.*ReparsePoint' },
        @{ Name='Storage scan has a bounded file limit'; Text=$module; Pattern='MaxFiles\s*=\s*200000' },
        @{ Name='Storage report covers runtime, data, backups and logs'; Text=$module; Pattern='PostgreSQL runtime.*Database data and WAL.*Backup folder.*Log folder' },
        @{ Name='Storage report includes API, desktop and frontend build outputs'; Text=$module; Pattern='API build output.*Desktop host build output.*Frontend build output' },
        @{ Name='Storage report includes volume free-space thresholds'; Text=$module; Pattern='AvailableFreeSpace.*5GB.*15GB' },
        @{ Name='WAL size is reported without double-counting the database folder'; Text=$module; Pattern='WAL is already included in Database data folder size and is not added again' },
        @{ Name='Backup health validates PostgreSQL archives'; Text=$module; Pattern='Test-DarBackupArchive' },
        @{ Name='Backup health verifies SHA-256 metadata'; Text=$module; Pattern='Get-FileHash.*SHA256|Get-FileHash.*Sha256' },
        @{ Name='API offline while desktop is closed is advisory'; Text=$module; Pattern='API is offline; this is expected.*AffectsOverall \$false' },
        @{ Name='Overall status excludes explicitly advisory checks'; Text=$module; Pattern='affectsOverall -ne \$false' },
        @{ Name='Health report declares itself read-only'; Text=$module; Pattern='readOnly\s*=\s*\$true' },
        @{ Name='Health report duration uses a real Stopwatch'; Text=$module; Pattern='reportStopwatch\.ElapsedMilliseconds' },
        @{ Name='Health results do not expose a fabricated per-check zero duration'; Text=$module; Pattern='(?im)^\s*durationMs\s*='; Negative=$true },
        @{ Name='Health module contains no database mutation SQL'; Text=$module; Pattern='(?im)^\s*(INSERT|UPDATE|DELETE|ALTER|VACUUM|REINDEX|CREATE|DROP)\s'; Negative=$true },
        @{ Name='Health module never starts or stops services'; Text=$module; Pattern='Start-DarPostgresServer|Stop-DarPostgresServer|Ensure-DarLocalPostgres|Start-Process'; Negative=$true },
        @{ Name='Health report does not serialize secret object or passwords'; Text=$module; Pattern='(?im)^\s*(PostgresAdminPassword|AppPassword|Secrets|ConnectionString)\s*='; Negative=$true }
    )
    foreach ($check in $checks) {
        $matched = [regex]::IsMatch([string]$check.Text,[string]$check.Pattern,[System.Text.RegularExpressions.RegexOptions]::Singleline)
        if ($check.Negative) { $matched = -not $matched }
        if ($matched) { Write-Host ('PASS: ' + $check.Name) -ForegroundColor Green }
        else { Write-Host ('FAIL: ' + $check.Name) -ForegroundColor Red; $failed.Add([string]$check.Name) }
    }
    if ($failed.Count) { Write-Output 'DAR_TEST_RESULT=FAIL'; exit 1 }
    Write-Output 'DAR_TEST_RESULT=PASS'; exit 0
} catch {
    Write-Host ('FAIL: Health source checker error: ' + $_.Exception.Message) -ForegroundColor Red
    Write-Output 'DAR_TEST_RESULT=FAIL'; exit 1
}
