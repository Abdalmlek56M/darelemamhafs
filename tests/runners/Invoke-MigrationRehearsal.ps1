$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$localPostgresPath = Join-Path $projectRoot 'tools\LocalPostgres.ps1'
if (-not (Test-Path -LiteralPath $localPostgresPath -PathType Leaf)) { throw 'LocalPostgres.ps1 is missing.' }
. $localPostgresPath

function Write-Step([string]$Message) { Write-Host ('[Migration rehearsal] ' + $Message) -ForegroundColor Cyan }
function Test-TcpPort([int]$Port) {
    $client = New-Object System.Net.Sockets.TcpClient
    try { $async=$client.BeginConnect('127.0.0.1',$Port,$null,$null); if (-not $async.AsyncWaitHandle.WaitOne(700)) { return $false }; $client.EndConnect($async); return $true }
    catch { return $false } finally { $client.Close() }
}
function Get-ListeningProcessSummary([int]$Port) {
    $connections = @()
    try { $connections = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) } catch { }
    $owners = @($connections | Select-Object -ExpandProperty OwningProcess -Unique)
    if ($owners.Count -eq 0) { return "Port $Port is no longer listening." }
    $items = foreach ($ownerId in $owners) {
        $process = Get-Process -Id ([int]$ownerId) -ErrorAction SilentlyContinue
        $processInfo = $null
        try { $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $ownerId" -ErrorAction SilentlyContinue } catch { }
        $name = if ($process) { $process.ProcessName } elseif ($processInfo) { [System.IO.Path]::GetFileNameWithoutExtension($processInfo.Name) } else { 'Unknown process' }
        $role = if ($processInfo -and $processInfo.CommandLine -match 'DarEltahfeez\.Api\.(dll|exe)') { ' — Dar API' } else { '' }
        '{0} (PID {1}){2}' -f $name,$ownerId,$role
    }
    return ('Port {0} is listening under: {1}. Close the Dar window and wait for the START_DAR console to finish cleanup. If it remains, inspect tools\Show-DarPortOwner.ps1; stop only a verified Dar API process and never postgres.exe.' -f $Port,($items -join '; '))
}
function Get-ReportSignature($Report) {
    # Compare logical database contents and validated schema, not physical file size.
    # PostgreSQL may grow relation/catalog files through background maintenance even when
    # the API smoke test performs only read-only requests.
    $parts = New-Object System.Collections.Generic.List[string]
    foreach ($field in @(
        'Encoding','TableCount','RequiredTableCount','AppliedMigrationCount','RequiredColumnCount',
        'ForeignKeyCount','RequiredForeignKeyCount','UnvalidatedForeignKeyCount','InvalidIndexCount','RequiredFunctionCount','RequiredTriggerCount'
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
function Get-DatabaseSizeDelta($Before, $After) {
    return ([long]$After.DatabaseSizeBytes - [long]$Before.DatabaseSizeBytes)
}
function Remove-RehearsalDatabase([string]$Name,$Secrets) {
    if ($Name -notmatch '^dar_migration_rehearsal_[a-f0-9]{16}$') { throw "Refusing to drop a database outside the migration rehearsal allow-list: $Name" }
    if (Test-DarDatabaseExists -Secrets $Secrets -DatabaseName $Name) {
        Invoke-DarPgTool -Tool 'psql' -Arguments @('-h','127.0.0.1','-p',[string]$Secrets.Port,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c',"DROP DATABASE IF EXISTS $Name WITH (FORCE);") -Password $Secrets.PostgresAdminPassword | Out-Null
    }
    if (Test-DarDatabaseExists -Secrets $Secrets -DatabaseName $Name) { throw "Temporary migration rehearsal database remains: $Name" }
}
function Restore-ProcessEnvironment($Names,$Values) {
    foreach ($name in $Names) {
        if ($Values.ContainsKey($name) -and $null -ne $Values[$name]) { Set-Item -Path ('Env:' + $name) -Value ([string]$Values[$name]) }
        else { Remove-Item -Path ('Env:' + $name) -ErrorAction SilentlyContinue }
    }
}

$result='FAIL'; $failureMessage=$null; $skipMessage=$null
$testApiProcessId=$null; $testApiProcess=$null; $apiStopped=$true; $secrets=$null; $stagingDatabase=$null
$apiOut=$null; $apiErr=$null; $reportPath=$null; $reportData=$null
$logRoot=Join-Path $env:LOCALAPPDATA 'DarEltahfeez\Logs'
$tempRoot=Join-Path ([IO.Path]::GetTempPath()) ('DarMigrationRehearsal_' + [Guid]::NewGuid().ToString('N'))
try {
    do {
        $paths=Get-DarLocalPaths
        if (Test-DarTcpPortListening -Port 5080) { $result='SKIP'; $skipMessage=Get-ListeningProcessSummary 5080; break }
        if (Test-TcpPort 5081) { $result='SKIP'; $skipMessage='Test port 5081 is already occupied. Close the other local service before rehearsal.'; break }
        if (-not (Test-Path -LiteralPath $paths.Secrets -PathType Leaf) -or -not (Test-Path -LiteralPath (Join-Path $paths.Data 'PG_VERSION') -PathType Leaf)) { $result='SKIP'; $skipMessage='The existing local PostgreSQL cluster and secrets must be prepared first. This test will not initialize a cluster.'; break }
        $apiDir=Join-Path $projectRoot 'backend\DarEltahfeez.Api'
        $apiDll=Join-Path $apiDir 'bin\Debug\net10.0\DarEltahfeez.Api.dll'
        $webIndex=Join-Path $apiDir 'wwwroot\index.html'
        $dotnetCommand=Get-Command 'dotnet.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
        $dotnetExecutable=if ($dotnetCommand) { $dotnetCommand.Source } else { $null }
        if (-not $dotnetExecutable) {
            $dotnetCandidates=@((Join-Path $env:ProgramFiles 'dotnet\dotnet.exe'),(Join-Path ${env:ProgramFiles(x86)} 'dotnet\dotnet.exe')) | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf }
            $dotnetExecutable=$dotnetCandidates | Select-Object -First 1
        }
        if (-not $dotnetExecutable -or -not (Test-Path -LiteralPath $apiDll -PathType Leaf) -or -not (Test-Path -LiteralPath $webIndex -PathType Leaf)) { $result='SKIP'; $skipMessage='Run BUILD_DAR_FOR_REHEARSAL.bat first. The local .NET 10 API DLL and frontend wwwroot assets are required; the test also checks the standard .NET installation folders.'; break }
        $secrets=Get-DarDatabaseSecrets
        Assert-DarDatabaseSecrets -Secrets $secrets
        $pgBin=Get-DarPostgresBin -ProjectRoot $projectRoot
        if ([string]::IsNullOrWhiteSpace([string]$pgBin)) { $result='SKIP'; $skipMessage='The existing PostgreSQL runtime is unavailable. No download or cluster initialization is performed by this test.'; break }
        # All shared PostgreSQL helpers resolve pg_ctl/psql/pg_restore through this
        # script-scoped variable. Assign the verified runtime path before any DB call.
        $script:DarPgBin = [string]$pgBin
        if (-not (Test-Path -LiteralPath (Join-Path $script:DarPgBin 'pg_restore.exe') -PathType Leaf)) {
            throw ('The verified PostgreSQL runtime path does not contain pg_restore.exe: ' + $script:DarPgBin)
        }
        Write-Step ('Using existing PostgreSQL runtime: ' + $script:DarPgBin)
        New-Item -ItemType Directory -Force -Path $paths.Logs | Out-Null

        $startupMutex=[System.Threading.Mutex]::new($false,'Global\DarEltahfeez_Postgres_55432'); $ownsMutex=$false
        try {
            try { $ownsMutex=$startupMutex.WaitOne([TimeSpan]::FromSeconds(30)) } catch [System.Threading.AbandonedMutexException] { $ownsMutex=$true }
            if (-not $ownsMutex) { throw 'Another Dar process is initializing PostgreSQL. Retry when it finishes.' }
            if (-not (Test-DarExpectedPostgresIdentity -Secrets $secrets -Paths $paths)) { Start-DarPostgresServer -Secrets $secrets -Paths $paths }
        } finally { if ($ownsMutex) { $startupMutex.ReleaseMutex() }; $startupMutex.Dispose() }
        if (-not (Test-DarExpectedPostgresIdentity -Secrets $secrets -Paths $paths)) { throw 'The expected local PostgreSQL server identity could not be verified.' }
        if (-not (Test-DarDatabaseExists -Secrets $secrets -DatabaseName $secrets.Database)) { throw 'The source Dar database is missing. Migration rehearsal stopped without creating a replacement.' }
        if (Test-DarTcpPortListening -Port 5080) { $result='SKIP'; $skipMessage=('Production API became active during preflight. ' + (Get-ListeningProcessSummary 5080)); break }

        # Test 10 must use the exact archive accepted by the most recent successful Test 8 run.
        # This removes the possibility of choosing a different stale/manifest-less archive.
        $acceptedBackupReferencePath=Join-Path $env:LOCALAPPDATA 'DarEltahfeez\TestRuns\test8-accepted-backup.json'
        if (-not (Test-Path -LiteralPath $acceptedBackupReferencePath -PathType Leaf)) {
            $result='SKIP'; $skipMessage='Run Test 8 individually and let it finish PASS first. Test 10 does not choose a different backup.'; break
        }
        try { $acceptedBackupReference=Get-Content -LiteralPath $acceptedBackupReferencePath -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop }
        catch { throw ('The Test 8 accepted-backup reference is unreadable: ' + $_.Exception.Message) }
        if ([int]$acceptedBackupReference.SchemaVersion -ne 1 -or [string]$acceptedBackupReference.AcceptedBy -cne 'Test 8' -or [string]$acceptedBackupReference.DatabaseName -cne [string]$secrets.Database) {
            throw 'The saved Test 8 backup acceptance reference does not match the current Dar database.'
        }
        $backupPath=[IO.Path]::GetFullPath([string]$acceptedBackupReference.BackupPath)
        if (-not (Test-Path -LiteralPath $backupPath -PathType Leaf)) { throw 'The exact backup accepted by Test 8 is no longer present. Rerun Test 8 with a current full backup.' }
        $verifiedManifest=Get-DarVerifiedBackupManifest -BackupPath $backupPath -Secrets $secrets
        if (-not [string]::Equals([string]$verifiedManifest.Sha256,[string]$acceptedBackupReference.Sha256,[StringComparison]::OrdinalIgnoreCase)) {
            throw 'The selected archive SHA-256 differs from the exact backup accepted by Test 8.'
        }
        if (-not [string]::Equals([IO.Path]::GetFullPath([string]$verifiedManifest.Path),[IO.Path]::GetFullPath([string]$acceptedBackupReference.ManifestPath),[StringComparison]::OrdinalIgnoreCase)) {
            throw 'The backup sidecar manifest path differs from the exact reference accepted by Test 8.'
        }
        Write-Step ("Using the exact backup accepted by Test 8: $backupPath")
        Test-DarBackupArchive -BackupPath $backupPath | Out-Null
        $backupInfo=Get-Item -LiteralPath $backupPath
        $backupHash=[string]$verifiedManifest.Sha256
        $productionBefore=Get-DarDatabaseRestoreReport -Secrets $secrets -DatabaseName $secrets.Database
        $productionSignatureBefore=Get-ReportSignature $productionBefore
        $expectedCurrentMigrations=@(
            '001_initial_schema','002_management_security','003_schedule_attendance_ads_receipts',
            '004_operating_expenses','005_system_admin','006_student_attendance',
            '007_student_attendance_active_unique','008_schedule_slot_active_unique',
            '009_teacher_notes','010_circle_start_date','011_enrollment_lifecycle_audit_index',
            '012_teacher_schedule_no_overlap'
        )
        if (@($productionBefore.AppliedMigrations).Count -ne $expectedCurrentMigrations.Count -or (@($productionBefore.AppliedMigrations) -join '|') -cne ($expectedCurrentMigrations -join '|')) {
            throw ('Production Dar database is not at the expected 12-migration schema. Applied=[' + (@($productionBefore.AppliedMigrations) -join ', ') + '].')
        }
        Write-Step ("Current production schema: migrations={0}/12; required lifecycle functions={1}; triggers={2}." -f $productionBefore.AppliedMigrationCount,$productionBefore.RequiredFunctionCount,$productionBefore.RequiredTriggerCount)

        $suffix=[Guid]::NewGuid().ToString('N').Substring(0,16)
        $stagingDatabase='dar_migration_rehearsal_' + $suffix
        if ($stagingDatabase -notmatch '^dar_migration_rehearsal_[a-f0-9]{16}$') { throw 'Generated staging database name failed the safety allow-list.' }
        if (Test-DarDatabaseExists -Secrets $secrets -DatabaseName $stagingDatabase) { throw 'Unexpected staging database name collision.' }
        New-DarDatabase -DatabaseName $stagingDatabase -Secrets $secrets
        Write-Step "Restoring selected archive into isolated database $stagingDatabase ..."
        Invoke-DarPgTool -Tool 'pg_restore' -Arguments @('--no-owner','--no-privileges','--exit-on-error','--single-transaction','-h','127.0.0.1','-p',[string]$secrets.Port,'-U',$secrets.AppUser,'-d',$stagingDatabase,$backupPath) -Password $secrets.AppPassword | Out-Null
        $stagingBefore=Get-DarDatabaseRestoreReport -Secrets $secrets -DatabaseName $stagingDatabase
        $stagingSignatureBefore=Get-ReportSignature $stagingBefore
        if ($stagingBefore.AppliedMigrationCount -ne $productionBefore.AppliedMigrationCount -or (@($stagingBefore.AppliedMigrations) -join '|') -cne (@($productionBefore.AppliedMigrations) -join '|')) {
            throw ('Selected rehearsal backup is not from the current 12-migration schema. Production=[' + (@($productionBefore.AppliedMigrations) -join ', ') + ']; backup=[' + (@($stagingBefore.AppliedMigrations) -join ', ') + '].')
        }
        if ($stagingSignatureBefore -cne $productionSignatureBefore) {
            throw 'Selected rehearsal backup does not match the current production database logical snapshot. Recreate a full backup with Dar System Center, stop writes, and select the new archive.'
        }
        Write-Host ("PASS: Backup restored and matched current Dar logical snapshot. Tables={0}; ForeignKeys={1}; Migrations={2}/12; RequiredFunctions={3}; RequiredTriggers={4}; Size={5} bytes." -f $stagingBefore.TableCount,$stagingBefore.ForeignKeyCount,$stagingBefore.AppliedMigrationCount,$stagingBefore.RequiredFunctionCount,$stagingBefore.RequiredTriggerCount,$stagingBefore.DatabaseSizeBytes)

        $stamp=Get-Date -Format 'yyyyMMdd_HHmmss_fff'
        $reportPath=Join-Path $paths.Logs "migration-rehearsal-$stamp.json"
        $reportData=[ordered]@{
            createdAt=(Get-Date -Format o); result='RUNNING'; version='0.8.25.0';
            backup=[ordered]@{ fileName=[IO.Path]::GetFileName($backupPath); createdAtUtc=$verifiedManifest.CreatedAtUtc.ToString('o'); sizeBytes=[long]$backupInfo.Length; sha256=$backupHash };
            production=[ordered]@{ database=$secrets.Database; appliedMigrations=$productionBefore.AppliedMigrations; requiredFunctions=$productionBefore.RequiredFunctions; requiredTriggers=$productionBefore.RequiredTriggers; databaseSizeBeforeBytes=[long]$productionBefore.DatabaseSizeBytes };
            target=[ordered]@{ database=$stagingDatabase; tableCount=$stagingBefore.TableCount; foreignKeyCount=$stagingBefore.ForeignKeyCount; databaseSizeBeforeBytes=[long]$stagingBefore.DatabaseSizeBytes; tableCounts=$stagingBefore.TableCounts; appliedMigrations=$stagingBefore.AppliedMigrations; requiredFunctions=$stagingBefore.RequiredFunctions; requiredTriggers=$stagingBefore.RequiredTriggers };
            checks=[ordered]@{ backupRestore='PASS'; apiHealth='PENDING'; reactIndex='PENDING'; javascriptAssets='PENDING'; cssAssets='PENDING'; targetUnchanged='PENDING'; productionUnchanged='PENDING'; migrationsAppliedByRehearsal=$false; apiProcessStopped='PENDING'; apiPortReleased='PENDING'; stagingDatabaseRemoved='PENDING' };
            note='Isolated same-machine migration rehearsal. The WPF shell and real laptop installation are not tested by this report.'
        }

        $connection="Host=127.0.0.1;Port=$($secrets.Port);Database=$stagingDatabase;Username=$($secrets.AppUser);Password=$($secrets.AppPassword);Pooling=false;Timeout=5;Command Timeout=30;Application Name=DarMigrationRehearsal;Options=-c default_transaction_read_only=on"
        $apiOut=Join-Path $paths.Logs "migration-api-$stamp-output.log"
        $apiErr=Join-Path $paths.Logs "migration-api-$stamp-error.log"
        $oldEnvironment=@{}
        $environmentNames=@('DAR_ISOLATED_REHEARSAL','DAR_DATABASE_CONNECTION_STRING','DAR_APPLY_MIGRATIONS_ON_STARTUP','ASPNETCORE_URLS','ASPNETCORE_ENVIRONMENT')
        foreach ($name in $environmentNames) { $oldEnvironment[$name]=[Environment]::GetEnvironmentVariable($name,'Process') }
        try {
            $env:DAR_ISOLATED_REHEARSAL='1'
            $env:DAR_DATABASE_CONNECTION_STRING=$connection
            $env:DAR_APPLY_MIGRATIONS_ON_STARTUP='false'
            $env:ASPNETCORE_ENVIRONMENT='Production'
            $env:ASPNETCORE_URLS='http://127.0.0.1:5081'
            $apiArgs='"' + $apiDll + '" --urls http://127.0.0.1:5081'
            $testApiProcess=Start-Process -FilePath $dotnetExecutable -ArgumentList $apiArgs -WorkingDirectory $apiDir -PassThru -WindowStyle Hidden -RedirectStandardOutput $apiOut -RedirectStandardError $apiErr
            $testApiProcessId=$testApiProcess.Id
            $apiStopped=$false
        } finally { Restore-ProcessEnvironment -Names $environmentNames -Values $oldEnvironment }

        Write-Step 'Starting isolated API against the restored database on port 5081 (production API remains closed).'
        $deadline=(Get-Date).AddSeconds(40); $health=$null
        while ((Get-Date) -lt $deadline) {
            $processState=Get-Process -Id $testApiProcessId -ErrorAction SilentlyContinue
            if (-not $processState) { throw 'Isolated API process exited before health check succeeded. Review migration-api error log.' }
            try {
                $health=Invoke-RestMethod -Uri 'http://127.0.0.1:5081/health' -TimeoutSec 2
                if ($health.status -eq 'ok' -and $health.database -eq 'connected' -and $health.service -eq 'DarEltahfeez.Api') { break }
            } catch { }
            Start-Sleep -Milliseconds 400
        }
        if ($null -eq $health -or $health.status -ne 'ok' -or $health.database -ne 'connected') {
            $tail=''
            if (Test-Path $apiErr) { $tail=(Get-Content -LiteralPath $apiErr -Tail 40 -ErrorAction SilentlyContinue) -join "`n" }
            throw "Isolated API did not become healthy on port 5081. $tail"
        }
        Write-Host 'PASS: Isolated API health check connected to the restored staging database.'
        $reportData.checks.apiHealth='PASS'

        $homePageResponse=Invoke-WebRequest -Uri 'http://127.0.0.1:5081/' -TimeoutSec 8 -UseBasicParsing
        if ([int]$homePageResponse.StatusCode -ne 200 -or $homePageResponse.Content -notmatch 'id\s*=\s*["'']root["'']') { throw 'The restored-database API did not serve the expected React application entry page.' }
        Write-Host 'PASS: React application entry page is served by the isolated API.'
        $reportData.checks.reactIndex='PASS'
        $jsMatches=[regex]::Matches($homePageResponse.Content,'src\s*=\s*(?:\x22|\x27)([^\x22\x27]+\.js)(?:\x22|\x27)')
        $cssMatches=[regex]::Matches($homePageResponse.Content,'href\s*=\s*(?:\x22|\x27)([^\x22\x27]+\.css)(?:\x22|\x27)')
        if ($jsMatches.Count -lt 1 -or $cssMatches.Count -lt 1) { throw 'The React entry page did not reference both JS and CSS bundles.' }
        foreach ($asset in @($jsMatches[0].Groups[1].Value,$cssMatches[0].Groups[1].Value)) {
            $assetUrl='http://127.0.0.1:5081/' + $asset.TrimStart('/')
            $assetResponse=Invoke-WebRequest -Uri $assetUrl -TimeoutSec 8 -UseBasicParsing
            if ([int]$assetResponse.StatusCode -ne 200) { throw "A frontend asset was not served: $asset" }
        }
        Write-Host 'PASS: React JavaScript and CSS bundles are served by the isolated API.'
        $reportData.checks.javascriptAssets='PASS'; $reportData.checks.cssAssets='PASS'

        $stagingAfter=Get-DarDatabaseRestoreReport -Secrets $secrets -DatabaseName $stagingDatabase
        if ((Get-ReportSignature $stagingAfter) -cne $stagingSignatureBefore) {
            throw 'Isolated API smoke test changed logical table row counts, migration history, or validated schema metadata in the staged database.'
        }
        $stagingSizeDelta=Get-DatabaseSizeDelta -Before $stagingBefore -After $stagingAfter
        Write-Host 'PASS: Staged database logical signature remained unchanged after HTTP smoke tests.'
        if ($stagingSizeDelta -ne 0) { Write-Host ("INFO: PostgreSQL physical database size changed by {0} bytes; size is recorded separately and is not treated as a logical data/schema mutation." -f $stagingSizeDelta) -ForegroundColor DarkYellow }
        $reportData.checks.targetUnchanged='PASS'
        $reportData.target.databaseSizeAfterBytes=[long]$stagingAfter.DatabaseSizeBytes
        $reportData.target.databaseSizeDeltaBytes=[long]$stagingSizeDelta

        $productionAfter=Get-DarDatabaseRestoreReport -Secrets $secrets -DatabaseName $secrets.Database
        if ((Get-ReportSignature $productionAfter) -cne $productionSignatureBefore) { throw 'Production database logical signature changed during isolated migration rehearsal.' }
        $productionSizeDelta=Get-DatabaseSizeDelta -Before $productionBefore -After $productionAfter
        Write-Host 'PASS: Production database logical signature remains unchanged.'
        if ($productionSizeDelta -ne 0) { Write-Host ("INFO: Production database physical size changed by {0} bytes; physical size is informational and excluded from the logical signature." -f $productionSizeDelta) -ForegroundColor DarkYellow }
        $reportData.checks.productionUnchanged='PASS'
        $reportData.production=[ordered]@{ database=$secrets.Database; appliedMigrations=$productionAfter.AppliedMigrations; requiredFunctions=$productionAfter.RequiredFunctions; requiredTriggers=$productionAfter.RequiredTriggers; databaseSizeBeforeBytes=[long]$productionBefore.DatabaseSizeBytes; databaseSizeAfterBytes=[long]$productionAfter.DatabaseSizeBytes; databaseSizeDeltaBytes=[long]$productionSizeDelta }

        $reportData.target=[ordered]@{ database=$stagingDatabase; tableCount=$stagingAfter.TableCount; foreignKeyCount=$stagingAfter.ForeignKeyCount; databaseSizeBeforeBytes=[long]$stagingBefore.DatabaseSizeBytes; databaseSizeAfterBytes=[long]$stagingAfter.DatabaseSizeBytes; databaseSizeDeltaBytes=[long]$stagingSizeDelta; tableCounts=$stagingAfter.TableCounts; appliedMigrations=$stagingAfter.AppliedMigrations; requiredFunctions=$stagingAfter.RequiredFunctions; requiredTriggers=$stagingAfter.RequiredTriggers }
        $result='PASS'
    } while ($false)
}
catch {
    $result='FAIL'
    $record = $_
    $failureMessage = $record.Exception.Message
    if ($record.InvocationInfo -and $record.InvocationInfo.ScriptLineNumber -gt 0) {
        $failureMessage += (' | At ' + $record.InvocationInfo.ScriptName + ':' + $record.InvocationInfo.ScriptLineNumber)
    }
    if (-not [string]::IsNullOrWhiteSpace([string]$record.ScriptStackTrace)) {
        $failureMessage += (' | Stack: ' + $record.ScriptStackTrace)
    }
    foreach ($diagnosticPath in @($apiErr,$apiOut)) {
        if (-not [string]::IsNullOrWhiteSpace([string]$diagnosticPath) -and (Test-Path -LiteralPath $diagnosticPath -PathType Leaf)) {
            $diagnosticTail=(Get-Content -LiteralPath $diagnosticPath -Tail 30 -ErrorAction SilentlyContinue) -join "`n"
            if (-not [string]::IsNullOrWhiteSpace([string]$diagnosticTail)) { $failureMessage += (' | API log tail (' + [IO.Path]::GetFileName($diagnosticPath) + '): ' + $diagnosticTail) }
        }
    }
}
finally {
    if ($testApiProcess) {
        try {
            # Keep the Process handle returned by Start-Process. This targets only
            # the exact child launched by this rehearsal, not an arbitrary PID lookup.
            $testApiProcess.Refresh()
            if (-not $testApiProcess.HasExited) {
                try { $testApiProcess.Kill() }
                catch {
                    $testApiProcess.Refresh()
                    if (-not $testApiProcess.HasExited) { throw }
                }
                if (-not $testApiProcess.WaitForExit(15000)) {
                    throw ('The isolated API child did not exit after termination was requested (PID ' + $testApiProcessId + ').')
                }
            }
            $testApiProcess.Refresh()
            $apiStopped = [bool]$testApiProcess.HasExited
            if (-not $apiStopped) { throw ('The isolated API child is still running (PID ' + $testApiProcessId + ').') }

            # Wait for Kestrel to release its listener before dropping the staging DB.
            $portReleaseDeadline=(Get-Date).AddSeconds(8)
            while ((Test-TcpPort 5081) -and (Get-Date) -lt $portReleaseDeadline) { Start-Sleep -Milliseconds 200 }
            if (Test-TcpPort 5081) {
                $apiStopped=$false
                throw 'Port 5081 remains occupied after the child process exited. The staging database is preserved; inspect the listener before cleanup.'
            }
            Write-Step ('Stopped isolated API child PID ' + $testApiProcessId + ' and confirmed port 5081 is released.')
            if ($reportData) { $reportData.checks.apiProcessStopped='PASS'; $reportData.checks.apiPortReleased='PASS' }
        } catch {
            $apiStopped=$false
            if (-not $failureMessage) { $failureMessage='Could not safely stop isolated API process: ' + $_.Exception.Message } else { $failureMessage += ' | ' + $_.Exception.Message }
            $result='FAIL'
        }
    }
    if ($secrets -and $stagingDatabase -and $apiStopped) {
        try {
            if (Test-TcpPort 5081) { throw 'Port 5081 is still listening. The staging database is preserved to avoid dropping a database that may still be in use.' }
            Remove-RehearsalDatabase -Name $stagingDatabase -Secrets $secrets
            if ($reportData) { $reportData.checks.stagingDatabaseRemoved='PASS' }
        }
        catch {
            if (-not $failureMessage) { $failureMessage='Staging cleanup failed: ' + $_.Exception.Message } else { $failureMessage += ' | Staging cleanup failed: ' + $_.Exception.Message }
            $result='FAIL'
        }
    } elseif ($secrets -and $stagingDatabase -and -not $apiStopped) {
        if (-not $failureMessage) { $failureMessage='Staging DB was preserved because the isolated API process could not be confirmed stopped. Review the API log and clean up manually after inspection.' }
        $result='FAIL'
    }
    if (Test-Path -LiteralPath $tempRoot) { Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue }
    if ($reportData -and $reportPath) {
        $reportData.result=$result
        if ($result -eq 'FAIL') { $reportData.failure=$failureMessage }
        try {
            [IO.File]::WriteAllText($reportPath,($reportData | ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
            Write-Host "Migration rehearsal report saved to $reportPath"
        } catch {
            $result='FAIL'
            $failureMessage='Could not write migration rehearsal report: ' + $_.Exception.Message
            Write-Host $failureMessage -ForegroundColor Red
        }
    }
}
if ($result -eq 'SKIP') { Write-Host ('SKIP: ' + $skipMessage); Write-Output 'DAR_TEST_RESULT=SKIP'; exit 2 }
if ($result -eq 'FAIL') { Write-Host ('FAIL: Migration rehearsal failed: ' + $failureMessage) -ForegroundColor Red; Write-Output 'DAR_TEST_RESULT=FAIL'; exit 1 }
Write-Host 'PASS: Restored database passed the isolated API and frontend smoke rehearsal. Production database was unchanged.'
Write-Output 'DAR_TEST_RESULT=PASS'
exit 0
