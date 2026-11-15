#requires -Version 5.1
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false) } catch { }

$projectRoot = Split-Path -Parent $PSScriptRoot
$localPostgresPath = Join-Path $projectRoot 'tools\LocalPostgres.ps1'
$sqlPath = Join-Path $projectRoot 'maintenance\repair_known_teacher_schedule_overlap.sql'
foreach ($path in @($localPostgresPath, $sqlPath)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Required repair file is missing: $path" }
}
. $localPostgresPath

$paths = Get-DarLocalPaths
if (-not (Test-Path -LiteralPath $paths.Secrets -PathType Leaf) -or -not (Test-Path -LiteralPath (Join-Path $paths.Data 'PG_VERSION') -PathType Leaf)) {
    throw 'لم يتم العثور على قاعدة دار المحلية الموجودة وإعدادات اتصالها. لم يتم إنشاء قاعدة جديدة أو تهيئة PostgreSQL.'
}
$secrets = Get-DarDatabaseSecrets
Assert-DarDatabaseSecrets -Secrets $secrets
$script:DarPgBin = Get-DarPostgresBin -ProjectRoot $projectRoot
if ([string]::IsNullOrWhiteSpace([string]$script:DarPgBin)) { throw 'ملفات PostgreSQL المحلية غير متاحة. لم يتم تنزيل أو تثبيت أي محرك جديد.' }

$startupMutex = [System.Threading.Mutex]::new($false, 'Global\DarEltahfeez_Postgres_55432')
$ownsStartupMutex = $false
try {
    try { $ownsStartupMutex = $startupMutex.WaitOne([TimeSpan]::FromSeconds(30)) }
    catch [System.Threading.AbandonedMutexException] { $ownsStartupMutex = $true }
    if (-not $ownsStartupMutex) { throw 'هناك عملية أخرى تجهز PostgreSQL. أعد المحاولة بعد انتهائها.' }
    if (-not (Test-DarExpectedPostgresIdentity -Secrets $secrets -Paths $paths)) {
        Start-DarPostgresServer -Secrets $secrets -Paths $paths
    }
}
finally {
    if ($ownsStartupMutex) { $startupMutex.ReleaseMutex() }
    $startupMutex.Dispose()
}
if (-not (Test-DarExpectedPostgresIdentity -Secrets $secrets -Paths $paths)) { throw 'تعذر إثبات هوية قاعدة PostgreSQL المحلية الخاصة بدار.' }

Write-Host ''
Write-Host 'تصحيح المواعيد الثلاثة المعروفة — معاينة قبل التنفيذ' -ForegroundColor Cyan
Write-Host 'تعليمات ومراجعة الخطة: docs\REPAIR_KNOWN_TEACHER_SCHEDULE_OVERLAPS_AR.md' -ForegroundColor Gray
Write-Host 'حلقة: جزء تبارك | المعلمة: فخاد كبيرة | يوم الأحد | مدة كل حصة 60 دقيقة' -ForegroundColor Gray
Write-Host '  الموعد 5e3581db: 00:07  ->  07:00 صباحًا' -ForegroundColor White
Write-Host '  الموعد 78189952: 00:10  ->  10:00 صباحًا' -ForegroundColor White
Write-Host '  الموعد 4e0823c4: 00:11  ->  11:00 صباحًا' -ForegroundColor White
Write-Host ''
Write-Host 'سيتم تغيير وقت البداية فقط. لن تُحذف المواعيد ولن تتغير معرفاتها أو سجلات الحضور أو المستحقات.' -ForegroundColor Green
Write-Host 'سيتم إنشاء نسخة PostgreSQL كاملة والتحقق منها أولًا، ثم تسجيل before/after في سجل التدقيق.' -ForegroundColor Green
Write-Host ''
$confirmation = Read-Host 'للتطبيق اكتب APPLY بالحروف الإنجليزية، أو أي شيء آخر للإلغاء'
if ($confirmation -cne 'APPLY') {
    Write-Host 'تم الإلغاء. لم تتغير قاعدة البيانات.' -ForegroundColor Yellow
    exit 0
}

$backupFolder = [string]$paths.BackupFolder
New-Item -ItemType Directory -Force -Path $backupFolder | Out-Null
$backupPath = Join-Path $backupFolder ('Dar-before-timetable-repair-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0,8) + '.backup')
Write-Host 'إنشاء نسخة احتياطية كاملة والتحقق منها...' -ForegroundColor Cyan
$dump = Invoke-DarPgTool -Tool 'pg_dump' -Arguments @(
    '-h','127.0.0.1','-p',[string]$secrets.Port,'-U',[string]$secrets.AppUser,
    '-d',[string]$secrets.Database,'-F','c','--no-owner','--no-acl','-f',$backupPath
) -Password ([string]$secrets.AppPassword)
if ($dump.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $backupPath -PathType Leaf)) { throw 'فشل إنشاء النسخة الاحتياطية. لم يتم تعديل مواعيد الدار.' }
Test-DarBackupArchive -BackupPath $backupPath -RequiredTables @('app_users','students','teachers','circles','circle_schedule_slots','teacher_attendance','student_attendance','audit_log')
Write-Host "تم التحقق من النسخة الاحتياطية: $backupPath" -ForegroundColor Green

Write-Host 'تطبيق التصحيح داخل Transaction واحدة...' -ForegroundColor Cyan
$repairResult = Invoke-DarPgTool -Tool 'psql' -Arguments @(
    '-X','-h','127.0.0.1','-p',[string]$secrets.Port,'-U',[string]$secrets.AppUser,
    '-d',[string]$secrets.Database,'-q','-v','ON_ERROR_STOP=1','-f',$sqlPath
) -Password ([string]$secrets.AppPassword)
if ($repairResult.ExitCode -ne 0) {
    $detail = (@($repairResult.Output) | ForEach-Object { [string]$_ }) -join [Environment]::NewLine
    throw "فشل التصحيح وتراجعت Transaction دون تطبيق جزئي. النسخة الاحتياطية محفوظة: $backupPath`r`n$detail"
}

$verifySql = "SELECT id::text || '|' || to_char(starts_at,'HH24:MI') FROM public.circle_schedule_slots WHERE id IN ('5e3581db-6aef-48fa-9abb-e1d9b0f8f474','78189952-a897-4a6d-b838-42e0037e5ccb','4e0823c4-5667-4526-9038-47fdf8602e83') ORDER BY CASE id WHEN '5e3581db-6aef-48fa-9abb-e1d9b0f8f474' THEN 1 WHEN '78189952-a897-4a6d-b838-42e0037e5ccb' THEN 2 ELSE 3 END;"
$verified = Invoke-DarPgTool -Tool 'psql' -Arguments @('-X','-h','127.0.0.1','-p',[string]$secrets.Port,'-U',[string]$secrets.AppUser,'-d',[string]$secrets.Database,'-qAt','-F','|','-v','ON_ERROR_STOP=1','-c',$verifySql) -Password ([string]$secrets.AppPassword)
if ($verified.ExitCode -ne 0) { throw "تعذر التحقق من الأوقات بعد التصحيح. النسخة الاحتياطية محفوظة: $backupPath" }
$expected = @(
    '5e3581db-6aef-48fa-9abb-e1d9b0f8f474|07:00',
    '78189952-a897-4a6d-b838-42e0037e5ccb|10:00',
    '4e0823c4-5667-4526-9038-47fdf8602e83|11:00'
)
$actual = @($verified.Output | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ })
if ($actual.Count -ne 3 -or @(Compare-Object $expected $actual).Count -ne 0) {
    throw "التصحيح تم لكن نتيجة القراءة اللاحقة لا تطابق الخطة المتوقعة. لا تكرر العملية؛ النسخة الاحتياطية: $backupPath"
}

Write-Host ''
Write-Host 'اكتمل التصحيح بنجاح.' -ForegroundColor Green
Write-Host 'تم الاحتفاظ بمعرفات المواعيد وسجلات الحضور والطلاب والمستحقات كما هي.' -ForegroundColor Green
Write-Host 'النسخة الاحتياطية: ' $backupPath -ForegroundColor Green
Write-Host 'الخطوة التالية: افتح Test Center وشغّل Test 27؛ المتوقع PASS إذا لم توجد تعارضات أخرى.' -ForegroundColor Cyan
exit 0
