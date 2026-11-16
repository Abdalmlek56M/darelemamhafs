#requires -Version 5.1
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
function Read-Source([string]$RelativePath) {
    $path = Join-Path $projectRoot $RelativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Required source is missing: $RelativePath" }
    return [System.IO.File]::ReadAllText($path,[System.Text.Encoding]::UTF8)
}
$runnerPath = Join-Path $projectRoot 'tests\runners\Verify-FinancialArtifactsApiAcceptance.ps1'
$runner = Read-Source 'tests\runners\Verify-FinancialArtifactsApiAcceptance.ps1'
$domain = Read-Source 'backend\DarEltahfeez.Api\DomainEndpoints.cs'
$moneyRules = Read-Source 'backend\DarEltahfeez.Api\MoneyRules.cs'
$paymentsUi = Read-Source 'frontend\src\pages\PaymentsPage.tsx'
$paymentDialog = Read-Source 'frontend\src\components\dialogs\PaymentDialog.tsx'
$createOnlyPanel = Read-Source 'frontend\src\components\FinanceEntryCreateOnlyPanel.tsx'
$appHook = Read-Source 'frontend\src\application\useDarApplication.ts'
$managementReports = Read-Source 'frontend\src\components\ManagementReportBuilder.tsx'
$savedReportDialog = Read-Source 'frontend\src\components\dialogs\SavedReportDialog.tsx'
$reportExports = Read-Source 'frontend\src\lib\reportExports.ts'
$testCenter = Read-Source 'tests\runners\TestCenter.ps1'
$catalogText = Read-Source 'tests\catalog.json'
$tokens = $null; $parseErrors = $null
[System.Management.Automation.Language.Parser]::ParseFile($runnerPath,[ref]$tokens,[ref]$parseErrors) | Out-Null
$syntaxValid = @($parseErrors).Count -eq 0
$testCenterTokens = $null; $testCenterErrors = $null
[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $projectRoot 'tests\runners\TestCenter.ps1'),[ref]$testCenterTokens,[ref]$testCenterErrors) | Out-Null
$testCenterSyntaxValid = @($testCenterErrors).Count -eq 0
$catalog = $null
try { $catalog = Get-Content -LiteralPath (Join-Path $projectRoot 'tests\catalog.json') -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop } catch { }
$checks = @(
    @{Name='Financial artifact runner parses with Windows PowerShell 5.1 AST'; Pass=$syntaxValid},
    @{Name='Test Center parses with Windows PowerShell 5.1 AST'; Pass=$testCenterSyntaxValid},
    @{Name='Financial artifact runner uses the dedicated functional-acceptance gate and loopback port 5082'; Pass=$runner.Contains("DAR_ISOLATED_FUNCTIONAL_ACCEPTANCE = '1'") -and $runner.Contains('$apiBase = ''http://127.0.0.1:5082''')},
    @{Name='Financial artifact runner restricts its database to a unique dar_functional_test name'; Pass=$runner.Contains("'dar_functional_test_' + $suffix") -and $runner.Contains('^dar_functional_test_[a-f0-9]{16}$')},
    @{Name='Financial artifact runner assigns verified PostgreSQL runtime before its first identity probe'; Pass=$runner.Contains('$script:DarPgBin = [string]$pgBin') -and $runner.IndexOf('$script:DarPgBin = [string]$pgBin') -lt $runner.IndexOf('Test-DarExpectedPostgresIdentity -Secrets $secrets -Paths $paths')},
    @{Name='Financial artifact runner applies all 14 migrations before isolated API startup'; Pass=$runner.Contains('$migrationFiles.Count -ne 14') -and $runner.Contains('Disposable database received all 14 migrations before API startup.')},
    @{Name='Financial artifact runner compares production logical signatures before and after'; Pass=$runner.Contains('$productionSignatureBefore') -and $runner.Contains('$productionSignatureAfter') -and $runner.Contains('Production Dar logical signature is unchanged after financial-artifacts acceptance.')},
    @{Name='Financial artifact runner drops only the strict disposable database allow-list'; Pass=$runner.Contains('$databaseName -match ''^dar_functional_test_[a-f0-9]{16}$''') -and $runner.Contains('DROP DATABASE IF EXISTS $databaseName WITH (FORCE)')},
    @{Name='Financial artifact runner preserves its database if API process or port cleanup cannot be confirmed'; Pass=$runner.Contains('preserving the disposable database instead of dropping it') -and $runner.Contains('$apiProcessStopped') -and $runner.Contains('$portReleased')},
    @{Name='Financial artifact runner preflights and never force-stops ports 5080, 5081 or 5082'; Pass=$runner.Contains('foreach ($port in @(5080,5081,5082))') -and $runner.Contains('Get-NetTCPConnection') -and $runner.Contains('Get-CimInstance Win32_Process') -and (-not $runner.Contains('taskkill')) -and (-not $runner.Contains('Stop-Process'))},
    @{Name='Financial artifact runner tests malformed receipt MIME rejection without creating a payment'; Pass=$runner.Contains('Reject unsupported PDF receipt upload') -and $runner.Contains('Reject non-PNG bytes declared as image/png') -and $runner.Contains('Rejected receipt uploads did not create a payment row.')},
    @{Name='Financial artifact runner tests receipt signature validation'; Pass=$runner.Contains("'image/png'") -and $runner.Contains('FileBytes') -and $runner.Contains('Reject unsupported PDF receipt upload')},
    @{Name='Financial artifact runner uploads a valid PNG receipt through multipart HTTP'; Pass=$runner.Contains('/api/payments/with-receipt') -and $runner.Contains('Invoke-FunctionalReceiptMultipart') -and $runner.Contains('Upload PNG receipt with finance.create only')},
    @{Name='Receipt create-only response redacts amount while preserving hasReceipt metadata'; Pass=$runner.Contains('Create-only receipt response confirms receipt presence but redacts payment amount.')},
    @{Name='Receipt read is forbidden without finance.read and authorized retrieval verifies exact bytes'; Pass=$runner.Contains('Deny receipt download without finance.read') -and $runner.Contains('Downloaded receipt bytes exactly match the uploaded PNG.')},
    @{Name='Receipt download response requires private no-store, nosniff and attachment headers'; Pass=$runner.Contains('private') -and $runner.Contains('no-store') -and $runner.Contains('nosniff') -and $runner.Contains("ContentDisposition -match '^attachment'")},
    @{Name='API limits stored receipt uploads to 8 MiB and supported image formats'; Pass=$domain.Contains('8 * 1024 * 1024') -and $domain.Contains('image/jpeg') -and $domain.Contains('image/png') -and $domain.Contains('image/webp')},
    @{Name='API validates declared receipt MIME against JPEG, PNG and WebP signatures'; Pass=$domain.Contains('var isJpeg') -and $domain.Contains('var isPng') -and $domain.Contains('var isWebp') -and ($domain.Contains('var isJpeg') -and $domain.Contains('var isPng') -and $domain.Contains('var isWebp') -and $domain.Contains('receipt.ContentType'))},
    @{Name='API stores receipt bytes on the payment row and audits receipt creation'; Pass=$domain.Contains('receipt_file_name,receipt_content_type,receipt_data,receipt_uploaded_at') -and $domain.Contains('payment.create_with_receipt')},
    @{Name='Receipt retrieval requires finance.read and sets private/no-store and nosniff headers'; Pass=$domain.Contains('/api/payments/{id:guid}/receipt') -and $domain.Contains('RequireAuthorization("finance.read")') -and $domain.Contains('Cache-Control') -and $domain.Contains('X-Content-Type-Options')},
    @{Name='Operating expense listing requires finance.read and creation requires finance.create'; Pass=$domain.Contains('MapGet("/api/operating-expenses"') -and $domain.Contains('MapPost("/api/operating-expenses"') -and $domain.Contains('RequireAuthorization("finance.read")') -and $domain.Contains('RequireAuthorization("finance.create")')},
    @{Name='Operating expense edit requires both finance.edit and finance.read'; Pass=$domain.Contains('MapPut("/api/operating-expenses/{id:guid}"') -and $domain.Contains('RequireAuthorization("finance.edit", "finance.read")')},
    @{Name='Operating expense amount validation uses the shared two-decimal currency normalization'; Pass=$domain.Contains('TryNormalizePositiveCurrency(request.Amount') -and $moneyRules.Contains('RoundCurrency(amount)') -and $domain.Contains('ValidateOperatingExpense(normalizedRequest)')},
    @{Name='Nullable Guid parameters retain explicit PostgreSQL UUID type when their value is null'; Pass=$domain.Contains('cmd.Parameters.Add(name, NpgsqlDbType.Uuid)') -and $domain.Contains('parameter.Value = value.HasValue ? (object)value.Value : DBNull.Value;')},
    @{Name='Financial runner exercises create-only operating expense entry, read denial, admin update and null/linked circle IDs'; Pass=$runner.Contains('Create operating expense with finance.create only') -and $runner.Contains('Deny operating-expense list without finance.read') -and $runner.Contains('Update operating expense as finance editor') -and $runner.Contains('Create circle-linked operating expense with finance.create only') -and $runner.Contains('Circle-linked operating expense preserves its optional UUID association.') -and $runner.Contains('12.345') -and $runner.Contains('12.35')},
    @{Name='Advertising expense creation is finance.create-gated and bounded to 1..3650 days'; Pass=$domain.Contains('MapPost("/api/advertising-expenses"') -and $domain.Contains('DaysCount is < 1 or > 3650') -and $domain.Contains('RequireAuthorization("finance.create")')},
    @{Name='Advertising monthly prorating uses inclusive overlapping date count'; Pass=$domain.Contains('overlap_days') -and $domain.Contains('a.start_date + (a.days_count - 1)') -and $domain.Contains('@to - 1')},
    @{Name='Financial runner tests ad campaign total and selected-month proration across month boundary'; Pass=$runner.Contains('Advertising monthly cost prorates exactly the two campaign days inside the selected month.') -and $runner.Contains('overlapDays') -and $runner.Contains('monthAmount') -and $runner.Contains('14.50') -and $runner.Contains('21.75')},
    @{Name='Financial runner tests create-only advertising amount redaction'; Pass=$runner.Contains('Create-only advertising response exposes the record ID but redacts its total.')},
    @{Name='Saved collection report creation requires finance.create and captures JSON snapshot'; Pass=$domain.Contains('MapPost("/api/collection-reports"') -and $domain.Contains('JsonSerializer.Serialize(snapshot') -and $domain.Contains('NpgsqlDbType.Jsonb') -and $domain.Contains('RequireAuthorization("finance.create")')},
    @{Name='Saved report list and snapshot reads require finance.read'; Pass=$domain.Contains('MapGet("/api/collection-reports"') -and $domain.Contains('MapGet("/api/collection-reports/{id:guid}"') -and $domain.Contains('RequireAuthorization("finance.read")')},
    @{Name='Financial runner tests create-only report saving and read denial'; Pass=$runner.Contains('Save collection report snapshot with finance.create only') -and $runner.Contains('Deny saved report snapshot access without finance.read')},
    @{Name='Financial runner verifies immutable saved snapshot after a later payment'; Pass=$runner.Contains('Saved collection report remains immutable after a later payment.') -and $runner.Contains('Live ledger reflects the later payment while the saved snapshot stays unchanged.')},
    @{Name='Financial runner writes diagnostics and a final result marker'; Pass=$runner.Contains('financial-artifacts-api-acceptance-') -and $runner.Contains('DAR_TEST_RESULT=PASS') -and $runner.Contains('DAR_TEST_RESULT=FAIL')},
    @{Name='Payment dialog supports PNG/JPG/WebP receipt preview with an 8 MiB client limit'; Pass=$paymentDialog.Contains('image/png,image/jpeg,image/webp') -and $paymentDialog.Contains('8*1024*1024') -and $paymentDialog.Contains('paymentReceiptPreview')},
    @{Name='Payment hook posts receipt forms to the matching multipart API endpoint'; Pass=$appHook.Contains("requestForm('/api/payments/with-receipt',form)") -and $appHook.Contains("form.append('receipt',paymentReceipt)")},
    @{Name='Create-only finance panel supports receipt uploads without displaying financial ledger'; Pass=$createOnlyPanel.Contains("requestForm('/api/payments/with-receipt', form)") -and $createOnlyPanel.Contains("form.append('receipt', receipt)") -and $paymentsUi.Contains("ctx.has('finance.create') && <FinanceEntryCreateOnlyPanel ctx={ctx}/>")},
    @{Name='Payments page shows expense entry only to finance.create and financial lists to finance.read'; Pass=$paymentsUi.Contains("ctx.has('finance.create')") -and $paymentsUi.Contains('canReadFinance && <div className="table-scroll ad-expenses-list">') -and $paymentsUi.Contains('operating-expenses-panel')},
    @{Name='Payments page wires saved report view and expense edit/delete controls'; Pass=$paymentsUi.Contains('ctx.openSavedReport(report)') -and $paymentsUi.Contains('ctx.editOperatingExpense(expense)') -and $paymentsUi.Contains('ctx.deleteAdExpense(ad)') -and $paymentsUi.Contains('ctx.deleteOperatingExpense(expense)')},
    @{Name='Management reports define six report types and print/save-PDF behavior'; Pass=$managementReports.Contains("'school' | 'circles' | 'teacher' | 'teacher-attendance' | 'student-attendance' | 'student'") -and $managementReports.Contains('window.print()') -and $managementReports.Contains('window.open')},
    @{Name='Management report sharing suppresses finance details'; Pass=$managementReports.Contains("permissions.includes('finance.read') && audience === 'internal'") -and $managementReports.Contains("audience === 'share'")},
    @{Name='Saved report dialog displays frozen totals and exports CSV/JSON/SVG'; Pass=$savedReportDialog.Contains('reportView.snapshot.totalDue') -and $savedReportDialog.Contains('downloadSavedCsv') -and $savedReportDialog.Contains('downloadSavedJson') -and $savedReportDialog.Contains('makeReportSvg')},
    @{Name='Report export helpers escape CSV quotes and generate UTF-8 BOM and SVG'; Pass=$reportExports.Contains("'\ufeff'") -and $reportExports.Contains("replaceAll('""', '""""')") -and $reportExports.Contains('<svg xmlns=') -and $reportExports.Contains('safeDownload')},
    @{Name='Test Center registers source guard Test 35 and isolated API acceptance Test 36'; Pass=$testCenter.Contains("Id='35'") -and $testCenter.Contains('Verify-FinancialArtifactsAcceptanceSource.ps1') -and $testCenter.Contains("Id='36'") -and $testCenter.Contains('Verify-FinancialArtifactsApiAcceptance.ps1')},
    @{Name='Test 36 is interactive and is excluded from Run All'; Pass=$testCenter.Contains("Id='36'") -and $testCenter.Contains('Interactive=$true') -and $testCenter.Contains('if ($test.Interactive -and $script:RunAllMode)')},
    @{Name='Test Center checks PostgreSQL preparation, three ports and output wwwroot for Test 36'; Pass=$testCenter.Contains('$Id -eq ''36''') -and $testCenter.Contains('Test-RestoreClusterPrepared') -and $testCenter.Contains('5082') -and $testCenter.Contains('bin\Debug\net10.0\wwwroot\index.html')},
    @{Name='JSON test catalog registers FIN-ART source and runtime acceptance tests'; Pass=($null -ne $catalog -and @($catalog.tests | Where-Object {$_.id -eq 'FIN-ART-SRC-01'}).Count -eq 1 -and @($catalog.tests | Where-Object {$_.id -eq 'FIN-ART-API-01'}).Count -eq 1)},
    @{Name='Test 36 runner does not use production writes or broaden its database cleanup allow-list'; Pass=$runner.Contains('productionSignatureBefore') -and $runner.Contains('productionSignatureAfter') -and $runner.Contains('dar_functional_test_') -and $runner.Contains('productionWasReadOnlyForThisTest = $true') -and (-not $runner.Contains('dar_main')) -and (-not $runner.Contains('DROP DATABASE IF EXISTS Dar'))}
)
$failed=0
foreach($check in $checks){ if($check.Pass){Write-Host ('PASS: '+$check.Name) -ForegroundColor Green}else{Write-Host ('FAIL: '+$check.Name) -ForegroundColor Red;$failed++} }
Write-Host ("Financial artifacts source checks: PASS={0}; FAIL={1}" -f ($checks.Count-$failed),$failed)
if($failed -gt 0){Write-Output 'DAR_TEST_RESULT=FAIL';exit 1}
Write-Output 'DAR_TEST_RESULT=PASS';exit 0
