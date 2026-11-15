$ErrorActionPreference = 'Stop'
$testRoot = Join-Path $env:TEMP ('DarSystemCenterWatcherTest_' + [Guid]::NewGuid().ToString('N'))
$watcher = $null
$jobs = @()

function Start-TestWriter([string]$Path, [string]$Mode, [string]$Text) {
    $job = Start-Job -ArgumentList $Path, $Mode, $Text -ScriptBlock {
        param($targetPath, $writeMode, $content)
        Start-Sleep -Milliseconds 350
        if ($writeMode -eq 'Create') {
            [System.IO.File]::WriteAllText($targetPath, $content, [System.Text.UTF8Encoding]::new($false))
        }
        else {
            [System.IO.File]::AppendAllText($targetPath, $content, [System.Text.UTF8Encoding]::new($false))
        }
    }
    if (-not $job) { throw 'Could not start the isolated temporary file writer job.' }
    $script:jobs += $job
    return $job
}

try {
    New-Item -ItemType Directory -Path $testRoot -Force | Out-Null

    $watcher = New-Object System.IO.FileSystemWatcher
    $watcher.Path = $testRoot
    $watcher.Filter = '*.log'
    $watcher.NotifyFilter = [System.IO.NotifyFilters]::FileName -bor [System.IO.NotifyFilters]::LastWrite -bor [System.IO.NotifyFilters]::Size
    $watcher.IncludeSubdirectories = $false
    $watcher.EnableRaisingEvents = $true

    $file = Join-Path $testRoot 'watcher-test.log'
    $createJob = Start-TestWriter -Path $file -Mode 'Create' -Text "first`r`n"
    $created = $watcher.WaitForChanged([System.IO.WatcherChangeTypes]::Created, 8000)
    if ($created.TimedOut) { throw 'FileSystemWatcher did not detect file creation within 8 seconds.' }
    Wait-Job -Job $createJob -Timeout 8 | Out-Null
    $createState = (Get-Job -Id $createJob.Id).State
    if ($createState -ne 'Completed') { throw "Temporary file create job did not complete. State=$createState" }
    Receive-Job -Job $createJob -ErrorAction Stop | Out-Null
    if ($created.Name -ne 'watcher-test.log') { throw "Unexpected created file event: $($created.Name)" }
    Write-Host 'PASS: FileSystemWatcher detected file creation.' -ForegroundColor Green

    # Recreate the watcher so delayed notifications from the initial create operation
    # cannot be mistaken for the append notification.
    $watcher.EnableRaisingEvents = $false
    $watcher.Dispose()
    $watcher = New-Object System.IO.FileSystemWatcher
    $watcher.Path = $testRoot
    $watcher.Filter = '*.log'
    $watcher.NotifyFilter = [System.IO.NotifyFilters]::FileName -bor [System.IO.NotifyFilters]::LastWrite -bor [System.IO.NotifyFilters]::Size
    $watcher.IncludeSubdirectories = $false
    $watcher.EnableRaisingEvents = $true

    $appendJob = Start-TestWriter -Path $file -Mode 'Append' -Text "second`r`n"
    $changed = $watcher.WaitForChanged([System.IO.WatcherChangeTypes]::Changed, 8000)
    if ($changed.TimedOut) { throw 'FileSystemWatcher did not detect appended data within 8 seconds.' }
    if ($changed.Name -ne 'watcher-test.log') { throw "Unexpected changed file event: $($changed.Name)" }
    Wait-Job -Job $appendJob -Timeout 8 | Out-Null
    $appendState = (Get-Job -Id $appendJob.Id).State
    if ($appendState -ne 'Completed') { throw "Temporary file append job did not complete. State=$appendState" }
    Receive-Job -Job $appendJob -ErrorAction Stop | Out-Null
    Write-Host 'PASS: FileSystemWatcher detected appended data.' -ForegroundColor Green

    $content = [System.IO.File]::ReadAllText($file)
    if ($content -notmatch 'first' -or $content -notmatch 'second') {
        throw 'The temporary writer did not produce the expected file content.'
    }
    Write-Host 'PASS: Temporary file contains both expected writes.' -ForegroundColor Green
    Write-Host 'PASS: Watcher test used only its unique temporary folder.' -ForegroundColor Green
}
catch {
    Write-Host ('FAIL: ' + $_.Exception.Message) -ForegroundColor Red
    throw
}
finally {
    if ($watcher) {
        try { $watcher.EnableRaisingEvents = $false; $watcher.Dispose() } catch { }
    }
    foreach ($job in $jobs) {
        try { Stop-Job -Job $job -ErrorAction SilentlyContinue } catch { }
        try { Remove-Job -Job $job -Force -ErrorAction SilentlyContinue } catch { }
    }
    if (Test-Path -LiteralPath $testRoot) {
        Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Output 'DAR_TEST_RESULT=PASS'
