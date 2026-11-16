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


function Invoke-FunctionalReceiptMultipart {
    param(
        [Parameter(Mandatory = $true)][Microsoft.PowerShell.Commands.WebRequestSession]$Session,
        [Parameter(Mandatory = $true)][string]$ChargeId,
        [Parameter(Mandatory = $true)][decimal]$Amount,
        [Parameter(Mandatory = $true)][byte[]]$FileBytes,
        [Parameter(Mandatory = $true)][string]$FileName,
        [Parameter(Mandatory = $true)][string]$ContentType
    )
    $boundary = '----DarFinancialAcceptance' + [Guid]::NewGuid().ToString('N')
    $encoding = [System.Text.UTF8Encoding]::new($false)
    $memory = [System.IO.MemoryStream]::new()
    try {
        foreach ($field in @(
            @{ Name='monthlyChargeId'; Value=$ChargeId },
            @{ Name='amount'; Value=$Amount.ToString([Globalization.CultureInfo]::InvariantCulture) },
            @{ Name='method'; Value='cash' },
            @{ Name='reference'; Value='financial-artifacts-acceptance' },
            @{ Name='note'; Value='synthetic isolated receipt test' }
        )) {
            $part = "--$boundary`r`nContent-Disposition: form-data; name=`"$($field.Name)`"`r`n`r`n$($field.Value)`r`n"
            $bytes = $encoding.GetBytes($part)
            $memory.Write($bytes, 0, $bytes.Length)
        }
        $fileHeader = "--$boundary`r`nContent-Disposition: form-data; name=`"receipt`"; filename=`"$FileName`"`r`nContent-Type: $ContentType`r`n`r`n"
        $headerBytes = $encoding.GetBytes($fileHeader)
        $memory.Write($headerBytes, 0, $headerBytes.Length)
        $memory.Write($FileBytes, 0, $FileBytes.Length)
        $tailBytes = $encoding.GetBytes("`r`n--$boundary--`r`n")
        $memory.Write($tailBytes, 0, $tailBytes.Length)
        $bodyBytes = $memory.ToArray()
    } finally { $memory.Dispose() }

    $parameters = @{
        Uri = ($apiBase + '/api/payments/with-receipt')
        Method = 'POST'
        WebSession = $Session
        UseBasicParsing = $true
        TimeoutSec = 25
        ContentType = ('multipart/form-data; boundary=' + $boundary)
        Body = $bodyBytes
        Headers = @{ Accept = 'application/json' }
    }
    $statusCode = 0; $responseText = ''
    try {
        $response = Invoke-WebRequest @parameters
        $statusCode = [int]$response.StatusCode
        $responseText = [string]$response.Content
    } catch {
        $webResponse = $_.Exception.Response
        if ($null -eq $webResponse) { throw ('Multipart receipt request failed before HTTP response: ' + $_.Exception.Message) }
        $statusCode = [int]$webResponse.StatusCode
        $stream = $webResponse.GetResponseStream()
        if ($null -ne $stream) {
            $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::UTF8)
            try { $responseText = $reader.ReadToEnd() } finally { $reader.Dispose(); $stream.Dispose() }
        }
    }
    $json = $null
    if (-not [string]::IsNullOrWhiteSpace($responseText)) { try { $json = ConvertFrom-Json -InputObject $responseText -ErrorAction Stop } catch { } }
    return [pscustomobject]@{ StatusCode=$statusCode; Text=$responseText; Json=$json }
}
function Get-FunctionalReceiptBytes {
    param([Microsoft.PowerShell.Commands.WebRequestSession]$Session, [string]$Path)
    $request = [System.Net.HttpWebRequest]::Create($apiBase + $Path)
    $request.Method = 'GET'
    $request.CookieContainer = $Session.Cookies
    $request.Accept = 'image/png'
    $request.Timeout = 25000
    $response = $null
    try {
        $response = [System.Net.HttpWebResponse]$request.GetResponse()
        $stream = $response.GetResponseStream()
        $memory = [System.IO.MemoryStream]::new()
        try { $stream.CopyTo($memory); $bytes = $memory.ToArray() } finally { $memory.Dispose(); $stream.Dispose() }
        return [pscustomobject]@{
            StatusCode = [int]$response.StatusCode
            ContentType = [string]$response.ContentType
            ContentDisposition = [string]$response.Headers['Content-Disposition']
            CacheControl = [string]$response.Headers['Cache-Control']
            Nosniff = [string]$response.Headers['X-Content-Type-Options']
            Bytes = $bytes
        }
    } finally { if ($null -ne $response) { $response.Dispose() } }
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
    $script:reportPath = Join-Path $paths.Logs ('financial-artifacts-api-acceptance-' + $stamp + '.json')
    $apiOut = Join-Path $paths.Logs ('financial-artifacts-api-' + $stamp + '-output.log')
    $apiErr = Join-Path $paths.Logs ('financial-artifacts-api-' + $stamp + '-error.log')
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
    Assert-Functional ((@($productionBefore.AppliedMigrations) -join '|') -ceq ($expectedMigrations -join '|')) 'Production schema reports the expected 14 migration versions before functional acceptance.'
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
    if ($migrationFiles.Count -ne 14) { throw "Expected 14 migrations, found $($migrationFiles.Count)." }
    foreach ($migration in $migrationFiles) {
        $version = [IO.Path]::GetFileNameWithoutExtension($migration.Name)
        if ($version -notmatch '^\d{3}_[a-z0-9_]+$') { throw ('Unexpected migration filename: ' + $migration.Name) }
        Write-FunctionalStep ('Applying ' + $version + ' to the disposable database.')
        Invoke-DarPgTool -Tool 'psql' -Arguments @('-X','-h','127.0.0.1','-p',[string]$secrets.Port,'-U',$secrets.AppUser,'-d',$databaseName,'-v','ON_ERROR_STOP=1','-f',$migration.FullName) -Password $secrets.AppPassword | Out-Null
        Invoke-DarPgTool -Tool 'psql' -Arguments @('-X','-h','127.0.0.1','-p',[string]$secrets.Port,'-U',$secrets.AppUser,'-d',$databaseName,'-v','ON_ERROR_STOP=1','-c',("INSERT INTO public.schema_migrations(version) VALUES ('$version');")) -Password $secrets.AppPassword | Out-Null
    }
    $temporaryReport = Get-DarDatabaseRestoreReport -Secrets $secrets -DatabaseName $databaseName
    Assert-Functional ($temporaryReport.AppliedMigrationCount -eq 14 -and @($temporaryReport.AppliedMigrations).Count -eq 14) 'Disposable database received all 14 migrations before API startup.'
    $script:checks['temporarySchema12Of12'] = 'PASS'

    $script:failureStage = 'isolated-api-start'
    $connection = "Host=127.0.0.1;Port=$($secrets.Port);Database=$databaseName;Username=$($secrets.AppUser);Password=$($secrets.AppPassword);Pooling=false;Timeout=5;Command Timeout=30;Application Name=DarFinancialArtifactsAcceptance"
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


    $script:failureStage = 'financial-artifacts-api-acceptance'
    $today = [DateTime]::Now.Date
    $todayText = $today.ToString('yyyy-MM-dd',[Globalization.CultureInfo]::InvariantCulture)
    $billingMonth = $today.ToString('yyyy-MM',[Globalization.CultureInfo]::InvariantCulture)
    $monthStart = [DateTime]::new($today.Year, $today.Month, 1)
    $previousDay = $monthStart.AddDays(-1)
    $startDate = $today.AddDays(-30).ToString('yyyy-MM-dd',[Globalization.CultureInfo]::InvariantCulture)
    $token = $suffix.Substring(0,10)
    $adminUsername = 'artifacts_' + $token
    $adminPassword = New-DarStrongPassword
    $adminSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession

    $adminSetup = Invoke-FunctionalApi -Session $adminSession -Method 'POST' -Path '/api/setup/admin' -Body @{ username=$adminUsername; displayName='Financial Artifacts Acceptance Admin'; password=$adminPassword }
    Assert-HttpStatus $adminSetup 200 'Create first administrator in financial-artifacts disposable database'
    $script:checks['isolatedAdmin'] = 'PASS'

    $teacherCode = 'FAT-' + $token
    $teacher = Invoke-FunctionalApi -Session $adminSession -Method 'POST' -Path '/api/teachers' -Body @{ teacherCode=$teacherCode; fullName=('اختبار معلمة مالية ' + $token); phone=$null; hourlyRate=[decimal]120; status='active'; notes='synthetic artifacts acceptance' }
    Assert-HttpStatus $teacher 201 'Create synthetic teacher for advertising circle'
    $teacherId = [string]$teacher.Json.id
    $circle = Invoke-FunctionalApi -Session $adminSession -Method 'POST' -Path '/api/circles' -Body @{ circleCode=('FAC-' + $token); name=('حلقة اختبار المخرجات ' + $token); teacherId=$teacherId; monthlyFee=[decimal]150; scheduleText='Financial artifacts acceptance'; isActive=$true; startsOn=$startDate }
    Assert-HttpStatus $circle 201 'Create synthetic circle for ad-expense and enrollment tests'
    $circleId = [string]$circle.Json.id

    $student = Invoke-FunctionalApi -Session $adminSession -Method 'POST' -Path '/api/students' -Body @{ studentCode=('FAS-' + $token); fullName=('طالب اختبار المخرجات ' + $token); ageYears=12; phone=$null; guardianName='ولي أمر اختباري'; guardianPhone=$null; joinedOn=$startDate; status='active'; notes='synthetic financial artifacts acceptance' }
    Assert-HttpStatus $student 201 'Create synthetic student for charge and receipt'
    $studentId = [string]$student.Json.id
    $enrollment = Invoke-FunctionalApi -Session $adminSession -Method 'POST' -Path '/api/enrollments' -Body @{ studentId=$studentId; circleId=$circleId; startsOn=$startDate; agreedMonthlyFee=[decimal]150; allowClosedCircle=$false }
    Assert-HttpStatus $enrollment 201 'Create enrollment for collection artifacts'
    $enrollmentId = [string]$enrollment.Json.id
    $charge = Invoke-FunctionalApi -Session $adminSession -Method 'POST' -Path '/api/charges' -Body @{ enrollmentId=$enrollmentId; billingMonth=$billingMonth; amountDue=[decimal]150; note='receipt and report acceptance' }
    Assert-HttpStatus $charge 201 'Create monthly charge for receipt and snapshot tests'
    $chargeId = [string]$charge.Json.id

    # Create-only account: it can enter expenses/receipts/reports but cannot read any of them.
    $limitedUsername = 'artifact_create_' + $token
    $limitedPassword = New-DarStrongPassword
    $limitedPermissions = @('students.read','teachers.read','circles.read','finance.create')
    $limitedCreate = Invoke-FunctionalApi -Session $adminSession -Method 'POST' -Path '/api/admin/users' -Body @{ username=$limitedUsername; displayName='Financial Artifact Create Only'; password=$limitedPassword; isActive=$true; permissionCodes=$limitedPermissions }
    Assert-HttpStatus $limitedCreate 201 'Create finance.create-only user for receipt and expense entry'
    $limitedSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
    $limitedLogin = Invoke-FunctionalApi -Session $limitedSession -Method 'POST' -Path '/api/auth/login' -Body @{ username=$limitedUsername; password=$limitedPassword; rememberMe=$false }
    Assert-HttpStatus $limitedLogin 200 'Login create-only financial user'

    $script:failureStage = 'receipt-upload-and-download'
    $pngBytes = [Convert]::FromBase64String('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=')
    $invalidPdfReceiptBytes = [System.Text.Encoding]::ASCII.GetBytes('%PDF-1.4 invalid')
    $badReceipt = Invoke-FunctionalReceiptMultipart -Session $limitedSession -ChargeId $chargeId -Amount ([decimal]10) -FileBytes $invalidPdfReceiptBytes -FileName 'not-an-image.pdf' -ContentType 'application/pdf'
    Assert-HttpStatus $badReceipt 400 'Reject unsupported PDF receipt upload'
    $badSignatureReceipt = Invoke-FunctionalReceiptMultipart -Session $limitedSession -ChargeId $chargeId -Amount ([decimal]10) -FileBytes $invalidPdfReceiptBytes -FileName 'spoofed.png' -ContentType 'image/png'
    Assert-HttpStatus $badSignatureReceipt 400 'Reject non-PNG bytes declared as image/png'
    $beforeReceiptLedger = Invoke-FunctionalApi -Session $adminSession -Method 'GET' -Path ('/api/collections?month=' + $billingMonth)
    Assert-HttpStatus $beforeReceiptLedger 200 'Read ledger after rejected receipt uploads'
    $beforeReceiptRow = @($beforeReceiptLedger.Json | Where-Object { [string]$_.enrollmentId -eq $enrollmentId }) | Select-Object -First 1
    Assert-Functional ($null -ne $beforeReceiptRow -and [decimal]$beforeReceiptRow.paidAmount -eq [decimal]0) 'Rejected receipt uploads did not create a payment row.'

    $receiptUpload = Invoke-FunctionalReceiptMultipart -Session $limitedSession -ChargeId $chargeId -Amount ([decimal]25) -FileBytes $pngBytes -FileName 'synthetic-receipt.png' -ContentType 'image/png'
    Assert-HttpStatus $receiptUpload 201 'Upload PNG receipt with finance.create only'
    $paymentId = [string]$receiptUpload.Json.id
    Assert-Functional ($receiptUpload.Json.hasReceipt -eq $true -and $null -eq $receiptUpload.Json.amount) 'Create-only receipt response confirms receipt presence but redacts payment amount.'
    $limitedReceiptRead = Invoke-FunctionalApi -Session $limitedSession -Method 'GET' -Path ('/api/payments/' + $paymentId + '/receipt')
    Assert-HttpStatus $limitedReceiptRead 403 'Deny receipt download without finance.read'
    $downloadedReceipt = Get-FunctionalReceiptBytes -Session $adminSession -Path ('/api/payments/' + $paymentId + '/receipt?download=true')
    Assert-Functional ($downloadedReceipt.StatusCode -eq 200 -and $downloadedReceipt.ContentType -eq 'image/png') 'Authorized receipt download returns HTTP 200 and image/png.'
    Assert-Functional ([Convert]::ToBase64String($downloadedReceipt.Bytes) -ceq [Convert]::ToBase64String($pngBytes)) 'Downloaded receipt bytes exactly match the uploaded PNG.'
    Assert-Functional ($downloadedReceipt.CacheControl -match 'private' -and $downloadedReceipt.CacheControl -match 'no-store' -and $downloadedReceipt.Nosniff -eq 'nosniff' -and $downloadedReceipt.ContentDisposition -match '^attachment') 'Receipt response applies private no-store, nosniff and attachment headers.'
    $script:checks['receiptUploadDownloadAndPrivacy'] = 'PASS'

    $script:failureStage = 'operating-expense-acceptance'
    $operatingExpenseBody = @{ expenseDate=$todayText; category='مرافق'; description=('مصروف اختبار الإنترنت ' + $token); amount=[decimal]25.50; circleId=$null; note='synthetic isolated test; not a cash payment' }
    $limitedOperatingCreate = Invoke-FunctionalApi -Session $limitedSession -Method 'POST' -Path '/api/operating-expenses' -Body $operatingExpenseBody
    Assert-HttpStatus $limitedOperatingCreate 201 'Create operating expense with finance.create only'
    $operatingExpenseId = [string]$limitedOperatingCreate.Json.id
    Assert-Functional ($null -ne $operatingExpenseId -and $null -eq $limitedOperatingCreate.Json.amount) 'Create-only operating-expense response returns identity only.'
    $limitedOperatingList = Invoke-FunctionalApi -Session $limitedSession -Method 'GET' -Path ('/api/operating-expenses?month=' + $billingMonth)
    Assert-HttpStatus $limitedOperatingList 403 'Deny operating-expense list without finance.read'
    $limitedOperatingUpdate = Invoke-FunctionalApi -Session $limitedSession -Method 'PUT' -Path ('/api/operating-expenses/' + $operatingExpenseId) -Body $operatingExpenseBody
    Assert-HttpStatus $limitedOperatingUpdate 403 'Deny operating-expense edit without finance.edit and finance.read'
    $adminOperatingList = Invoke-FunctionalApi -Session $adminSession -Method 'GET' -Path ('/api/operating-expenses?month=' + $billingMonth)
    Assert-HttpStatus $adminOperatingList 200 'Read operating expenses as administrator'
    $operatingRow = @($adminOperatingList.Json | Where-Object { [string]$_.id -eq $operatingExpenseId }) | Select-Object -First 1
    Assert-Functional ($null -ne $operatingRow -and [decimal]$operatingRow.amount -eq [decimal]25.50 -and [string]$operatingRow.category -eq 'مرافق') 'Operating expense is stored with normalized amount, category and current-month date.'
    $updatedOperatingBody = @{ expenseDate=$todayText; category='مرافق'; description=('مصروف اختبار محدث ' + $token); amount=[decimal]35.75; circleId=$null; note='updated synthetic test' }
    $operatingUpdate = Invoke-FunctionalApi -Session $adminSession -Method 'PUT' -Path ('/api/operating-expenses/' + $operatingExpenseId) -Body $updatedOperatingBody
    Assert-HttpStatus $operatingUpdate 200 'Update operating expense as finance editor'
    $updatedOperatingList = Invoke-FunctionalApi -Session $adminSession -Method 'GET' -Path ('/api/operating-expenses?month=' + $billingMonth)
    Assert-HttpStatus $updatedOperatingList 200 'Reload updated operating expense'
    $updatedOperatingRow = @($updatedOperatingList.Json | Where-Object { [string]$_.id -eq $operatingExpenseId }) | Select-Object -First 1
    Assert-Functional ($null -ne $updatedOperatingRow -and [decimal]$updatedOperatingRow.amount -eq [decimal]35.75 -and [string]$updatedOperatingRow.description -eq $updatedOperatingBody.description) 'Operating expense update persists the new amount and description.'
    $circleOperatingBody = @{ expenseDate=$todayText; category='نشاط حلقة'; description=('مصروف مرتبط بحلقة اختبار ' + $token); amount=[decimal]18.25; circleId=$circleId; note='synthetic circle-linked operating expense' }
    $circleOperatingCreate = Invoke-FunctionalApi -Session $limitedSession -Method 'POST' -Path '/api/operating-expenses' -Body $circleOperatingBody
    Assert-HttpStatus $circleOperatingCreate 201 'Create circle-linked operating expense with finance.create only'
    $circleOperatingId = [string]$circleOperatingCreate.Json.id
    $circleOperatingList = Invoke-FunctionalApi -Session $adminSession -Method 'GET' -Path ('/api/operating-expenses?month=' + $billingMonth)
    Assert-HttpStatus $circleOperatingList 200 'Read circle-linked operating expense as administrator'
    $circleOperatingRow = @($circleOperatingList.Json | Where-Object { [string]$_.id -eq $circleOperatingId }) | Select-Object -First 1
    Assert-Functional ($null -ne $circleOperatingRow -and [string]$circleOperatingRow.circleId -eq $circleId -and [decimal]$circleOperatingRow.amount -eq [decimal]18.25) 'Circle-linked operating expense preserves its optional UUID association.'
    $roundedOperatingBody = @{ expenseDate=$todayText; category='مرافق'; description=('مصروف اختبار تقريب العملة ' + $token); amount=[decimal]12.345; circleId=$null; note='shared currency normalization acceptance' }
    $roundedOperatingCreate = Invoke-FunctionalApi -Session $adminSession -Method 'POST' -Path '/api/operating-expenses' -Body $roundedOperatingBody
    Assert-HttpStatus $roundedOperatingCreate 201 'Normalize operating expense amount with extra decimal precision'
    $roundedOperatingId = [string]$roundedOperatingCreate.Json.id
    $roundedOperatingList = Invoke-FunctionalApi -Session $adminSession -Method 'GET' -Path ('/api/operating-expenses?month=' + $billingMonth)
    Assert-HttpStatus $roundedOperatingList 200 'Read normalized operating expense'
    $roundedOperatingRow = @($roundedOperatingList.Json | Where-Object { [string]$_.id -eq $roundedOperatingId }) | Select-Object -First 1
    Assert-Functional ($null -ne $roundedOperatingRow -and [decimal]$roundedOperatingRow.amount -eq [decimal]12.35) 'Operating expense currency follows shared two-decimal midpoint-away-from-zero normalization (12.345 becomes 12.35).'
    $script:checks['operatingExpenseCrudAndPermissions'] = 'PASS'

    $script:failureStage = 'advertising-expense-proration'
    $adStartText = $previousDay.ToString('yyyy-MM-dd',[Globalization.CultureInfo]::InvariantCulture)
    $adCreate = Invoke-FunctionalApi -Session $limitedSession -Method 'POST' -Path '/api/advertising-expenses' -Body @{ circleId=$circleId; platform='Synthetic Test'; startDate=$adStartText; daysCount=3; dailyCost=[decimal]7.25; note='test crosses month boundary' }
    Assert-HttpStatus $adCreate 201 'Create advertising expense spanning a month boundary with finance.create only'
    Assert-Functional ($null -ne $adCreate.Json.id -and $null -eq $adCreate.Json.totalAmount) 'Create-only advertising response exposes the record ID but redacts its total.'
    $adList = Invoke-FunctionalApi -Session $adminSession -Method 'GET' -Path ('/api/advertising-expenses?month=' + $billingMonth)
    Assert-HttpStatus $adList 200 'Read advertising expenses for selected month'
    $adRow = @($adList.Json | Where-Object { [string]$_.circleId -eq $circleId -and [string]$_.platform -eq 'Synthetic Test' }) | Select-Object -First 1
    Assert-Functional ($null -ne $adRow -and [int]$adRow.overlapDays -eq 2 -and [decimal]$adRow.monthAmount -eq [decimal]14.50 -and [decimal]$adRow.totalAmount -eq [decimal]21.75) 'Advertising monthly cost prorates exactly the two campaign days inside the selected month.'
    $invalidAd = Invoke-FunctionalApi -Session $adminSession -Method 'POST' -Path '/api/advertising-expenses' -Body @{ circleId=$circleId; platform='Bad'; startDate=$todayText; daysCount=0; dailyCost=[decimal]1; note=$null }
    Assert-HttpStatus $invalidAd 400 'Reject advertising campaign with zero days'
    $script:checks['advertisingExpenseProrationAndValidation'] = 'PASS'

    $script:failureStage = 'saved-collection-report-snapshot'
    $snapshotCreate = Invoke-FunctionalApi -Session $limitedSession -Method 'POST' -Path '/api/collection-reports' -Body @{ billingMonth=$billingMonth; title=('لقطة اختبار ' + $token) }
    Assert-HttpStatus $snapshotCreate 201 'Save collection report snapshot with finance.create only'
    $reportId = [string]$snapshotCreate.Json.id
    $snapshotBefore = Invoke-FunctionalApi -Session $adminSession -Method 'GET' -Path ('/api/collection-reports/' + $reportId)
    Assert-HttpStatus $snapshotBefore 200 'Read saved collection report snapshot'
    Assert-Functional ($null -ne $snapshotBefore.Json.snapshot -and [decimal]$snapshotBefore.Json.snapshot.totalDue -eq [decimal]150 -and [decimal]$snapshotBefore.Json.snapshot.totalPaid -eq [decimal]25 -and [decimal]$snapshotBefore.Json.snapshot.totalBalance -eq [decimal]125) 'Saved report contains the due/paid/balance totals at the exact time it was created.'
    $limitedReportRead = Invoke-FunctionalApi -Session $limitedSession -Method 'GET' -Path ('/api/collection-reports/' + $reportId)
    Assert-HttpStatus $limitedReportRead 403 'Deny saved report snapshot access without finance.read'
    $additionalPayment = Invoke-FunctionalApi -Session $adminSession -Method 'POST' -Path '/api/payments' -Body @{ monthlyChargeId=$chargeId; amount=[decimal]10; paidAt=$null; method='cash'; reference='snapshot-after-save'; note='payment after saved report' }
    Assert-HttpStatus $additionalPayment 201 'Record a later payment after the report snapshot'
    $snapshotAfter = Invoke-FunctionalApi -Session $adminSession -Method 'GET' -Path ('/api/collection-reports/' + $reportId)
    Assert-HttpStatus $snapshotAfter 200 'Reopen saved report after a later payment'
    Assert-Functional ($null -ne $snapshotAfter.Json.snapshot -and [decimal]$snapshotAfter.Json.snapshot.totalPaid -eq [decimal]25 -and [decimal]$snapshotAfter.Json.snapshot.totalBalance -eq [decimal]125) 'Saved collection report remains immutable after a later payment.'
    $currentCollections = Invoke-FunctionalApi -Session $adminSession -Method 'GET' -Path ('/api/collections?month=' + $billingMonth)
    Assert-HttpStatus $currentCollections 200 'Read live collections after later payment'
    $currentRow = @($currentCollections.Json | Where-Object { [string]$_.enrollmentId -eq $enrollmentId }) | Select-Object -First 1
    Assert-Functional ($null -ne $currentRow -and [decimal]$currentRow.paidAmount -eq [decimal]35 -and [decimal]$currentRow.balance -eq [decimal]115) 'Live ledger reflects the later payment while the saved snapshot stays unchanged.'
    $reportList = Invoke-FunctionalApi -Session $adminSession -Method 'GET' -Path ('/api/collection-reports?month=' + $billingMonth)
    Assert-HttpStatus $reportList 200 'List saved collection reports'
    Assert-Functional (@($reportList.Json | Where-Object { [string]$_.id -eq $reportId }).Count -eq 1) 'Saved collection report appears in the selected-month report list.'
    $script:checks['collectionReportSnapshotImmutability'] = 'PASS'

    $script:failureStage = 'production-readonly-postcheck'
    $productionAfter = Get-DarDatabaseRestoreReport -Secrets $secrets -DatabaseName $secrets.Database
    $productionSignatureAfter = Get-FunctionalReportSignature $productionAfter
    Assert-Functional ($productionSignatureBefore -ceq $productionSignatureAfter) 'Production Dar logical signature is unchanged after financial-artifacts acceptance.'
    $script:checks['productionUnchanged'] = 'PASS'
    $script:result = 'PASS'
    Write-FunctionalStep 'All receipt, operating/advertising expense and saved-report snapshot API scenarios passed against the isolated disposable database.' 'PASS'
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
Write-FunctionalStep 'PASS: Financial artifacts API acceptance completed; production database logical signature is unchanged.' 'PASS'
Write-Output 'DAR_TEST_RESULT=PASS'
exit 0
