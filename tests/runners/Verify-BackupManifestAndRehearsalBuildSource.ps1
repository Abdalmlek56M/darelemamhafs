$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
function Read-ProjectFile([string]$RelativePath) {
    $path = Join-Path $projectRoot $RelativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Required file is missing: $RelativePath" }
    return [System.IO.File]::ReadAllText($path,[System.Text.Encoding]::UTF8)
}
$localDb = Read-ProjectFile 'tools\LocalPostgres.ps1'
$scheduler = Read-ProjectFile 'tools\Invoke-AutomatedBackup.ps1'
$systemCenter = Read-ProjectFile 'tools\SystemCenter.ps1'
$systemAdmin = Read-ProjectFile 'backend\DarEltahfeez.Api\Services\SystemAdminService.cs'
$restore = Read-ProjectFile 'tests\runners\Verify-BackupRestoreIsolation.ps1'
$rehearsal = Read-ProjectFile 'tests\runners\Invoke-MigrationRehearsal.ps1'
$testCenter = Read-ProjectFile 'tests\runners\TestCenter.ps1'
$build = Read-ProjectFile 'tools\Build-DarForRehearsal.ps1'
$batch = Read-ProjectFile 'BUILD_DAR_FOR_REHEARSAL.bat'
$nativeHandlingTest = Read-ProjectFile 'tests\runners\Verify-PostgresNativeErrorHandling.ps1'
$checks = @(
    @{ Name='Shared backup manifest writer records completed archive metadata and SHA-256'; Text=$localDb; Pattern='function New-DarBackupManifest[\s\S]*?Status = .completed.[\s\S]*?FileName = \$file\.Name[\s\S]*?DatabaseName[\s\S]*?PostgreSqlMajorVersion[\s\S]*?ArchiveFormat = .PostgreSQL Custom.[\s\S]*?FileSizeBytes[\s\S]*?Sha256[\s\S]*?Write-DarAtomicJson' },
    @{ Name='Latest backup candidate discovery requires a sidecar manifest matching active Dar database'; Text=$localDb; Pattern='function Get-DarLatestBackupWithManifest[\s\S]*?\.backup[\s\S]*?\.json[\s\S]*?Status -cne .completed.[\s\S]*?DatabaseName[\s\S]*?FileSizeBytes[\s\S]*?Sha256' },
    @{ Name='Latest candidate discovery verifies the actual archive SHA-256 before automatic selection'; Text=$localDb; Pattern='Get-FileHash -LiteralPath \$file\.FullName -Algorithm SHA256[\s\S]*?StringComparison]::OrdinalIgnoreCase' },
    @{ Name='Scheduler creates its final manifest through the shared writer'; Text=$scheduler; Pattern='New-DarBackupManifest -BackupPath \$finalPath -Secrets \$secrets' },
    @{ Name='System Center manual full backup creates the same sidecar manifest'; Text=$systemCenter; Pattern='New-DarDatabaseBackup[\s\S]*?New-DarBackupManifest -BackupPath \$file\.FullName' },
    @{ Name='API creates a full manifest only for all-scope backups'; Text=$systemAdmin; Pattern='if \(allScope\)[\s\S]*?await WriteFullBackupManifestAsync\(filePath, databaseName, pgRestorePath, ct\)' },
    @{ Name='API full backup manifest validates PostgreSQL 17 and Custom archive with pg_restore'; Text=$systemAdmin; Pattern='private async Task WriteFullBackupManifestAsync[\s\S]*?SHOW server_version_num[\s\S]*?postgresMajor != 17[\s\S]*?validationStart.ArgumentList.Add\("--list"\)[\s\S]*?ArchiveFormat = "PostgreSQL Custom"[\s\S]*?Validation = "pg_restore --list passed"[\s\S]*?Sha256 = sha256' },
    @{ Name='API manifest binds the actual backup file name and size'; Text=$systemAdmin; Pattern='FileName = file\.Name[\s\S]*?FileSizeBytes = file\.Length[\s\S]*?File.Move\(temporaryPath, manifestPath, overwrite: false\)' },
    @{ Name='API failure cleanup deletes only artifacts created by the current request'; Text=$systemAdmin; Pattern='archiveCreatedByThisRequest = false[\s\S]*?manifestCreatedByThisRequest = false[\s\S]*?FileMode\.CreateNew[\s\S]*?archiveCreatedByThisRequest = true[\s\S]*?manifestCreatedByThisRequest = true[\s\S]*?manifestCreatedByThisRequest && File\.Exists[\s\S]*?archiveCreatedByThisRequest && File\.Exists' },
    @{ Name='API backup path follows the validated active Storage Center folder'; Text=$systemAdmin; Pattern='storage-locations\.json[\s\S]*?BackupFolder[\s\S]*?DarEltahfeez-Backups[\s\S]*?IsSameOrChildPath' },
    @{ Name='Pre-restore safety backup also receives a verified manifest'; Text=$localDb; Pattern='New-DarDatabaseBackup -DestinationPath \$safetyBackup[\s\S]*?New-DarBackupManifest -BackupPath \$safetyBackup' },
    @{ Name='Test 8 automatically selects only the newest verified manifest-backed backup and removes arbitrary file selection'; Text=$restore; Pattern='Get-DarLatestBackupWithManifest[\s\S]*?backupPath = \[IO\.Path\]::GetFullPath\(\$latestManifestBackup\)[\s\S]*?Get-DarVerifiedBackupManifest' },
    @{ Name='Test 10 reuses the exact path and SHA-256 accepted by Test 8'; Text=$rehearsal; Pattern='test8-accepted-backup\.json[\s\S]*?BackupPath[\s\S]*?Get-DarVerifiedBackupManifest[\s\S]*?acceptedBackupReference\.Sha256' },
    @{ Name='Test 8 writes its Test 10 acceptance reference only after all temporary database cleanup succeeds'; Text=$restore; Pattern='if \(\$cleanupFailures\.Count -gt 0\)[\s\S]*?if \(\$result -eq .PASS. -and \$null -ne \$pendingAcceptedBackupReference\)[\s\S]*?Write-DarAtomicJson -Path \$acceptedBackupReferencePath' },
    @{ Name='Test 10 does not prompt for a different backup file'; Text=$rehearsal; Pattern='test8-accepted-backup\.json[\s\S]*?Using the exact backup accepted by Test 8' },
    @{ Name='Missing-manifest error reports the exact expected sidecar path'; Text=$localDb; Pattern='Backup manifest sidecar is missing\. Expected file: \$manifestPath' },
    @{ Name='Test Center gives a build-only prerequisite for Test 10'; Text=$testCenter; Pattern='BUILD_DAR_FOR_REHEARSAL\.bat from the project root\. It builds the React assets and API only' },
    @{ Name='Build workflow compiles React desktop assets and copies them to API wwwroot'; Text=$build; Pattern='npm\.cmd[\s\S]*?build:desktop[\s\S]*?frontend[\\/]dist[\\/]index\.html[\s\S]*?Copy-Item[\s\S]*?wwwroot' },
    @{ Name='Build workflow compiles API DLL targeting .NET 10'; Text=$build; Pattern='\$ApiDll = Join-Path \$ApiDir .bin\\Debug\\net10\.0\\DarEltahfeez\.Api\.dll.[\s\S]*?Invoke-Checked \$DotnetExecutable @\(.build.,\$ApiProject,[\s\S]*?Test-Path -LiteralPath \$ApiDll' },
    @{ Name='Build workflow explicitly copies React assets beside the API DLL and verifies runtime wwwroot'; Text=$build; Pattern='\$ApiOutputWebRoot[\s\S]*?Copy-Item -Path \(Join-Path \$WebRoot[\s\S]*?runtimeIndex[\s\S]*?API_OUTPUT_WWWROOT_INDEX=' },
    @{ Name='Test 10 resolves dotnet from PATH or standard .NET installation folders'; Text=$rehearsal; Pattern='Get-Command .dotnet\.exe.[\s\S]*?ProgramFiles[\s\S]*?dotnetExecutable[\s\S]*?Start-Process -FilePath \$dotnetExecutable' },
    @{ Name='Build-only workflow does not start PostgreSQL, API or run migrations'; Text=$build; Pattern='This build-only operation did not start Dar, PostgreSQL, an API process, or run database migrations' },
    @{ Name='Root batch launcher calls build-only PowerShell script'; Text=$batch; Pattern='Build-DarForRehearsal\.ps1' },
    @{ Name='Shared PostgreSQL native wrapper neutralizes PowerShell 5.1 STDERR promotion and restores the caller preference'; Text=$localDb; Pattern='function Invoke-DarNativeProcessCapture[\s\S]*?ErrorActionPreference = .Continue.[\s\S]*?ErrorActionPreference = \$previousErrorActionPreference[\s\S]*?function Invoke-DarPgTool[\s\S]*?Invoke-DarNativeProcessCapture' },
    @{ Name='PostgreSQL cold-start progress output has a standalone fallback when Write-Step is absent'; Text=$localDb; Pattern='function Write-DarPostgresStep[\s\S]*?Get-Command -Name .Write-Step.[\s\S]*?Write-Host[\s\S]*?Write-DarPostgresStep .Starting the local PostgreSQL database engine' },
    @{ Name='Test Center exposes an isolated native STDERR handling regression'; Text=$testCenter; Pattern='Id=.30.[\s\S]*?Verify-PostgresNativeErrorHandling\.ps1' },
    @{ Name='Native STDERR regression uses a disposable executable and does not touch PostgreSQL'; Text=$nativeHandlingTest; Pattern='Copy-Item -LiteralPath \$commandProcessor[\s\S]*?Invoke-DarPgTool -Tool .psql.[\s\S]*?-AllowFailure[\s\S]*?ErrorActionPreference[\s\S]*?DAR_NATIVE_STDERR_PROBE' }
)
$passed=0
foreach ($check in $checks) {
    if (-not [regex]::IsMatch($check.Text,$check.Pattern,[System.Text.RegularExpressions.RegexOptions]::Singleline)) { throw ('FAIL: ' + $check.Name) }
    Write-Host ('PASS: ' + $check.Name) -ForegroundColor Green
    $passed++
}
Write-Host ("Backup manifest & rehearsal build source checks: PASS=$passed; FAIL=0") -ForegroundColor Green
Write-Output 'DAR_TEST_RESULT=PASS'
exit 0
