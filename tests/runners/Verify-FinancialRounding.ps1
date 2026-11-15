$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$projectPath = Join-Path $projectRoot 'tests\regression\financial-rounding\FinancialRoundingRegression.csproj'
if (-not (Test-Path -LiteralPath $projectPath -PathType Leaf)) {
    Write-Output 'FAIL: Financial rounding regression project is missing.'
    Write-Output 'DAR_TEST_RESULT=FAIL'
    exit 1
}
$dotnet = Get-Command dotnet -ErrorAction SilentlyContinue
if (-not $dotnet) {
    Write-Output 'SKIP: .NET 10 SDK is unavailable; financial rounding regression was not compiled or run.'
    Write-Output 'DAR_TEST_RESULT=SKIP'
    exit 0
}
Write-Output 'START: Financial rounding regression (.NET 10; no database connection)'
$output = @(& $dotnet.Source run --project $projectPath --configuration Release 2>&1)
$exitCode = $LASTEXITCODE
foreach ($line in $output) { Write-Output ([string]$line) }
if ($exitCode -ne 0 -or -not ($output -match 'DAR_TEST_RESULT=PASS')) {
    Write-Output ('FAIL: Financial rounding regression exited with code ' + $exitCode)
    Write-Output 'DAR_TEST_RESULT=FAIL'
    exit 1
}
Write-Output 'PASS: Financial rounding regression completed without connecting to PostgreSQL.'
Write-Output 'DAR_TEST_RESULT=PASS'
exit 0
