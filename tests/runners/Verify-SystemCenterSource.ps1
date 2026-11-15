$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$systemCenter = Join-Path $projectRoot 'tools\SystemCenter.ps1'
if (-not (Test-Path -LiteralPath $systemCenter -PathType Leaf)) { throw 'FAIL: tools\SystemCenter.ps1 is missing.' }
$source = Get-Content -LiteralPath $systemCenter -Raw -Encoding UTF8
$checks = @(
    @{ Name = 'FileSystemWatcher is used'; Pattern = 'System\.IO\.FileSystemWatcher' },
    @{ Name = 'Watcher notifications use Register-ObjectEvent'; Pattern = 'Register-ObjectEvent -InputObject \$script:Watcher' },
    @{ Name = 'Watcher events are passed to an in-memory queue'; Pattern = '\$Event\.MessageData\.Queue\.Enqueue' },
    @{ Name = 'Queued event dispatcher exists'; Pattern = '\$script:EventDispatchTimer\.Add_Tick\(\{ Drain-LogFileEvents \}\)' },
    @{ Name = 'Dispatcher is only an in-memory queue drain'; Pattern = '\$script:EventDispatchTimer\.Interval = 100' },
    @{ Name = 'Clear display action exists'; Pattern = 'مسح العرض' },
    @{ Name = 'Clear action preserves persistent logs'; Pattern = 'لم يتم حذف أي ملف سجل' },
    @{ Name = 'Unified System Center includes backup'; Pattern = 'New-DarDatabaseBackup' },
    @{ Name = 'System Center manual full backup writes a verified manifest'; Pattern = 'New-DarDatabaseBackup[\s\S]*?New-DarBackupManifest -BackupPath \$file\.FullName' },
    @{ Name = 'Unified System Center includes restore'; Pattern = 'Restore-DarDatabaseBackup' },
    @{ Name = 'Live following exists'; Pattern = 'النزول لآخر حدث تلقائيًا' },
    @{ Name = 'Log filtering exists'; Pattern = 'الأخطاء فقط' },
    @{ Name = 'UI thread crash logging exists'; Pattern = 'ThreadExceptionHandler' },
    @{ Name = 'Watcher startup errors are logged'; Pattern = 'system-center-crash\.log' }
)
foreach ($check in $checks) {
    if (-not [regex]::IsMatch($source, $check.Pattern)) { throw ('FAIL: ' + $check.Name) }
    Write-Host ('PASS: ' + $check.Name) -ForegroundColor Green
}
$required = @(
    'tools\Start-SystemCenter.ps1',
    'tests\runners\TestCenter.ps1',
    'tests\runners\Start-TestCenter.ps1',
    'COLLECT_DIAGNOSTICS.bat',
    'BUILD_DAR_FOR_REHEARSAL.bat',
    'tools\Build-DarForRehearsal.ps1',
    'tests\runners\Verify-BackupManifestAndRehearsalBuildSource.ps1',
    'docs\PROJECT_SESSION_LOG_AR.md',
    'docs\TESTING_GUIDE_AR.md',
    'tools\BackupScheduler.ps1',
    'tools\Invoke-AutomatedBackup.ps1',
    'backend\DarEltahfeez.Api\Services\SystemAdminService.cs',
    'tools\PostgresMaintenance.ps1',
    'tests\runners\Verify-PostgresMaintenanceSource.ps1',
    'tests\runners\Verify-PostgresMaintenanceRegression.ps1',
    'tests\runners\Verify-BackupSchedulerSource.ps1',
    'tests\runners\Verify-BackupRetention.ps1',
    'tests\runners\Verify-LaunchEncodingAndDrawString.ps1',
    'tests\runners\Verify-FinancialRounding.ps1',
    'tests\regression\financial-rounding\FinancialRoundingRegression.csproj',
    'tests\runners\Verify-CurrencyInputNormalization.ps1',
    'tests\runners\Verify-FinanceReadRedactionSource.ps1',
    'tests\runners\Verify-EnrollmentLifecycleAndCreateOnlyFinanceSource.ps1',
    'tests\runners\Verify-EnrollmentBillingLifecycleRegression.ps1',
    'tests\regression\sql\enrollment_month_eligibility.test.sql',
    'tests\regression\currency-input-normalization\CurrencyInputNormalizationRegression.csproj'
)
foreach ($relative in $required) {
    if (-not (Test-Path -LiteralPath (Join-Path $projectRoot $relative) -PathType Leaf)) {
        throw ('FAIL: Required project file is missing: ' + $relative)
    }
    Write-Host ('PASS: Required file exists: ' + $relative) -ForegroundColor Green
}
foreach ($obsolete in @('tools\LogMonitor.ps1','tools\DatabaseManager.ps1','START_DATABASE_MANAGER.bat')) {
    if (Test-Path -LiteralPath (Join-Path $projectRoot $obsolete)) {
        throw ('FAIL: Duplicate standalone utility remains: ' + $obsolete)
    }
}
$rootDocs = @(Get-ChildItem -LiteralPath $projectRoot -File | Where-Object { $_.Extension -in @('.md','.txt') })
if ($rootDocs.Count -gt 0) { throw 'FAIL: Loose Markdown/TXT files remain in the project root.' }
Write-Host 'PASS: No duplicate standalone utility launchers or loose root documentation remain.' -ForegroundColor Green

$testCenter = Get-Content -LiteralPath (Join-Path $projectRoot 'tests\runners\TestCenter.ps1') -Raw -Encoding UTF8
if ($testCenter -notmatch 'DAR_TEST_RESULT=\(PASS\|FAIL\|SKIP\)' -or $testCenter -notmatch '\$script:CurrentResult') {
    throw 'FAIL: Test Center does not consume explicit runner result markers.'
}
Write-Host 'PASS: Test Center consumes explicit runner result markers.' -ForegroundColor Green
$runnerFiles = @(
    'tests\runners\Verify-SystemCenterSource.ps1',
    'tests\runners\Verify-SystemCenterWatcher.ps1',
    'tests\runners\Verify-LoggingPipeline.ps1',
    'tests\runners\Run-TeacherAttendanceSnapshotTest.ps1',
    'tests\runners\Verify-BackupSchedulerSource.ps1',
    'tests\runners\Verify-BackupManifestAndRehearsalBuildSource.ps1',
    'tests\runners\Verify-BackupRetention.ps1',
    'tests\runners\Verify-LaunchEncodingAndDrawString.ps1',
    'tests\runners\Verify-PostgresMaintenanceSource.ps1',
    'tests\runners\Verify-PostgresMaintenanceRegression.ps1',
    'tests\runners\Verify-FinancialRounding.ps1',
    'tests\runners\Verify-CurrencyInputNormalization.ps1',
    'tests\runners\Verify-FinanceReadRedactionSource.ps1',
    'tests\runners\Verify-EnrollmentLifecycleAndCreateOnlyFinanceSource.ps1',
    'tests\runners\Verify-EnrollmentBillingLifecycleRegression.ps1'
)
foreach ($relative in $runnerFiles) {
    $runnerText = Get-Content -LiteralPath (Join-Path $projectRoot $relative) -Raw -Encoding UTF8
    if ($runnerText -notmatch 'DAR_TEST_RESULT=(PASS|FAIL|SKIP)') {
        throw ('FAIL: Explicit result marker is missing from ' + $relative)
    }
    Write-Host ('PASS: Runner result marker exists: ' + $relative) -ForegroundColor Green
}

Write-Output 'DAR_TEST_RESULT=PASS'
