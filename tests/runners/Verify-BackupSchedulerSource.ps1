$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$schedulerPath = Join-Path $projectRoot 'tools\BackupScheduler.ps1'
$runnerPath = Join-Path $projectRoot 'tools\Invoke-AutomatedBackup.ps1'
$localDbPath = Join-Path $projectRoot 'tools\LocalPostgres.ps1'
$systemCenterPath = Join-Path $projectRoot 'tools\SystemCenter.ps1'
$systemCenterLauncherPath = Join-Path $projectRoot 'tools\Start-SystemCenter.ps1'
$programPath = Join-Path $projectRoot 'backend\DarEltahfeez.Api\Program.cs'
$adminServicePath = Join-Path $projectRoot 'backend\DarEltahfeez.Api\Services\SystemAdminService.cs'
$frontendAdminPath = Join-Path $projectRoot 'frontend\src\SystemAdminView.tsx'
foreach ($path in @($schedulerPath,$runnerPath,$localDbPath,$systemCenterPath,$systemCenterLauncherPath,$programPath,$adminServicePath,$frontendAdminPath)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "FAIL: Missing required backup scheduler source file: $path" }
}
$scheduler = Get-Content -LiteralPath $schedulerPath -Raw -Encoding UTF8
$localDb = Get-Content -LiteralPath $localDbPath -Raw -Encoding UTF8
$runner = Get-Content -LiteralPath $runnerPath -Raw -Encoding UTF8
$systemCenter = Get-Content -LiteralPath $systemCenterPath -Raw -Encoding UTF8
$systemCenterLauncher = Get-Content -LiteralPath $systemCenterLauncherPath -Raw -Encoding UTF8
$program = Get-Content -LiteralPath $programPath -Raw -Encoding UTF8
$adminService = Get-Content -LiteralPath $adminServicePath -Raw -Encoding UTF8
$frontendAdmin = Get-Content -LiteralPath $frontendAdminPath -Raw -Encoding UTF8
$checks = @(
    @{ Name='Windows Task Scheduler registration exists'; Text=$scheduler; Pattern='Register-ScheduledTask' },
    @{ Name='Task uses the current interactive user token without elevation'; Text=$scheduler; Pattern='-LogonType Interactive -RunLevel Limited' },
    @{ Name='Schedule metadata identifies the Windows user without an ambiguous RunAs field'; Text=$scheduler; Pattern='WindowsUser = \[Security\.Principal\.WindowsIdentity\]::GetCurrent\(\)\.Name' },
    @{ Name='Missed runs start when the machine becomes available'; Text=$scheduler; Pattern='-StartWhenAvailable' },
    @{ Name='Task can wake a sleeping machine'; Text=$scheduler; Pattern='-WakeToRun' },
    @{ Name='Overlapping scheduled runs are ignored'; Text=$scheduler; Pattern='-MultipleInstances IgnoreNew' },
    @{ Name='Independent runner loads PostgreSQL helpers'; Text=$runner; Pattern='\. \$localPostgresScript' },
    @{ Name='Independent runner loads the shared backup scheduler module'; Text=$runner; Pattern='\. \$schedulerModule' },
    @{ Name='Scheduler payload includes BackupScheduler.ps1'; Text=$scheduler; Pattern='SchedulerModule = Join-Path \$root' },
    @{ Name='Scheduled runner re-resolves the active backup folder after acquiring the shared mutex'; Text=$runner; Pattern='WaitOne\(0\)[\s\S]*?\$paths = Get-DarLocalPaths[\s\S]*?New-Item -ItemType Directory -Force -Path \$paths\.BackupFolder' },
    @{ Name='Runner refuses to initialize a new database'; Text=$runner; Pattern='PG_VERSION' },
    @{ Name='Runner calls the shared verified full-backup routine'; Text=$runner; Pattern='New-DarDatabaseBackup' },
    @{ Name='Runner writes SHA-256 metadata through the shared completed-manifest helper'; Text=$runner; Pattern='New-DarBackupManifest -BackupPath \$finalPath -Secrets \$secrets' },
    @{ Name='Retention requires a validated PostgreSQL custom archive manifest'; Text=$scheduler; Pattern="Validation -ne 'pg_restore --list passed'.*ArchiveFormat -ne 'PostgreSQL Custom'" },
    @{ Name='A failed run removes only its own partial automatic backup'; Text=$runner; Pattern='DarEltahfeez_AUTO_.*backup.*partial' },
    @{ Name='Retention verifies SHA-256 before marking a backup for deletion'; Text=$scheduler; Pattern='Get-FileHash.*SHA256' },
    @{ Name='Retention is restricted to automatic backup names'; Text=$runner; Pattern='DarEltahfeez_AUTO_' },
    @{ Name='System Center exposes schedule management'; Text=$systemCenter; Pattern='Set-DarBackupSchedule' },
    @{ Name='System Center exposes manual background backup'; Text=$systemCenter; Pattern='Start-DarBackupNow' },
    @{ Name='Manual background backup refreshes all helper scripts'; Text=$scheduler; Pattern='Start-DarBackupNow\(\[string\]\$SourceToolsPath\)' },
    @{ Name='Manual backup handler avoids reserved PID variable'; Text=$systemCenter; Pattern='\$backupProcessId = Start-DarBackupNow' },
    @{ Name='Manual backup starts a same-user background process without RunAs elevation'; Text=$scheduler; Pattern='Start-Process -FilePath \$powerShell -ArgumentList \$argumentLine -WorkingDirectory \$paths.Root -WindowStyle Hidden -PassThru' },
    @{ Name='Manual backup bootstraps a disabled config when no schedule was saved'; Text=$scheduler; Pattern='Enabled = \$false' },
    @{ Name='Scheduler payload refresh copies the retention module even when schedule is disabled'; Text=$scheduler; Pattern='Copy-DarBackupPayloadAtomically -Source \$sourceSchedulerModule -Destination \$paths.SchedulerModule' },
    @{ Name='Backup runner labels manual and scheduled backup runs'; Text=$runner; Pattern='\$runTypeLabel = if \(\$Manual\)' },
    @{ Name='Backup runner records retention-plan summary'; Text=$runner; Pattern='Retention plan completed\. Kept=' },
    @{ Name='System Center includes app-branded dialog component'; Text=$systemCenter; Pattern='function Show-DarDialog' },
    @{ Name='System Center displays Task Scheduler last result code'; Text=$systemCenter; Pattern='LastTaskResult|آخر رمز نتيجة من Task Scheduler' },
    @{ Name='Scheduler payload files are copied atomically and hash-verified'; Text=$scheduler; Pattern='Copy-DarBackupPayloadAtomically' },
    @{ Name='System Center uses app-branded dialogs rather than default MessageBox'; Text=$systemCenter; Pattern='Show-DarDialog' },
    @{ Name='System Center dialogs do not use native Windows title bars'; Text=$systemCenter; Pattern='FormBorderStyle\]::None' },
    @{ Name='Schedule log opens in the integrated live console'; Text=$systemCenter; Pattern='\$tabs\.SelectedTab = \$logPage.*\$script:sourceCombo\.SelectedIndex = 6' },
    @{ Name='Schedule guidance matches Interactive Limited user session'; Text=$systemCenter; Pattern='Interactive / Limited' },
    @{ Name='Manual backup screen explains that scheduled backups are external'; Text=$frontendAdmin; Pattern='النسخ المجدولة المستقلة تُدار من Dar System Center' },
    @{ Name='PostgreSQL startup uses a cross-session global mutex'; Text=$localDb; Pattern='Global\\DarEltahfeez_Postgres_55432' },
    @{ Name='Scheduled backup runner shares the PostgreSQL startup mutex'; Text=$runner; Pattern='Global\\DarEltahfeez_Postgres_55432' },
    @{ Name='Local AppData path has a Windows profile fallback'; Text=$localDb; Pattern='GetFolderPath\(\[Environment\+SpecialFolder\]::LocalApplicationData\)' }
)
foreach ($check in $checks) {
    if (-not [regex]::IsMatch($check.Text,$check.Pattern,[System.Text.RegularExpressions.RegexOptions]::Singleline)) { throw "FAIL: $($check.Name)" }
    Write-Host "PASS: $($check.Name)" -ForegroundColor Green
}
if ($runner -match '(?i)\b(initdb|New-DarDatabase)\b') { throw 'FAIL: Scheduled backup runner contains a database initialization/create command.' }
if ($runner -match '127\.0\.0\.1:5080|/api/') { throw 'FAIL: Scheduled backup runner depends on the application API.' }
if ($program -match 'AddHostedService<BackupSchedulerService>|BackupSchedulerService') { throw 'FAIL: Legacy API-bound automatic backup worker is still registered or present.' }
if ($adminService -match 'AutoBackupDueAsync|class BackupSchedulerService') { throw 'FAIL: Legacy in-process backup scheduler remains in the API service.' }
if ($frontendAdmin -match 'النسخ التلقائي يبدأ بعد تشغيل الـBackend|يتطلب بقاء التطبيق وقاعدة البيانات المحلية قيد التشغيل') { throw 'FAIL: The manual backup page still shows obsolete API-bound automatic-backup guidance.' }
if ($runner -notmatch 'Get-DarBackupRetentionPlan') { throw 'FAIL: Independent backup runner does not invoke the retention planner.' }
if ($systemCenter -match '(?im)^\s*\$pid\s*=') { throw 'FAIL: System Center assigns to PowerShell reserved variable PID.' }
if ($systemCenter -match 'MessageBox\]::Show') { throw 'FAIL: Native MessageBox remains in the main System Center workflow.' }
if ($systemCenterLauncher -match 'MessageBox\]::Show') { throw 'FAIL: Startup wrapper still shows the default Windows MessageBox.' }
if ($systemCenter -match 'Start-Process notepad\.exe') { throw 'FAIL: Schedule log button still opens an external Notepad window.' }
if ($scheduler -match '-LogonType S4U') { throw 'FAIL: Scheduled task still uses the S4U logon type.' }
if ($scheduler -match '(?im)^\s*RunAs\s*=') { throw 'FAIL: Schedule config still uses the ambiguous RunAs metadata field.' }
if ($systemCenter -match '(?i)S4U') { throw 'FAIL: System Center schedule guidance still references S4U.' }
if ($scheduler -match '(?im)^\s*\$pid\s*=') { throw 'FAIL: Backup scheduler assigns to PowerShell reserved variable PID.' }
if ($scheduler -match 'Verb\s*=\s*[\x27\x22]RunAs') { throw 'FAIL: Manual backup unexpectedly requests elevation.' }
Write-Host 'PASS: Scheduled backup has no API dependency and cannot initialize an empty database.' -ForegroundColor Green
Write-Output 'DAR_TEST_RESULT=PASS'
