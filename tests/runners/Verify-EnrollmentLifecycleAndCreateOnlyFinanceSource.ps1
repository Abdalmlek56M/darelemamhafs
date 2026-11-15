$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$paths = @{
    Domain = 'backend\DarEltahfeez.Api\DomainEndpoints.cs'
    Types = 'frontend\src\domain\types.ts'
    Application = 'frontend\src\application\useDarApplication.ts'
    CircleDialog = 'frontend\src\components\dialogs\CircleDetailsDialog.tsx'
    AttendanceDialog = 'frontend\src\components\dialogs\StudentAttendanceDialog.tsx'
    StudentDialog = 'frontend\src\components\dialogs\StudentDialog.tsx'
    StudentHistoryDialog = 'frontend\src\components\dialogs\StudentHistoryDialog.tsx'
    EnrollmentDialog = 'frontend\src\components\dialogs\EnrollmentDialog.tsx'
    StudentPage = 'frontend\src\pages\StudentsPage.tsx'
    PaymentsPage = 'frontend\src\pages\PaymentsPage.tsx'
    FinancePanel = 'frontend\src\components\FinanceEntryCreateOnlyPanel.tsx'
    LifecycleIndexMigration = 'database\011_enrollment_lifecycle_audit_index.sql'
    RestoreValidator = 'tools\LocalPostgres.ps1'
    SqlRegression = 'tests\regression\sql\enrollment_month_eligibility.test.sql'
    BillingRunner = 'tests\runners\Verify-EnrollmentBillingLifecycleRegression.ps1'
}
$source = @{}
foreach ($entry in $paths.GetEnumerator()) {
    $full = Join-Path $projectRoot $entry.Value
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) {
        Write-Output "FAIL: Required lifecycle/finance source missing: $($entry.Value)"
        Write-Output 'DAR_TEST_RESULT=FAIL'
        exit 1
    }
    $source[$entry.Key] = [System.IO.File]::ReadAllText($full)
}
$d = $source.Domain
$a = $source.Application
$c = $source.CircleDialog
$att = $source.AttendanceDialog
$sd = $source.StudentDialog
$shd = $source.StudentHistoryDialog
$ed = $source.EnrollmentDialog
$sp = $source.StudentPage
$pp = $source.PaymentsPage
$fp = $source.FinancePanel
$indexMigration = $source.LifecycleIndexMigration
$restoreValidator = $source.RestoreValidator
$sql = $source.SqlRegression
$billingRunner = $source.BillingRunner
$financeOptionsStart = $d.IndexOf('app.MapGet("/api/finance-entry-options"')
$financeOptionsEnd = $d.IndexOf('app.MapGet("/api/collections"', $financeOptionsStart)
$chargeCreateStart = $d.IndexOf('app.MapPost("/api/charges"')
$chargeCreateEnd = $d.IndexOf('app.MapDelete("/api/charges/', $chargeCreateStart)
if ($financeOptionsStart -lt 0 -or $financeOptionsEnd -le $financeOptionsStart -or $chargeCreateStart -lt 0 -or $chargeCreateEnd -le $chargeCreateStart) {
    Write-Output 'FAIL: Could not isolate finance create-only API source blocks.'
    Write-Output 'DAR_TEST_RESULT=FAIL'
    exit 1
}
$financeOptionsSource = $d.Substring($financeOptionsStart, $financeOptionsEnd - $financeOptionsStart)
$chargeCreateSource = $d.Substring($chargeCreateStart, $chargeCreateEnd - $chargeCreateStart)
$pauseStart = $d.IndexOf('app.MapPatch("/api/enrollments/{id:guid}/pause"')
$resumeStart = $d.IndexOf('app.MapPatch("/api/enrollments/{id:guid}/resume"')
$endStart = $d.IndexOf('app.MapPatch("/api/enrollments/{id:guid}/end"')
if ($pauseStart -lt 0 -or $resumeStart -le $pauseStart -or $endStart -le $resumeStart) {
    Write-Output 'FAIL: Could not isolate enrollment pause, resume and end API source blocks.'
    Write-Output 'DAR_TEST_RESULT=FAIL'
    exit 1
}
$pauseSource = $d.Substring($pauseStart, $resumeStart - $pauseStart)
$resumeSource = $d.Substring($resumeStart, $endStart - $resumeStart)
$studentProjectionStart = $d.IndexOf('private const string StudentProjection =')
$studentProjectionEnd = $d.IndexOf('FROM students s', $studentProjectionStart)
if ($studentProjectionStart -lt 0 -or $studentProjectionEnd -le $studentProjectionStart) {
    Write-Output 'FAIL: Could not isolate StudentProjection.'
    Write-Output 'DAR_TEST_RESULT=FAIL'
    exit 1
}
$studentProjectionSource = $d.Substring($studentProjectionStart, $studentProjectionEnd - $studentProjectionStart)

$checks = [ordered]@{
    'Enrollment API exposes separate pause and resume operations' = $d.Contains('app.MapPatch("/api/enrollments/{id:guid}/pause"') -and $d.Contains('app.MapPatch("/api/enrollments/{id:guid}/resume"')
    'Student update status lookup creates and disposes NpgsqlCommand synchronously, then awaits execution' = $d.Contains('await using var currentStatus = db.CreateCommand("SELECT status FROM students WHERE id=@id AND is_trashed=FALSE;");') -and $d.Contains('var savedStatus = (await currentStatus.ExecuteScalarAsync(ct)) as string;') -and -not $d.Contains('var currentStatus = await db.CreateCommand(')
    'Lifecycle database regression suppresses expected NOTICE only and restores prior PGOPTIONS' = $billingRunner.Contains('client_min_messages=warning') -and $billingRunner.Contains('$env:PGOPTIONS = $previousPgOptions') -and $billingRunner.Contains('WARNING and above remain visible')
    'Pause and resume endpoints require student edit permission' = $pauseSource.Contains('}).RequireAuthorization("students.edit");') -and $resumeSource.Contains('}).RequireAuthorization("students.edit");')
    'Enrollment lifecycle events preserve baseline, pause, resume and end dates' = $d.Contains('enrollment.status.baseline') -and $d.Contains('enrollment.pause') -and $d.Contains('enrollment.resume') -and $d.Contains('enrollment.end') -and $d.Contains("'effectiveOn',@effectiveOn")
    'Lifecycle transitions reject out-of-order effective dates' = $d.Contains('GetLatestEnrollmentStatusDateAsync') -and $d.Contains('لا يمكن تسجيل تغيير حالة بتاريخ يسبق آخر تغيير مسجل') -and $d.Contains('لا يمكن تسجيل الاستئناف بتاريخ يسبق آخر تغيير حالة مسجل')
    'Final withdrawal ends every active or paused enrollment in one transaction' = $d.Contains('request.Status == "withdrawn"') -and $d.Contains("status IN ('active','paused') ORDER BY starts_on,id FOR UPDATE") -and $d.Contains('إنهاء جميع الالتحاقات بسبب الانسحاب النهائي من الدار')
    'Student status date cannot predate the student record' = $d.Contains('effectiveOn < studentJoinedOn')
    'Student archive is blocked while active or paused enrollments remain' = $d.Contains('request.Status == "archived"') -and $d.Contains("status IN ('active','paused')") -and $d.Contains('لا يمكن أرشفة الطالب قبل إنهاء جميع الالتحاقات النشطة أو المتوقفة مؤقتًا.')
    'Roster uses the shared date-effective enrollment status function and exposes the resulting eligibility reason' = $d.Contains('SELECT public.dar_enrollment_status_at_date(ce.id,@date) AS status_at_date') -and $d.Contains('lifecycle.status_at_date') -and $d.Contains('eligibility_reason') -and $d.Contains('eligibilityReason=reader.IsDBNull(7)?null:reader.GetString(7)')
    'Paused enrollment is excluded from eligibility at the paused interval' = $d.Contains('dar_enrollment_is_attendance_eligible_on_date') -and $d.Contains("THEN 'paused'")
    'Historical attendance override cannot bypass a paused state, circle start or end boundary' = $d.Contains('dar_enrollment_is_attendance_eligible_on_date(ce.id,@date)') -and $d.Contains('attendance_circle.starts_on<=@date') -and $d.Contains('(ce.ends_on IS NULL OR @date<=ce.ends_on)') -and $d.Contains('request.SessionDate>DateOnly.FromDateTime(DateTime.Today)')
    'Session summary excludes paused enrollments and circles not yet started from active current roster counts' = $d.Contains("BOOL_OR(ce.status='active' AND (ce.ends_on IS NULL OR ce.ends_on>=CURRENT_DATE) AND session_circle.starts_on<=CURRENT_DATE) AS is_current_roster")
    'Legacy paused rows preserve past attendance until a reliable pause date exists' = $d.Contains('لا يتوفر تاريخ موثوق للإيقاف القديم') -and $d.Contains('تثبيت حالة الإيقاف القديمة من تاريخ تفعيل سجل الحالات')
    'Circle details UI exposes per-enrollment pause, resume and end actions' = $c.Contains('ctx.pauseEnrollment') -and $c.Contains('ctx.resumeEnrollment') -and $c.Contains('title="إنهاء الالتحاق مع حفظ تاريخه"')
    'Student history distinguishes active, paused and ended enrollments and exposes their actions' = $shd.Contains("const paused=en.status==='paused'") -and $shd.Contains('متوقف مؤقتًا') -and $shd.Contains('ctx.pauseEnrollment') -and $shd.Contains('ctx.resumeEnrollment') -and $shd.Contains("history.student.status==='active'")
    'New enrollment selector excludes administratively paused, withdrawn and archived students' = $ed.Contains("ctx.students.filter(s=>s.status==='active')")
    'Application confirms per-enrollment actions and refreshes student/circle/collection views' = $a.Contains('سيتم إيقاف التحاق') -and $a.Contains('سيُستأنف التحاق') -and $a.Contains('refreshEnrollmentViews')
    'Attendance UI marks paused intervals and does not offer an attendance editor' = $att.Contains("row.eligibilityReason === 'paused'") -and $att.Contains('لا يمكن تسجيل حضور خلال فترة الإيقاف')
    'Historical attendance UI override is limited to dates before enrollment start; circle start, pause and end remain read-only' = $att.Contains("row.eligibilityReason === 'before-enrollment-start'") -and $att.Contains("allowHistoricalEntry: row.eligibilityReason === 'before-enrollment-start'") -and $att.Contains('لا يمكن تسجيل حضور خلال فترة الإيقاف') -and $att.Contains('التاريخ بعد نهاية الالتحاق') -and $att.Contains('الحلقة لم تبدأ في هذا التاريخ')
    'Final withdrawal is explicitly confirmed and names the all-enrollment effect' = $a.Contains('الانسحاب النهائي للطالب') -and $a.Contains('سينهي جميع التحاقات الطالب النشطة والمتوقفة')
    'Student edit form cannot bypass the dedicated status transition endpoint' = $sd.Contains('الحالة الحالية') -and $sd.Contains('تُغيّر الحالة من قائمة الحالة في سجل الطلاب')
    'Administrative student pause is distinguished from per-enrollment pause' = $sp.Contains('الإيقاف الإداري لا يوقف التحاقات الحلقات')
    'Student current-month financial summary retains existing charges after enrollment pause or end' = ([regex]::Matches($studentProjectionSource, "ce.status='active'")).Count -eq 1 -and $studentProjectionSource.Contains('COALESCE((SELECT SUM(mc.amount_due) FROM circle_enrollments ce')
    'Create-only financial options endpoint requires finance.create' = $d.Contains('app.MapGet("/api/finance-entry-options"') -and $d.Contains('}).RequireAuthorization("finance.create");')
    'Create-only financial options expose identifiers and names without monetary fields' = $d.Contains('var enrollments = new List<object>()') -and $d.Contains('var charges = new List<object>()') -and $d.Contains('identity and opaque record IDs only; no fees, payments, balances or payment status') -and $d.Contains('monthlyChargeId=reader.GetGuid(0), studentCode=reader.GetString(1)')
    'Enrollment creation blocks a second active or paused row in the same circle' = $d.Contains("status IN ('active','paused')") -and $d.Contains('الطالب لديه بالفعل التحاق نشط أو متوقف مؤقتًا بهذه الحلقة')
    'Create-only enrollment options use date-effective lifecycle history and avoid duplicate charges without global student status leakage' = $financeOptionsSource.Contains('public.dar_enrollment_has_active_day_in_month(ce.id,@month)') -and $indexMigration.Contains('al.action_code IN (''enrollment.status.baseline'',''enrollment.pause'',''enrollment.resume'',''enrollment.end'')') -and -not $financeOptionsSource.Contains("s.status='active'") -and $financeOptionsSource.Contains('NOT EXISTS(SELECT 1 FROM monthly_charges existing_charge')
    'Charge creation permits a billed month with active days even if the enrollment later paused or ended, while excluding fully paused months' = $chargeCreateSource.Contains('public.dar_enrollment_has_active_day_in_month(ce.id,@month)') -and $indexMigration.Contains('dar_enrollment_status_at_date') -and $indexMigration.Contains('dar_enrollment_has_active_day_in_month') -and $indexMigration.Contains('dar_enrollment_is_attendance_eligible_on_date')
    'Create-only empty state describes eligible days instead of claiming the enrollment must be currently active' = $fp.Contains('لا توجد التحاقات لها أيام نشاط مؤهلة في الشهر المحدد') -and -not $fp.Contains('لا توجد التحاقات نشطة متاحة')
    'Charge and payment endpoints support finance.create and redact response amounts' = $d.Contains('amountDue=CanReadFinance(principal) ? amountDue : (decimal?)null') -and $d.Contains('amount=CanReadFinance(principal) ? paymentAmount : (decimal?)null') -and $d.Contains('amount=CanReadFinance(principal) ? amount : (decimal?)null')
    'Payments page mounts create-only entry UI only when finance.read is absent' = $pp.Contains("!canReadFinance && ctx.has('finance.create') && <FinanceEntryCreateOnlyPanel ctx={ctx}/>")
    'Create-only panel does not fetch or render ledgers, balances, due/paid amounts or reports' = $fp.Contains('/api/finance-entry-options?month=') -and -not $fp.Contains('/api/collections') -and -not $fp.Contains('balance') -and -not $fp.Contains('paidAmount') -and $fp.Contains('amountDue: parsedAmount')
    'Create-only panel can submit charge and payment requests including optional receipt' = $fp.Contains("request('/api/charges'") -and $fp.Contains("request('/api/payments'") -and $fp.Contains("requestForm('/api/payments/with-receipt'")
    'Create-only panel states that server enforces outstanding amount without disclosing it' = $fp.Contains('يتحقق الخادم من صحة المبلغ ويمنع التحصيل الزائد') -and $fp.Contains('لا يعرض هذا النموذج قيمة الاستحقاق أو المدفوعات أو الرصيد')
    'Create-only charge options do not filter by paid amount or expose payment state through option presence' = -not $d.Contains('mc.amount_due>COALESCE((SELECT SUM(p.amount)') -and $d.Contains('SELECT mc.id,s.student_code,s.full_name,c.name,mc.billing_month')
    'Monthly charge options and creation call the same database eligibility helper' = $financeOptionsSource.Contains('public.dar_enrollment_has_active_day_in_month(ce.id,@month)') -and $chargeCreateSource.Contains('public.dar_enrollment_has_active_day_in_month(ce.id,@month)')
    'Database migration defines date status, attendance eligibility and month eligibility functions' = $indexMigration.Contains('CREATE OR REPLACE FUNCTION public.dar_enrollment_status_at_date') -and $indexMigration.Contains('CREATE OR REPLACE FUNCTION public.dar_enrollment_is_attendance_eligible_on_date') -and $indexMigration.Contains('CREATE OR REPLACE FUNCTION public.dar_enrollment_has_active_day_in_month')
    'Monthly eligibility respects the circle start date as well as the enrollment start date' = $indexMigration.Contains('JOIN public.circles c ON c.id=ce.circle_id') -and $indexMigration.Contains('GREATEST(ce.starts_on,c.starts_on,date_trunc(''month'',p_billing_month)::date)')
    'Attendance helper rejects ending an already-paused enrollment but allows an active inclusive end date' = $indexMigration.Contains("AND ce.ends_on=p_date") -and $indexMigration.Contains("COALESCE(previous_state.prior_status,'active')='active'") -and $sql.Contains('ending an already-paused enrollment must not make the end date attendance-eligible')
    'Central lifecycle helper reads indexed enrollment events and has a supporting non-unique audit index' = $indexMigration.Contains('ON audit_log (entity_type, entity_id, action_code, occurred_at DESC, id DESC)') -and $indexMigration.Contains("WHERE al.entity_type='enrollment'") -and $indexMigration.Contains('AND al.entity_id=ce.id') -and $indexMigration.Contains("al.action_code IN ('enrollment.status.baseline','enrollment.pause','enrollment.resume','enrollment.end')") -and $d.Contains('dar_enrollment_status_at_date(ce.id,@date)')
    'Backup restore validator recognizes migration 011 index and required helper functions' = $restoreValidator.Contains("'011_enrollment_lifecycle_audit_index' = @()") -and $restoreValidator.Contains("'ix_audit_log_enrollment_lifecycle' = [pscustomobject]@{ Table='audit_log'; Columns='entity_type,entity_id,action_code,occurred_at,id'; PredicatePattern='^$';") -and $restoreValidator.Contains('Unique=$false }') -and $restoreValidator.Contains('i.indisunique=required.is_unique') -and $restoreValidator.Contains('dar_enrollment_status_at_date') -and $restoreValidator.Contains('dar_enrollment_has_active_day_in_month') -and $restoreValidator.Contains('dar_enrollment_is_attendance_eligible_on_date') -and $restoreValidator.Contains('RequiredFunctionCount')
}

$failed = 0
foreach ($entry in $checks.GetEnumerator()) {
    if ($entry.Value) { Write-Output "PASS: $($entry.Key)" }
    else { Write-Output "FAIL: $($entry.Key)"; $failed++ }
}
Write-Output ("Enrollment lifecycle and create-only finance source checks: PASS={0}; FAIL={1}" -f ($checks.Count - $failed), $failed)
if ($failed -gt 0) {
    Write-Output 'DAR_TEST_RESULT=FAIL'
    exit 1
}
Write-Output 'DAR_TEST_RESULT=PASS'
exit 0
