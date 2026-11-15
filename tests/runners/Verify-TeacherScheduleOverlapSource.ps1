$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$files = @{
    Migration = 'database\012_teacher_schedule_no_overlap.sql'
    Domain = 'backend\DarEltahfeez.Api\DomainEndpoints.cs'
    SystemAdmin = 'backend\DarEltahfeez.Api\SystemAdminEndpoints.cs'
    RestoreValidator = 'tools\LocalPostgres.ps1'
    EnrollmentRunner = 'tests\runners\Verify-EnrollmentBillingLifecycleRegression.ps1'
    ScheduleSql = 'tests\regression\sql\teacher_schedule_overlap.test.sql'
    ScheduleRunner = 'tests\runners\Verify-TeacherScheduleOverlapRegression.ps1'
    Rehearsal = 'tests\runners\Invoke-MigrationRehearsal.ps1'
    Frontend = 'frontend\src\application\useDarApplication.ts'
    TestCenter = 'tests\runners\TestCenter.ps1'
    PreflightSql = 'tests\diagnostics\teacher_schedule_overlap_preflight.sql'
    PreflightRunner = 'tests\runners\Verify-TeacherScheduleOverlapPreflight.ps1'
    ScheduleInspectionSql = 'tests\diagnostics\teacher_schedule_inspection.sql'
    ScheduleInspectionRunner = 'tests\runners\Inspect-TeacherScheduleSlots.ps1'
    SchedulePage = 'frontend\src\pages\SchedulePage.tsx'
    CircleDialog = 'frontend\src\components\dialogs\CircleDialog.tsx'
    TimeInputCss = 'frontend\src\styles\students.css'
    RepairScript = 'tools\Repair-KnownTeacherScheduleOverlap.ps1'
    RepairSql = 'maintenance\repair_known_teacher_schedule_overlap.sql'
}
$source = @{}
foreach ($entry in $files.GetEnumerator()) {
    $path = Join-Path $projectRoot $entry.Value
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Required schedule-overlap source is missing: $($entry.Value)" }
    $source[$entry.Key] = [System.IO.File]::ReadAllText($path)
}

$m = $source.Migration
$d = $source.Domain
$systemAdmin = $source.SystemAdmin
$r = $source.RestoreValidator
$sql = $source.ScheduleSql
$runner = $source.ScheduleRunner
$enrollmentRunner = $source.EnrollmentRunner
$rehearsal = $source.Rehearsal
$frontend = $source.Frontend
$testCenter = $source.TestCenter
$preflightSql = $source.PreflightSql
$preflightRunner = $source.PreflightRunner
$repairScript = $source.RepairScript
$repairSql = $source.RepairSql

$checks = [ordered]@{
    'Migration 012 defines the shared volatile overlap helper for fresh post-lock snapshots' = $m.Contains('CREATE OR REPLACE FUNCTION public.dar_teacher_has_schedule_overlap') -and $m.Contains('RETURNS BOOLEAN') -and $m.Contains('VOLATILE')
    'Overlap comparison uses half-open intervals so exact adjacency is allowed' = $m.Contains('candidate.starts_at_seconds <') -and $m.Contains('< candidate.ends_at_seconds')
    'Weekly interval comparison handles the seven-day wrap boundary' = $m.Contains('-604800::NUMERIC') -and $m.Contains('604800::NUMERIC')
    'Migration checks existing active schedules before installing protection' = $m.Contains('Resolve any reported legacy conflicts before applying this migration') -and $m.Contains('dar_teacher_has_schedule_overlap(')
    'Schedule slot trigger protects insert and update operations' = $m.Contains('trg_circle_schedule_slots_teacher_overlap') -and $m.Contains('BEFORE INSERT OR UPDATE ON public.circle_schedule_slots')
    'Circle trigger revalidates teacher reassignment, activation and trash restoration' = $m.Contains('trg_circles_teacher_schedule_overlap') -and $m.Contains('BEFORE UPDATE OF teacher_id, is_active, is_trashed ON public.circles')
    'Both trigger paths use one transaction-level timetable mutation lock' = ([regex]::Matches($m, 'pg_advisory_xact_lock\(867530912345::BIGINT\)')).Count -eq 2
    'Overlap errors use a stable named check constraint for API translation' = $m.Contains("CONSTRAINT = 'ck_teacher_schedule_no_overlap'") -and $m.Contains("ERRCODE = '23514'")
    'Schedule creation translates overlap errors to HTTP conflict' = $d.Contains('ex.SqlState == "23514" && ex.ConstraintName == "ck_teacher_schedule_no_overlap"') -and $d.Contains('اختر وقتًا غير متداخل؛ يُسمح بالمواعيد المتتالية.')
    'Circle reassignment translates overlap errors to HTTP conflict' = $d.Contains('ex.SqlState=="23514" && ex.ConstraintName=="ck_teacher_schedule_no_overlap"') -and $d.Contains('لا يمكن إسناد هذه المعلمة للحلقة أو تفعيلها')
    'Trash restore translates timetable trigger errors to HTTP conflict and rolls back the restore transaction' = $systemAdmin.Contains('ex.SqlState == "23514" && ex.ConstraintName == "ck_teacher_schedule_no_overlap"') -and $systemAdmin.Contains('لا يمكن استعادة الحلقة أو الموعد') -and $systemAdmin.Contains('await tx.RollbackAsync(ct);')
    'Circle editor surfaces the first schedule conflict message returned by API' = $frontend.Contains('const firstScheduleError = scheduleErrors[0]') -and $frontend.Contains('تعذّر حفظ بعض المواعيد: ${firstScheduleError}')
    'Read-only preflight query strips PostgreSQL base64 line wraps and transports UTF-8 JSON without modifying rows' = $preflightSql.Contains('BEGIN TRANSACTION READ ONLY;') -and $preflightSql.Contains('translate(encode(convert_to(json_build_object(') -and $preflightSql.Contains("E'\n\r'") -and $preflightSql.Contains('circleAId') -and $preflightSql.Contains('circleBId') -and $preflightSql.Contains('FROM public.circle_schedule_slots') -and $preflightSql.Contains('CROSS JOIN LATERAL (VALUES') -and $preflightSql.Contains('COMMIT;') -and -not ($preflightSql -match '(?im)^\s*(INSERT|UPDATE|DELETE|MERGE|ALTER|DROP|TRUNCATE|CREATE)\b')
    'Preflight runner reads only the configured Dar database and never drops or creates databases' = $preflightRunner.Contains("'-d',") -and $preflightRunner.Contains('The query ran inside a READ ONLY transaction') -and $preflightRunner.Contains('ConvertFrom-Json') -and $preflightRunner.Contains('FromBase64String') -and $preflightRunner.Contains('[Console]::OutputEncoding') -and $preflightRunner.Contains("'-o',") -and $preflightRunner.Contains('$preflightOutputPath') -and $preflightRunner.Contains('WriteAllText($preflightOutputPath') -and $preflightRunner.Contains('ReadAllLines($preflightOutputPath, [System.Text.Encoding]::ASCII)') -and $preflightRunner.Contains('pager=off') -and $preflightRunner.Contains("'-X'") -and $preflightRunner.Contains('Remove-Item -LiteralPath $preflightOutputPath') -and $preflightRunner.Contains('Slot A:') -and $preflightRunner.Contains('Slot B:') -and $preflightRunner.Contains('Do not launch candidate r6.3 yet') -and -not ($preflightRunner -match '(?i)DROP DATABASE|CREATE DATABASE') -and -not ($preflightRunner -match '(?im)^\s*(?:initdb|createdb|dropdb)(?:\.exe)?\b')
    'Affected timetable inspection is read-only and targets the known circle/teacher' = $source.ScheduleInspectionSql.Contains('BEGIN TRANSACTION READ ONLY') -and $source.ScheduleInspectionSql.Contains('01a6c471-d6a3-4bc2-83d6-af9379d214de') -and $source.ScheduleInspectionSql.Contains('86f8e5af-19e8-4403-9431-3a6d6bf701ca') -and -not $source.ScheduleInspectionSql.Contains('UPDATE ') -and -not $source.ScheduleInspectionSql.Contains('DELETE ') -and -not $source.ScheduleInspectionSql.Contains('INSERT ')
    'Affected timetable inspection includes exact stored time, attendance counts and audit details' = $source.ScheduleInspectionSql.Contains('startsAtSeconds') -and $source.ScheduleInspectionSql.Contains('teacherAttendanceTotal') -and $source.ScheduleInspectionSql.Contains('studentAttendanceTotal') -and $source.ScheduleInspectionSql.Contains('auditEvents')
    'Test Center exposes the affected timetable inspection as Test 28' = $source.TestCenter.Contains("Id='28'") -and $source.TestCenter.Contains('Inspect-TeacherScheduleSlots.ps1') -and (Test-Path -LiteralPath (Join-Path $projectRoot $files.ScheduleInspectionRunner) -PathType Leaf)
    'Affected timetable inspection runner uses the validated Dar database, ASCII Base64 transport and no database creation/deletion' = $source.ScheduleInspectionRunner.Contains("'-d',") -and $source.ScheduleInspectionRunner.Contains("'-o',") -and $source.ScheduleInspectionRunner.Contains('FromBase64String') -and $source.ScheduleInspectionRunner.Contains('READ ONLY') -and -not ($source.ScheduleInspectionRunner -match '(?i)DROP DATABASE|CREATE DATABASE|initdb|createdb|dropdb')
    'Test Center reads redirected UTF-8 test output and falls back for legacy system-encoded logs' = $testCenter.Contains('UTF8Encoding]::new($false, $true)') -and $testCenter.Contains('GetString($bytes)') -and $testCenter.Contains('[System.Text.Encoding]::Default.GetString($bytes)')
    'Test Center exposes source, database, preflight and affected timetable diagnostic tests' = $testCenter.Contains("Id='25'") -and $testCenter.Contains("Id='26'") -and $testCenter.Contains("Id='27'") -and $testCenter.Contains("Id='28'") -and $testCenter.Contains('Verify-TeacherScheduleOverlapPreflight.ps1') -and $testCenter.Contains('Inspect-TeacherScheduleSlots.ps1')
    'Restore validator recognizes migration 012, its lookup index, helper signature and VOLATILE mode' = $r.Contains("'012_teacher_schedule_no_overlap' = @()") -and $r.Contains('ix_schedule_slots_active_day_lookup') -and $r.Contains("PredicatePattern='is_active.*is_trashed'") -and $r.Contains('dar_teacher_has_schedule_overlap') -and $r.Contains("Volatility='v'") -and $r.Contains('procedure_row.provolatile=required.volatility')
    'Restore validator checks both timetable protection triggers are present and enabled' = $r.Contains('trg_circle_schedule_slots_teacher_overlap') -and $r.Contains('trg_circles_teacher_schedule_overlap') -and $r.Contains('MissingRequiredTriggers') -and $r.Contains("trigger_row.tgenabled IN ('O','A')")
    'Migration rehearsal logical signature includes required trigger metadata' = $rehearsal.Contains('RequiredTriggerCount') -and $rehearsal.Contains('RequiredTriggers') -and $rehearsal.Contains('RequiredTriggerSpecifications')
    'Enrollment billing regression expects the current 12 migrations' = $enrollmentRunner.Contains('$migrationFiles.Count -ne 12')
    'SQL regression covers overlap, adjacency, same-circle overlap, reassignment and activation' = $sql.Contains('overlapping cross-circle schedule was accepted') -and $sql.Contains('Exact adjacency') -and $sql.Contains('same-circle schedule was accepted') -and $sql.Contains('teacher reassignment was accepted') -and $sql.Contains('circle activation was accepted')
    'SQL regression covers weekly boundary, circle/slot trash restoration, slot editing and inactive schedules' = $sql.Contains('Saturday/Sunday overlap was accepted') -and $sql.Contains('circle restoration was accepted') -and $sql.Contains('trash restoration was accepted') -and $sql.Contains('moving a slot into a conflict was accepted') -and $sql.Contains('conflicting slot reactivation was accepted') -and $sql.Contains('Deactivated timetable rows do not block')
    'Integration runner creates a unique disposable DB and drops only that DB' = $runner.Contains('dar_schedule_test_') -and $runner.Contains('DROP DATABASE IF EXISTS $databaseName WITH (FORCE)') -and $runner.Contains('$migrationFiles.Count -ne 12')
    'Integration runner does not initialize a missing PostgreSQL cluster' = $runner.Contains('The test will not run initdb') -and -not $runner.Contains('initdb.exe')
    'SchedulePage time input is explicitly left-to-right with 24-hour labeling' = $source.SchedulePage.Contains('dir="ltr" lang="en"') -and $source.SchedulePage.Contains('وقت البداية (24 ساعة)')
    'CircleDialog time input is explicitly left-to-right with accessible labeling' = $source.CircleDialog.Contains('dir="ltr" lang="en"') -and $source.CircleDialog.Contains('وقت البداية للموعد')
    'Global form styling keeps native time input segments left-to-right inside RTL pages' = $source.TimeInputCss.Contains('input[type="time"]') -and $source.TimeInputCss.Contains('direction:ltr') -and $source.TimeInputCss.Contains('unicode-bidi:isolate')
    'Known timetable repair is guarded by exact slot IDs, old values, full verified backup and explicit APPLY confirmation' = $repairScript.Contains("Read-Host 'للتطبيق اكتب APPLY") -and $repairScript.Contains('Test-DarBackupArchive') -and $repairScript.Contains('maintenance\repair_known_teacher_schedule_overlap.sql') -and $repairScript.Contains('Test-DarExpectedPostgresIdentity') -and $repairScript.Contains('pg_dump')
    'Known timetable repair updates only start times, checks conflicts, writes audit before/after and preserves linked attendance' = $repairSql.Contains('BEGIN;') -and $repairSql.Contains('starts_at = item.new_time') -and $repairSql.Contains('before_data, after_data') -and $repairSql.Contains('schedule.time.correct') -and $repairSql.Contains('attendanceRowsPreserved') -and $repairSql.Contains('867530912345') -and $repairSql.Contains('TIME ''00:07''') -and $repairSql.Contains('TIME ''07:00''') -and $repairSql.Contains('TIME ''00:10''') -and $repairSql.Contains('TIME ''10:00''') -and $repairSql.Contains('TIME ''00:11''') -and $repairSql.Contains('TIME ''11:00''')
}

$failed = 0
foreach ($entry in $checks.GetEnumerator()) {
    if ($entry.Value) { Write-Output "PASS: $($entry.Key)" }
    else { Write-Output "FAIL: $($entry.Key)"; $failed++ }
}
Write-Output ("Teacher schedule overlap source checks: PASS={0}; FAIL={1}" -f ($checks.Count - $failed), $failed)
if ($failed -gt 0) { Write-Output 'DAR_TEST_RESULT=FAIL'; exit 1 }
Write-Output 'DAR_TEST_RESULT=PASS'
exit 0
