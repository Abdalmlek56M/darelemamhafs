$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$localPostgresPath = Join-Path $projectRoot 'tools\LocalPostgres.ps1'
$apiDll = Join-Path $projectRoot 'backend\DarEltahfeez.Api\bin\Debug\net10.0\DarEltahfeez.Api.dll'
$apiDirectory = Split-Path -Parent $apiDll
$apiIndex = Join-Path $apiDirectory 'wwwroot\index.html'
$apiBase = 'http://127.0.0.1:5082'
$databaseName = $null
$databaseCreated = $false
$secrets = $null
$paths = $null
$apiProcess = $null
$apiProcessStopped = $true
$apiLaunchAttempted = $false
$portReleased = $true
$failure = $null
$script:result = 'FAIL'
$script:failureStage = 'initialization'
$script:checks = [ordered]@{}
$script:reportPath = $null
$oldEnvironment = @{}
$environmentNames = @(
    'DAR_ISOLATED_FUNCTIONAL_ACCEPTANCE', 'DAR_ISOLATED_REHEARSAL',
    'DAR_DATABASE_CONNECTION_STRING', 'DAR_DESKTOP_LOCAL_MODE',
    'ASPNETCORE_URLS', 'ASPNETCORE_ENVIRONMENT', 'DAR_APPLY_MIGRATIONS_ON_STARTUP'
)
foreach ($name in $environmentNames) { $oldEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
$previousPassword = $env:PGPASSWORD
$previousPgOptions = $env:PGOPTIONS

function Write-FunctionalStep([string]$Message, [string]$Kind = 'INFO') {
    $line = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss.fffK'), $Message
    Write-Host $line
}
function Assert-Functional([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
    Write-FunctionalStep ('PASS: ' + $Message) 'PASS'
}
function Test-FunctionalPort([int]$Port) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $pending = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
        if (-not $pending.AsyncWaitHandle.WaitOne(500)) { return $false }
        $client.EndConnect($pending)
        return $true
    } catch { return $false } finally { $client.Close() }
}
function Wait-FunctionalPortReleased([int]$Port, [int]$TimeoutSeconds = 15) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if (-not (Test-FunctionalPort $Port)) { return $true }
        Start-Sleep -Milliseconds 250
    }
    return (-not (Test-FunctionalPort $Port))
}
function Get-FunctionalReportSignature($Report) {
    $parts = New-Object System.Collections.Generic.List[string]
    foreach ($field in @(
        'Encoding','TableCount','RequiredTableCount','AppliedMigrationCount','RequiredColumnCount',
        'ForeignKeyCount','RequiredForeignKeyCount','UnvalidatedForeignKeyCount','InvalidIndexCount',
        'RequiredFunctionCount','RequiredTriggerCount'
    )) {
        $property = $Report.PSObject.Properties[$field]
        if ($null -eq $property) { throw "Database report is missing signature field '$field'." }
        $parts.Add($field + ':' + [string]$property.Value)
    }
    foreach ($field in @('AppliedMigrations','RequiredTables','RequiredColumns','RequiredForeignKeys','RequiredIndexes','RequiredFunctions','RequiredTriggers')) {
        $values = @($Report.$field | ForEach-Object { [string]$_ } | Sort-Object)
        $parts.Add($field + ':' + ($values -join ','))
    }
    foreach ($field in @('RequiredForeignKeySpecifications','RequiredIndexSpecifications','RequiredTriggerSpecifications')) {
        $values = @($Report.$field | ForEach-Object {
            if ($field -eq 'RequiredForeignKeySpecifications') {
                '{0}:{1}.{2}->{3}.{4}' -f $_.Name,$_.Table,$_.Column,$_.TargetTable,$_.TargetColumn
            } elseif ($field -eq 'RequiredIndexSpecifications') {
                '{0}:{1}.{2}:{3}:unique={4}' -f $_.Name,$_.Table,$_.Columns,$_.PredicatePattern,$_.Unique
            } else {
                '{0}:{1}:{2}' -f $_.Name,$_.Table,$_.Function
            }
        } | Sort-Object)
        $parts.Add($field + ':' + ($values -join ','))
    }
    $rows = foreach ($key in ($Report.TableCounts.Keys | Sort-Object)) { "${key}:$($Report.TableCounts[$key])" }
    $parts.Add('TableCounts:' + (@($rows) -join ','))
    return ($parts -join "`n")
}
function Invoke-FunctionalApi {
    param(
        [Parameter(Mandatory = $true)][Microsoft.PowerShell.Commands.WebRequestSession]$Session,
        [Parameter(Mandatory = $true)][string]$Method,
        [Parameter(Mandatory = $true)][string]$Path,
        $Body = $null
    )
    $uri = $apiBase + $Path
    $parameters = @{
        Uri = $uri
        Method = $Method
        WebSession = $Session
        UseBasicParsing = $true
        TimeoutSec = 25
        Headers = @{ Accept = 'application/json' }
    }
    if ($null -ne $Body) {
        $parameters.ContentType = 'application/json; charset=utf-8'
        $parameters.Body = ConvertTo-Json -InputObject $Body -Depth 16 -Compress
    }
    $statusCode = 0
    $text = ''
    try {
        $response = Invoke-WebRequest @parameters
        $statusCode = [int]$response.StatusCode
        $text = [string]$response.Content
    } catch {
        $webResponse = $_.Exception.Response
        if ($null -eq $webResponse) { throw ('HTTP request failed before a response was received: ' + $_.Exception.Message) }
        $statusCode = [int]$webResponse.StatusCode
        $stream = $webResponse.GetResponseStream()
        if ($null -ne $stream) {
            $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::UTF8)
            try { $text = $reader.ReadToEnd() } finally { $reader.Dispose(); $stream.Dispose() }
        }
    }
    $json = $null
    if (-not [string]::IsNullOrWhiteSpace($text)) {
        try { $json = ConvertFrom-Json -InputObject $text -ErrorAction Stop } catch { }
    }
    return [pscustomobject]@{ StatusCode = $statusCode; Text = $text; Json = $json }
}
function Assert-HttpStatus($Response, [int]$Expected, [string]$Label) {
    if ([int]$Response.StatusCode -ne $Expected) {
        $safeBody = [string]$Response.Text
        if ($safeBody.Length -gt 1200) { $safeBody = $safeBody.Substring(0, 1200) }
        throw ("{0}: expected HTTP {1}, received {2}. Response={3}" -f $Label,$Expected,$Response.StatusCode,$safeBody)
    }
    Write-FunctionalStep ("PASS: {0} returned HTTP {1}." -f $Label,$Expected) 'PASS'
}
function Get-ArrayItemById($Items, [string]$PropertyName, [string]$Id) {
    foreach ($item in @($Items)) {
        if ([string]$item.$PropertyName -eq $Id) { return $item }
    }
    return $null
}
function Format-FunctionalDate($Value) {
    if ($null -eq $Value) { return '' }
    try { return ([DateTime]$Value).ToString('yyyy-MM-dd',[Globalization.CultureInfo]::InvariantCulture) }
    catch {
        $text = [string]$Value
        if ($text.Length -ge 10) { return $text.Substring(0,10) }
        return $text
    }
}
function Restore-FunctionalEnvironment {
    foreach ($name in $environmentNames) {
        $value = $oldEnvironment[$name]
        if ($null -eq $value) { [Environment]::SetEnvironmentVariable($name, $null, 'Process') }
        else { [Environment]::SetEnvironmentVariable($name, [string]$value, 'Process') }
    }
}

trap {
    try { $failure = $_.Exception.ToString(); Write-FunctionalStep ('UNHANDLED: ' + $failure) 'FAIL' } catch { }
    try { [Console]::Out.WriteLine('DAR_TEST_RESULT=FAIL'); [Console]::Out.Flush() } catch { }
    exit 1
}

try {
    $script:failureStage = 'preflight'
    if (-not (Test-Path -LiteralPath $localPostgresPath -PathType Leaf)) { throw 'LocalPostgres.ps1 is missing.' }
    $occupiedPortDetails = New-Object System.Collections.Generic.List[string]
    foreach ($port in @(5080,5081,5082)) {
        if (-not (Test-FunctionalPort $port)) { continue }
        $listeners = @()
        try { $listeners = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) } catch { }
        $owners = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)
        if ($owners.Count -eq 0) { $occupiedPortDetails.Add(("port {0} is listening but its PID could not be resolved" -f $port)); continue }
        foreach ($owner in $owners) {
            $ownerInfo = $null
            try { $ownerInfo = Get-CimInstance Win32_Process -Filter ("ProcessId = {0}" -f [int]$owner) -ErrorAction SilentlyContinue } catch { }
            if ($ownerInfo) {
                $occupiedPortDetails.Add(("port {0}: PID {1}, {2}; command: {3}" -f $port,$owner,$ownerInfo.Name,$ownerInfo.CommandLine))
            } else {
                $occupiedPortDetails.Add(("port {0}: PID {1}, process details unavailable" -f $port,$owner))
            }
        }
    }
    if ($occupiedPortDetails.Count -gt 0) {
        throw ('SKIP: Required functional-test ports are occupied: ' + ($occupiedPortDetails -join ' | ') + '. Close Dar, then run CHECK_API_PORT.bat. If port 5080 is still owned by a verified DarEltahfeez.Api process, use STOP_STALE_DAR_API.bat; never stop postgres.exe.')
    }
    $missingBuildArtifacts = New-Object System.Collections.Generic.List[string]
    if (-not (Test-Path -LiteralPath $apiDll -PathType Leaf)) { $missingBuildArtifacts.Add($apiDll) }
    if (-not (Test-Path -LiteralPath $apiIndex -PathType Leaf)) { $missingBuildArtifacts.Add($apiIndex) }
    if ($missingBuildArtifacts.Count -gt 0) {
        throw ('SKIP: Functional-test build artifacts are missing from this exact project folder: ' + ($missingBuildArtifacts -join ' | ') + '. Project root: ' + $projectRoot + '. Run BUILD_DAR_FOR_REHEARSAL.bat from this same folder and confirm BUILD RESULT: PASS before retrying. The build window now pauses and writes a persistent log under %LOCALAPPDATA%\DarEltahfeez\Logs.')
    }

    . $localPostgresPath
    $paths = Get-DarLocalPaths
    if (-not (Test-Path -LiteralPath $paths.Secrets -PathType Leaf)) { throw 'SKIP: Local Dar database secrets are missing. Start Dar once to prepare the local runtime.' }
    $secrets = Get-DarDatabaseSecrets
    Assert-DarDatabaseSecrets -Secrets $secrets
    if ([int]$secrets.Port -ne 55432 -or [string]$secrets.Database -notmatch '^[A-Za-z0-9_]+$') { throw 'Local database settings do not match the expected Dar loopback cluster.' }
    if (-not (Test-Path -LiteralPath (Join-Path $paths.Data 'PG_VERSION') -PathType Leaf)) { throw 'SKIP: Existing PostgreSQL cluster is not initialized; this test never runs initdb.' }
    $pgVersion = (Get-Content -LiteralPath (Join-Path $paths.Data 'PG_VERSION') -Raw).Trim()
    if ($pgVersion -ne '17') { throw "SKIP: Expected an initialized PostgreSQL 17 cluster; found PG_VERSION=$pgVersion." }
    $pgBin = Get-DarPostgresBin -ProjectRoot $projectRoot
    if ([string]::IsNullOrWhiteSpace([string]$pgBin)) { throw 'SKIP: Verified PostgreSQL 17 client binaries are unavailable.' }
    # Invoke-DarPgTool resolves every PostgreSQL executable through this shared
    # script-scoped value. Migration rehearsal already follows this contract;
    # functional acceptance must assign it before the first identity probe.
    $script:DarPgBin = [string]$pgBin
    foreach ($requiredPgTool in @('psql.exe','pg_ctl.exe','pg_restore.exe')) {
        $requiredPgPath = Join-Path $script:DarPgBin $requiredPgTool
        if (-not (Test-Path -LiteralPath $requiredPgPath -PathType Leaf)) {
            throw ('The verified PostgreSQL runtime is missing ' + $requiredPgTool + ': ' + $requiredPgPath)
        }
    }
    Assert-Functional (-not [string]::IsNullOrWhiteSpace([string]$script:DarPgBin)) 'Verified PostgreSQL bin path is initialized for the shared database helpers.'
    $dotnetCommand = Get-Command dotnet -ErrorAction SilentlyContinue
    $dotnetPath = if ($dotnetCommand) { $dotnetCommand.Source } else { $null }
    if ([string]::IsNullOrWhiteSpace([string]$dotnetPath)) {
        foreach ($candidate in @((Join-Path $env:ProgramFiles 'dotnet\dotnet.exe'), (Join-Path $env:LOCALAPPDATA 'Microsoft\dotnet\dotnet.exe'))) {
            if (Test-Path -LiteralPath $candidate -PathType Leaf) { $dotnetPath = $candidate; break }
        }
    }
    if ([string]::IsNullOrWhiteSpace([string]$dotnetPath) -or -not (Test-Path -LiteralPath $dotnetPath -PathType Leaf)) { throw 'SKIP: .NET 10 runtime/host was not found. Install/prepare the .NET 10 runtime and rebuild Test assets.' }
    New-Item -ItemType Directory -Force -Path $paths.Logs | Out-Null
    $stamp = Get-Date -Format 'yyyyMMdd_HHmmss_fff'
    $script:reportPath = Join-Path $paths.Logs ('functional-api-acceptance-' + $stamp + '.json')
    $apiOut = Join-Path $paths.Logs ('functional-api-' + $stamp + '-output.log')
    $apiErr = Join-Path $paths.Logs ('functional-api-' + $stamp + '-error.log')
    $script:checks['preparedPostgres17'] = 'PASS'
    $script:checks['apiBuildAssets'] = 'PASS'
    Write-FunctionalStep ('Using verified PostgreSQL client runtime: ' + $pgBin)

    $startupMutex = [System.Threading.Mutex]::new($false, 'Global\DarEltahfeez_Postgres_55432')
    $ownsStartupMutex = $false
    try {
        try { $ownsStartupMutex = $startupMutex.WaitOne([TimeSpan]::FromSeconds(30)) }
        catch [System.Threading.AbandonedMutexException] { $ownsStartupMutex = $true }
        if (-not $ownsStartupMutex) { throw 'Another process is preparing local PostgreSQL. Retry after it finishes.' }
        if (-not (Test-DarExpectedPostgresIdentity -Secrets $secrets -Paths $paths)) {
            Write-FunctionalStep 'Starting the already-initialized PostgreSQL 17 cluster; initdb will not be run.'
            Start-DarPostgresServer -Secrets $secrets -Paths $paths
        }
    } finally {
        if ($ownsStartupMutex) { $startupMutex.ReleaseMutex() }
        $startupMutex.Dispose()
    }
    if (-not (Test-DarExpectedPostgresIdentity -Secrets $secrets -Paths $paths)) { throw 'Could not verify the existing local PostgreSQL cluster identity.' }

    $script:failureStage = 'production-readonly-baseline'
    $productionBefore = Get-DarDatabaseRestoreReport -Secrets $secrets -DatabaseName $secrets.Database
    $productionSignatureBefore = Get-FunctionalReportSignature $productionBefore
    $expectedMigrations = @(
        '001_initial_schema','002_management_security','003_schedule_attendance_ads_receipts',
        '004_operating_expenses','005_system_admin','006_student_attendance',
        '007_student_attendance_active_unique','008_schedule_slot_active_unique',
        '009_teacher_notes','010_circle_start_date','011_enrollment_lifecycle_audit_index',
        '012_teacher_schedule_no_overlap'
    )
    Assert-Functional ((@($productionBefore.AppliedMigrations) -join '|') -ceq ($expectedMigrations -join '|')) 'Production schema reports the expected 12 migration versions before functional acceptance.'
    $script:checks['productionSignatureBeforeCaptured'] = 'PASS'

    $script:failureStage = 'temporary-database-create'
    $suffix = [Guid]::NewGuid().ToString('N').Substring(0,16).ToLowerInvariant()
    $databaseName = 'dar_functional_test_' + $suffix
    if ($databaseName -notmatch '^dar_functional_test_[a-f0-9]{16}$') { throw 'Generated disposable database name failed the strict allow-list.' }
    if (Test-DarDatabaseExists -Secrets $secrets -DatabaseName $databaseName) { throw 'Unexpected disposable database name collision.' }
    Write-FunctionalStep ('Creating isolated functional acceptance database: ' + $databaseName)
    New-DarDatabase -DatabaseName $databaseName -Secrets $secrets
    $databaseCreated = $true
    Invoke-DarPgTool -Tool 'psql' -Arguments @('-X','-h','127.0.0.1','-p',[string]$secrets.Port,'-U',$secrets.AppUser,'-d',$databaseName,'-v','ON_ERROR_STOP=1','-c',"CREATE TABLE public.schema_migrations(version VARCHAR(120) PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now());") -Password $secrets.AppPassword | Out-Null
    $migrationFiles = @(Get-ChildItem -LiteralPath (Join-Path $projectRoot 'database') -Filter '*.sql' -File | Sort-Object Name)
    if ($migrationFiles.Count -ne 12) { throw "Expected 12 migrations, found $($migrationFiles.Count)." }
    foreach ($migration in $migrationFiles) {
        $version = [IO.Path]::GetFileNameWithoutExtension($migration.Name)
        if ($version -notmatch '^\d{3}_[a-z0-9_]+$') { throw ('Unexpected migration filename: ' + $migration.Name) }
        Write-FunctionalStep ('Applying ' + $version + ' to the disposable database.')
        Invoke-DarPgTool -Tool 'psql' -Arguments @('-X','-h','127.0.0.1','-p',[string]$secrets.Port,'-U',$secrets.AppUser,'-d',$databaseName,'-v','ON_ERROR_STOP=1','-f',$migration.FullName) -Password $secrets.AppPassword | Out-Null
        Invoke-DarPgTool -Tool 'psql' -Arguments @('-X','-h','127.0.0.1','-p',[string]$secrets.Port,'-U',$secrets.AppUser,'-d',$databaseName,'-v','ON_ERROR_STOP=1','-c',("INSERT INTO public.schema_migrations(version) VALUES ('$version');")) -Password $secrets.AppPassword | Out-Null
    }
    $temporaryReport = Get-DarDatabaseRestoreReport -Secrets $secrets -DatabaseName $databaseName
    Assert-Functional ($temporaryReport.AppliedMigrationCount -eq 12 -and @($temporaryReport.AppliedMigrations).Count -eq 12) 'Disposable database received all 12 migrations before API startup.'
    $script:checks['temporarySchema12Of12'] = 'PASS'

    $script:failureStage = 'isolated-api-start'
    $connection = "Host=127.0.0.1;Port=$($secrets.Port);Database=$databaseName;Username=$($secrets.AppUser);Password=$($secrets.AppPassword);Pooling=false;Timeout=5;Command Timeout=30;Application Name=DarFunctionalAcceptance"
    $previousEnv = @{}
    foreach ($name in $environmentNames) { $previousEnv[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
    try {
        $env:DAR_ISOLATED_FUNCTIONAL_ACCEPTANCE = '1'
        Remove-Item Env:DAR_ISOLATED_REHEARSAL -ErrorAction SilentlyContinue
        $env:DAR_DATABASE_CONNECTION_STRING = $connection
        $env:DAR_DESKTOP_LOCAL_MODE = '1'
        $env:ASPNETCORE_ENVIRONMENT = 'Production'
        $env:ASPNETCORE_URLS = $apiBase
        Remove-Item Env:DAR_APPLY_MIGRATIONS_ON_STARTUP -ErrorAction SilentlyContinue
        $apiArguments = '"' + $apiDll + '" --urls ' + $apiBase
        $apiLaunchAttempted = $true
        $apiProcess = Start-Process -FilePath $dotnetPath -ArgumentList $apiArguments -WorkingDirectory $apiDirectory -PassThru -WindowStyle Hidden -RedirectStandardOutput $apiOut -RedirectStandardError $apiErr
        $apiProcessStopped = $false
    } finally {
        foreach ($name in $environmentNames) {
            $value = $previousEnv[$name]
            if ($null -eq $value) { [Environment]::SetEnvironmentVariable($name, $null, 'Process') }
            else { [Environment]::SetEnvironmentVariable($name, [string]$value, 'Process') }
        }
    }
    Write-FunctionalStep ('Started gated isolated API PID ' + $apiProcess.Id + ' on port 5082; connection is restricted to ' + $databaseName + '.')
    $health = $null
    $healthDeadline = (Get-Date).AddSeconds(40)
    while ((Get-Date) -lt $healthDeadline) {
        $apiProcess.Refresh()
        if ($apiProcess.HasExited) {
            $tail = ''
            if (Test-Path -LiteralPath $apiErr) { $tail = (Get-Content -LiteralPath $apiErr -Tail 30 -ErrorAction SilentlyContinue) -join "`n" }
            throw ('Isolated API exited before health check. ' + $tail)
        }
        try { $health = Invoke-RestMethod -Uri ($apiBase + '/health') -TimeoutSec 2 } catch { $health = $null }
        if ($null -ne $health -and $health.status -eq 'ok' -and $health.database -eq 'connected' -and $health.service -eq 'DarEltahfeez.Api') { break }
        Start-Sleep -Milliseconds 400
    }
    Assert-Functional ($null -ne $health -and $health.status -eq 'ok' -and $health.database -eq 'connected') 'Isolated API health endpoint connects to the disposable database.'
    $script:checks['isolatedApiHealth'] = 'PASS'

    $script:failureStage = 'api-functional-flows'
    $today = [DateTime]::Now.Date
    $todayText = $today.ToString('yyyy-MM-dd',[Globalization.CultureInfo]::InvariantCulture)
    $startDate = $today.AddDays(-30).ToString('yyyy-MM-dd',[Globalization.CultureInfo]::InvariantCulture)
    $pauseDate = $today.AddDays(-5).ToString('yyyy-MM-dd',[Globalization.CultureInfo]::InvariantCulture)
    $pausedSessionDate = $today.AddDays(-4).ToString('yyyy-MM-dd',[Globalization.CultureInfo]::InvariantCulture)
    $resumeDate = $today.AddDays(-2).ToString('yyyy-MM-dd',[Globalization.CultureInfo]::InvariantCulture)
    $billingMonth = $today.ToString('yyyy-MM',[Globalization.CultureInfo]::InvariantCulture)
    $token = $suffix.Substring(0,10)
    $adminUsername = 'admin_' + $token
    $adminPassword = New-DarStrongPassword
    $adminSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession

    $response = Invoke-FunctionalApi -Session $adminSession -Method 'POST' -Path '/api/setup/admin' -Body @{ username=$adminUsername; displayName='Functional Acceptance Admin'; password=$adminPassword }
    Assert-HttpStatus $response 200 'Create the first administrator in the disposable database'
    Assert-Functional ($null -ne $response.Json.id -and @($response.Json.permissionCodes).Count -ge 20) 'Initial isolated administrator receives the full permission set.'
    $script:checks['initialAdminSetupAndCookie'] = 'PASS'

    $teacherCode = 'TCH-' + $token
    $teacherResponse = Invoke-FunctionalApi -Session $adminSession -Method 'POST' -Path '/api/teachers' -Body @{ teacherCode=$teacherCode; fullName=('اختبار معلمة ' + $token); phone=$null; hourlyRate=[decimal]120; status='active'; notes='synthetic isolated acceptance record' }
    Assert-HttpStatus $teacherResponse 201 'Create synthetic teacher'
    $teacherId = [string]$teacherResponse.Json.id
    Assert-Functional (-not [string]::IsNullOrWhiteSpace($teacherId)) 'Synthetic teacher receives a stable ID.'

    $circleCode = 'CIR-' + $token
    $circleResponse = Invoke-FunctionalApi -Session $adminSession -Method 'POST' -Path '/api/circles' -Body @{ circleCode=$circleCode; name=('اختبار حلقة قبول ' + $token); teacherId=$teacherId; monthlyFee=[decimal]150; scheduleText='Functional acceptance synthetic circle'; isActive=$true; startsOn=$startDate }
    Assert-HttpStatus $circleResponse 201 'Create synthetic circle with assigned teacher'
    $circleId = [string]$circleResponse.Json.id

    $dayOfWeek = [int]$today.DayOfWeek
    $slotResponse = Invoke-FunctionalApi -Session $adminSession -Method 'POST' -Path '/api/schedule-slots' -Body @{ circleId=$circleId; dayOfWeek=$dayOfWeek; startsAt='09:00'; durationMinutes=60 }
    Assert-HttpStatus $slotResponse 201 'Create current-day schedule slot'
    $slotId = [string]$slotResponse.Json.id
    $script:checks['teacherCircleScheduleCrud'] = 'PASS'

    $studentCode = 'STU-' + $token
    $studentResponse = Invoke-FunctionalApi -Session $adminSession -Method 'POST' -Path '/api/students' -Body @{ studentCode=$studentCode; fullName=('اختبار طالب ' + $token); ageYears=12; phone=$null; guardianName='ولي أمر اختباري'; guardianPhone=$null; joinedOn=$startDate; status='active'; notes='synthetic isolated acceptance record' }
    Assert-HttpStatus $studentResponse 201 'Create synthetic student'
    $studentId = [string]$studentResponse.Json.id
    $enrollmentBody = @{ studentId=$studentId; circleId=$circleId; startsOn=$startDate; agreedMonthlyFee=[decimal]150; allowClosedCircle=$false }
    $enrollmentResponse = Invoke-FunctionalApi -Session $adminSession -Method 'POST' -Path '/api/enrollments' -Body $enrollmentBody
    Assert-HttpStatus $enrollmentResponse 201 'Create student enrollment'
    $enrollmentId = [string]$enrollmentResponse.Json.id
    $duplicateEnrollment = Invoke-FunctionalApi -Session $adminSession -Method 'POST' -Path '/api/enrollments' -Body $enrollmentBody
    Assert-HttpStatus $duplicateEnrollment 409 'Reject duplicate active enrollment'
    $script:checks['studentEnrollmentAndDuplicateGuard'] = 'PASS'

    $pauseResponse = Invoke-FunctionalApi -Session $adminSession -Method 'PATCH' -Path ('/api/enrollments/' + $enrollmentId + '/pause') -Body @{ effectiveOn=$pauseDate; reason='isolated regression pause' }
    Assert-HttpStatus $pauseResponse 200 'Pause enrollment using an effective date'
    $pausedAttendance = Invoke-FunctionalApi -Session $adminSession -Method 'POST' -Path '/api/student-attendance' -Body @{ scheduleSlotId=$slotId; enrollmentId=$enrollmentId; sessionDate=$pausedSessionDate; status='present'; note='must be rejected while paused'; allowHistoricalEntry=$false }
    Assert-HttpStatus $pausedAttendance 409 'Reject student attendance on a paused date'
    $resumeResponse = Invoke-FunctionalApi -Session $adminSession -Method 'PATCH' -Path ('/api/enrollments/' + $enrollmentId + '/resume') -Body @{ effectiveOn=$resumeDate; reason='isolated regression resume' }
    Assert-HttpStatus $resumeResponse 200 'Resume enrollment using a later effective date'
    $script:checks['pauseResumeAndPausedAttendanceGuard'] = 'PASS'

    $studentAttendanceBody = @{ scheduleSlotId=$slotId; enrollmentId=$enrollmentId; sessionDate=$todayText; status='present'; note='functional acceptance'; allowHistoricalEntry=$false }
    $studentAttendanceFirst = Invoke-FunctionalApi -Session $adminSession -Method 'POST' -Path '/api/student-attendance' -Body $studentAttendanceBody
    Assert-HttpStatus $studentAttendanceFirst 200 'Record student attendance'
    $studentAttendanceId = [string]$studentAttendanceFirst.Json.id
    $studentAttendanceBody.status = 'excused'
    $studentAttendanceSecond = Invoke-FunctionalApi -Session $adminSession -Method 'POST' -Path '/api/student-attendance' -Body $studentAttendanceBody
    Assert-HttpStatus $studentAttendanceSecond 200 'Update the same student attendance record'
    Assert-Functional ([string]$studentAttendanceSecond.Json.id -eq $studentAttendanceId) 'Student attendance update preserves the original row ID.'
    $studentAttendanceList = Invoke-FunctionalApi -Session $adminSession -Method 'GET' -Path ('/api/student-attendance?month=' + $billingMonth)
    Assert-HttpStatus $studentAttendanceList 200 'Read monthly student attendance'
    $matchingStudentAttendance = @($studentAttendanceList.Json | Where-Object { [string]$_.studentId -eq $studentId -and [string]$_.scheduleSlotId -eq $slotId -and (Format-FunctionalDate $_.sessionDate) -eq $todayText })
    Assert-Functional ($matchingStudentAttendance.Count -eq 1 -and [string]$matchingStudentAttendance[0].status -eq 'excused') 'Student attendance upsert creates exactly one current-session row with the latest status.'
    $script:checks['studentAttendanceUpsert'] = 'PASS'

    $teacherAttendanceBody = @{ scheduleSlotId=$slotId; sessionDate=$todayText; status='present'; note='snapshot acceptance'; teacherId=$teacherId }
    $teacherAttendanceFirst = Invoke-FunctionalApi -Session $adminSession -Method 'POST' -Path '/api/teacher-attendance' -Body $teacherAttendanceBody
    Assert-HttpStatus $teacherAttendanceFirst 200 'Record teacher attendance and hourly-rate snapshot'
    $teacherAttendanceId = [string]$teacherAttendanceFirst.Json.id
    Assert-Functional ([decimal]$teacherAttendanceFirst.Json.hourlyRateSnapshot -eq [decimal]120 -and [decimal]$teacherAttendanceFirst.Json.payableAmount -eq [decimal]120) 'Teacher attendance captures rate 120 and calculates one-hour payable 120.'
    $teacherUpdate = Invoke-FunctionalApi -Session $adminSession -Method 'PUT' -Path ('/api/teachers/' + $teacherId) -Body @{ teacherCode=$teacherCode; fullName=('اختبار معلمة ' + $token); phone=$null; hourlyRate=[decimal]180; status='active'; notes='synthetic isolated acceptance record' }
    Assert-HttpStatus $teacherUpdate 200 'Update teacher hourly rate after attendance snapshot'
    $teacherAttendanceSecond = Invoke-FunctionalApi -Session $adminSession -Method 'POST' -Path '/api/teacher-attendance' -Body $teacherAttendanceBody
    Assert-HttpStatus $teacherAttendanceSecond 200 'Re-save the same teacher attendance row after rate change'
    Assert-Functional ([string]$teacherAttendanceSecond.Json.id -eq $teacherAttendanceId -and [decimal]$teacherAttendanceSecond.Json.hourlyRateSnapshot -eq [decimal]120 -and [decimal]$teacherAttendanceSecond.Json.payableAmount -eq [decimal]120) 'Teacher attendance upsert preserves the original hourly-rate snapshot and payable amount.'
    $script:checks['teacherAttendanceSnapshotUpsert'] = 'PASS'

    $script:failureStage = 'permission-and-finance-acceptance'
    $limitedUsername = 'fin_' + $token
    $limitedPassword = New-DarStrongPassword
    $limitedPermissions = @('students.read','teachers.read','circles.read','attendance.read','finance.create')
    $limitedCreate = Invoke-FunctionalApi -Session $adminSession -Method 'POST' -Path '/api/admin/users' -Body @{ username=$limitedUsername; displayName='Finance Entry Only Test'; password=$limitedPassword; isActive=$true; permissionCodes=$limitedPermissions }
    Assert-HttpStatus $limitedCreate 201 'Create a finance.create-only user without finance.read'
    $limitedSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
    $limitedLogin = Invoke-FunctionalApi -Session $limitedSession -Method 'POST' -Path '/api/auth/login' -Body @{ username=$limitedUsername; password=$limitedPassword; rememberMe=$false }
    Assert-HttpStatus $limitedLogin 200 'Login using the limited-permission test account'
    $limitedMe = Invoke-FunctionalApi -Session $limitedSession -Method 'GET' -Path '/api/auth/me'
    Assert-HttpStatus $limitedMe 200 'Read limited user session'
    $limitedCodes = @($limitedMe.Json.permissionCodes | ForEach-Object { [string]$_ })
    Assert-Functional ($limitedCodes -contains 'finance.create' -and $limitedCodes -notcontains 'finance.read' -and $limitedCodes -notcontains 'students.edit') 'Limited user has finance.create but not finance.read or students.edit.'

    $limitedStudents = Invoke-FunctionalApi -Session $limitedSession -Method 'GET' -Path '/api/students'
    Assert-HttpStatus $limitedStudents 200 'Read students without finance.read'
    $limitedStudent = Get-ArrayItemById $limitedStudents.Json 'id' $studentId
    Assert-Functional ($null -ne $limitedStudent -and $null -eq $limitedStudent.currentMonthDue -and $null -eq $limitedStudent.currentMonthPaid -and $null -eq $limitedStudent.currentMonthPaymentStatus) 'Student list redacts due, paid and payment-status fields without finance.read.'

    $limitedTeachers = Invoke-FunctionalApi -Session $limitedSession -Method 'GET' -Path '/api/teachers'
    Assert-HttpStatus $limitedTeachers 200 'Read teachers without finance.read'
    $limitedTeacher = Get-ArrayItemById $limitedTeachers.Json 'id' $teacherId
    Assert-Functional ($null -ne $limitedTeacher -and $null -eq $limitedTeacher.hourlyRate) 'Teacher list redacts hourly rate without finance.read.'

    $limitedCircles = Invoke-FunctionalApi -Session $limitedSession -Method 'GET' -Path '/api/circles'
    Assert-HttpStatus $limitedCircles 200 'Read circles without finance.read'
    $limitedCircle = Get-ArrayItemById $limitedCircles.Json 'id' $circleId
    Assert-Functional ($null -ne $limitedCircle -and $null -eq $limitedCircle.monthlyFee) 'Circle list redacts monthly fee without finance.read.'

    $financeOptions = Invoke-FunctionalApi -Session $limitedSession -Method 'GET' -Path ('/api/finance-entry-options?month=' + $billingMonth)
    Assert-HttpStatus $financeOptions 200 'Read financial entry options with finance.create only'
    Assert-Functional ($financeOptions.Text -notmatch '"(amountDue|paidAmount|balance|paymentStatus|agreedMonthlyFee|monthlyFee|hourlyRate|hourlyRateSnapshot|payableAmount)"\s*:') 'Finance entry options expose identity and IDs only; no monetary values or payment status.'

    $limitedTeacherAttendance = Invoke-FunctionalApi -Session $limitedSession -Method 'GET' -Path ('/api/teacher-attendance?month=' + $billingMonth)
    Assert-HttpStatus $limitedTeacherAttendance 200 'Read teacher attendance without finance.read'
    $limitedTeacherAttendanceRow = @($limitedTeacherAttendance.Json | Where-Object { [string]$_.id -eq $teacherAttendanceId }) | Select-Object -First 1
    Assert-Functional ($null -ne $limitedTeacherAttendanceRow -and $null -eq $limitedTeacherAttendanceRow.hourlyRateSnapshot -and $null -eq $limitedTeacherAttendanceRow.payableAmount) 'Teacher attendance redacts hourly-rate snapshot and payable amount without finance.read.'

    $limitedHistory = Invoke-FunctionalApi -Session $limitedSession -Method 'GET' -Path ('/api/students/' + $studentId + '/history')
    Assert-HttpStatus $limitedHistory 200 'Read student history without finance.read'
    $limitedHistoryEnrollment = @($limitedHistory.Json.enrollments | Where-Object { [string]$_.id -eq $enrollmentId }) | Select-Object -First 1
    Assert-Functional ($limitedHistory.Json.financeVisible -eq $false -and $null -ne $limitedHistoryEnrollment -and $null -eq $limitedHistoryEnrollment.agreedMonthlyFee -and @($limitedHistory.Json.charges).Count -eq 0) 'Student history hides agreed fees and charge/payment snapshots without finance.read.'
    $script:checks['financialReadRedaction'] = 'PASS'

    $chargeResponse = Invoke-FunctionalApi -Session $limitedSession -Method 'POST' -Path '/api/charges' -Body @{ enrollmentId=$enrollmentId; billingMonth=$billingMonth; amountDue=[decimal]150; note='limited create-only financial acceptance' }
    Assert-HttpStatus $chargeResponse 201 'Create monthly charge with finance.create only'
    $chargeId = [string]$chargeResponse.Json.id
    Assert-Functional ($null -eq $chargeResponse.Json.amountDue) 'Create-only charge response redacts amountDue.'
    $duplicateCharge = Invoke-FunctionalApi -Session $limitedSession -Method 'POST' -Path '/api/charges' -Body @{ enrollmentId=$enrollmentId; billingMonth=$billingMonth; amountDue=[decimal]150; note='duplicate must fail' }
    Assert-HttpStatus $duplicateCharge 409 'Reject duplicate monthly charge for the same enrollment and month'

    $paymentResponse = Invoke-FunctionalApi -Session $limitedSession -Method 'POST' -Path '/api/payments' -Body @{ monthlyChargeId=$chargeId; amount=[decimal]50; paidAt=$null; method='cash'; reference='functional-acceptance'; note='partial payment' }
    Assert-HttpStatus $paymentResponse 201 'Record a partial payment with finance.create only'
    $paymentId = [string]$paymentResponse.Json.id
    Assert-Functional ($null -eq $paymentResponse.Json.amount) 'Payment response redacts the paid amount without finance.read.'
    $overPayment = Invoke-FunctionalApi -Session $limitedSession -Method 'POST' -Path '/api/payments' -Body @{ monthlyChargeId=$chargeId; amount=[decimal]100.01; paidAt=$null; method='cash'; reference='overpay-probe'; note='must be rejected without exposing balance' }
    Assert-HttpStatus $overPayment 409 'Reject payment above the outstanding balance'
    Assert-Functional ($overPayment.Text -notmatch '100\.00|100\.01') 'Overpayment conflict does not disclose the exact remaining amount to a create-only user.'

    $limitedCollections = Invoke-FunctionalApi -Session $limitedSession -Method 'GET' -Path ('/api/collections?month=' + $billingMonth)
    Assert-HttpStatus $limitedCollections 403 'Deny ledger reads without finance.read'
    $limitedReports = Invoke-FunctionalApi -Session $limitedSession -Method 'GET' -Path ('/api/collection-reports?month=' + $billingMonth)
    Assert-HttpStatus $limitedReports 403 'Deny collection-report listing without finance.read'
    $limitedReceipt = Invoke-FunctionalApi -Session $limitedSession -Method 'GET' -Path ('/api/payments/' + $paymentId + '/receipt')
    Assert-HttpStatus $limitedReceipt 403 'Deny payment receipt access without finance.read'

    $reportCreate = Invoke-FunctionalApi -Session $limitedSession -Method 'POST' -Path '/api/collection-reports' -Body @{ billingMonth=$billingMonth; title='Functional acceptance create-only report' }
    Assert-HttpStatus $reportCreate 201 'Allow finance.create to save a collection report without reading it'
    $reportId = [string]$reportCreate.Json.id
    $reportDetail = Invoke-FunctionalApi -Session $limitedSession -Method 'GET' -Path ('/api/collection-reports/' + $reportId)
    Assert-HttpStatus $reportDetail 403 'Deny saved report snapshot access without finance.read'
    $script:checks['financeCreateOnlyAndLedgerRestrictions'] = 'PASS'

    $adminCollections = Invoke-FunctionalApi -Session $adminSession -Method 'GET' -Path ('/api/collections?month=' + $billingMonth)
    Assert-HttpStatus $adminCollections 200 'Read collection ledger as administrator'
    $adminCollectionRow = @($adminCollections.Json | Where-Object { [string]$_.enrollmentId -eq $enrollmentId }) | Select-Object -First 1
    Assert-Functional ($null -ne $adminCollectionRow -and [decimal]$adminCollectionRow.amountDue -eq [decimal]150 -and [decimal]$adminCollectionRow.paidAmount -eq [decimal]50 -and [decimal]$adminCollectionRow.balance -eq [decimal]100 -and [string]$adminCollectionRow.paymentStatus -eq 'partial') 'Administrator sees correct partial-payment ledger: due 150, paid 50, balance 100, status partial.'
    $script:checks['partialPaymentLedger'] = 'PASS'

    $withdrawStudentResponse = Invoke-FunctionalApi -Session $adminSession -Method 'POST' -Path '/api/students' -Body @{ studentCode=('STW-' + $token); fullName=('اختبار انسحاب ' + $token); ageYears=13; phone=$null; guardianName=$null; guardianPhone=$null; joinedOn=$startDate; status='active'; notes='synthetic withdrawal acceptance record' }
    Assert-HttpStatus $withdrawStudentResponse 201 'Create second synthetic student for withdrawal test'
    $withdrawStudentId = [string]$withdrawStudentResponse.Json.id
    $secondCircleResponse = Invoke-FunctionalApi -Session $adminSession -Method 'POST' -Path '/api/circles' -Body @{ circleCode=('CR2-' + $token); name=('اختبار حلقة ثانية ' + $token); teacherId=$null; monthlyFee=[decimal]150; scheduleText='No teacher schedule required'; isActive=$true; startsOn=$startDate }
    Assert-HttpStatus $secondCircleResponse 201 'Create a second active circle without an assigned teacher'
    $secondCircleId = [string]$secondCircleResponse.Json.id
    $withdrawEnrollA = Invoke-FunctionalApi -Session $adminSession -Method 'POST' -Path '/api/enrollments' -Body @{ studentId=$withdrawStudentId; circleId=$circleId; startsOn=$startDate; agreedMonthlyFee=[decimal]150; allowClosedCircle=$false }
    Assert-HttpStatus $withdrawEnrollA 201 'Enroll withdrawal test student in the first circle'
    $withdrawEnrollB = Invoke-FunctionalApi -Session $adminSession -Method 'POST' -Path '/api/enrollments' -Body @{ studentId=$withdrawStudentId; circleId=$secondCircleId; startsOn=$startDate; agreedMonthlyFee=[decimal]150; allowClosedCircle=$false }
    Assert-HttpStatus $withdrawEnrollB 201 'Enroll withdrawal test student in the second circle'
    $withdrawStatus = Invoke-FunctionalApi -Session $adminSession -Method 'PATCH' -Path ('/api/students/' + $withdrawStudentId + '/status') -Body @{ status='withdrawn'; effectiveOn=$todayText }
    Assert-HttpStatus $withdrawStatus 200 'Withdraw student with two active enrollments'
    $withdrawHistory = Invoke-FunctionalApi -Session $adminSession -Method 'GET' -Path ('/api/students/' + $withdrawStudentId + '/history')
    Assert-HttpStatus $withdrawHistory 200 'Read final-withdrawal history'
    $withdrawnEnrollments = @($withdrawHistory.Json.enrollments | Where-Object { [string]$_.id -in @([string]$withdrawEnrollA.Json.id,[string]$withdrawEnrollB.Json.id) })
    Assert-Functional ($withdrawnEnrollments.Count -eq 2 -and @($withdrawnEnrollments | Where-Object { [string]$_.status -ne 'ended' -or (Format-FunctionalDate $_.endsOn) -ne $todayText }).Count -eq 0) 'Final student withdrawal ends all active enrollments on the effective date.'
    $script:checks['finalWithdrawalClosesAllEnrollments'] = 'PASS'

    $script:failureStage = 'production-readonly-postcheck'
    $productionAfter = Get-DarDatabaseRestoreReport -Secrets $secrets -DatabaseName $secrets.Database
    $productionSignatureAfter = Get-FunctionalReportSignature $productionAfter
    Assert-Functional ($productionSignatureBefore -ceq $productionSignatureAfter) 'Production Dar logical signature is unchanged after isolated API acceptance.'
    $script:checks['productionUnchanged'] = 'PASS'
    $script:result = 'PASS'
    Write-FunctionalStep 'All end-to-end functional API and finance permission scenarios passed against the isolated disposable database.' 'PASS'
}
catch {
    $failure = $_.Exception.Message
    if ($failure -like 'SKIP:*') { $script:result = 'SKIP' }
    else { $script:result = 'FAIL' }
    Write-FunctionalStep ("{0} at stage '{1}': {2}" -f $script:result,$script:failureStage,$failure) 'FAIL'
    if ($_.ScriptStackTrace) { Write-FunctionalStep ('Stack: ' + $_.ScriptStackTrace) 'FAIL' }
}
finally {
    if ($null -ne $apiProcess) {
        try {
            $apiProcess.Refresh()
            if (-not $apiProcess.HasExited) {
                Write-FunctionalStep ('Stopping only isolated API child PID ' + $apiProcess.Id)
                $apiProcess.Kill()
                $apiProcess.WaitForExit(15000) | Out-Null
            }
            $apiProcess.Refresh()
            $apiProcessStopped = $apiProcess.HasExited
        } catch {
            $apiProcessStopped = $false
            $failure = (($failure + ' API process cleanup: ' + $_.Exception.Message).Trim())
            $script:result = 'FAIL'
        }
    }
    if ($apiLaunchAttempted) {
        $portReleased = Wait-FunctionalPortReleased -Port 5082 -TimeoutSeconds 15
    } else {
        # No child listener was launched by this runner; do not misclassify an unrelated pre-existing listener as our cleanup failure.
        $portReleased = $true
    }
    if ($apiLaunchAttempted -and (-not $apiProcessStopped -or -not $portReleased)) {
        $failure = (($failure + ' The isolated API process/port could not be confirmed stopped; disposable database was preserved for safety.').Trim())
        $script:result = 'FAIL'
        Write-FunctionalStep 'FAIL: API PID or port 5082 is not confirmed stopped; preserving the disposable database instead of dropping it.' 'FAIL'
    } elseif ($databaseCreated -and $databaseName -match '^dar_functional_test_[a-f0-9]{16}$' -and $null -ne $secrets) {
        try {
            Write-FunctionalStep ('Dropping only disposable functional database ' + $databaseName)
            Invoke-DarPgTool -Tool 'psql' -Arguments @('-X','-h','127.0.0.1','-p',[string]$secrets.Port,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c',("DROP DATABASE IF EXISTS $databaseName WITH (FORCE);")) -Password $secrets.PostgresAdminPassword | Out-Null
            if (Test-DarDatabaseExists -Secrets $secrets -DatabaseName $databaseName) { throw 'Disposable functional database still exists after cleanup.' }
            $script:checks['temporaryDatabaseRemoved'] = 'PASS'
        } catch {
            $failure = (($failure + ' Disposable database cleanup failed: ' + $_.Exception.Message).Trim())
            $script:result = 'FAIL'
        }
    }
    if ($null -eq $previousPassword) { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue } else { $env:PGPASSWORD = $previousPassword }
    if ($null -eq $previousPgOptions) { Remove-Item Env:PGOPTIONS -ErrorAction SilentlyContinue } else { $env:PGOPTIONS = $previousPgOptions }
    Restore-FunctionalEnvironment
    if ($null -ne $paths -and -not [string]::IsNullOrWhiteSpace([string]$script:reportPath)) {
        try {
            $report = [ordered]@{
                createdAt = (Get-Date -Format o)
                version = '0.8.25.0'
                result = $script:result
                failureStage = $script:failureStage
                failure = [string]$failure
                databaseName = [string]$databaseName
                apiPort = 5082
                checks = $script:checks
                apiLaunchAttempted = [bool]$apiLaunchAttempted
                apiProcessStopped = [bool]$apiProcessStopped
                apiPortReleased = [bool]$portReleased
                apiStdoutLog = if ($apiOut) { [IO.Path]::GetFileName($apiOut) } else { $null }
                apiStderrLog = if ($apiErr) { [IO.Path]::GetFileName($apiErr) } else { $null }
                productionWasReadOnlyForThisTest = $true
            }
            Write-DarAtomicJson -Path $script:reportPath -Value $report
            Write-FunctionalStep ('Diagnostic report: ' + $script:reportPath)
            if ($script:result -eq 'FAIL') {
                foreach ($logPath in @($apiOut,$apiErr)) {
                    if ($logPath -and (Test-Path -LiteralPath $logPath -PathType Leaf)) {
                        Write-FunctionalStep ('API log: ' + $logPath)
                        Get-Content -LiteralPath $logPath -Tail 40 -ErrorAction SilentlyContinue | ForEach-Object { Write-FunctionalStep ([string]$_) }
                    }
                }
            }
        } catch {
            $script:result = 'FAIL'
            $failure = (($failure + ' Report write failed: ' + $_.Exception.Message).Trim())
        }
    }
}

if ($script:result -eq 'SKIP') {
    Write-FunctionalStep ('SKIP: ' + [string]$failure) 'SKIP'
    Write-Output 'DAR_TEST_RESULT=SKIP'
    exit 0
}
if ($script:result -ne 'PASS') {
    Write-FunctionalStep ('FAIL: ' + [string]$failure) 'FAIL'
    Write-Output 'DAR_TEST_RESULT=FAIL'
    exit 1
}
Write-FunctionalStep 'PASS: Functional API acceptance completed; production database logical signature is unchanged.' 'PASS'
Write-Output 'DAR_TEST_RESULT=PASS'
exit 0
