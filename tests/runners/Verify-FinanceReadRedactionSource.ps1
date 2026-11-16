$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$domainPath = Join-Path $projectRoot 'backend\DarEltahfeez.Api\DomainEndpoints.cs'
$adminPath = Join-Path $projectRoot 'backend\DarEltahfeez.Api\SystemAdminEndpoints.cs'
$typesPath = Join-Path $projectRoot 'frontend\src\domain\types.ts'
$uiPaths = @(
    'frontend\src\pages\StudentsPage.tsx',
    'frontend\src\pages\TeachersPage.tsx',
    'frontend\src\pages\CirclesPage.tsx',
    'frontend\src\components\dialogs\StudentHistoryDialog.tsx',
    'frontend\src\components\dialogs\TeacherHistoryDialog.tsx',
    'frontend\src\components\dialogs\TeacherDialog.tsx',
    'frontend\src\components\dialogs\EnrollmentDialog.tsx',
    'frontend\src\components\dialogs\CircleDetailsDialog.tsx',
    'frontend\src\pages\SchedulePage.tsx',
    'frontend\src\domain\defaults.ts'
)

$requiredFiles = @($domainPath, $adminPath, $typesPath) + @($uiPaths | ForEach-Object { Join-Path $projectRoot $_ })
$missingFiles = @($requiredFiles | Where-Object { -not (Test-Path -LiteralPath $_ -PathType Leaf) })
if ($missingFiles.Count -gt 0) {
    foreach ($file in $missingFiles) { Write-Output "FAIL: Required finance-redaction file missing: $file" }
    Write-Output 'DAR_TEST_RESULT=FAIL'
    exit 1
}

# Domain/SystemAdmin endpoints are split into partial files; concatenate all partials
# so source guards keep checking the real implementation after the refactor.
$domain = (Get-ChildItem -LiteralPath (Split-Path -Parent $domainPath) -Filter 'DomainEndpoints*.cs' | Sort-Object Name | ForEach-Object { [System.IO.File]::ReadAllText($_.FullName) }) -join "`n"
$admin = (Get-ChildItem -LiteralPath (Split-Path -Parent $adminPath) -Filter 'SystemAdminEndpoints*.cs' | Sort-Object Name | ForEach-Object { [System.IO.File]::ReadAllText($_.FullName) }) -join "`n"
$types = [System.IO.File]::ReadAllText($typesPath)
$ui = @{}
foreach ($relativePath in $uiPaths) { $ui[$relativePath] = [System.IO.File]::ReadAllText((Join-Path $projectRoot $relativePath)) }

$checks = [ordered]@{
    'finance.read is the explicit visibility permission' = $domain.Contains('private static bool CanReadFinance(ClaimsPrincipal principal) => principal.HasClaim("permission", "finance.read");')
    'financial editing requires finance.read and finance.edit' = $domain.Contains('private static bool CanEditFinancialValues(ClaimsPrincipal principal) => CanReadFinance(principal) && principal.HasClaim("permission", "finance.edit");')
    'dedicated financial update routes require both finance.edit and finance.read' = $domain.Contains('app.MapPut("/api/operating-expenses/{id:guid}"') -and $domain.Contains('app.MapPut("/api/charges/{id:guid}"') -and ([regex]::Matches($domain, '\.RequireAuthorization\("finance\.edit", "finance\.read"\);')).Count -eq 2 -and -not $domain.Contains('.RequireAuthorization("finance.edit");')
    'student financial DTO fields are nullable' = $domain.Contains('decimal? CurrentMonthDue,decimal? CurrentMonthPaid,string? CurrentMonthPaymentStatus')
    'front-end financial DTO fields accept explicit hidden nulls' = $types.Contains('currentMonthDue: number | null') -and $types.Contains('hourlyRate: number | null') -and $types.Contains('monthlyFee: number | null') -and $types.Contains('payableAmount: number | null')
    'student list hides due, paid and payment status in API' = $domain.Contains('financeVisible?r.GetDecimal(13):null,financeVisible?r.GetDecimal(14):null,financeVisible?r.GetString(15):null')
    'circle roster hides agreed fee and current-month amounts' = $domain.Contains('agreedMonthlyFee=financeVisible ? reader.GetDecimal(8) : (decimal?)null, currentMonthDue=financeVisible ? reader.GetDecimal(9) : (decimal?)null, currentMonthPaid=financeVisible ? reader.GetDecimal(10) : (decimal?)null')
    'enrollment write/read/end responses hide agreed monthly fee' = $domain.Contains('agreedMonthlyFee = canReadFinance ? agreedMonthlyFee : null') -and $domain.Contains('agreedMonthlyFee=financeVisible ? reader.GetDecimal(6) : (decimal?)null') -and $domain.Contains('agreedMonthlyFee = CanReadFinance(principal) ? agreedFee : (decimal?)null')
    'teacher attendance responses hide snapshot wage and payable in both attendance flows' = $domain.Contains('payableAmount=CanReadFinance(principal) ? payable : (decimal?)null, hourlyRateSnapshot=CanReadFinance(principal) ? rate : (decimal?)null') -and $domain.Contains('payableAmount = CanReadFinance(principal) ? savedPayable : (decimal?)null, hourlyRateSnapshot = CanReadFinance(principal) ? savedRate : (decimal?)null')
    'teacher payable continues to use historical saved rate snapshot' = $domain.Contains('SELECT teacher_id,hourly_rate_snapshot FROM teacher_attendance WHERE schedule_slot_id=@slot AND session_date=@date FOR UPDATE;')
    'student history only loads charge/payment data for finance readers' = $domain.Contains('if (financeVisible)') -and $domain.Contains('charges=charges.Values.Select(c=>c.ToResponse())')
    'charge create response hides amount due' = $domain.Contains('amountDue=CanReadFinance(principal) ? amountDue : (decimal?)null')
    'charge update response hides amount due' = $domain.Contains('amountDue = CanReadFinance(principal) ? reader.GetDecimal(1) : (decimal?)null')
    'payment creation responses hide payment amount in both standard and receipt flows' = $domain.Contains('amount=CanReadFinance(principal) ? paymentAmount : (decimal?)null') -and $domain.Contains('amount=CanReadFinance(principal) ? amount : (decimal?)null')
    'advertising expense create response hides generated total' = $domain.Contains('totalAmount=CanReadFinance(principal) ? reader.GetDecimal(1) : (decimal?)null')
    'operating expense create and update responses do not echo amounts' = $domain.Contains('return Results.Created($"/api/operating-expenses/{id}", new { id, createdAt });') -and $domain.Contains('return Results.Ok(new { id, updated = true });')
    'payment and charge conflict messages do not disclose balances without finance.read' = $domain.Contains('CanReadFinance(principal) ? $"المبلغ أكبر من المتبقي') -and $domain.Contains('المبلغ يتجاوز المتبقي المسموح لهذا الاستحقاق.') -and $domain.Contains('لا يمكن تخفيض الاستحقاق عن قيمة التحصيل المسجل.')
    'audit details and before/after snapshots are redacted at API boundary' = $admin.Contains('details = ParseJsonForFinance(') -and $admin.Contains('beforeData = ParseJsonForFinance(') -and $admin.Contains('afterData = ParseJsonForFinance(')
    'trash snapshots are redacted at API boundary' = $admin.Contains('recordSnapshot = ParseJsonForFinance(')
    'trash display names are redacted for historical and new financial items' = $admin.Contains('displayName = financeVisible ? r.GetString(3) : GetFinanceSafeTrashDisplayName(r.GetString(1))') -and $admin.Contains('if (table == "operating_expenses") return "مصروف تشغيلي";') -and $admin.Contains('private static string GetFinanceSafeTrashDisplayName(string entityType)')
    'trash restore and purge audit details do not retain financial display names' = $admin.Contains('displayName = CanReadFinance(principal) ? name : GetFinanceSafeTrashDisplayName(type!)') -and $admin.Contains('displayName = CanReadFinance(principal) ? displayName : GetFinanceSafeTrashDisplayName(type!)')
    'reset candidate labels do not expose user-entered operating expense descriptions' = $admin.Contains("COALESCE(c.name,'مصروف عام للدار'),' · مصروف تشغيلي'") -and $admin.Contains("' · مصروف عام للدار · مصروف تشغيلي'")
    'data exports redact financial fields without finance.read' = $admin.Contains('var financeVisible = CanReadFinance(principal);') -and $admin.Contains('financeVisible ? ParseJson(tableJson) : ParseJsonForFinance(tableJson, false)')
    'audit restore cannot change financial values without finance.read and finance.edit' = $admin.Contains('ContainsFinancialJsonFields(snapshot) && !CanEditFinancialValues(principal)')
    'JSON redaction covers monetary values and receipt metadata' = $admin.Contains('"receiptdata", "receiptfilename", "receiptcontenttype", "receiptuploadedat"') -and $admin.Contains('"amountdue"')
    'payment reset candidates do not disclose amount in labels' = $admin.Contains("SELECT p.id, concat(s.full_name,' · ',c.name,' · ',to_char(p.paid_at,'DD/MM/YYYY'))")
    'front end student page checks finance.read' = $ui['frontend\src\pages\StudentsPage.tsx'].Contains('finance.read')
    'front end teacher page checks finance.read' = $ui['frontend\src\pages\TeachersPage.tsx'].Contains('finance.read')
    'front end circle page checks finance.read' = $ui['frontend\src\pages\CirclesPage.tsx'].Contains('finance.read')
    'student and teacher history dialogs distinguish hidden financial values' = $ui['frontend\src\components\dialogs\StudentHistoryDialog.tsx'].Contains('financeVisible') -and $ui['frontend\src\components\dialogs\TeacherHistoryDialog.tsx'].Contains('financeVisible')
    'teacher and enrollment forms gate financial edits' = $ui['frontend\src\components\dialogs\TeacherDialog.tsx'].Contains('finance.edit') -and $ui['frontend\src\components\dialogs\EnrollmentDialog.tsx'].Contains('finance.edit')
    'circle details page gates financial columns' = $ui['frontend\src\components\dialogs\CircleDetailsDialog.tsx'].Contains('finance.read')
    'schedule attendance hides wage and payable values without finance.read and handles redacted nulls' = $ui['frontend\src\pages\SchedulePage.tsx'].Contains("const canReadFinance = ctx.has('finance.read')") -and $ui['frontend\src\pages\SchedulePage.tsx'].Contains('{canReadFinance && <Stat') -and $ui['frontend\src\pages\SchedulePage.tsx'].Contains('row.payableAmount ?? 0') -and $ui['frontend\src\pages\SchedulePage.tsx'].Contains('{canReadFinance && <td>')
    'enrollment creation omits agreed fee unless the user can read and edit finance' = ([System.IO.File]::ReadAllText((Join-Path $projectRoot 'frontend\src\application\useDarApplication.ts')).Contains('...(canEditFinancials ? { agreedMonthlyFee: Number(enrollmentForm.agreedMonthlyFee) } : {})') -and -not ([System.IO.File]::ReadAllText((Join-Path $projectRoot 'frontend\src\application\useDarApplication.ts')).Contains('{ ...enrollmentForm,')))
    'enrollment defaults represent hidden fee as null without stringifying null' = $ui['frontend\src\domain\defaults.ts'].Contains('fee: number | null = 0') -and $ui['frontend\src\domain\defaults.ts'].Contains("agreedMonthlyFee: fee == null ? '' : String(fee)")
    'payments page hides ledgers, summaries and saved reports without finance.read' = [System.IO.File]::ReadAllText((Join-Path $projectRoot 'frontend\src\pages\PaymentsPage.tsx')).Contains("const canReadFinance = ctx.has('finance.read')") -and (Get-Content -LiteralPath (Join-Path $projectRoot 'frontend\src\pages\PaymentsPage.tsx') -Raw).Contains('{canReadFinance &&')
    'trash labels do not include advertising amounts' = [System.IO.File]::ReadAllText((Join-Path $projectRoot 'frontend\src\application\useDarApplication.ts')).Contains('`إعلان ${ad.circleName}`') -and -not ([System.IO.File]::ReadAllText((Join-Path $projectRoot 'frontend\src\application\useDarApplication.ts')).Contains('إعلان ${ad.circleName} · ${money(ad.totalAmount)}'))
    'system audit view labels redacted financial nulls as unavailable' = [System.IO.File]::ReadAllText((Join-Path $projectRoot 'frontend\src\system\formatting.tsx')).Contains('غير متاح دون صلاحية قراءة المالية')
}

$failed = 0
foreach ($entry in $checks.GetEnumerator()) {
    if ($entry.Value) { Write-Output "PASS: $($entry.Key)" }
    else { Write-Output "FAIL: $($entry.Key)"; $failed++ }
}
Write-Output ("Finance read permission source checks: PASS={0}; FAIL={1}" -f ($checks.Count - $failed), $failed)
if ($failed -gt 0) {
    Write-Output 'DAR_TEST_RESULT=FAIL'
    exit 1
}
Write-Output 'DAR_TEST_RESULT=PASS'
exit 0
