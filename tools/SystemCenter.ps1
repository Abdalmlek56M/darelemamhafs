$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Root = Split-Path -Parent $PSScriptRoot
$LocalPostgresScript = Join-Path $PSScriptRoot 'LocalPostgres.ps1'
if (-not (Test-Path -LiteralPath $LocalPostgresScript -PathType Leaf)) {
    throw 'ملف إدارة PostgreSQL المحلي غير موجود. أعد فك ضغط الحزمة كاملة.'
}
. $LocalPostgresScript
if (-not (Get-Command 'Ensure-DarLocalPostgres' -CommandType Function -ErrorAction SilentlyContinue)) {
    throw 'تعذر تحميل وحدة PostgreSQL المحلية. لم يتم تشغيل قاعدة البيانات أو تعديلها.'
}
$BackupSchedulerModule = Join-Path $PSScriptRoot 'BackupScheduler.ps1'
if (-not (Test-Path -LiteralPath $BackupSchedulerModule -PathType Leaf)) { throw 'BackupScheduler.ps1 is missing from the tools folder.' }
. $BackupSchedulerModule
$HealthChecksModule = Join-Path $PSScriptRoot 'HealthChecks.ps1'
if (-not (Test-Path -LiteralPath $HealthChecksModule -PathType Leaf)) { throw 'HealthChecks.ps1 is missing from the tools folder.' }
. $HealthChecksModule
$StorageCenterModule = Join-Path $PSScriptRoot 'StorageCenter.ps1'
if (-not (Test-Path -LiteralPath $StorageCenterModule -PathType Leaf)) { throw 'StorageCenter.ps1 is missing from the tools folder.' }
. $StorageCenterModule
$StoragePathManagerModule = Join-Path $PSScriptRoot 'StoragePathManager.ps1'
if (-not (Test-Path -LiteralPath $StoragePathManagerModule -PathType Leaf)) { throw 'StoragePathManager.ps1 is missing from the tools folder.' }
. $StoragePathManagerModule
$DatabaseStudioModule = Join-Path $PSScriptRoot 'DatabaseStudio.ps1'
if (-not (Test-Path -LiteralPath $DatabaseStudioModule -PathType Leaf)) { throw 'DatabaseStudio.ps1 is missing from the tools folder.' }
. $DatabaseStudioModule
$PostgresMaintenanceModule = Join-Path $PSScriptRoot 'PostgresMaintenance.ps1'
if (-not (Test-Path -LiteralPath $PostgresMaintenanceModule -PathType Leaf)) { throw 'PostgresMaintenance.ps1 is missing from the tools folder.' }
. $PostgresMaintenanceModule

$script:LogRoot = (Get-DarLocalPaths).Logs
New-Item -ItemType Directory -Force -Path $script:LogRoot | Out-Null
$script:SystemCenterLog = Join-Path $script:LogRoot 'system-center.log'
$script:ActiveLogPath = $null
$script:LogReadOffset = [long]0
$script:PendingLogText = ''
$script:LiveEnabled = $true
$script:FollowTail = $true
$script:Ready = $false
$script:Secrets = $null
$script:LogEventQueue = [System.Collections.Concurrent.ConcurrentQueue[string]]::new()
$script:Watcher = $null
$script:WatcherSourceIds = @()
$script:EventDispatchTimer = $null
$script:WatcherContext = [pscustomobject]@{
    Queue = $script:LogEventQueue
    CrashLog = (Join-Path $script:LogRoot 'system-center-crash.log')
}

function Write-SystemCenterEvent([string]$Level, [string]$Message) {
    try {
        $event = [ordered]@{ timestamp = [DateTimeOffset]::Now.ToString('o'); level = $Level; source = 'System Center'; message = $Message }
        $line = ($event | ConvertTo-Json -Compress -Depth 4) + [Environment]::NewLine
        [System.IO.File]::AppendAllText($script:SystemCenterLog, $line, [System.Text.UTF8Encoding]::new($false))
    } catch { }
}
function Write-Step([string]$Message) {
    if ($script:statusLabel) {
        $script:statusLabel.Text = $Message
        [System.Windows.Forms.Application]::DoEvents()
    }
    Write-SystemCenterEvent -Level 'Information' -Message $Message
}
function Get-LatestLogFile([string]$Pattern) {
    $file = Get-ChildItem -LiteralPath $script:LogRoot -Filter $Pattern -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
    if ($null -eq $file) { return $null }
    return $file.FullName
}
function Get-SelectedLogPath {
    switch ($script:sourceCombo.SelectedIndex) {
        0 { return (Get-LatestLogFile 'api-*.jsonl') }
        1 { $p = Join-Path $script:LogRoot 'postgresql.log'; if (Test-Path -LiteralPath $p) { return $p }; return $null }
        2 { $p = Join-Path $script:LogRoot 'launcher.log'; if (Test-Path -LiteralPath $p) { return $p }; return $null }
        3 { $p = Join-Path $script:LogRoot 'system-center.log'; if (Test-Path -LiteralPath $p) { return $p }; return $null }
        4 { return (Get-LatestLogFile 'api-console-*-output.log') }
        5 { return (Get-LatestLogFile 'api-console-*-error.log') }
        6 { $p = Join-Path $script:LogRoot 'backup-scheduler.jsonl'; if (Test-Path -LiteralPath $p) { return $p }; return $null }
        default { return $null }
    }
}
function Get-LogPresentation([string]$Line) {
    $level = 'Information'
    $display = $Line
    if (($script:sourceCombo.SelectedIndex -eq 0) -or ($script:sourceCombo.SelectedIndex -eq 3) -or ($script:sourceCombo.SelectedIndex -eq 6)) {
        try {
            $entry = $Line | ConvertFrom-Json -ErrorAction Stop
            if ($entry.level) { $level = [string]$entry.level }
            $time = if ($entry.timestamp) { [string]$entry.timestamp } else { '' }
            $origin = if ($entry.category) { [string]$entry.category } elseif ($entry.source) { [string]$entry.source } else { 'System' }
            $message = if ($entry.message) { [string]$entry.message } else { $Line }
            $display = "[$time] [$level] $origin — $message"
            if ($entry.eventId -and [int]$entry.eventId -ne 0) { $display += " (Event $($entry.eventId))" }
            if ($entry.exception) { $display += "`r`n$([string]$entry.exception)" }
        } catch {
            if ($Line -match '(?i)\bcritical\b|\bfatal\b|\berror\b|\bexception\b|\bfailed\b') { $level = 'Error' }
            elseif ($Line -match '(?i)\bwarning\b|\bwarn\b') { $level = 'Warning' }
        }
    } else {
        if ($Line -match '(?i)\bcritical\b|\bfatal\b|\bERROR\b|\bexception\b|\bfailed\b') { $level = 'Error' }
        elseif ($Line -match '(?i)\bWARNING\b|\bWARN\b') { $level = 'Warning' }
        elseif ($Line -match '(?i)\bDEBUG\b|\bTRACE\b') { $level = 'Debug' }
    }
    return [pscustomobject]@{ Level = $level; Text = $display }
}
function Test-VisibleLogLevel([string]$Level) {
    switch ($script:levelCombo.SelectedIndex) {
        1 { return ($Level -match '(?i)Error|Critical|Fatal') }
        2 { return ($Level -match '(?i)Warning|Warn') }
        default { return $true }
    }
}
function Add-ConsoleLine([string]$Line) {
    if ([string]::IsNullOrWhiteSpace($Line)) { return }
    $item = Get-LogPresentation -Line $Line
    if (-not (Test-VisibleLogLevel -Level $item.Level)) { return }
    switch -Regex ($item.Level) {
        'Critical|Error|Fatal' { $color = [System.Drawing.Color]::FromArgb(255, 112, 112); break }
        'Warning|Warn' { $color = [System.Drawing.Color]::FromArgb(255, 190, 92); break }
        'Debug|Trace' { $color = [System.Drawing.Color]::FromArgb(145, 160, 180); break }
        default { $color = [System.Drawing.Color]::FromArgb(205, 220, 238) }
    }
    $script:console.SelectionStart = $script:console.TextLength
    $script:console.SelectionLength = 0
    $script:console.SelectionColor = $color
    $script:console.AppendText($item.Text + [Environment]::NewLine)
    $script:console.SelectionColor = $script:console.ForeColor
    $lineCount = $script:console.Lines.Length
    if ($lineCount -gt 3000) {
        $removeLines = $lineCount - 2500
        $cutIndex = $script:console.GetFirstCharIndexFromLine($removeLines)
        if ($cutIndex -gt 0) { $script:console.Select(0, $cutIndex); $script:console.SelectedText = '' }
    }
    if ($script:FollowTail) {
        $script:console.SelectionStart = $script:console.TextLength
        $script:console.ScrollToCaret()
    }
}
function Load-SelectedLog {
    try {
        $file = Get-SelectedLogPath
        $script:console.Clear()
        $script:PendingLogText = ''
        $script:ActiveLogPath = $file
        $script:LogReadOffset = 0
        if ([string]::IsNullOrWhiteSpace([string]$file) -or -not (Test-Path -LiteralPath $file -PathType Leaf)) {
            $script:pathLabel.Text = 'لم يُنشأ ملف السجل المحدد بعد.'
            $script:console.AppendText('لا توجد أحداث مسجلة في هذا المصدر حتى الآن.' + [Environment]::NewLine)
            $script:console.SelectionStart = $script:console.TextLength
            $script:statusLabel.Text = 'لا يوجد ملف لهذا المصدر.'
            return
        }
        $script:pathLabel.Text = $file
        $lines = @(Get-Content -LiteralPath $file -Tail 400 -Encoding UTF8 -ErrorAction Stop)
        foreach ($line in $lines) { Add-ConsoleLine -Line ([string]$line) }
        $info = Get-Item -LiteralPath $file -ErrorAction Stop
        $script:LogReadOffset = [long]$info.Length
        $script:PendingLogText = ''
        $script:statusLabel.Text = "متصل بالمصدر — آخر $($lines.Count) سطر. المتابعة المباشرة عبر إشعارات الملفات."
    } catch {
        $script:statusLabel.Text = 'تعذر قراءة السجل: ' + $_.Exception.Message
        Add-ConsoleLine -Line $script:statusLabel.Text
    }
}
function Read-AppendedLogData {
    if (-not $script:LiveEnabled) { return }
    $file = $script:ActiveLogPath
    if ([string]::IsNullOrWhiteSpace([string]$file) -or -not (Test-Path -LiteralPath $file -PathType Leaf)) { return }
    $stream = $null
    $reader = $null
    try {
        $share = [System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete
        $stream = [System.IO.File]::Open($file, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, $share)
        if ($stream.Length -lt $script:LogReadOffset) {
            $script:LogReadOffset = 0
            $script:PendingLogText = ''
        }
        if ($stream.Length -le $script:LogReadOffset) { return }
        [void]$stream.Seek($script:LogReadOffset, [System.IO.SeekOrigin]::Begin)
        $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::UTF8, $true, 4096, $true)
        $chunk = $reader.ReadToEnd()
        $script:LogReadOffset = [long]$stream.Position
        if ([string]::IsNullOrEmpty($chunk)) { return }
        $combined = $script:PendingLogText + $chunk
        $parts = $combined -split "`n"
        if ($combined.EndsWith("`n")) {
            $script:PendingLogText = ''
            $completeLines = $parts | Select-Object -First ($parts.Count - 1)
        } else {
            if ($parts.Count -gt 1) { $completeLines = $parts | Select-Object -First ($parts.Count - 1) } else { $completeLines = @() }
            $script:PendingLogText = [string]$parts[$parts.Count - 1]
        }
        foreach ($line in $completeLines) { Add-ConsoleLine -Line ([string]$line).TrimEnd("`r") }
        if ($completeLines.Count -gt 0) { $script:statusLabel.Text = "متابعة مباشرة — $([DateTime]::Now.ToString('HH:mm:ss'))" }
    } catch {
        # A writer can temporarily rotate/replace a file. The next file-system event retries.
    } finally {
        if ($reader) { $reader.Dispose() }
        if ($stream) { $stream.Dispose() }
    }
}
function Drain-LogFileEvents {
    if (-not $script:LiveEnabled) { return }
    $changedPath = $null
    $queued = $false
    while ($script:LogEventQueue.TryDequeue([ref]$changedPath)) { $queued = $true }
    if (-not $queued) { return }
    $latest = Get-SelectedLogPath
    if (-not [string]::IsNullOrWhiteSpace([string]$latest) -and $latest -ne $script:ActiveLogPath) {
        Load-SelectedLog
        return
    }
    if (-not [string]::IsNullOrWhiteSpace([string]$script:ActiveLogPath)) {
        Read-AppendedLogData
    } elseif (-not [string]::IsNullOrWhiteSpace([string]$latest)) {
        Load-SelectedLog
    }
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::SetUnhandledExceptionMode([System.Windows.Forms.UnhandledExceptionMode]::CatchException)
$script:ThreadExceptionHandler = [System.Threading.ThreadExceptionEventHandler]{
    param($sender, $eventArgs)
    try {
        $details = "[$(Get-Date -Format o)] WinForms UI exception`r`n$($eventArgs.Exception.ToString())`r`n$('=' * 72)`r`n"
        [System.IO.File]::AppendAllText((Join-Path $script:LogRoot 'system-center-crash.log'), $details, [System.Text.UTF8Encoding]::new($false))
    } catch { }
    try { [void](Show-DarDialog -Title 'Dar System Center' -Message "An unexpected System Center UI error occurred. Details were saved under:`r`n$script:LogRoot\system-center-crash.log`r`n`r`n$($eventArgs.Exception.Message)" -Kind Error) } catch { }
}
[System.Windows.Forms.Application]::add_ThreadException($script:ThreadExceptionHandler)
[System.Windows.Forms.Application]::EnableVisualStyles()

function Show-DarDialog {
    param(
        [Parameter(Mandatory=$true)][string]$Title,
        [Parameter(Mandatory=$true)][string]$Message,
        [ValidateSet('Information','Success','Warning','Error','Question')][string]$Kind='Information',
        [ValidateSet('OK','YesNo')][string]$Buttons='OK',
        [string]$PrimaryText='موافق',
        [string]$SecondaryText='إلغاء'
    )
    $palette = @{
        Information = [System.Drawing.Color]::FromArgb(113,213,192)
        Success = [System.Drawing.Color]::FromArgb(75,190,145)
        Warning = [System.Drawing.Color]::FromArgb(225,170,82)
        Error = [System.Drawing.Color]::FromArgb(220,100,112)
        Question = [System.Drawing.Color]::FromArgb(140,157,255)
    }
    $accent = $palette[$Kind]
    $dialog = New-Object System.Windows.Forms.Form
    $dialog.Text = $Title
    $dialog.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterParent
    $dialog.Size = New-Object System.Drawing.Size(570,286)
    $dialog.MinimumSize = $dialog.Size
    $dialog.MaximumSize = $dialog.Size
    $dialog.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
    $dialog.MaximizeBox = $false
    $dialog.MinimizeBox = $false
    $dialog.ShowInTaskbar = $false
    $dialog.RightToLeft = [System.Windows.Forms.RightToLeft]::Yes
    $dialog.RightToLeftLayout = $true
    $dialog.BackColor = [System.Drawing.Color]::FromArgb(8,14,25)
    $dialog.ForeColor = [System.Drawing.Color]::FromArgb(238,243,252)
    $dialog.Font = New-Object System.Drawing.Font('Segoe UI',9)
    $dialog.Padding = New-Object System.Windows.Forms.Padding(1)

    $header = New-Object System.Windows.Forms.Panel
    $header.Location = New-Object System.Drawing.Point(1,1)
    $header.Size = New-Object System.Drawing.Size(568,58)
    $header.BackColor = [System.Drawing.Color]::FromArgb(17,27,44)
    $dialog.Controls.Add($header)

    $accentBar = New-Object System.Windows.Forms.Panel
    $accentBar.Dock = [System.Windows.Forms.DockStyle]::Right
    $accentBar.Width = 5
    $accentBar.BackColor = $accent
    $header.Controls.Add($accentBar)

    $titleLabel = New-Object System.Windows.Forms.Label
    $titleLabel.Text = $Title
    $titleLabel.Font = New-Object System.Drawing.Font('Segoe UI',11,[System.Drawing.FontStyle]::Bold)
    $titleLabel.ForeColor = [System.Drawing.Color]::FromArgb(238,243,252)
    $titleLabel.TextAlign = [System.Drawing.ContentAlignment]::MiddleRight
    $titleLabel.Location = New-Object System.Drawing.Point(18,8)
    $titleLabel.Size = New-Object System.Drawing.Size(490,42)
    $header.Controls.Add($titleLabel)

    $closeButton = New-Object System.Windows.Forms.Button
    $closeButton.Text = '×'
    $closeButton.Location = New-Object System.Drawing.Point(8,11)
    $closeButton.Size = New-Object System.Drawing.Size(38,36)
    $closeButton.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
    $closeButton.FlatAppearance.BorderSize = 0
    $closeButton.BackColor = [System.Drawing.Color]::FromArgb(17,27,44)
    $closeButton.ForeColor = [System.Drawing.Color]::FromArgb(145,162,184)
    $closeButton.Font = New-Object System.Drawing.Font('Segoe UI',15)
    $closeButton.Cursor = [System.Windows.Forms.Cursors]::Hand
    $closeButton.Add_Click({ $dialog.DialogResult = [System.Windows.Forms.DialogResult]::Cancel; $dialog.Close() })
    $header.Controls.Add($closeButton)

    $iconLabel = New-Object System.Windows.Forms.Label
    $iconLabel.Text = switch ($Kind) { 'Success' { '✓' } 'Warning' { '!' } 'Error' { '×' } 'Question' { '?' } default { 'i' } }
    $iconLabel.Font = New-Object System.Drawing.Font('Segoe UI',17,[System.Drawing.FontStyle]::Bold)
    $iconLabel.ForeColor = $accent
    $iconLabel.BackColor = [System.Drawing.Color]::FromArgb(25,42,57)
    $iconLabel.TextAlign = [System.Drawing.ContentAlignment]::MiddleCenter
    $iconLabel.Location = New-Object System.Drawing.Point(25,105)
    $iconLabel.Size = New-Object System.Drawing.Size(46,46)
    $dialog.Controls.Add($iconLabel)

    $messageLabel = New-Object System.Windows.Forms.Label
    $messageLabel.Text = $Message
    $messageLabel.ForeColor = [System.Drawing.Color]::FromArgb(205,217,233)
    $messageLabel.TextAlign = [System.Drawing.ContentAlignment]::MiddleRight
    $messageLabel.Location = New-Object System.Drawing.Point(86,72)
    $messageLabel.Size = New-Object System.Drawing.Size(450,126)
    $messageLabel.Font = New-Object System.Drawing.Font('Segoe UI',9.5)
    $dialog.Controls.Add($messageLabel)

    $footer = New-Object System.Windows.Forms.Panel
    $footer.Location = New-Object System.Drawing.Point(1,214)
    $footer.Size = New-Object System.Drawing.Size(568,71)
    $footer.BackColor = [System.Drawing.Color]::FromArgb(15,24,39)
    $dialog.Controls.Add($footer)

    if ($Buttons -eq 'YesNo') {
        $secondary = New-Object System.Windows.Forms.Button
        $secondary.Text = $SecondaryText
        $secondary.DialogResult = [System.Windows.Forms.DialogResult]::No
        $secondary.Location = New-Object System.Drawing.Point(318,17)
        $secondary.Size = New-Object System.Drawing.Size(105,38)
        $secondary.BackColor = [System.Drawing.Color]::FromArgb(34,49,70)
        $secondary.ForeColor = [System.Drawing.Color]::FromArgb(218,228,241)
        $secondary.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
        $secondary.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(58,76,101)
        $secondary.FlatAppearance.BorderSize = 1
        $secondary.Cursor = [System.Windows.Forms.Cursors]::Hand
        $footer.Controls.Add($secondary)

        $primary = New-Object System.Windows.Forms.Button
        $primary.Text = $PrimaryText
        $primary.DialogResult = [System.Windows.Forms.DialogResult]::Yes
        $primary.Location = New-Object System.Drawing.Point(435,17)
        $primary.Size = New-Object System.Drawing.Size(118,38)
        $primary.BackColor = $accent
        $primary.ForeColor = [System.Drawing.Color]::FromArgb(8,20,29)
        $primary.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
        $primary.FlatAppearance.BorderSize = 0
        $primary.Cursor = [System.Windows.Forms.Cursors]::Hand
        $footer.Controls.Add($primary)
        $dialog.AcceptButton = $primary
        $dialog.CancelButton = $secondary
    } else {
        $primary = New-Object System.Windows.Forms.Button
        $primary.Text = $PrimaryText
        $primary.DialogResult = [System.Windows.Forms.DialogResult]::OK
        $primary.Location = New-Object System.Drawing.Point(435,17)
        $primary.Size = New-Object System.Drawing.Size(118,38)
        $primary.BackColor = $accent
        $primary.ForeColor = [System.Drawing.Color]::FromArgb(8,20,29)
        $primary.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
        $primary.FlatAppearance.BorderSize = 0
        $primary.Cursor = [System.Windows.Forms.Cursors]::Hand
        $footer.Controls.Add($primary)
        $dialog.AcceptButton = $primary
        $dialog.CancelButton = $primary
    }
    try { return $dialog.ShowDialog($script:form) }
    finally { $dialog.Dispose() }
}

$form = New-Object System.Windows.Forms.Form
$script:form = $form
$form.Text = 'Dar System Center 0.8.25.0'
$form.StartPosition = 'CenterScreen'
$form.Size = New-Object System.Drawing.Size(1120, 780)
$form.MinimumSize = New-Object System.Drawing.Size(980, 680)
$form.RightToLeft = [System.Windows.Forms.RightToLeft]::Yes
$form.RightToLeftLayout = $true
$form.Font = New-Object System.Drawing.Font('Segoe UI', 9)
$form.BackColor = [System.Drawing.Color]::FromArgb(243, 246, 250)

$header = New-Object System.Windows.Forms.Panel
$header.Location = New-Object System.Drawing.Point(18, 14)
$header.Size = New-Object System.Drawing.Size(1068, 82)
$header.Anchor = 'Top,Left,Right'
$header.BackColor = [System.Drawing.Color]::White
$header.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
$form.Controls.Add($header)

$title = New-Object System.Windows.Forms.Label
$title.Text = 'مركز إدارة نظام دار الإمام حفص'
$title.Font = New-Object System.Drawing.Font('Segoe UI', 17, [System.Drawing.FontStyle]::Bold)
$title.ForeColor = [System.Drawing.Color]::FromArgb(24, 39, 58)
$title.TextAlign = [System.Drawing.ContentAlignment]::MiddleRight
$title.Location = New-Object System.Drawing.Point(20, 8)
$title.Size = New-Object System.Drawing.Size(1020, 36)
$header.Controls.Add($title)

$subtitle = New-Object System.Windows.Forms.Label
$subtitle.Text = 'النسخ والاستعادة والتحكم في قاعدة البيانات ومراقبة التشغيل من مكان واحد.'
$subtitle.ForeColor = [System.Drawing.Color]::FromArgb(95, 109, 128)
$subtitle.TextAlign = [System.Drawing.ContentAlignment]::MiddleRight
$subtitle.Location = New-Object System.Drawing.Point(20, 45)
$subtitle.Size = New-Object System.Drawing.Size(1020, 25)
$header.Controls.Add($subtitle)

$tabs = New-Object System.Windows.Forms.TabControl
$tabs.Location = New-Object System.Drawing.Point(18, 108)
$tabs.Size = New-Object System.Drawing.Size(1068, 590)
$tabs.Anchor = 'Top,Bottom,Left,Right'
$tabs.Font = New-Object System.Drawing.Font('Segoe UI', 10)
$form.Controls.Add($tabs)

$opsPage = New-Object System.Windows.Forms.TabPage
$opsPage.Text = 'البيانات والنسخ الاحتياطي'
$opsPage.BackColor = [System.Drawing.Color]::FromArgb(248, 250, 253)
$opsPage.RightToLeft = [System.Windows.Forms.RightToLeft]::Yes
$tabs.TabPages.Add($opsPage) | Out-Null

$logPage = New-Object System.Windows.Forms.TabPage
$logPage.Text = 'الكونسول المباشر والسجلات'
$logPage.BackColor = [System.Drawing.Color]::FromArgb(248, 250, 253)
$logPage.RightToLeft = [System.Windows.Forms.RightToLeft]::Yes
$tabs.TabPages.Add($logPage) | Out-Null

$schedulePage = New-Object System.Windows.Forms.TabPage
$schedulePage.Text = 'النسخ المجدول'
$schedulePage.BackColor = [System.Drawing.Color]::FromArgb(12, 21, 35)
$schedulePage.RightToLeft = [System.Windows.Forms.RightToLeft]::Yes
$tabs.TabPages.Add($schedulePage) | Out-Null

$healthPage = New-Object System.Windows.Forms.TabPage
$healthPage.Text = 'صحة النظام'
$healthPage.BackColor = [System.Drawing.Color]::FromArgb(12, 21, 35)
$healthPage.RightToLeft = [System.Windows.Forms.RightToLeft]::Yes
$tabs.TabPages.Add($healthPage) | Out-Null

$storagePage = New-Object System.Windows.Forms.TabPage
$storagePage.Text = 'التخزين'
$storagePage.BackColor = [System.Drawing.Color]::FromArgb(12, 21, 35)
$storagePage.RightToLeft = [System.Windows.Forms.RightToLeft]::Yes
$tabs.TabPages.Add($storagePage) | Out-Null

$databaseStudioPage = New-Object System.Windows.Forms.TabPage
$databaseStudioPage.Text = 'قاعدة البيانات'
$databaseStudioPage.BackColor = [System.Drawing.Color]::FromArgb(12, 21, 35)
$databaseStudioPage.RightToLeft = [System.Windows.Forms.RightToLeft]::Yes
$tabs.TabPages.Add($databaseStudioPage) | Out-Null

$postgresMaintenancePage = New-Object System.Windows.Forms.TabPage
$postgresMaintenancePage.Text = 'صيانة PostgreSQL'
$postgresMaintenancePage.BackColor = [System.Drawing.Color]::FromArgb(12, 21, 35)
$postgresMaintenancePage.RightToLeft = [System.Windows.Forms.RightToLeft]::Yes
$tabs.TabPages.Add($postgresMaintenancePage) | Out-Null

$opsIntro = New-Object System.Windows.Forms.Label
$opsIntro.Text = 'إدارة محرك PostgreSQL المحلي والنسخ الاحتياطية. العمليات الحساسة تتحقق من حالة التطبيق قبل التنفيذ.'
$opsIntro.Location = New-Object System.Drawing.Point(24, 18)
$opsIntro.Size = New-Object System.Drawing.Size(1000, 38)
$opsIntro.TextAlign = [System.Drawing.ContentAlignment]::MiddleRight
$opsIntro.ForeColor = [System.Drawing.Color]::FromArgb(82, 98, 118)
$opsPage.Controls.Add($opsIntro)

$backupButton = New-Object System.Windows.Forms.Button
$backupButton.Text = 'إنشاء نسخة احتياطية كاملة'
$backupButton.Location = New-Object System.Drawing.Point(540, 78)
$backupButton.Size = New-Object System.Drawing.Size(470, 64)
$backupButton.BackColor = [System.Drawing.Color]::FromArgb(31, 107, 94)
$backupButton.ForeColor = [System.Drawing.Color]::White
$backupButton.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$backupButton.FlatAppearance.BorderSize = 0
$backupButton.Font = New-Object System.Drawing.Font('Segoe UI', 11, [System.Drawing.FontStyle]::Bold)
$opsPage.Controls.Add($backupButton)

$restoreButton = New-Object System.Windows.Forms.Button
$restoreButton.Text = 'استعادة نسخة احتياطية'
$restoreButton.Location = New-Object System.Drawing.Point(28, 78)
$restoreButton.Size = New-Object System.Drawing.Size(470, 64)
$restoreButton.BackColor = [System.Drawing.Color]::FromArgb(44, 87, 132)
$restoreButton.ForeColor = [System.Drawing.Color]::White
$restoreButton.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$restoreButton.FlatAppearance.BorderSize = 0
$restoreButton.Font = New-Object System.Drawing.Font('Segoe UI', 11, [System.Drawing.FontStyle]::Bold)
$opsPage.Controls.Add($restoreButton)

$openFolderButton = New-Object System.Windows.Forms.Button
$openFolderButton.Text = 'فتح مجلد النسخ الاحتياطية'
$openFolderButton.Location = New-Object System.Drawing.Point(540, 164)
$openFolderButton.Size = New-Object System.Drawing.Size(470, 48)
$opsPage.Controls.Add($openFolderButton)

$stopButton = New-Object System.Windows.Forms.Button
$stopButton.Text = 'إيقاف محرك قاعدة البيانات بأمان'
$stopButton.Location = New-Object System.Drawing.Point(28, 164)
$stopButton.Size = New-Object System.Drawing.Size(470, 48)
$stopButton.BackColor = [System.Drawing.Color]::FromArgb(245, 237, 237)
$stopButton.ForeColor = [System.Drawing.Color]::FromArgb(150, 50, 50)
$stopButton.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$opsPage.Controls.Add($stopButton)
$backupButton.Enabled = $false
$restoreButton.Enabled = $false
$stopButton.Enabled = $false

$opsNotice = New-Object System.Windows.Forms.Label
$opsNotice.Text = "مهم: لا تحذف مجلد البيانات يدويًا. الاستعادة تتطلب إغلاق التطبيق، وتُنشئ الأداة نسخة أمان وتحتفظ بالقاعدة السابقة قبل التبديل. إيقاف المحرك متاح فقط بعد التأكد من إغلاق التطبيق."
$opsNotice.Location = New-Object System.Drawing.Point(28, 242)
$opsNotice.Size = New-Object System.Drawing.Size(982, 88)
$opsNotice.BackColor = [System.Drawing.Color]::FromArgb(255, 249, 235)
$opsNotice.ForeColor = [System.Drawing.Color]::FromArgb(116, 86, 37)
$opsNotice.TextAlign = [System.Drawing.ContentAlignment]::MiddleRight
$opsPage.Controls.Add($opsNotice)

$opsPath = New-Object System.Windows.Forms.Label
$opsPath.Text = 'مسار البيانات والنسخ والسجلات: %LOCALAPPDATA%\DarEltahfeez'
$opsPath.Location = New-Object System.Drawing.Point(28, 354)
$opsPath.Size = New-Object System.Drawing.Size(982, 38)
$opsPath.ForeColor = [System.Drawing.Color]::FromArgb(95, 109, 128)
$opsPath.TextAlign = [System.Drawing.ContentAlignment]::MiddleRight
$opsPage.Controls.Add($opsPath)


# Independent Windows Task Scheduler backup page.
$scheduleIntro = New-Object System.Windows.Forms.Label
$scheduleIntro.Text = 'نسخ PostgreSQL كاملًا بجدول مستقل عن واجهة دار التحفيظ والـAPI. يعمل مع إغلاق التطبيق، ويُسجل كل تشغيل ونتيجته.'
$scheduleIntro.Location = New-Object System.Drawing.Point(28, 20)
$scheduleIntro.Size = New-Object System.Drawing.Size(982, 48)
$scheduleIntro.TextAlign = [System.Drawing.ContentAlignment]::MiddleRight
$scheduleIntro.ForeColor = [System.Drawing.Color]::FromArgb(171, 187, 207)
$schedulePage.Controls.Add($scheduleIntro)

$script:backupScheduleEnabled = New-Object System.Windows.Forms.CheckBox
$script:backupScheduleEnabled.Text = 'تفعيل النسخ الاحتياطي اليومي'
$script:backupScheduleEnabled.Location = New-Object System.Drawing.Point(735, 92)
$script:backupScheduleEnabled.Size = New-Object System.Drawing.Size(275, 32)
$script:backupScheduleEnabled.Checked = $true
$schedulePage.Controls.Add($script:backupScheduleEnabled)

$scheduleTimeLabel = New-Object System.Windows.Forms.Label
$scheduleTimeLabel.Text = 'موعد النسخ اليومي'
$scheduleTimeLabel.Location = New-Object System.Drawing.Point(535, 94)
$scheduleTimeLabel.Size = New-Object System.Drawing.Size(175, 28)
$scheduleTimeLabel.TextAlign = [System.Drawing.ContentAlignment]::MiddleRight
$scheduleTimeLabel.ForeColor = [System.Drawing.Color]::FromArgb(192, 207, 226)
$schedulePage.Controls.Add($scheduleTimeLabel)
$script:backupScheduleTime = New-Object System.Windows.Forms.DateTimePicker
$script:backupScheduleTime.Format = [System.Windows.Forms.DateTimePickerFormat]::Custom
$script:backupScheduleTime.CustomFormat = 'HH:mm'
$script:backupScheduleTime.ShowUpDown = $true
$script:backupScheduleTime.Value = (Get-Date).Date.AddHours(3)
$script:backupScheduleTime.Location = New-Object System.Drawing.Point(440, 92)
$script:backupScheduleTime.Size = New-Object System.Drawing.Size(88, 30)
$schedulePage.Controls.Add($script:backupScheduleTime)

$retentionLabel = New-Object System.Windows.Forms.Label
$retentionLabel.Text = 'الاحتفاظ بآخر عدد من النسخ'
$retentionLabel.Location = New-Object System.Drawing.Point(210, 94)
$retentionLabel.Size = New-Object System.Drawing.Size(215, 28)
$retentionLabel.TextAlign = [System.Drawing.ContentAlignment]::MiddleRight
$retentionLabel.ForeColor = [System.Drawing.Color]::FromArgb(192, 207, 226)
$schedulePage.Controls.Add($retentionLabel)
$script:backupRetentionCount = New-Object System.Windows.Forms.NumericUpDown
$script:backupRetentionCount.Minimum = 7
$script:backupRetentionCount.Maximum = 365
$script:backupRetentionCount.Value = 30
$script:backupRetentionCount.Location = New-Object System.Drawing.Point(120, 92)
$script:backupRetentionCount.Size = New-Object System.Drawing.Size(78, 30)
$schedulePage.Controls.Add($script:backupRetentionCount)

$script:saveScheduleButton = New-Object System.Windows.Forms.Button
$script:saveScheduleButton.Text = 'حفظ وتفعيل الجدولة'
$script:saveScheduleButton.Location = New-Object System.Drawing.Point(748, 160)
$script:saveScheduleButton.Size = New-Object System.Drawing.Size(262, 48)
$schedulePage.Controls.Add($script:saveScheduleButton)
$script:disableScheduleButton = New-Object System.Windows.Forms.Button
$script:disableScheduleButton.Text = 'تعطيل الجدولة'
$script:disableScheduleButton.Location = New-Object System.Drawing.Point(476, 160)
$script:disableScheduleButton.Size = New-Object System.Drawing.Size(250, 48)
$schedulePage.Controls.Add($script:disableScheduleButton)
$script:runBackupNowButton = New-Object System.Windows.Forms.Button
$script:runBackupNowButton.Text = 'إنشاء نسخة الآن بالخلفية'
$script:runBackupNowButton.Location = New-Object System.Drawing.Point(210, 160)
$script:runBackupNowButton.Size = New-Object System.Drawing.Size(248, 48)
$schedulePage.Controls.Add($script:runBackupNowButton)
$script:refreshScheduleButton = New-Object System.Windows.Forms.Button
$script:refreshScheduleButton.Text = 'تحديث الحالة'
$script:refreshScheduleButton.Location = New-Object System.Drawing.Point(28, 160)
$script:refreshScheduleButton.Size = New-Object System.Drawing.Size(166, 48)
$schedulePage.Controls.Add($script:refreshScheduleButton)

$script:scheduleStatusLabel = New-Object System.Windows.Forms.Label
$script:scheduleStatusLabel.Text = 'لم يتم فحص حالة الجدولة بعد.'
$script:scheduleStatusLabel.Location = New-Object System.Drawing.Point(28, 238)
$script:scheduleStatusLabel.Size = New-Object System.Drawing.Size(982, 100)
$script:scheduleStatusLabel.TextAlign = [System.Drawing.ContentAlignment]::MiddleRight
$script:scheduleStatusLabel.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
$schedulePage.Controls.Add($script:scheduleStatusLabel)

$scheduleNotice = New-Object System.Windows.Forms.Label
$scheduleNotice.Text = 'ملاحظات التشغيل: تعمل المهمة تحت حساب Windows الحالي بصلاحياته العادية (Interactive / Limited)، ولا تخزن كلمة المرور ولا تحتاج إلى تشغيل مركز النظام كمسؤول في الاستخدام المعتاد. يجب بقاء حساب Windows مسجل الدخول؛ يمكن إغلاق دار التحفيظ ومركز النظام. يعمل المجدول عند موعده إذا كان الجهاز يعمل أو في وضع Sleep مع السماح بمؤقتات الإيقاظ؛ لا يمكنه العمل والجهاز مغلق تمامًا. يبدأ المجدول PostgreSQL المحلي عند الحاجة ولا يوقفه بعد النسخ حتى لا يقطع اتصال التطبيق إذا فُتح أثناء العملية. الاحتفاظ يحذف النسخ التلقائية القديمة الموثقة والسليمة فقط، ويحمي النسخ اليدوية وأي ملف غير معروف أو غير متحقق منه.'
$scheduleNotice.Location = New-Object System.Drawing.Point(28, 356)
$scheduleNotice.Size = New-Object System.Drawing.Size(982, 132)
$scheduleNotice.TextAlign = [System.Drawing.ContentAlignment]::MiddleRight
$scheduleNotice.BackColor = [System.Drawing.Color]::FromArgb(35, 43, 58)
$scheduleNotice.ForeColor = [System.Drawing.Color]::FromArgb(192, 207, 226)
$scheduleNotice.Font = New-Object System.Drawing.Font('Segoe UI', 9)
$scheduleNotice.Padding = New-Object System.Windows.Forms.Padding(12,8,12,8)
$schedulePage.Controls.Add($scheduleNotice)

$script:openScheduleLogButton = New-Object System.Windows.Forms.Button
$script:openScheduleLogButton.Text = 'عرض سجل النسخ في الكونسول'
$script:openScheduleLogButton.Location = New-Object System.Drawing.Point(28, 500)
$script:openScheduleLogButton.Size = New-Object System.Drawing.Size(240, 42)
$schedulePage.Controls.Add($script:openScheduleLogButton)

function Update-BackupScheduleUi {
    try {
        $state = Get-DarBackupScheduleState
        $script:backupScheduleEnabled.Checked = [bool]$state.ConfigEnabled
        try { $timeParts = ([string]$state.DailyTime).Split(':'); $script:backupScheduleTime.Value = (Get-Date).Date.AddHours([int]$timeParts[0]).AddMinutes([int]$timeParts[1]) } catch { }
        $script:backupRetentionCount.Value = [decimal][Math]::Max(7,[Math]::Min(365,$state.RetentionCount))
        $enabledText = if ($state.Enabled) { 'مفعّلة' } elseif ($state.Registered) { 'مسجلة لكنها معطلة' } else { 'غير مفعّلة' }
        $nextText = if ($state.NextRunTime) { ([DateTime]$state.NextRunTime).ToString('yyyy-MM-dd HH:mm') } else { '—' }
        $lastText = if ($state.LastRunTime) { ([DateTime]$state.LastRunTime).ToString('yyyy-MM-dd HH:mm') } else { '—' }
        $taskResultText = if ($null -ne $state.LastTaskResult) { '0x{0:X8}' -f [int]$state.LastTaskResult } else { '—' }
        $script:scheduleStatusLabel.Text = "الحالة: $enabledText`r`nالموعد: يوميًا $($state.DailyTime) | الاحتفاظ: $($state.RetentionCount) نسخة`r`nالتشغيل القادم: $nextText | آخر تشغيل للمهمة: $lastText`r`nآخر رمز نتيجة من Task Scheduler: $taskResultText`r`nمجلد النسخ: $($state.BackupFolder)`r`nسجل النتائج: $($state.LogPath)"
    } catch {
        $script:scheduleStatusLabel.Text = 'تعذر قراءة حالة الجدولة: ' + $_.Exception.Message
        Write-SystemCenterEvent -Level 'Error' -Message ('Backup schedule status failed: ' + $_.Exception.Message)
    }
}

# Read-only System Health dashboard.
$healthIntro = New-Object System.Windows.Forms.Label
$healthIntro.Text = 'فحص حالة خدمات دار التحفيظ وقاعدة البيانات والتخزين والنسخ وسلامة البيانات. جميع الفحوص هنا للقراءة فقط.'
$healthIntro.Location = New-Object System.Drawing.Point(22, 14)
$healthIntro.Size = New-Object System.Drawing.Size(1000, 34)
$healthIntro.TextAlign = [System.Drawing.ContentAlignment]::MiddleRight
$healthIntro.ForeColor = [System.Drawing.Color]::FromArgb(171, 187, 207)
$healthPage.Controls.Add($healthIntro)

$script:healthRunButton = New-Object System.Windows.Forms.Button
$script:healthRunButton.Text = 'تشغيل فحص صحة النظام'
$script:healthRunButton.Location = New-Object System.Drawing.Point(792, 54)
$script:healthRunButton.Size = New-Object System.Drawing.Size(218, 42)
$script:healthRunButton.BackColor = [System.Drawing.Color]::FromArgb(31, 121, 105)
$script:healthRunButton.ForeColor = [System.Drawing.Color]::White
$script:healthRunButton.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$script:healthRunButton.FlatAppearance.BorderSize = 0
$script:healthRunButton.Font = New-Object System.Drawing.Font('Segoe UI', 9, [System.Drawing.FontStyle]::Bold)
$script:healthPageRunToolTip = New-Object System.Windows.Forms.ToolTip
$script:healthPageRunToolTip.SetToolTip($script:healthRunButton, 'يشغل فحوصًا محلية للقراءة فقط؛ لا يصلح أو يغيّر أي بيانات.')
$healthPage.Controls.Add($script:healthRunButton)

$script:healthExportButton = New-Object System.Windows.Forms.Button
$script:healthExportButton.Text = 'تصدير التقرير JSON'
$script:healthExportButton.Location = New-Object System.Drawing.Point(566, 54)
$script:healthExportButton.Size = New-Object System.Drawing.Size(210, 42)
$script:healthExportButton.BackColor = [System.Drawing.Color]::FromArgb(39, 61, 87)
$script:healthExportButton.ForeColor = [System.Drawing.Color]::FromArgb(225, 234, 245)
$script:healthExportButton.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$script:healthExportButton.FlatAppearance.BorderSize = 0
$script:healthExportButton.Enabled = $false
$healthPage.Controls.Add($script:healthExportButton)

$script:healthSummaryLabel = New-Object System.Windows.Forms.Label
$script:healthSummaryLabel.Text = 'لم يتم تشغيل الفحص بعد. اضغط تشغيل فحص صحة النظام لبدء المراجعة.'
$script:healthSummaryLabel.Location = New-Object System.Drawing.Point(22, 108)
$script:healthSummaryLabel.Size = New-Object System.Drawing.Size(988, 54)
$script:healthSummaryLabel.TextAlign = [System.Drawing.ContentAlignment]::MiddleCenter
$script:healthSummaryLabel.BackColor = [System.Drawing.Color]::FromArgb(17, 27, 44)
$script:healthSummaryLabel.ForeColor = [System.Drawing.Color]::FromArgb(192, 207, 226)
$script:healthSummaryLabel.Font = New-Object System.Drawing.Font('Segoe UI', 11, [System.Drawing.FontStyle]::Bold)
$healthPage.Controls.Add($script:healthSummaryLabel)

$script:healthGrid = New-Object System.Windows.Forms.DataGridView
$script:healthGrid.Location = New-Object System.Drawing.Point(22, 174)
$script:healthGrid.Size = New-Object System.Drawing.Size(988, 280)
$script:healthGrid.Anchor = 'Top,Bottom,Left,Right'
$script:healthGrid.ReadOnly = $true
$script:healthGrid.AllowUserToAddRows = $false
$script:healthGrid.AllowUserToDeleteRows = $false
$script:healthGrid.AllowUserToResizeRows = $false
$script:healthGrid.MultiSelect = $false
$script:healthGrid.SelectionMode = [System.Windows.Forms.DataGridViewSelectionMode]::FullRowSelect
$script:healthGrid.RowHeadersVisible = $false
$script:healthGrid.AutoGenerateColumns = $false
$script:healthGrid.AutoSizeRowsMode = [System.Windows.Forms.DataGridViewAutoSizeRowsMode]::None
$script:healthGrid.RowTemplate.Height = 34
$script:healthGrid.AllowUserToOrderColumns = $true
$script:healthGrid.BackgroundColor = [System.Drawing.Color]::FromArgb(8, 13, 22)
$script:healthGrid.BorderStyle = [System.Windows.Forms.BorderStyle]::None
$script:healthGrid.GridColor = [System.Drawing.Color]::FromArgb(39, 54, 74)
$script:healthGrid.EnableHeadersVisualStyles = $false
$script:healthGrid.ColumnHeadersDefaultCellStyle.BackColor = [System.Drawing.Color]::FromArgb(20, 34, 52)
$script:healthGrid.ColumnHeadersDefaultCellStyle.ForeColor = [System.Drawing.Color]::FromArgb(184, 205, 226)
$script:healthGrid.ColumnHeadersDefaultCellStyle.Font = New-Object System.Drawing.Font('Segoe UI', 8, [System.Drawing.FontStyle]::Bold)
$script:healthGrid.DefaultCellStyle.BackColor = [System.Drawing.Color]::FromArgb(13, 22, 36)
$script:healthGrid.DefaultCellStyle.ForeColor = [System.Drawing.Color]::FromArgb(218, 228, 240)
$script:healthGrid.DefaultCellStyle.SelectionBackColor = [System.Drawing.Color]::FromArgb(31, 61, 70)
$script:healthGrid.DefaultCellStyle.SelectionForeColor = [System.Drawing.Color]::White
$script:healthGrid.RightToLeft = [System.Windows.Forms.RightToLeft]::Yes
[void]$script:healthGrid.Columns.Add('Status','الحالة')
[void]$script:healthGrid.Columns.Add('Category','الفئة')
[void]$script:healthGrid.Columns.Add('Name','الفحص')
[void]$script:healthGrid.Columns.Add('Summary','النتيجة')
$script:healthGrid.Columns['Status'].Width = 92
$script:healthGrid.Columns['Category'].Width = 112
$script:healthGrid.Columns['Name'].Width = 188
$script:healthGrid.Columns['Summary'].AutoSizeMode = [System.Windows.Forms.DataGridViewAutoSizeColumnMode]::Fill
$healthPage.Controls.Add($script:healthGrid)

$script:healthDetails = New-Object System.Windows.Forms.TextBox
$script:healthDetails.Location = New-Object System.Drawing.Point(22, 464)
$script:healthDetails.Size = New-Object System.Drawing.Size(988, 74)
$script:healthDetails.Anchor = 'Bottom,Left,Right'
$script:healthDetails.Multiline = $true
$script:healthDetails.ReadOnly = $true
$script:healthDetails.ScrollBars = [System.Windows.Forms.ScrollBars]::Vertical
$script:healthDetails.BackColor = [System.Drawing.Color]::FromArgb(8, 13, 22)
$script:healthDetails.ForeColor = [System.Drawing.Color]::FromArgb(190, 207, 225)
$script:healthDetails.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
$script:healthDetails.Font = New-Object System.Drawing.Font('Segoe UI', 8.5)
$healthPage.Controls.Add($script:healthDetails)

$script:healthReport = $null
$script:healthGrid.Add_SelectionChanged({
    if ($script:healthGrid.SelectedRows.Count -gt 0) {
        $item = $script:healthGrid.SelectedRows[0].Tag
        if ($item) {
            $script:healthDetails.Text = @(
                ('الفحص: ' + $item.name + ' [' + $item.checkId + ']')
                ('الحالة: ' + $item.status + ' | الخطورة: ' + $item.severity)
                ('التفاصيل: ' + $item.details)
                ('الدليل: ' + $item.evidence)
                ('التوصية: ' + $item.recommendation)
            ) -join [Environment]::NewLine
        }
    }
})

$script:healthRunButton.Add_Click({
    if (-not $script:Ready -or -not $script:Secrets) {
        Show-DarDialog -Title 'قاعدة البيانات غير جاهزة' -Message 'تعذر تشغيل فحوص الصحة لأن اتصال PostgreSQL المحلي لم يجهز بعد. لم يتم تغيير أي بيانات.' -Kind Warning | Out-Null
        return
    }
    $script:healthRunButton.Enabled = $false
    $script:healthExportButton.Enabled = $false
    $script:healthSummaryLabel.Text = 'جارٍ تنفيذ فحوص القراءة فقط...'
    $script:healthSummaryLabel.ForeColor = [System.Drawing.Color]::FromArgb(89, 166, 255)
    $script:healthDetails.Clear()
    [System.Windows.Forms.Application]::DoEvents()
    try {
        $script:healthReport = Get-DarSystemHealthReport -ProjectRoot $Root -Secrets $script:Secrets
        $script:healthGrid.Rows.Clear()
        foreach ($item in $script:healthReport.checks) {
            $rowIndex = $script:healthGrid.Rows.Add()
            $row = $script:healthGrid.Rows[$rowIndex]
            $row.Cells['Status'].Value = [string]$item.status
            $row.Cells['Category'].Value = [string]$item.category
            $row.Cells['Name'].Value = [string]$item.name
            $row.Cells['Summary'].Value = [string]$item.summary
            $row.Tag = $item
            $statusColor = switch ($item.status) {
                'Healthy' { [System.Drawing.Color]::FromArgb(75, 205, 151) }
                'Warning' { [System.Drawing.Color]::FromArgb(245, 184, 83) }
                'Critical' { [System.Drawing.Color]::FromArgb(255, 105, 115) }
                default { [System.Drawing.Color]::FromArgb(153, 169, 190) }
            }
            $row.Cells['Status'].Style.ForeColor = $statusColor
            $row.Cells['Status'].Style.Font = New-Object System.Drawing.Font('Segoe UI', 8, [System.Drawing.FontStyle]::Bold)
        }
        $counts = $script:healthReport.counts
        $script:healthSummaryLabel.Text = ('الحالة العامة: {0}     |     سليم: {1}     |     تحذير: {2}     |     حرج: {3}     |     غير معروف: {4}     |     إجمالي الفحوص: {5}     |     المدة: {6} ms' -f $script:healthReport.overallStatus,$counts.healthy,$counts.warning,$counts.critical,$counts.unknown,$script:healthReport.checkCount,$script:healthReport.reportDurationMs)
        $script:healthSummaryLabel.ForeColor = switch ($script:healthReport.overallStatus) {
            'Healthy' { [System.Drawing.Color]::FromArgb(75, 205, 151) }
            'Warning' { [System.Drawing.Color]::FromArgb(245, 184, 83) }
            'Critical' { [System.Drawing.Color]::FromArgb(255, 105, 115) }
            default { [System.Drawing.Color]::FromArgb(153, 169, 190) }
        }
        $script:healthExportButton.Enabled = $true
        Write-SystemCenterEvent -Level 'Information' -Message ('Read-only Health Check completed. Overall=' + $script:healthReport.overallStatus + '; checks=' + $script:healthReport.checkCount)
        Write-Step 'اكتمل فحص النظام. لم يتم تعديل قاعدة البيانات أو حذف ملفات.'
        if ($script:healthGrid.Rows.Count -gt 0) { $script:healthGrid.Rows[0].Selected = $true }
    } catch {
        Write-SystemCenterEvent -Level 'Error' -Message ('Health Check failed: ' + $_.Exception.Message)
        $script:healthSummaryLabel.Text = 'تعذر إكمال الفحص. راجع سجل System Center.'
        $script:healthSummaryLabel.ForeColor = [System.Drawing.Color]::FromArgb(255, 105, 115)
        Show-DarDialog -Title 'فشل فحص صحة النظام' -Message $_.Exception.Message -Kind Error | Out-Null
    } finally { $script:healthRunButton.Enabled = $true }
})

$script:healthExportButton.Add_Click({
    if (-not $script:healthReport) { return }
    $dialog = New-Object System.Windows.Forms.SaveFileDialog
    $dialog.Filter = 'JSON Health Report (*.json)|*.json'
    $dialog.FileName = 'Dar-Health-Report-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.json'
    $dialog.InitialDirectory = $script:LogRoot
    try {
        if ($dialog.ShowDialog($form) -eq [System.Windows.Forms.DialogResult]::OK) {
            $json = $script:healthReport | ConvertTo-Json -Depth 9
            [System.IO.File]::WriteAllText($dialog.FileName,$json,[System.Text.UTF8Encoding]::new($false))
            Write-SystemCenterEvent -Level 'Information' -Message 'Read-only Health Report exported.'
            Write-Step 'تم تصدير تقرير صحة النظام دون كلمات مرور أو بيانات شخصية.'
            Show-DarDialog -Title 'تم تصدير التقرير' -Message ('تم حفظ تقرير الصحة في:`r`n' + $dialog.FileName) -Kind Success | Out-Null
        }
    } catch {
        Show-DarDialog -Title 'تعذر تصدير التقرير' -Message $_.Exception.Message -Kind Error | Out-Null
    } finally { $dialog.Dispose() }
})

# Read-only Storage Center. This first delivery inventories folders and volumes only;
# it does not move, copy, delete or clean any user data.
$storageIntro = New-Object System.Windows.Forms.Label
$storageIntro.Text = 'جرد أحجام البرنامج والتخزين المحلي والأقراص. الفحص يقرأ بيانات الملفات الوصفية فقط ولا ينقل أو يحذف أي ملف.'
$storageIntro.Location = New-Object System.Drawing.Point(22, 14)
$storageIntro.Size = New-Object System.Drawing.Size(1000, 34)
$storageIntro.TextAlign = [System.Drawing.ContentAlignment]::MiddleRight
$storageIntro.ForeColor = [System.Drawing.Color]::FromArgb(171, 187, 207)
$storagePage.Controls.Add($storageIntro)

$script:storageMoveButton = New-Object System.Windows.Forms.Button
$script:storageMoveButton.Text = 'إدارة مكان النسخ الاحتياطية'
$script:storageMoveButton.Location = New-Object System.Drawing.Point(22, 54)
$script:storageMoveButton.Size = New-Object System.Drawing.Size(300, 42)
$script:storageMoveButton.BackColor = [System.Drawing.Color]::FromArgb(39, 61, 87)
$script:storageMoveButton.ForeColor = [System.Drawing.Color]::FromArgb(225, 234, 245)
$script:storageMoveButton.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$script:storageMoveButton.FlatAppearance.BorderSize = 0
$storagePage.Controls.Add($script:storageMoveButton)

$script:storageRefreshButton = New-Object System.Windows.Forms.Button
$script:storageRefreshButton.Text = 'تحديث جرد التخزين'
$script:storageRefreshButton.Location = New-Object System.Drawing.Point(790, 54)
$script:storageRefreshButton.Size = New-Object System.Drawing.Size(218, 42)
$script:storageRefreshButton.BackColor = [System.Drawing.Color]::FromArgb(31, 121, 105)
$script:storageRefreshButton.ForeColor = [System.Drawing.Color]::White
$script:storageRefreshButton.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$script:storageRefreshButton.FlatAppearance.BorderSize = 0
$storagePage.Controls.Add($script:storageRefreshButton)

$script:storageExportButton = New-Object System.Windows.Forms.Button
$script:storageExportButton.Text = 'تصدير التقرير JSON'
$script:storageExportButton.Location = New-Object System.Drawing.Point(566, 54)
$script:storageExportButton.Size = New-Object System.Drawing.Size(210, 42)
$script:storageExportButton.BackColor = [System.Drawing.Color]::FromArgb(39, 61, 87)
$script:storageExportButton.ForeColor = [System.Drawing.Color]::FromArgb(225, 234, 245)
$script:storageExportButton.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$script:storageExportButton.FlatAppearance.BorderSize = 0
$script:storageExportButton.Enabled = $false
$storagePage.Controls.Add($script:storageExportButton)

$script:storageOpenButton = New-Object System.Windows.Forms.Button
$script:storageOpenButton.Text = 'فتح المجلد المحدد'
$script:storageOpenButton.Location = New-Object System.Drawing.Point(350, 54)
$script:storageOpenButton.Size = New-Object System.Drawing.Size(200, 42)
$script:storageOpenButton.BackColor = [System.Drawing.Color]::FromArgb(39, 61, 87)
$script:storageOpenButton.ForeColor = [System.Drawing.Color]::FromArgb(225, 234, 245)
$script:storageOpenButton.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$script:storageOpenButton.FlatAppearance.BorderSize = 0
$script:storageOpenButton.Enabled = $false
$storagePage.Controls.Add($script:storageOpenButton)

$script:storageSummaryLabel = New-Object System.Windows.Forms.Label
$script:storageSummaryLabel.Text = 'لم يتم إنشاء جرد بعد. اضغط تحديث جرد التخزين.'
$script:storageSummaryLabel.Location = New-Object System.Drawing.Point(22, 108)
$script:storageSummaryLabel.Size = New-Object System.Drawing.Size(988, 52)
$script:storageSummaryLabel.TextAlign = [System.Drawing.ContentAlignment]::MiddleCenter
$script:storageSummaryLabel.BackColor = [System.Drawing.Color]::FromArgb(17, 27, 44)
$script:storageSummaryLabel.ForeColor = [System.Drawing.Color]::FromArgb(192, 207, 226)
$script:storageSummaryLabel.Font = New-Object System.Drawing.Font('Segoe UI', 9, [System.Drawing.FontStyle]::Bold)
$storagePage.Controls.Add($script:storageSummaryLabel)

$script:storageGrid = New-Object System.Windows.Forms.DataGridView
$script:storageGrid.Location = New-Object System.Drawing.Point(22, 170)
$script:storageGrid.Size = New-Object System.Drawing.Size(988, 205)
$script:storageGrid.Anchor = 'Top,Bottom,Left,Right'
$script:storageGrid.ReadOnly = $true
$script:storageGrid.AllowUserToAddRows = $false
$script:storageGrid.AllowUserToDeleteRows = $false
$script:storageGrid.AllowUserToResizeRows = $false
$script:storageGrid.MultiSelect = $false
$script:storageGrid.SelectionMode = [System.Windows.Forms.DataGridViewSelectionMode]::FullRowSelect
$script:storageGrid.RowHeadersVisible = $false
$script:storageGrid.AutoGenerateColumns = $false
$script:storageGrid.AutoSizeColumnsMode = [System.Windows.Forms.DataGridViewAutoSizeColumnsMode]::Fill
$script:storageGrid.RowTemplate.Height = 29
$script:storageGrid.BackgroundColor = [System.Drawing.Color]::FromArgb(8, 13, 22)
$script:storageGrid.BorderStyle = [System.Windows.Forms.BorderStyle]::None
$script:storageGrid.GridColor = [System.Drawing.Color]::FromArgb(39, 54, 74)
$script:storageGrid.EnableHeadersVisualStyles = $false
$script:storageGrid.ColumnHeadersDefaultCellStyle.BackColor = [System.Drawing.Color]::FromArgb(20, 34, 52)
$script:storageGrid.ColumnHeadersDefaultCellStyle.ForeColor = [System.Drawing.Color]::FromArgb(184, 205, 226)
$script:storageGrid.ColumnHeadersDefaultCellStyle.Font = New-Object System.Drawing.Font('Segoe UI', 8, [System.Drawing.FontStyle]::Bold)
$script:storageGrid.DefaultCellStyle.BackColor = [System.Drawing.Color]::FromArgb(13, 22, 36)
$script:storageGrid.DefaultCellStyle.ForeColor = [System.Drawing.Color]::FromArgb(218, 228, 240)
$script:storageGrid.DefaultCellStyle.SelectionBackColor = [System.Drawing.Color]::FromArgb(31, 61, 70)
$script:storageGrid.DefaultCellStyle.SelectionForeColor = [System.Drawing.Color]::White
$script:storageGrid.RightToLeft = [System.Windows.Forms.RightToLeft]::Yes
[void]$script:storageGrid.Columns.Add('Category','الفئة')
[void]$script:storageGrid.Columns.Add('Name','الموقع')
[void]$script:storageGrid.Columns.Add('Path','المسار')
[void]$script:storageGrid.Columns.Add('Size','الحجم')
[void]$script:storageGrid.Columns.Add('Files','الملفات')
[void]$script:storageGrid.Columns.Add('Status','حالة القياس')
$script:storageGrid.Columns['Category'].FillWeight = 75
$script:storageGrid.Columns['Name'].FillWeight = 105
$script:storageGrid.Columns['Path'].FillWeight = 150
$script:storageGrid.Columns['Size'].FillWeight = 70
$script:storageGrid.Columns['Files'].FillWeight = 62
$script:storageGrid.Columns['Status'].FillWeight = 90
$storagePage.Controls.Add($script:storageGrid)

$script:storageDetails = New-Object System.Windows.Forms.TextBox
$script:storageDetails.Location = New-Object System.Drawing.Point(22, 386)
$script:storageDetails.Size = New-Object System.Drawing.Size(988, 145)
$script:storageDetails.Anchor = 'Bottom,Left,Right'
$script:storageDetails.Multiline = $true
$script:storageDetails.ReadOnly = $true
$script:storageDetails.ScrollBars = [System.Windows.Forms.ScrollBars]::Vertical
$script:storageDetails.BackColor = [System.Drawing.Color]::FromArgb(8, 13, 22)
$script:storageDetails.ForeColor = [System.Drawing.Color]::FromArgb(192, 207, 226)
$script:storageDetails.Font = New-Object System.Drawing.Font('Consolas', 8)
$script:storageDetails.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
$storagePage.Controls.Add($script:storageDetails)

$script:storageInventory = $null
$script:storageLoaded = $false
function Format-DarStorageSize([object]$Value) {
    if ($null -eq $Value) { return 'ضمن مجلد آخر' }
    [double]$bytes = [double]$Value
    if ($bytes -ge 1GB) { return ('{0:N2} GiB' -f ($bytes / 1GB)) }
    if ($bytes -ge 1MB) { return ('{0:N2} MiB' -f ($bytes / 1MB)) }
    if ($bytes -ge 1KB) { return ('{0:N1} KiB' -f ($bytes / 1KB)) }
    return ('{0:N0} B' -f $bytes)
}
function Show-DarStorageLocationDetails {
    if (-not $script:storageGrid.CurrentRow -or -not $script:storageGrid.CurrentRow.Tag) { return }
    $location = $script:storageGrid.CurrentRow.Tag.Location
    $handle = $script:storageGrid.CurrentRow.Tag.Handle
    $lines = New-Object System.Collections.Generic.List[string]
    $lines.Add('الموقع: ' + $location.Name + ' [' + $location.Id + ']')
    $lines.Add('المسار المعروض: ' + $location.Path)
    $completenessText = if ($location.Status -eq 'Included') { 'محتسب ضمن مجلد حاوٍ؛ راجع حالة المجلد الحاوي' } elseif ($location.Complete) { 'مكتمل' } else { 'غير مكتمل؛ الحجم حد أدنى' }
    $lines.Add('الحالة: ' + $location.Status + ' | اكتمال القياس: ' + $completenessText)
    $lines.Add('الملفات: ' + [string]$location.FileCount + ' (زيارات ' + [string]$location.VisitedFileEntries + ') | المجلدات: ' + [string]$location.DirectoryCount + ' (زيارات ' + [string]$location.VisitedDirectoryEntries + ') | أخطاء الوصول: ' + $location.ErrorCount + ' | Reparse Points المتجاوزة: ' + $location.ReparsePointCount)
    $lines.Add('ملاحظة: ' + $location.Note)
    $lines.Add('الحجم المعروض للمجلدات هو مجموع أطوال الملفات المنطقية؛ قد يختلف عن المساحة الفعلية المحجوزة على NTFS بسبب الضغط أو الملفات sparse أو بيانات نظام الملفات.')
    if ($location.IncludedIn) { $lines.Add('غير مضاف للحجم الإجمالي؛ محسوب ضمن: ' + $location.IncludedIn) }
    if ($location.Id -eq 'program') {
        $lines.Add('')
        $lines.Add('مكونات فرعية محسوبة بالفعل ضمن مجلد البرنامج:')
        foreach ($component in @($script:storageInventory.Report.components)) {
            $componentState = if ($component.Exists) { 'موجود' } else { 'غير موجود حاليًا' }
            $lines.Add((' - {0} | {1} | {2}' -f $component.Name,$component.Path,$componentState))
        }
    }
    $lines.Add('')
    $lines.Add('الأقراص التي تستضيف مواقع التخزين:')
    foreach ($volume in @($script:storageInventory.Report.volumes)) {
        if ($volume.Status -eq 'Ready') {
            $volumeStatusText = switch ($volume.FreeSpaceStatus) { 'Critical' { 'حرج' } 'Warning' { 'تحذير' } default { 'سليم' } }
            $lines.Add(('{0} | الإجمالي {1} | المستخدم فعليًا {2} | المساحة الحرة {3} | المتاحة لحساب Windows {4} | {5}' -f $volume.Root,(Format-DarStorageSize $volume.TotalBytes),(Format-DarStorageSize $volume.UsedBytes),(Format-DarStorageSize $volume.FreeBytes),(Format-DarStorageSize $volume.AvailableBytes),$volumeStatusText))
        } else {
            $lines.Add(('{0} | حالة القرص: {1}' -f $volume.Root,$volume.Status))
        }
    }
    $lines.Add('')
    $lines.Add('أكبر الملفات في هذا الموقع:')
    if (@($location.LargestFiles).Count -eq 0) { $lines.Add('لا توجد قائمة مستقلة؛ قد يكون الموقع مفقودًا أو محسوبًا ضمن مجلد أعلى.') }
    else {
        foreach ($file in @($location.LargestFiles)) {
            $lines.Add(('{0} | {1} | {2}' -f $file.Name,(Format-DarStorageSize $file.SizeBytes),$file.Path))
        }
    }
    $script:storageDetails.Text = $lines -join [Environment]::NewLine
    $script:storageOpenButton.Enabled = [bool]($handle -and $handle.Exists -and $location.Status -ne 'UnsafeRoot')
}

$script:storageGrid.Add_SelectionChanged({ Show-DarStorageLocationDetails })
$script:storageRefreshButton.Add_Click({
    if ($script:storageRefreshButton.Enabled -eq $false) { return }
    $script:storageRefreshButton.Enabled = $false
    $script:storageExportButton.Enabled = $false
    $script:storageOpenButton.Enabled = $false
    $script:storageSummaryLabel.Text = 'جارٍ قياس مجلدات البرنامج والتخزين المحلي...'
    $script:storageSummaryLabel.ForeColor = [System.Drawing.Color]::FromArgb(89, 166, 255)
    $script:storageGrid.Rows.Clear()
    $script:storageDetails.Clear()
    [System.Windows.Forms.Application]::DoEvents()
    try {
        $script:storageInventory = Get-DarStorageInventory -ProjectRoot $Root -LocalPaths (Get-DarLocalPaths) -MaxFilesPerLocation 200000 -MaxDirectoriesPerLocation 200000 -OnProgress {
            param($message)
            Write-Step ([string]$message)
            [System.Windows.Forms.Application]::DoEvents()
        }
        $report = $script:storageInventory.Report
        foreach ($location in $report.locations) {
            $rowIndex = $script:storageGrid.Rows.Add()
            $row = $script:storageGrid.Rows[$rowIndex]
            $row.Cells['Category'].Value = [string]$location.Category
            $row.Cells['Name'].Value = [string]$location.Name
            $row.Cells['Path'].Value = [string]$location.Path
            $row.Cells['Size'].Value = Format-DarStorageSize $location.Bytes
            $fileCountDisplay = if ($null -ne $location.FileCount) { [string]$location.FileCount } else { '—' }
            $row.Cells['Files'].Value = $fileCountDisplay
            $statusDisplay = switch ($location.Status) {
                'Complete' { 'مكتمل' } 'Partial' { 'جزئي' } 'Missing' { 'غير موجود' }
                'UnsafeRoot' { 'مسار غير آمن' } 'Included' { 'ضمن مجلد آخر' } default { [string]$location.Status }
            }
            $row.Cells['Status'].Value = $statusDisplay
            $handle = Get-DarStorageLocationHandle -Inventory $script:storageInventory -Id $location.Id
            $row.Tag = [pscustomobject]@{ Location=$location; Handle=$handle }
        }
        $volumeText = @($report.volumes | Where-Object { $_.Status -eq 'Ready' } | ForEach-Object {
            $freeLabel = switch ($_.FreeSpaceStatus) { 'Critical' { 'حرج' } 'Warning' { 'تحذير' } default { 'سليم' } }
            '{0} available {1} ({2})' -f $_.Root,(Format-DarStorageSize $_.AvailableBytes),$freeLabel
        }) -join ' | '
        if ([string]::IsNullOrWhiteSpace($volumeText)) { $volumeText = 'تعذر قراءة مساحة الأقراص المستخدمة.' }
        $totalText = Format-DarStorageSize $report.summary.measuredBytes
        $coverageText = if ($report.summary.measuredBytesIsLowerBound) { 'إجمالي الحجم المنطقي مقاس جزئيًا (حد أدنى)' } else { 'إجمالي الحجم المنطقي للمواقع المستقلة' }
        $script:storageSummaryLabel.Text = ('{0}: {1} | مكتملة: {2} | جزئية: {3} | مفقودة: {4} | أقراص غير متاحة: {5} | حرجة: {6} | تحذيرية: {7} | {8}' -f $coverageText,$totalText,$report.summary.completeLocations,$report.summary.partialLocations,$report.summary.missingLocations,$report.summary.unavailableVolumes,$report.summary.criticalVolumes,$report.summary.warningVolumes,$volumeText)
        if ($report.summary.criticalVolumes -gt 0) { $summaryColor = [System.Drawing.Color]::FromArgb(255,105,115) }
        elseif ($report.summary.partialLocations -gt 0 -or $report.summary.missingLocations -gt 0 -or $report.summary.warningVolumes -gt 0 -or $report.summary.unavailableVolumes -gt 0) { $summaryColor = [System.Drawing.Color]::FromArgb(245,184,83) }
        else { $summaryColor = [System.Drawing.Color]::FromArgb(75,205,151) }
        $script:storageSummaryLabel.ForeColor = $summaryColor
        $script:storageExportButton.Enabled = $true
        $script:storageLoaded = $true
        Write-SystemCenterEvent -Level 'Information' -Message ('Read-only Storage inventory completed. Locations=' + $report.summary.locationCount + '; partial=' + $report.summary.partialLocations + '; measuredBytes=' + $report.summary.measuredBytes)
        Write-Step 'اكتمل جرد التخزين. لم تتم قراءة محتويات الملفات أو تغيير أي ملف.'
        if ($script:storageGrid.Rows.Count -gt 0) { $script:storageGrid.Rows[0].Selected = $true; $script:storageGrid.CurrentCell = $script:storageGrid.Rows[0].Cells['Name'] }
    } catch {
        $script:storageSummaryLabel.Text = 'تعذر إكمال جرد التخزين. راجع سجل System Center.'
        $script:storageSummaryLabel.ForeColor = [System.Drawing.Color]::FromArgb(255,105,115)
        Write-SystemCenterEvent -Level 'Error' -Message ('Storage inventory failed: ' + $_.Exception.Message)
        Show-DarDialog -Title 'فشل جرد التخزين' -Message $_.Exception.Message -Kind Error | Out-Null
    } finally { $script:storageRefreshButton.Enabled = $true }
})

$script:storageMoveButton.Add_Click({
    if (-not $script:storageMoveButton.Enabled) { return }
    if (Get-NetTCPConnection -LocalPort 5080 -State Listen -ErrorAction SilentlyContinue) {
        Show-DarDialog -Title 'أغلق التطبيق أولًا' -Message 'لمنع تغيّر ملفات النسخ أثناء النقل، أغلق تطبيق دار التحفيظ وAPI على المنفذ 5080. اترك Dar System Center مفتوحًا ثم أعد المحاولة.' -Kind Warning | Out-Null
        return
    }
    $folderDialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $folderDialog.Description = 'اختر المجلد الأب على قرص NTFS محلي. سينشئ البرنامج داخله مجلد DarEltahfeez-Backups. لن يتم استخدام مشاركة شبكة.'
    $folderDialog.ShowNewFolderButton = $true
    try {
        $currentRoot = [IO.Path]::GetPathRoot((Get-DarLocalPaths).BackupFolder)
        if (Test-Path -LiteralPath $currentRoot -PathType Container) { $folderDialog.SelectedPath = $currentRoot }
        if ($folderDialog.ShowDialog($form) -ne [System.Windows.Forms.DialogResult]::OK) { return }
        $targetFolder = Join-Path $folderDialog.SelectedPath 'DarEltahfeez-Backups'
        $plan = Get-DarBackupFolderMovePlan -SourceFolder (Get-DarLocalPaths).BackupFolder -TargetFolder $targetFolder -LocalBase (Get-DarLocalPaths).Base -ProjectRoot $Root
        if (-not $plan.Ready) {
            Show-DarDialog -Title 'الوجهة غير جاهزة للنقل' -Message (($plan.Issues -join [Environment]::NewLine) + [Environment]::NewLine + [Environment]::NewLine + 'لم يتم إنشاء مجلد أو نسخ أو تغيير أي إعداد.') -Kind Warning | Out-Null
            return
        }
        $sizeText = Format-DarStorageSize $plan.TotalBytes
        $requiredText = Format-DarStorageSize $plan.RequiredBytes
        $availableText = Format-DarStorageSize $plan.AvailableBytes
        $confirmation = Show-DarDialog -Title 'تأكيد نقل مجلد النسخ الاحتياطية' -Message ("سيتم نسخ كل ملفات مجلد النسخ الحالي إلى:`r`n$targetFolder`r`n`r`nالملفات: $($plan.FileCount) | الحجم: $sizeText`r`nالمساحة المطلوبة بهامش أمان: $requiredText`r`nالمتاح على القرص: $availableText`r`n`r`nسيتم التحقق من SHA-256 لكل ملف وفحص أرشيفات PostgreSQL. بعد نجاح التحقق سيتغير المسار النشط. سيظل المجلد القديم محفوظًا كنسخة رجوع، ولن نحذفه تلقائيًا. لا يتم نقل قاعدة البيانات أو Runtime أو Logs. هل تريد المتابعة؟") -Kind Warning -Buttons YesNo -PrimaryText 'نسخ والتحقق وتبديل المسار' -SecondaryText 'إلغاء'
        if ($confirmation -ne [System.Windows.Forms.DialogResult]::Yes) { return }
        $script:storageMoveButton.Enabled = $false
        $script:storageRefreshButton.Enabled = $false
        $script:storageSummaryLabel.Text = 'جارٍ نسخ ملفات النسخ الاحتياطية والتحقق من SHA-256...'
        [System.Windows.Forms.Application]::DoEvents()
        try {
            $result = Invoke-DarBackupFolderRelocation -TargetFolder $targetFolder -ProjectRoot $Root -SourceToolsPath $PSScriptRoot -OnProgress {
                param($progress)
                $script:storageSummaryLabel.Text = ('جارٍ النقل والتحقق: {0}/{1} ملف | {2}' -f $progress.CopiedFiles,$progress.TotalFiles,(Format-DarStorageSize $progress.CopiedBytes))
                [System.Windows.Forms.Application]::DoEvents()
            }
            $message = "تم تغيير مسار النسخ الاحتياطية بنجاح.`r`n`r`nالمسار الجديد:`r`n$($result.ActiveFolder)`r`n`r`nالملفات التي تم التحقق منها: $($result.FileCount)`r`nالأرشيفات التي اجتازت pg_restore --list: $($result.ArchiveCount)`r`nSHA-256: PASS`r`n`r`nالمجلد القديم محفوظ بالكامل ولم يتم حذفه. يمكنك الاستمرار في استخدام الدار."
            if ($result.SchedulerMetadataWarning) { $message += "`r`n`r`nتنبيه تحديث معلومات الجدولة: $($result.SchedulerMetadataWarning)" }
            Write-SystemCenterEvent -Level 'Information' -Message ('Verified backup folder copy-and-switch completed. Files=' + $result.FileCount + '; bytes=' + $result.TotalBytes + '; archives=' + $result.ArchiveCount)
            Write-Step 'تم تغيير مكان النسخ بعد التحقق. المصدر السابق محفوظ ولم يتم حذفه.'
            Update-BackupScheduleUi
            $script:storageLoaded = $false
            $script:storageRefreshButton.PerformClick()
            Show-DarDialog -Title 'اكتمل نقل مجلد النسخ' -Message $message -Kind Success | Out-Null
        } catch {
            Write-SystemCenterEvent -Level 'Error' -Message ('Backup folder relocation failed: ' + $_.Exception.Message)
            Show-DarDialog -Title 'تعذر نقل مجلد النسخ' -Message ($_.Exception.Message + [Environment]::NewLine + [Environment]::NewLine + 'لم يتم حذف مجلد المصدر. إذا فشل التبديل، يظل المسار السابق نشطًا.') -Kind Error | Out-Null
        } finally {
            $script:storageMoveButton.Enabled = $true
            $script:storageRefreshButton.Enabled = $true
        }
    } finally { $folderDialog.Dispose() }
})

$script:storageOpenButton.Add_Click({
    if (-not $script:storageGrid.CurrentRow -or -not $script:storageGrid.CurrentRow.Tag) { return }
    $handle = $script:storageGrid.CurrentRow.Tag.Handle
    if ($handle -and $handle.Exists -and $script:storageGrid.CurrentRow.Tag.Location.Status -ne 'UnsafeRoot' -and (Test-Path -LiteralPath $handle.FullPath -PathType Container)) {
        try { Start-Process -FilePath 'explorer.exe' -ArgumentList ('"' + $handle.FullPath + '"') }
        catch { Show-DarDialog -Title 'تعذر فتح المجلد' -Message $_.Exception.Message -Kind Error | Out-Null }
    }
})

$script:storageExportButton.Add_Click({
    if (-not $script:storageInventory) { return }
    $dialog = New-Object System.Windows.Forms.SaveFileDialog
    $dialog.Filter = 'JSON Storage Report (*.json)|*.json'
    $dialog.FileName = 'Dar-Storage-Inventory-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.json'
    $dialog.InitialDirectory = $script:LogRoot
    try {
        if ($dialog.ShowDialog($form) -eq [System.Windows.Forms.DialogResult]::OK) {
            $json = $script:storageInventory.Report | ConvertTo-Json -Depth 9
            [System.IO.File]::WriteAllText($dialog.FileName,$json,[System.Text.UTF8Encoding]::new($false))
            Write-SystemCenterEvent -Level 'Information' -Message 'Read-only Storage inventory exported.'
            Write-Step 'تم تصدير تقرير التخزين دون تضمين مسارات Windows الشخصية أو محتويات الملفات.'
            Show-DarDialog -Title 'تم تصدير التقرير' -Message ('تم حفظ تقرير التخزين في:' + [Environment]::NewLine + $dialog.FileName) -Kind Success | Out-Null
        }
    } catch {
        Show-DarDialog -Title 'تعذر تصدير التقرير' -Message $_.Exception.Message -Kind Error | Out-Null
    } finally { $dialog.Dispose() }
})


# Read-only Database Studio. The UI exposes only predefined catalog views; it does not accept user-authored SQL.
$databaseStudioIntro = New-Object System.Windows.Forms.Label
$databaseStudioIntro.Text = 'استعراض بنية PostgreSQL وقواعد البيانات والجداول والعلاقات والفهارس والاتصالات. كل الاستعلامات محددة مسبقًا وتعمل داخل معاملات READ ONLY.'
$databaseStudioIntro.Location = New-Object System.Drawing.Point(22, 14)
$databaseStudioIntro.Size = New-Object System.Drawing.Size(1000, 34)
$databaseStudioIntro.TextAlign = [System.Drawing.ContentAlignment]::MiddleRight
$databaseStudioIntro.ForeColor = [System.Drawing.Color]::FromArgb(171, 187, 207)
$databaseStudioPage.Controls.Add($databaseStudioIntro)

$script:databaseStudioRefreshButton = New-Object System.Windows.Forms.Button
$script:databaseStudioRefreshButton.Text = 'تحديث معلومات قاعدة البيانات'
$script:databaseStudioRefreshButton.Location = New-Object System.Drawing.Point(790, 54)
$script:databaseStudioRefreshButton.Size = New-Object System.Drawing.Size(218, 42)
$script:databaseStudioRefreshButton.BackColor = [System.Drawing.Color]::FromArgb(31, 121, 105)
$script:databaseStudioRefreshButton.ForeColor = [System.Drawing.Color]::White
$script:databaseStudioRefreshButton.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$script:databaseStudioRefreshButton.FlatAppearance.BorderSize = 0
$databaseStudioPage.Controls.Add($script:databaseStudioRefreshButton)

$script:databaseStudioViewCombo = New-Object System.Windows.Forms.ComboBox
$script:databaseStudioViewCombo.DropDownStyle = [System.Windows.Forms.ComboBoxStyle]::DropDownList
$script:databaseStudioViewCombo.Location = New-Object System.Drawing.Point(555, 60)
$script:databaseStudioViewCombo.Size = New-Object System.Drawing.Size(220, 30)
$script:databaseStudioViewCombo.Items.AddRange([object[]]@('الجداول','قواعد البيانات','الأعمدة','العلاقات والقيود','الفهارس','الاتصالات'))
$script:databaseStudioViewCombo.SelectedIndex = 0
$databaseStudioPage.Controls.Add($script:databaseStudioViewCombo)

$script:databaseStudioTableCombo = New-Object System.Windows.Forms.ComboBox
$script:databaseStudioTableCombo.DropDownStyle = [System.Windows.Forms.ComboBoxStyle]::DropDownList
$script:databaseStudioTableCombo.DisplayMember = 'DisplayName'
$script:databaseStudioTableCombo.Location = New-Object System.Drawing.Point(330, 60)
$script:databaseStudioTableCombo.Size = New-Object System.Drawing.Size(210, 30)
$script:databaseStudioTableCombo.Enabled = $false
$databaseStudioPage.Controls.Add($script:databaseStudioTableCombo)

$script:databaseStudioSummaryLabel = New-Object System.Windows.Forms.Label
$script:databaseStudioSummaryLabel.Text = 'لم يتم تحميل معلومات قاعدة البيانات بعد. اضغط تحديث لبدء الاستعراض الآمن.'
$script:databaseStudioSummaryLabel.Location = New-Object System.Drawing.Point(22, 108)
$script:databaseStudioSummaryLabel.Size = New-Object System.Drawing.Size(988, 58)
$script:databaseStudioSummaryLabel.TextAlign = [System.Drawing.ContentAlignment]::MiddleCenter
$script:databaseStudioSummaryLabel.BackColor = [System.Drawing.Color]::FromArgb(17, 27, 44)
$script:databaseStudioSummaryLabel.ForeColor = [System.Drawing.Color]::FromArgb(192, 207, 226)
$script:databaseStudioSummaryLabel.Font = New-Object System.Drawing.Font('Segoe UI', 9, [System.Drawing.FontStyle]::Bold)
$databaseStudioPage.Controls.Add($script:databaseStudioSummaryLabel)

$script:databaseStudioGrid = New-Object System.Windows.Forms.DataGridView
$script:databaseStudioGrid.Location = New-Object System.Drawing.Point(22, 176)
$script:databaseStudioGrid.Size = New-Object System.Drawing.Size(988, 230)
$script:databaseStudioGrid.Anchor = 'Top,Bottom,Left,Right'
$script:databaseStudioGrid.ReadOnly = $true
$script:databaseStudioGrid.AllowUserToAddRows = $false
$script:databaseStudioGrid.AllowUserToDeleteRows = $false
$script:databaseStudioGrid.AllowUserToResizeRows = $false
$script:databaseStudioGrid.MultiSelect = $false
$script:databaseStudioGrid.SelectionMode = [System.Windows.Forms.DataGridViewSelectionMode]::FullRowSelect
$script:databaseStudioGrid.RowHeadersVisible = $false
$script:databaseStudioGrid.AutoGenerateColumns = $false
$script:databaseStudioGrid.AutoSizeColumnsMode = [System.Windows.Forms.DataGridViewAutoSizeColumnsMode]::Fill
$script:databaseStudioGrid.RowTemplate.Height = 29
$script:databaseStudioGrid.BackgroundColor = [System.Drawing.Color]::FromArgb(8, 13, 22)
$script:databaseStudioGrid.BorderStyle = [System.Windows.Forms.BorderStyle]::None
$script:databaseStudioGrid.GridColor = [System.Drawing.Color]::FromArgb(39, 54, 74)
$script:databaseStudioGrid.EnableHeadersVisualStyles = $false
$script:databaseStudioGrid.ColumnHeadersDefaultCellStyle.BackColor = [System.Drawing.Color]::FromArgb(20, 34, 52)
$script:databaseStudioGrid.ColumnHeadersDefaultCellStyle.ForeColor = [System.Drawing.Color]::FromArgb(184, 205, 226)
$script:databaseStudioGrid.ColumnHeadersDefaultCellStyle.Font = New-Object System.Drawing.Font('Segoe UI', 8, [System.Drawing.FontStyle]::Bold)
$script:databaseStudioGrid.DefaultCellStyle.BackColor = [System.Drawing.Color]::FromArgb(13, 22, 36)
$script:databaseStudioGrid.DefaultCellStyle.ForeColor = [System.Drawing.Color]::FromArgb(218, 228, 240)
$script:databaseStudioGrid.DefaultCellStyle.SelectionBackColor = [System.Drawing.Color]::FromArgb(31, 61, 70)
$script:databaseStudioGrid.DefaultCellStyle.SelectionForeColor = [System.Drawing.Color]::White
$script:databaseStudioGrid.RightToLeft = [System.Windows.Forms.RightToLeft]::Yes
$databaseStudioPage.Controls.Add($script:databaseStudioGrid)

$script:databaseStudioSqlLabel = New-Object System.Windows.Forms.Label
$script:databaseStudioSqlLabel.Text = 'قالب الاستعلام المنفذ — للعرض فقط (لا يمكن تحريره أو تشغيل SQL حر)'
$script:databaseStudioSqlLabel.Location = New-Object System.Drawing.Point(22, 414)
$script:databaseStudioSqlLabel.Size = New-Object System.Drawing.Size(988, 22)
$script:databaseStudioSqlLabel.TextAlign = [System.Drawing.ContentAlignment]::MiddleRight
$script:databaseStudioSqlLabel.ForeColor = [System.Drawing.Color]::FromArgb(171, 187, 207)
$databaseStudioPage.Controls.Add($script:databaseStudioSqlLabel)

$script:databaseStudioSqlText = New-Object System.Windows.Forms.RichTextBox
$script:databaseStudioSqlText.Location = New-Object System.Drawing.Point(22, 440)
$script:databaseStudioSqlText.Size = New-Object System.Drawing.Size(988, 96)
$script:databaseStudioSqlText.Anchor = 'Bottom,Left,Right'
$script:databaseStudioSqlText.ReadOnly = $true
$script:databaseStudioSqlText.DetectUrls = $false
$script:databaseStudioSqlText.WordWrap = $false
$script:databaseStudioSqlText.BackColor = [System.Drawing.Color]::FromArgb(8, 13, 22)
$script:databaseStudioSqlText.ForeColor = [System.Drawing.Color]::FromArgb(190, 207, 225)
$script:databaseStudioSqlText.Font = New-Object System.Drawing.Font('Consolas', 8)
$script:databaseStudioSqlText.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
$databaseStudioPage.Controls.Add($script:databaseStudioSqlText)

$script:databaseStudioOverview = $null
$script:databaseStudioTables = @()
$script:databaseStudioTablesResult = $null
$script:databaseStudioLastResult = $null
$script:databaseStudioLoaded = $false
$script:databaseStudioViewKeys = @('Tables','Databases','Columns','Constraints','Indexes','Connections')
$script:databaseStudioColumnLabels = @{
    database_name='قاعدة البيانات'; owner_name='المالك'; encoding='الترميز'; size_bytes='الحجم (بايت)'; size_pretty='الحجم'; allows_connections='تقبل اتصالات'; connection_count='الاتصالات'
    schema_name='المخطط'; table_name='الجدول'; object_type='النوع'; estimated_rows='صفوف تقديرية'; table_size_bytes='حجم الجدول'; index_size_bytes='حجم الفهارس'; total_size_bytes='الإجمالي (بايت)'; total_size_pretty='الحجم الإجمالي'; estimated_live_rows='صفوف حية تقديرية'; estimated_dead_rows='صفوف ميتة تقديرية'
    ordinal_position='الترتيب'; column_name='العمود'; data_type='نوع البيانات'; udt_name='النوع الداخلي'; is_nullable='يسمح NULL'; character_maximum_length='أقصى طول'; numeric_precision='الدقة'; numeric_scale='المقياس'
    constraint_name='اسم القيد'; constraint_type='نوع القيد'; definition='التعريف'; is_validated='تم التحقق'; is_deferrable='قابل للتأجيل'; referenced_relation='الجدول المرجعي'
    index_name='اسم الفهرس'; is_primary='أساسي'; is_unique='فريد'; is_valid='صالح'; is_ready='جاهز'; pretty_size='الحجم'
    pid='PID'; user_name='المستخدم'; application_name='التطبيق'; client_location='المصدر'; state='الحالة'; wait_event_type='نوع الانتظار'; wait_event='حدث الانتظار'; backend_start='بدء الاتصال'; query_start='بدء الاستعلام'; elapsed_ms='المدة (ms)'; is_active='نشط'
}

function Format-DarDatabaseStudioSize([object]$Value) {
    if ($null -eq $Value) { return '—' }
    [double]$bytes = 0
    if (-not [double]::TryParse([string]$Value,[ref]$bytes)) { return [string]$Value }
    if ($bytes -ge 1GB) { return ('{0:N2} GiB' -f ($bytes / 1GB)) }
    if ($bytes -ge 1MB) { return ('{0:N2} MiB' -f ($bytes / 1MB)) }
    if ($bytes -ge 1KB) { return ('{0:N1} KiB' -f ($bytes / 1KB)) }
    return ('{0:N0} B' -f $bytes)
}

function Set-DarDatabaseStudioGrid([object[]]$Rows) {
    $grid = $script:databaseStudioGrid
    $grid.SuspendLayout()
    try {
        $grid.DataSource = $null
        $grid.Rows.Clear()
        $grid.Columns.Clear()
        if ($Rows.Count -eq 0) {
            [void]$grid.Columns.Add('Notice','النتيجة')
            [void]$grid.Rows.Add('لا توجد سجلات لهذا العرض.')
            return
        }
        $properties = @($Rows[0].PSObject.Properties | ForEach-Object { $_.Name })
        foreach ($propertyName in $properties) {
            $headerText = if ($script:databaseStudioColumnLabels.ContainsKey($propertyName)) { $script:databaseStudioColumnLabels[$propertyName] } else { $propertyName }
            [void]$grid.Columns.Add($propertyName,$headerText)
        }
        foreach ($record in $Rows) {
            $values = New-Object System.Collections.Generic.List[object]
            foreach ($propertyName in $properties) {
                $value = $record.$propertyName
                if ($null -eq $value) { $values.Add('—') }
                elseif ($value -is [bool]) { $values.Add($(if ($value) {'نعم'} else {'لا'})) }
                elseif ($propertyName -match '(_bytes$|_size_bytes$)') {
                    $formattedSize = Format-DarDatabaseStudioSize -Value $value
                    [void]$values.Add($formattedSize)
                }
                elseif ($value -is [DateTime]) { $values.Add($value.ToString('yyyy-MM-dd HH:mm:ss')) }
                else { $values.Add([string]$value) }
            }
            $rowIndex = $grid.Rows.Add($values.ToArray())
            $grid.Rows[$rowIndex].Tag = $record
        }
        foreach ($column in $grid.Columns) { $column.SortMode = [System.Windows.Forms.DataGridViewColumnSortMode]::Automatic }
    } finally { $grid.ResumeLayout() }
}

function Get-DarDatabaseStudioSelectedTable {
    $selected = $script:databaseStudioTableCombo.SelectedItem
    if ($null -eq $selected) { return $null }
    return $selected
}

function Update-DarDatabaseStudioView {
    if (-not $script:Ready -or -not $script:Secrets) { throw 'قاعدة البيانات المحلية غير جاهزة. افتح دار التحفيظ أولًا.' }
    $viewIndex = [int]$script:databaseStudioViewCombo.SelectedIndex
    if ($viewIndex -lt 0 -or $viewIndex -ge $script:databaseStudioViewKeys.Count) { return }
    $view = $script:databaseStudioViewKeys[$viewIndex]
    $table = Get-DarDatabaseStudioSelectedTable
    $result = $null
    switch ($view) {
        'Tables' { $result = $script:databaseStudioTablesResult }
        'Databases' { $result = Get-DarDatabaseStudioDatabases -Secrets $script:Secrets }
        'Columns' {
            if ($null -eq $table) { throw 'اختر جدولًا أولًا لعرض الأعمدة.' }
            $result = Get-DarDatabaseStudioColumns -Secrets $script:Secrets -SchemaName ([string]$table.SchemaName) -TableName ([string]$table.TableName)
        }
        'Constraints' {
            if ($null -eq $table) { throw 'اختر جدولًا أولًا لعرض العلاقات والقيود.' }
            $result = Get-DarDatabaseStudioConstraints -Secrets $script:Secrets -SchemaName ([string]$table.SchemaName) -TableName ([string]$table.TableName)
        }
        'Indexes' {
            if ($null -eq $table) { throw 'اختر جدولًا أولًا لعرض الفهارس.' }
            $result = Get-DarDatabaseStudioIndexes -Secrets $script:Secrets -SchemaName ([string]$table.SchemaName) -TableName ([string]$table.TableName)
        }
        'Connections' { $result = Get-DarDatabaseStudioConnections -Secrets $script:Secrets }
        default { throw 'عرض قاعدة البيانات المحدد غير مدعوم.' }
    }
    $script:databaseStudioLastResult = $result
    Set-DarDatabaseStudioGrid -Rows @($result.Rows)
    $script:databaseStudioSqlText.Text = $result.SqlText
    $script:databaseStudioSqlText.SelectionStart = 0
    $script:databaseStudioSqlText.SelectionLength = 0
    $script:databaseStudioTableCombo.Enabled = ($view -in @('Columns','Constraints','Indexes'))
    $script:databaseStudioSqlLabel.Text = ('قالب الاستعلام المنفذ للعرض فقط — ' + (Get-DarDatabaseStudioViewQueryLabel $view))
}

function Refresh-DarDatabaseStudio {
    if (-not $script:Ready -or -not $script:Secrets) {
        $script:databaseStudioSummaryLabel.Text = 'قاعدة البيانات المحلية غير جاهزة. افتح دار التحفيظ أولًا.'
        return
    }
    $script:databaseStudioRefreshButton.Enabled = $false
    $script:databaseStudioSummaryLabel.ForeColor = [System.Drawing.Color]::FromArgb(89,166,255)
    $script:databaseStudioSummaryLabel.Text = 'جارٍ قراءة كتالوج PostgreSQL في معاملات READ ONLY محدودة...'
    [System.Windows.Forms.Application]::DoEvents()
    try {
        $script:databaseStudioOverview = Get-DarDatabaseStudioOverview -Secrets $script:Secrets
        if (@($script:databaseStudioOverview.Rows).Count -ne 1) { throw 'لم يتم إرجاع ملخص قاعدة البيانات المتوقع.' }
        $overview = $script:databaseStudioOverview.Rows[0]
        if ([string]$overview.transaction_read_only -ne 'on') { throw 'لم يؤكد PostgreSQL أن المعاملة للقراءة فقط.' }
        if ([int]$overview.server_port -ne 55432 -or [string]$overview.server_version -notmatch '^17\.') { throw 'هوية محرك PostgreSQL لا تطابق إصدار الدار أو المنفذ المحلي المعتمد.' }
        $script:databaseStudioTablesResult = Get-DarDatabaseStudioTables -Secrets $script:Secrets
        $script:databaseStudioTables = @($script:databaseStudioTablesResult.Rows)
        $script:databaseStudioTableCombo.Items.Clear()
        foreach ($entry in $script:databaseStudioTables) {
            [void]$script:databaseStudioTableCombo.Items.Add([pscustomobject]@{ DisplayName=([string]$entry.schema_name + '.' + [string]$entry.table_name); SchemaName=[string]$entry.schema_name; TableName=[string]$entry.table_name })
        }
        if ($script:databaseStudioTableCombo.Items.Count -gt 0) { $script:databaseStudioTableCombo.SelectedIndex = 0 }
        $sizeText = Format-DarDatabaseStudioSize $overview.database_size_bytes
        $startedText = try { ([DateTimeOffset]::Parse([string]$overview.server_started_at)).ToLocalTime().ToString('yyyy-MM-dd HH:mm') } catch { 'غير متاح' }
        $script:databaseStudioSummaryLabel.Text = ('قاعدة: {0} | PostgreSQL {1} | المنفذ: {2} | الحجم: {3} | الاتصالات: {4}/{5} | الاستعلامات النشطة: {6} | بدء المحرك: {7} | READ ONLY: ON' -f $overview.database_name,$overview.server_version,$overview.server_port,$sizeText,$overview.connection_count,$overview.max_connections,$overview.active_query_count,$startedText)
        $script:databaseStudioSummaryLabel.ForeColor = [System.Drawing.Color]::FromArgb(75,205,151)
        $script:databaseStudioLoaded = $true
        Update-DarDatabaseStudioView
        Write-SystemCenterEvent -Level 'Information' -Message ('Read-only Database Studio refresh completed. tables=' + $script:databaseStudioTables.Count + '; connections=' + $overview.connection_count)
        Write-Step 'اكتمل استعراض قاعدة البيانات. كل الاستعلامات كانت READ ONLY ولم تتغير أي بيانات.'
    } catch {
        $script:databaseStudioSummaryLabel.Text = 'تعذر استعراض قاعدة البيانات. راجع سجل System Center.'
        $script:databaseStudioSummaryLabel.ForeColor = [System.Drawing.Color]::FromArgb(255,105,115)
        Write-SystemCenterEvent -Level 'Error' -Message ('Database Studio failed: ' + $_.Exception.Message)
        Show-DarDialog -Title 'تعذر استعراض قاعدة البيانات' -Message $_.Exception.Message -Kind Error | Out-Null
    } finally { $script:databaseStudioRefreshButton.Enabled = $true }
}

$script:databaseStudioRefreshButton.Add_Click({ Refresh-DarDatabaseStudio })
$script:databaseStudioViewCombo.Add_SelectedIndexChanged({
    if ($script:databaseStudioLoaded -and $script:Ready) {
        try { Update-DarDatabaseStudioView } catch { Show-DarDialog -Title 'تعذر تحديث العرض' -Message $_.Exception.Message -Kind Warning | Out-Null }
    }
})
$script:databaseStudioTableCombo.Add_SelectedIndexChanged({
    if ($script:databaseStudioLoaded -and $script:Ready -and $script:databaseStudioViewCombo.SelectedIndex -in @(2,3,4)) {
        try { Update-DarDatabaseStudioView } catch { Show-DarDialog -Title 'تعذر عرض تفاصيل الجدول' -Message $_.Exception.Message -Kind Warning | Out-Null }
    }
})

# Read-only PostgreSQL Maintenance dashboard. No maintenance action buttons are exposed in this phase.
$postgresMaintenanceIntro = New-Object System.Windows.Forms.Label
$postgresMaintenanceIntro.Text = 'مراقبة Autovacuum وDead Tuples وإحصاءات الجداول فقط. هذه الشاشة لا تنفذ VACUUM أو ANALYZE أو REINDEX.'
$postgresMaintenanceIntro.Location = New-Object System.Drawing.Point(22, 14)
$postgresMaintenanceIntro.Size = New-Object System.Drawing.Size(1000, 34)
$postgresMaintenanceIntro.TextAlign = [System.Drawing.ContentAlignment]::MiddleRight
$postgresMaintenanceIntro.ForeColor = [System.Drawing.Color]::FromArgb(171, 187, 207)
$postgresMaintenancePage.Controls.Add($postgresMaintenanceIntro)

$script:postgresMaintenanceRefreshButton = New-Object System.Windows.Forms.Button
$script:postgresMaintenanceRefreshButton.Text = 'تحديث تشخيص الصيانة'
$script:postgresMaintenanceRefreshButton.Location = New-Object System.Drawing.Point(790, 54)
$script:postgresMaintenanceRefreshButton.Size = New-Object System.Drawing.Size(218, 42)
$script:postgresMaintenanceRefreshButton.BackColor = [System.Drawing.Color]::FromArgb(31, 121, 105)
$script:postgresMaintenanceRefreshButton.ForeColor = [System.Drawing.Color]::White
$script:postgresMaintenanceRefreshButton.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$script:postgresMaintenanceRefreshButton.FlatAppearance.BorderSize = 0
$postgresMaintenancePage.Controls.Add($script:postgresMaintenanceRefreshButton)

$script:postgresMaintenanceViewCombo = New-Object System.Windows.Forms.ComboBox
$script:postgresMaintenanceViewCombo.DropDownStyle = [System.Windows.Forms.ComboBoxStyle]::DropDownList
$script:postgresMaintenanceViewCombo.Location = New-Object System.Drawing.Point(490, 60)
$script:postgresMaintenanceViewCombo.Size = New-Object System.Drawing.Size(280, 30)
$script:postgresMaintenanceViewCombo.Items.AddRange([object[]]@('إحصاءات الجداول والصفوف الميتة','إعدادات Autovacuum','عمليات VACUUM النشطة'))
$script:postgresMaintenanceViewCombo.SelectedIndex = 0
$postgresMaintenancePage.Controls.Add($script:postgresMaintenanceViewCombo)

$script:postgresMaintenanceSummaryLabel = New-Object System.Windows.Forms.Label
$script:postgresMaintenanceSummaryLabel.Text = 'لم يتم تحميل إحصاءات الصيانة بعد. اضغط تحديث لبدء الفحص للقراءة فقط.'
$script:postgresMaintenanceSummaryLabel.Location = New-Object System.Drawing.Point(22, 108)
$script:postgresMaintenanceSummaryLabel.Size = New-Object System.Drawing.Size(988, 66)
$script:postgresMaintenanceSummaryLabel.TextAlign = [System.Drawing.ContentAlignment]::MiddleRight
$script:postgresMaintenanceSummaryLabel.BackColor = [System.Drawing.Color]::FromArgb(17, 27, 44)
$script:postgresMaintenanceSummaryLabel.ForeColor = [System.Drawing.Color]::FromArgb(192, 207, 226)
$script:postgresMaintenanceSummaryLabel.Font = New-Object System.Drawing.Font('Segoe UI', 9, [System.Drawing.FontStyle]::Bold)
$postgresMaintenancePage.Controls.Add($script:postgresMaintenanceSummaryLabel)

$script:postgresMaintenanceGrid = New-Object System.Windows.Forms.DataGridView
$script:postgresMaintenanceGrid.Location = New-Object System.Drawing.Point(22, 182)
$script:postgresMaintenanceGrid.Size = New-Object System.Drawing.Size(988, 330)
$script:postgresMaintenanceGrid.Anchor = 'Top,Bottom,Left,Right'
$script:postgresMaintenanceGrid.ReadOnly = $true
$script:postgresMaintenanceGrid.AllowUserToAddRows = $false
$script:postgresMaintenanceGrid.AllowUserToDeleteRows = $false
$script:postgresMaintenanceGrid.AllowUserToResizeRows = $false
$script:postgresMaintenanceGrid.MultiSelect = $false
$script:postgresMaintenanceGrid.SelectionMode = [System.Windows.Forms.DataGridViewSelectionMode]::FullRowSelect
$script:postgresMaintenanceGrid.RowHeadersVisible = $false
$script:postgresMaintenanceGrid.AutoGenerateColumns = $false
$script:postgresMaintenanceGrid.AutoSizeColumnsMode = [System.Windows.Forms.DataGridViewAutoSizeColumnsMode]::DisplayedCells
$script:postgresMaintenanceGrid.ScrollBars = [System.Windows.Forms.ScrollBars]::Both
$script:postgresMaintenanceGrid.RowTemplate.Height = 29
$script:postgresMaintenanceGrid.BackgroundColor = [System.Drawing.Color]::FromArgb(8, 13, 22)
$script:postgresMaintenanceGrid.BorderStyle = [System.Windows.Forms.BorderStyle]::None
$script:postgresMaintenanceGrid.GridColor = [System.Drawing.Color]::FromArgb(39, 54, 74)
$script:postgresMaintenanceGrid.EnableHeadersVisualStyles = $false
$script:postgresMaintenanceGrid.ColumnHeadersDefaultCellStyle.BackColor = [System.Drawing.Color]::FromArgb(20, 34, 52)
$script:postgresMaintenanceGrid.ColumnHeadersDefaultCellStyle.ForeColor = [System.Drawing.Color]::FromArgb(184, 205, 226)
$script:postgresMaintenanceGrid.ColumnHeadersDefaultCellStyle.Font = New-Object System.Drawing.Font('Segoe UI', 8, [System.Drawing.FontStyle]::Bold)
$script:postgresMaintenanceGrid.DefaultCellStyle.BackColor = [System.Drawing.Color]::FromArgb(13, 22, 36)
$script:postgresMaintenanceGrid.DefaultCellStyle.ForeColor = [System.Drawing.Color]::FromArgb(218, 228, 240)
$script:postgresMaintenanceGrid.DefaultCellStyle.SelectionBackColor = [System.Drawing.Color]::FromArgb(31, 61, 70)
$script:postgresMaintenanceGrid.DefaultCellStyle.SelectionForeColor = [System.Drawing.Color]::White
$script:postgresMaintenanceGrid.RightToLeft = [System.Windows.Forms.RightToLeft]::Yes
$postgresMaintenancePage.Controls.Add($script:postgresMaintenanceGrid)

$script:postgresMaintenanceNoteLabel = New-Object System.Windows.Forms.Label
$script:postgresMaintenanceNoteLabel.Text = 'الأرقام الخاصة بالصفوف الحية والميتة والتعديلات تقديرية وتتأثر بوقت آخر تحديث للإحصاءات. لا توجد أي عملية صيانة أو تعديل في هذه الشاشة.'
$script:postgresMaintenanceNoteLabel.Location = New-Object System.Drawing.Point(22, 520)
$script:postgresMaintenanceNoteLabel.Size = New-Object System.Drawing.Size(988, 34)
$script:postgresMaintenanceNoteLabel.Anchor = 'Bottom,Left,Right'
$script:postgresMaintenanceNoteLabel.TextAlign = [System.Drawing.ContentAlignment]::MiddleRight
$script:postgresMaintenanceNoteLabel.ForeColor = [System.Drawing.Color]::FromArgb(171, 187, 207)
$postgresMaintenancePage.Controls.Add($script:postgresMaintenanceNoteLabel)

$script:postgresMaintenanceReport = $null
$script:postgresMaintenanceLoaded = $false
$script:postgresMaintenanceViewKeys = @('Tables','Settings','Progress')
$script:postgresMaintenanceColumnLabels = @{
    schema_name='المخطط'; table_name='الجدول'; estimated_rows='صفوف تقديرية'; estimated_live_tuples='صفوف حية تقديرية'; estimated_dead_tuples='صفوف ميتة تقديرية'; dead_tuple_percent='نسبة الصفوف الميتة %'; modified_since_analyze='تعديلات منذ Analyze'; last_vacuum='آخر Vacuum يدوي'; last_autovacuum='آخر Autovacuum'; last_analyze='آخر Analyze يدوي'; last_autoanalyze='آخر Autoanalyze'; vacuum_count='مرات Vacuum'; autovacuum_count='مرات Autovacuum'; analyze_count='مرات Analyze'; autoanalyze_count='مرات Autoanalyze'; autovacuum_disabled_for_table='Autovacuum معطل للجدول'; table_storage_options='إعدادات الجدول'; total_size_bytes='الحجم الإجمالي'; name='الإعداد'; setting='القيمة'; unit='الوحدة'; source='مصدر الإعداد'; pending_restart='يتطلب إعادة تشغيل'; phase='المرحلة'; heap_blks_total='إجمالي الصفحات'; heap_blks_scanned='صفحات مفحوصة'; heap_blks_vacuumed='صفحات تمت معالجتها'; scan_progress_percent='تقدم الفحص %'; index_vacuum_count='دورات تنظيف الفهارس'; dead_tuple_bytes='حجم العناصر الميتة بالبايت'; max_dead_tuple_bytes='حد حجم العناصر الميتة بالبايت'; num_dead_item_ids='معرفات العناصر الميتة'; indexes_total='إجمالي الفهارس'; indexes_processed='الفهارس المعالجة'
}

function Set-DarPostgresMaintenanceGrid([object[]]$Rows) {
    $grid = $script:postgresMaintenanceGrid
    $grid.SuspendLayout()
    try {
        $grid.DataSource = $null
        $grid.Rows.Clear()
        $grid.Columns.Clear()
        if (@($Rows).Count -eq 0) {
            [void]$grid.Columns.Add('Notice','النتيجة')
            [void]$grid.Rows.Add('لا توجد عمليات نشطة لهذا العرض.')
            return
        }
        $properties = @($Rows[0].PSObject.Properties | ForEach-Object { $_.Name })
        foreach ($propertyName in $properties) {
            $headerText = if ($script:postgresMaintenanceColumnLabels.ContainsKey($propertyName)) { $script:postgresMaintenanceColumnLabels[$propertyName] } else { $propertyName }
            [void]$grid.Columns.Add($propertyName,$headerText)
        }
        foreach ($record in $Rows) {
            $values = New-Object System.Collections.Generic.List[object]
            foreach ($propertyName in $properties) {
                $value = $record.$propertyName
                if ($null -eq $value) { [void]$values.Add('—') }
                elseif ($value -is [bool]) { [void]$values.Add($(if ($value) {'نعم'} else {'لا'})) }
                elseif ($propertyName -match '(_bytes$|_size_bytes$)') { [void]$values.Add((Format-DarDatabaseStudioSize -Value $value)) }
                elseif ($value -is [DateTime]) { [void]$values.Add($value.ToString('yyyy-MM-dd HH:mm:ss')) }
                else { [void]$values.Add([string]$value) }
            }
            [void]$grid.Rows.Add($values.ToArray())
        }
        foreach ($column in $grid.Columns) { $column.SortMode = [System.Windows.Forms.DataGridViewColumnSortMode]::Automatic }
    } finally { $grid.ResumeLayout() }
}

function Update-DarPostgresMaintenanceView {
    if (-not $script:postgresMaintenanceReport) { return }
    $viewIndex = [int]$script:postgresMaintenanceViewCombo.SelectedIndex
    if ($viewIndex -lt 0 -or $viewIndex -ge $script:postgresMaintenanceViewKeys.Count) { return }
    $view = $script:postgresMaintenanceViewKeys[$viewIndex]
    $rows = switch ($view) {
        'Tables' { @($script:postgresMaintenanceReport.Tables); break }
        'Settings' { @($script:postgresMaintenanceReport.Settings); break }
        'Progress' { @($script:postgresMaintenanceReport.VacuumProgress); break }
    }
    Set-DarPostgresMaintenanceGrid -Rows @($rows)
    switch ($view) {
        'Tables' { $script:postgresMaintenanceNoteLabel.Text = 'إحصاءات الصفوف الحية والميتة والتعديلات تقديرية. قد تختلف إعدادات Autovacuum لكل جدول عن الإعدادات العامة.' }
        'Settings' { $script:postgresMaintenanceNoteLabel.Text = 'هذه الإعدادات الفعالة من pg_settings؛ مصدر الإعداد وإشارة pending_restart معروضان عند توفرهما.' }
        'Progress' { $script:postgresMaintenanceNoteLabel.Text = 'هذا العرض يوضح عمليات VACUUM النشطة وقت جمع التقرير فقط؛ عدم وجود صفوف يعني عدم رصد عملية نشطة في تلك اللحظة.' }
    }
}

function Refresh-DarPostgresMaintenance {
    if (-not $script:Ready -or -not $script:Secrets) { throw 'قاعدة البيانات المحلية غير جاهزة. افتح دار التحفيظ أولًا واترك PostgreSQL يعمل.' }
    $script:postgresMaintenanceRefreshButton.Enabled = $false
    $script:postgresMaintenanceSummaryLabel.Text = 'جارٍ قراءة إحصاءات PostgreSQL للقراءة فقط...'
    [System.Windows.Forms.Application]::DoEvents()
    try {
        $report = Get-DarPostgresMaintenanceReport -Secrets $script:Secrets
        if ($report.ReadOnly -ne $true) { throw 'لم يؤكد تقرير الصيانة وضع القراءة فقط.' }
        $overview = $report.Overview
        if ([string]$overview.transaction_read_only -ne 'on') { throw 'PostgreSQL لم يؤكد transaction_read_only=on.' }
        if ([int]$overview.server_port -ne 55432 -or [string]$overview.server_version -notmatch '^17\.') { throw 'هوية PostgreSQL لا تطابق المحرك المحلي المعتمد.' }
        $autoText = if ($overview.autovacuum_enabled) { 'مفعّل' } else { 'معطّل' }
        $trackText = if ($overview.track_counts_enabled) { 'مفعّل' } else { 'معطّل' }
        $freezeText = if ($null -ne $overview.freeze_age_percent) { ([double]$overview.freeze_age_percent).ToString('N2') + '%' } else { 'غير متاح' }
        $statsResetText = if ($overview.statistics_reset_at) { [string]$overview.statistics_reset_at } else { 'غير متاح' }
        $script:postgresMaintenanceSummaryLabel.Text = ('قاعدة: {0} | PostgreSQL {1} | المنفذ: {2} | READ ONLY: ON{10}Autovacuum: {3} | Track Counts: {4} | عمال Autovacuum (القاعدة الحالية): {5}{10}أقدم قاعدة XID: {6} ({7}) | Freeze: {8} | Stats Reset: {9}' -f $overview.database_name,$overview.server_version,$overview.server_port,$autoText,$trackText,$overview.active_autovacuum_workers,$overview.oldest_xid_age,$overview.oldest_database_name,$freezeText,$statsResetText,[Environment]::NewLine)
        $script:postgresMaintenanceSummaryLabel.ForeColor = [System.Drawing.Color]::FromArgb(75,205,151)
        $script:postgresMaintenanceReport = $report
        $script:postgresMaintenanceLoaded = $true
        Update-DarPostgresMaintenanceView
        Write-SystemCenterEvent -Level 'Information' -Message ('Read-only PostgreSQL maintenance diagnostics refreshed. tables=' + @($report.Tables).Count + '; workers=' + $overview.active_autovacuum_workers)
        Write-Step 'اكتمل تشخيص PostgreSQL للقراءة فقط؛ لم يتم تنفيذ أي عملية صيانة.'
    } catch {
        $script:postgresMaintenanceSummaryLabel.Text = 'تعذر قراءة إحصاءات PostgreSQL. راجع سجل System Center.'
        $script:postgresMaintenanceSummaryLabel.ForeColor = [System.Drawing.Color]::FromArgb(255,105,115)
        Write-SystemCenterEvent -Level 'Error' -Message ('PostgreSQL maintenance diagnostics failed: ' + $_.Exception.Message)
        Show-DarDialog -Title 'تعذر تشخيص PostgreSQL' -Message $_.Exception.Message -Kind Error | Out-Null
    } finally { $script:postgresMaintenanceRefreshButton.Enabled = $true }
}

$script:postgresMaintenanceRefreshButton.Add_Click({ Refresh-DarPostgresMaintenance })
$script:postgresMaintenanceViewCombo.Add_SelectedIndexChanged({
    if ($script:postgresMaintenanceLoaded -and $script:Ready) {
        try { Update-DarPostgresMaintenanceView } catch { Show-DarDialog -Title 'تعذر تحديث عرض الصيانة' -Message $_.Exception.Message -Kind Warning | Out-Null }
    }
})

$script:tabs.Add_SelectedIndexChanged({
    if ($script:tabs.SelectedTab -eq $storagePage -and -not $script:storageLoaded) { $script:storageRefreshButton.PerformClick() }
    if ($script:tabs.SelectedTab -eq $databaseStudioPage -and -not $script:databaseStudioLoaded) { $script:databaseStudioRefreshButton.PerformClick() }
    if ($script:tabs.SelectedTab -eq $postgresMaintenancePage -and -not $script:postgresMaintenanceLoaded) { $script:postgresMaintenanceRefreshButton.PerformClick() }
})

# Live console toolbar
$script:sourceCombo = New-Object System.Windows.Forms.ComboBox
$script:sourceCombo.DropDownStyle = [System.Windows.Forms.ComboBoxStyle]::DropDownList
$script:sourceCombo.Location = New-Object System.Drawing.Point(700, 16)
$script:sourceCombo.Size = New-Object System.Drawing.Size(310, 30)
$script:sourceCombo.Items.AddRange([object[]]@('API — أحداث منظمة','PostgreSQL','مشغّل التطبيق','System Center','API — إخراج التشغيل','API — أخطاء التشغيل','النسخ الاحتياطي المجدول'))
$script:sourceCombo.SelectedIndex = 0
$logPage.Controls.Add($script:sourceCombo)

$script:levelCombo = New-Object System.Windows.Forms.ComboBox
$script:levelCombo.DropDownStyle = [System.Windows.Forms.ComboBoxStyle]::DropDownList
$script:levelCombo.Location = New-Object System.Drawing.Point(535, 16)
$script:levelCombo.Size = New-Object System.Drawing.Size(145, 30)
$script:levelCombo.Items.AddRange([object[]]@('كل المستويات','الأخطاء فقط','التحذيرات فقط'))
$script:levelCombo.SelectedIndex = 0
$logPage.Controls.Add($script:levelCombo)

$copyButton = New-Object System.Windows.Forms.Button
$copyButton.Text = 'نسخ المعروض'
$copyButton.Location = New-Object System.Drawing.Point(420, 14)
$copyButton.Size = New-Object System.Drawing.Size(105, 34)
$logPage.Controls.Add($copyButton)

$clearButton = New-Object System.Windows.Forms.Button
$clearButton.Text = 'مسح العرض'
$clearButton.Location = New-Object System.Drawing.Point(310, 14)
$clearButton.Size = New-Object System.Drawing.Size(100, 34)
$clearButton.BackColor = [System.Drawing.Color]::FromArgb(250, 238, 238)
$clearButton.ForeColor = [System.Drawing.Color]::FromArgb(145, 56, 56)
$clearButton.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$logPage.Controls.Add($clearButton)
$clearTip = New-Object System.Windows.Forms.ToolTip
$clearTip.SetToolTip($clearButton, 'يمسح النص المعروض على الشاشة فقط، ولا يحذف ملفات السجل المحفوظة.')

$reloadButton = New-Object System.Windows.Forms.Button
$reloadButton.Text = 'إعادة تحميل'
$reloadButton.Location = New-Object System.Drawing.Point(205, 14)
$reloadButton.Size = New-Object System.Drawing.Size(95, 34)
$logPage.Controls.Add($reloadButton)

$openLogsButton = New-Object System.Windows.Forms.Button
$openLogsButton.Text = 'مجلد السجلات'
$openLogsButton.Location = New-Object System.Drawing.Point(28, 14)
$openLogsButton.Size = New-Object System.Drawing.Size(165, 34)
$logPage.Controls.Add($openLogsButton)

$script:console = New-Object System.Windows.Forms.RichTextBox
$script:console.Location = New-Object System.Drawing.Point(20, 62)
$script:console.Size = New-Object System.Drawing.Size(1010, 422)
$script:console.Anchor = 'Top,Bottom,Left,Right'
$script:console.ReadOnly = $true
$script:console.DetectUrls = $false
$script:console.WordWrap = $false
$script:console.BackColor = [System.Drawing.Color]::FromArgb(16, 23, 34)
$script:console.ForeColor = [System.Drawing.Color]::FromArgb(218, 228, 240)
$script:console.Font = New-Object System.Drawing.Font('Consolas', 9)
$script:console.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
$script:console.RightToLeft = [System.Windows.Forms.RightToLeft]::No
$logPage.Controls.Add($script:console)

$script:pathLabel = New-Object System.Windows.Forms.Label
$script:pathLabel.Location = New-Object System.Drawing.Point(20, 492)
$script:pathLabel.Size = New-Object System.Drawing.Size(1010, 24)
$script:pathLabel.Anchor = 'Bottom,Left,Right'
$script:pathLabel.ForeColor = [System.Drawing.Color]::FromArgb(96, 109, 128)
$script:pathLabel.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft
$logPage.Controls.Add($script:pathLabel)

$script:liveCheck = New-Object System.Windows.Forms.CheckBox
$script:liveCheck.Text = 'متابعة مباشرة'
$script:liveCheck.Checked = $true
$script:liveCheck.AutoSize = $true
$script:liveCheck.Location = New-Object System.Drawing.Point(890, 526)
$script:liveCheck.Anchor = 'Bottom,Right'
$logPage.Controls.Add($script:liveCheck)

$script:followCheck = New-Object System.Windows.Forms.CheckBox
$script:followCheck.Text = 'النزول لآخر حدث تلقائيًا'
$script:followCheck.Checked = $true
$script:followCheck.AutoSize = $true
$script:followCheck.Location = New-Object System.Drawing.Point(690, 526)
$script:followCheck.Anchor = 'Bottom,Right'
$logPage.Controls.Add($script:followCheck)

$script:logStatus = New-Object System.Windows.Forms.Label
$script:logStatus.Location = New-Object System.Drawing.Point(20, 522)
$script:logStatus.Size = New-Object System.Drawing.Size(640, 28)
$script:logStatus.Anchor = 'Bottom,Left,Right'
$script:logStatus.ForeColor = [System.Drawing.Color]::FromArgb(90, 105, 125)
$script:logStatus.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft
$script:logStatus.Text = 'المراقبة تستخدم إشعارات الملفات؛ لا يوجد تحديث دوري أو إعادة تحميل كل ثانيتين.'
$logPage.Controls.Add($script:logStatus)

$script:statusLabel = New-Object System.Windows.Forms.Label
$script:statusLabel.Text = 'جاهز لبدء الفحص.'
$script:statusLabel.Location = New-Object System.Drawing.Point(18, 710)
$script:statusLabel.Size = New-Object System.Drawing.Size(1068, 30)
$script:statusLabel.Anchor = 'Bottom,Left,Right'
$script:statusLabel.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
$script:statusLabel.BackColor = [System.Drawing.Color]::White
$script:statusLabel.TextAlign = [System.Drawing.ContentAlignment]::MiddleRight
$script:statusLabel.Padding = New-Object System.Windows.Forms.Padding(8, 0, 8, 0)
$form.Controls.Add($script:statusLabel)

$script:sourceCombo.Add_SelectedIndexChanged({ Load-SelectedLog })
$script:levelCombo.Add_SelectedIndexChanged({ Load-SelectedLog })
$reloadButton.Add_Click({ Load-SelectedLog })
$clearButton.Add_Click({
    $script:console.Clear()
    $script:PendingLogText = ''
    if ($script:ActiveLogPath -and (Test-Path -LiteralPath $script:ActiveLogPath)) {
        $item = Get-Item -LiteralPath $script:ActiveLogPath
        $script:LogReadOffset = [long]$item.Length
    }
    $script:logStatus.Text = 'تم مسح العرض الحالي فقط؛ ملفات السجل الأصلية محفوظة بالكامل.'
    Write-SystemCenterEvent -Level 'Information' -Message 'تم مسح محتوى عارض السجلات فقط؛ لم يتم حذف أي ملف سجل.'
})
$copyButton.Add_Click({
    if (-not [string]::IsNullOrEmpty($script:console.Text)) {
        [System.Windows.Forms.Clipboard]::SetText($script:console.Text)
        $script:logStatus.Text = 'تم نسخ النص المعروض.'
    }
})
$openLogsButton.Add_Click({ Start-Process explorer.exe -ArgumentList "`"$script:LogRoot`"" })
$script:liveCheck.Add_CheckedChanged({
    $script:LiveEnabled = $script:liveCheck.Checked
    if ($script:LiveEnabled) {
        $script:logStatus.Text = 'المتابعة المباشرة نشطة عبر إشعارات الملفات.'
        Drain-LogFileEvents
        Read-AppendedLogData
    } else {
        $script:logStatus.Text = 'المتابعة متوقفة مؤقتًا؛ ستظهر الأحداث الجديدة عند الاستئناف.'
    }
})
$script:followCheck.Add_CheckedChanged({ $script:FollowTail = $script:followCheck.Checked })

$backupButton.Add_Click({
    if (-not $script:Ready) { return }
    $dialog = New-Object System.Windows.Forms.SaveFileDialog
    $dialog.Title = 'حفظ نسخة احتياطية كاملة'
    $dialog.InitialDirectory = (Get-DarLocalPaths).BackupFolder
    $dialog.FileName = 'DarEltahfeez_FULL_' + (Get-Date -Format 'yyyyMMdd_HHmmss') + '.backup'
    $dialog.Filter = 'PostgreSQL Custom Backup (*.backup)|*.backup'
    $dialog.OverwritePrompt = $true
    if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { return }
    try {
        $backupButton.Enabled = $false
        Write-Step 'جارٍ إنشاء نسخة PostgreSQL كاملة وفحصها...'
        $file = New-DarDatabaseBackup -DestinationPath $dialog.FileName -Secrets $script:Secrets
        $manifestResult = New-DarBackupManifest -BackupPath $file.FullName -Secrets $script:Secrets
        Write-Step "اكتملت النسخة وManifest: $([math]::Round($file.Length / 1MB, 2)) MB"
        Show-DarDialog -Title 'اكتمل النسخ الاحتياطي' -Message "تم إنشاء النسخة الاحتياطية وفحصها وحفظ Manifest موثق لها بنجاح.`r`n`r`nالنسخة:`r`n$($file.FullName)`r`n`r`nManifest:`r`n$($manifestResult.Path)" -Kind Success | Out-Null
    } catch {
        Write-SystemCenterEvent -Level 'Error' -Message ('Backup failed: ' + $_.Exception.Message)
        Write-Step 'فشل إنشاء النسخة الاحتياطية.'
        Show-DarDialog -Title 'تعذر إنشاء النسخة' -Message $_.Exception.Message -Kind Error | Out-Null
    } finally { $backupButton.Enabled = $true }
})

$restoreButton.Add_Click({
    if (-not $script:Ready) { return }
    $dialog = New-Object System.Windows.Forms.OpenFileDialog
    $dialog.Title = 'اختر نسخة PostgreSQL كاملة لاستعادتها'
    $dialog.Filter = 'PostgreSQL Custom Backup (*.backup;*.dump)|*.backup;*.dump|All files (*.*)|*.*'
    $dialog.CheckFileExists = $true
    $dialog.Multiselect = $false
    if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { return }
    $confirm = Show-DarDialog -Title 'تأكيد استعادة قاعدة البيانات' -Message "سيتم فحص الملف واستعادته أولًا في قاعدة مؤقتة. إذا نجح الفحص، سيتم إنشاء نسخة أمان من قاعدة الجهاز الحالية ثم تحويلها إلى اسم احتياطي قبل التبديل.`r`n`r`nالملف:`r`n$($dialog.FileName)`r`n`r`nيجب إغلاق التطبيق بالكامل. هل تريد المتابعة؟" -Kind Warning -Buttons YesNo -PrimaryText 'متابعة الاستعادة' -SecondaryText 'إلغاء'
    if ($confirm -ne [System.Windows.Forms.DialogResult]::Yes) { return }
    try {
        $restoreButton.Enabled = $false; $backupButton.Enabled = $false
        Write-Step 'جارٍ التحقق من ملف النسخة الاحتياطية...'
        $previous = Restore-DarDatabaseBackup -BackupPath $dialog.FileName -Secrets $script:Secrets
        if ($previous) {
            Write-Step 'اكتملت الاستعادة. تم الاحتفاظ بقاعدة الجهاز السابقة ونسخة أمان مستقلة.'
            Show-DarDialog -Title 'اكتملت الاستعادة' -Message "تمت الاستعادة بنجاح.`r`n`r`nقاعدة الجهاز السابقة محفوظة باسم:`r`n$previous`r`n`r`nيمكنك الآن فتح دار التحفيظ." -Kind Success | Out-Null
        } else {
            Write-Step 'اكتملت الاستعادة بنجاح.'
            Show-DarDialog -Title 'اكتملت الاستعادة' -Message 'تمت استعادة النسخة الاحتياطية بنجاح. يمكنك الآن فتح دار التحفيظ.' -Kind Success | Out-Null
        }
    } catch {
        Write-SystemCenterEvent -Level 'Error' -Message ('Restore failed: ' + $_.Exception.Message)
        Write-Step 'لم تكتمل الاستعادة. القاعدة الأصلية لم يتم اعتمادها للاستبدال.'
        Show-DarDialog -Title 'فشلت الاستعادة' -Message $_.Exception.Message -Kind Error | Out-Null
    } finally { $restoreButton.Enabled = $true; $backupButton.Enabled = $true }
})

$openFolderButton.Add_Click({
    $folder = (Get-DarLocalPaths).BackupFolder
    Write-Step 'فتح مجلد النسخ الاحتياطية.'
    New-Item -ItemType Directory -Force -Path $folder | Out-Null
    Start-Process explorer.exe -ArgumentList "`"$folder`""
})

$stopButton.Add_Click({
    if (-not $script:Ready) { return }
    try {
        Assert-DarApplicationClosed
        $paths = Get-DarLocalPaths
        $status = Invoke-DarPgTool -Tool 'pg_ctl' -Arguments @('status','-D',$paths.Data) -Password '' -AllowFailure
        if ($status.ExitCode -eq 0) {
            Invoke-DarPgTool -Tool 'pg_ctl' -Arguments @('stop','-D',$paths.Data,'-m','fast','-w','-t','30') -Password '' | Out-Null
            Write-Step 'تم إيقاف محرك قاعدة البيانات بأمان. بياناتك ما زالت محفوظة.'
        } else { Write-Step 'محرك قاعدة البيانات متوقف بالفعل.' }
        $script:Ready = $false
        $backupButton.Enabled = $false; $restoreButton.Enabled = $false; $stopButton.Enabled = $false
        Write-Step 'تم الإيقاف. أغلق الأداة وافتحها مجددًا لإعادة تشغيل المحرك.'
    } catch {
        Write-SystemCenterEvent -Level 'Error' -Message ('PostgreSQL stop failed: ' + $_.Exception.Message)
        Show-DarDialog -Title 'تعذر إيقاف قاعدة البيانات' -Message $_.Exception.Message -Kind Error | Out-Null
    }
})


$script:saveScheduleButton.Add_Click({
    try {
        if ($script:backupScheduleEnabled.Checked) {
            Write-Step 'جارٍ تثبيت النسخ الاحتياطي المستقل في Windows Task Scheduler...'
            $state = Set-DarBackupSchedule -SourceToolsPath $PSScriptRoot -DailyTime $script:backupScheduleTime.Value.ToString('HH:mm') -RetentionCount ([int]$script:backupRetentionCount.Value)
            Write-Step "تم تفعيل النسخ اليومي الساعة $($state.DailyTime)."
            Show-DarDialog -Title 'تم تفعيل الجدولة' -Message "تم تسجيل النسخ الاحتياطي اليومي بنجاح.`r`n`r`nيمكن إغلاق دار التحفيظ ومركز النظام بعد الحفظ. يجب أن يظل حساب Windows مسجل الدخول وأن يكون الجهاز يعمل أو في وضع Sleep مع السماح بمؤقتات الإيقاظ." -Kind Success | Out-Null
        } else {
            $state = Disable-DarBackupSchedule
            Write-Step 'تم تعطيل النسخ المجدول. ملفات النسخ الموجودة لم تتغير.'
        }
        try { [void](Update-DarBackupSchedulerPayload -SourceToolsPath $PSScriptRoot) } catch { Write-SystemCenterEvent -Level 'Warning' -Message ('Could not refresh installed backup runner scripts: ' + $_.Exception.Message) }
        Update-BackupScheduleUi
    } catch {
        Write-SystemCenterEvent -Level 'Error' -Message ('Saving backup schedule failed: ' + $_.Exception.Message)
        Show-DarDialog -Title 'تعذر حفظ الجدولة' -Message $_.Exception.Message -Kind Error | Out-Null
    }
})
$script:disableScheduleButton.Add_Click({
    $confirm = Show-DarDialog -Title 'تأكيد تعطيل الجدولة' -Message 'سيتم تعطيل مهمة النسخ التلقائي فقط. لن يتم حذف أي نسخة احتياطية موجودة. هل تريد المتابعة؟' -Kind Warning -Buttons YesNo -PrimaryText 'تعطيل الجدولة' -SecondaryText 'إلغاء'
    if ($confirm -ne [System.Windows.Forms.DialogResult]::Yes) { return }
    try { Disable-DarBackupSchedule | Out-Null; Update-BackupScheduleUi; Write-Step 'تم تعطيل النسخ المجدول.' }
    catch { Show-DarDialog -Title 'تعذر تعطيل الجدولة' -Message $_.Exception.Message -Kind Error | Out-Null }
})
$script:runBackupNowButton.Add_Click({
    try {
        $backupProcessId = Start-DarBackupNow -SourceToolsPath $PSScriptRoot
        Write-Step "بدأت عملية النسخ الاحتياطي في الخلفية (Process ID=$backupProcessId). تابع backup-scheduler.jsonl في الكونسول."
        Update-BackupScheduleUi
    } catch { Show-DarDialog -Title 'تعذر بدء النسخ' -Message $_.Exception.Message -Kind Error | Out-Null }
})
$script:refreshScheduleButton.Add_Click({ Update-BackupScheduleUi })
$script:openScheduleLogButton.Add_Click({
    $log = (Get-DarBackupSchedulerPaths).Log
    if (-not (Test-Path -LiteralPath $log -PathType Leaf)) { New-Item -ItemType File -Path $log -Force | Out-Null }
    $tabs.SelectedTab = $logPage
    $script:sourceCombo.SelectedIndex = 6
    Load-SelectedLog
    Write-Step 'تم فتح سجل النسخ داخل الكونسول المباشر.'
})

# FileSystemWatcher events are queued by PowerShell event jobs. A short UI dispatcher
# only drains the in-memory queue; it never polls or reloads log files on a schedule.
$script:Watcher = New-Object System.IO.FileSystemWatcher
$script:Watcher.Path = $script:LogRoot
$script:Watcher.Filter = '*'
$script:Watcher.IncludeSubdirectories = $false
$script:Watcher.NotifyFilter = [System.IO.NotifyFilters]::FileName -bor [System.IO.NotifyFilters]::LastWrite -bor [System.IO.NotifyFilters]::Size
$eventMap = @(
    @{ Name = 'Changed'; Id = 'DarSystemCenter.Log.Changed' },
    @{ Name = 'Created'; Id = 'DarSystemCenter.Log.Created' },
    @{ Name = 'Deleted'; Id = 'DarSystemCenter.Log.Deleted' },
    @{ Name = 'Renamed'; Id = 'DarSystemCenter.Log.Renamed' }
)
foreach ($entry in $eventMap) {
    Unregister-Event -SourceIdentifier $entry.Id -ErrorAction SilentlyContinue
    $subscription = Register-ObjectEvent -InputObject $script:Watcher -EventName $entry.Name -SourceIdentifier $entry.Id -MessageData $script:WatcherContext -Action {
        try {
            $changeArgs = $Event.SourceEventArgs
            if ($changeArgs -and $Event.MessageData -and $Event.MessageData.Queue) {
                $Event.MessageData.Queue.Enqueue([string]$changeArgs.FullPath)
            }
        } catch {
            try {
                $failure = "[$([DateTimeOffset]::Now.ToString('o'))] FileSystemWatcher event action failed`r`n$($_.Exception.ToString())`r`n$('=' * 72)`r`n"
                [System.IO.File]::AppendAllText([string]$Event.MessageData.CrashLog, $failure, [System.Text.UTF8Encoding]::new($false))
            } catch { }
        }
    }
    $script:WatcherSourceIds += $entry.Id
}
$script:Watcher.EnableRaisingEvents = $true
$script:EventDispatchTimer = New-Object System.Windows.Forms.Timer
$script:EventDispatchTimer.Interval = 100
$script:EventDispatchTimer.Add_Tick({ Drain-LogFileEvents })
$script:EventDispatchTimer.Start()

$form.Add_Shown({
    Load-SelectedLog
    try {
        Write-Step 'جارٍ تجهيز محرك قاعدة البيانات المحلي والتحقق من الاتصال...'
        Ensure-DarLocalPostgres -ProjectRoot $Root
        $script:Secrets = Get-DarDatabaseSecrets
        $script:Ready = $true
        $backupButton.Enabled = $true; $restoreButton.Enabled = $true; $stopButton.Enabled = $true
        Write-Step 'قاعدة البيانات جاهزة. يمكنك إنشاء نسخة أو استعادة نسخة سابقة.'
        Update-BackupScheduleUi
    } catch {
        Write-SystemCenterEvent -Level 'Error' -Message ('PostgreSQL initialization failed: ' + $_.Exception.Message)
        Write-Step 'تعذر تجهيز قاعدة البيانات. راجع السجلات.'
        Show-DarDialog -Title 'مركز إدارة النظام' -Message $_.Exception.Message -Kind Error | Out-Null
    }
})
$form.Add_FormClosed({
    if ($script:EventDispatchTimer) { $script:EventDispatchTimer.Stop(); $script:EventDispatchTimer.Dispose() }
    if ($script:Watcher) {
        $script:Watcher.EnableRaisingEvents = $false
        $script:Watcher.Dispose()
    }
    foreach ($sourceId in $script:WatcherSourceIds) {
        try { Unregister-Event -SourceIdentifier $sourceId -Force -ErrorAction SilentlyContinue } catch { }
        try { Get-Event -SourceIdentifier $sourceId -ErrorAction SilentlyContinue | Remove-Event -ErrorAction SilentlyContinue } catch { }
    }
    Write-SystemCenterEvent -Level 'Information' -Message 'تم إغلاق Dar System Center.'
})

# Dark visual theme aligned with the Dar desktop application's navy surfaces and teal accent.
$form.BackColor = [System.Drawing.Color]::FromArgb(9, 15, 26)
$form.ForeColor = [System.Drawing.Color]::FromArgb(231, 238, 247)
$header.BackColor = [System.Drawing.Color]::FromArgb(16, 27, 44)
$header.BorderStyle = [System.Windows.Forms.BorderStyle]::None
$title.ForeColor = [System.Drawing.Color]::FromArgb(238, 244, 252)
$subtitle.ForeColor = [System.Drawing.Color]::FromArgb(145, 162, 184)
$opsPage.BackColor = [System.Drawing.Color]::FromArgb(12, 21, 35)
$logPage.BackColor = [System.Drawing.Color]::FromArgb(12, 21, 35)
$schedulePage.BackColor = [System.Drawing.Color]::FromArgb(12, 21, 35)
$healthPage.BackColor = [System.Drawing.Color]::FromArgb(12, 21, 35)
$opsIntro.ForeColor = [System.Drawing.Color]::FromArgb(171, 187, 207)
$opsPath.ForeColor = [System.Drawing.Color]::FromArgb(145, 162, 184)
$opsNotice.BackColor = [System.Drawing.Color]::FromArgb(50, 42, 28)
$opsNotice.ForeColor = [System.Drawing.Color]::FromArgb(245, 205, 132)
$script:statusLabel.BackColor = [System.Drawing.Color]::FromArgb(16, 27, 44)
$script:statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(192, 207, 226)
$script:statusLabel.BorderStyle = [System.Windows.Forms.BorderStyle]::None
$backupButton.BackColor = [System.Drawing.Color]::FromArgb(31, 121, 105)
$restoreButton.BackColor = [System.Drawing.Color]::FromArgb(42, 91, 145)
$stopButton.BackColor = [System.Drawing.Color]::FromArgb(62, 35, 43)
$stopButton.ForeColor = [System.Drawing.Color]::FromArgb(255, 139, 145)
$openFolderButton.BackColor = [System.Drawing.Color]::FromArgb(34, 49, 70)
$openFolderButton.ForeColor = [System.Drawing.Color]::FromArgb(225, 234, 245)
foreach ($button in @($backupButton,$restoreButton,$stopButton,$openFolderButton,$copyButton,$clearButton,$reloadButton,$openLogsButton)) {
    $button.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
    $button.FlatAppearance.BorderSize = 0
    $button.Font = New-Object System.Drawing.Font('Segoe UI', 9, [System.Drawing.FontStyle]::Bold)
}
foreach ($combo in @($script:sourceCombo,$script:levelCombo)) {
    $combo.BackColor = [System.Drawing.Color]::FromArgb(24, 37, 57)
    $combo.ForeColor = [System.Drawing.Color]::FromArgb(230, 238, 248)
    $combo.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
}
foreach ($check in @($script:liveCheck,$script:followCheck)) {
    $check.BackColor = [System.Drawing.Color]::FromArgb(12, 21, 35)
    $check.ForeColor = [System.Drawing.Color]::FromArgb(192, 207, 226)
}
$script:pathLabel.ForeColor = [System.Drawing.Color]::FromArgb(135, 153, 177)
$script:logStatus.ForeColor = [System.Drawing.Color]::FromArgb(135, 153, 177)
$script:logStatus.Text = 'المتابعة المباشرة تعتمد إشعارات الملفات؛ لا تتم إعادة قراءة السجل إلا عند وصول تغيير.'
$script:console.BackColor = [System.Drawing.Color]::FromArgb(8, 13, 22)
$script:console.ForeColor = [System.Drawing.Color]::FromArgb(211, 221, 235)
$script:console.BorderStyle = [System.Windows.Forms.BorderStyle]::None


$scheduleIntro.ForeColor = [System.Drawing.Color]::FromArgb(171, 187, 207)
$scheduleTimeLabel.ForeColor = [System.Drawing.Color]::FromArgb(192, 207, 226)
$retentionLabel.ForeColor = [System.Drawing.Color]::FromArgb(192, 207, 226)
foreach ($control in @($script:backupScheduleEnabled,$script:backupScheduleTime,$script:backupRetentionCount)) {
    $control.BackColor = [System.Drawing.Color]::FromArgb(24, 37, 57)
    $control.ForeColor = [System.Drawing.Color]::FromArgb(230, 238, 248)
}
$script:scheduleStatusLabel.BackColor = [System.Drawing.Color]::FromArgb(16, 27, 44)
$script:scheduleStatusLabel.ForeColor = [System.Drawing.Color]::FromArgb(205, 220, 238)
$scheduleNotice.BackColor = [System.Drawing.Color]::FromArgb(35, 43, 58)
$scheduleNotice.ForeColor = [System.Drawing.Color]::FromArgb(192, 207, 226)
$scheduleNotice.Font = New-Object System.Drawing.Font('Segoe UI', 9)
$scheduleNotice.Padding = New-Object System.Windows.Forms.Padding(12,8,12,8)
foreach ($button in @($script:saveScheduleButton,$script:disableScheduleButton,$script:runBackupNowButton,$script:refreshScheduleButton,$script:openScheduleLogButton)) {
    $button.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
    $button.FlatAppearance.BorderSize = 0
    $button.Font = New-Object System.Drawing.Font('Segoe UI', 9, [System.Drawing.FontStyle]::Bold)
    $button.BackColor = [System.Drawing.Color]::FromArgb(34, 49, 70)
    $button.ForeColor = [System.Drawing.Color]::FromArgb(225, 234, 245)
}
$script:saveScheduleButton.BackColor = [System.Drawing.Color]::FromArgb(31, 121, 105)
$script:disableScheduleButton.ForeColor = [System.Drawing.Color]::FromArgb(255, 165, 165)
# Match the Dar desktop UI tokens: deep navy surfaces, soft borders and mint accent.
$script:tabs = $tabs
$tabs.Appearance = [System.Windows.Forms.TabAppearance]::Buttons
$tabs.SizeMode = [System.Windows.Forms.TabSizeMode]::Fixed
$tabs.ItemSize = New-Object System.Drawing.Size(260,44)
$tabs.DrawMode = [System.Windows.Forms.TabDrawMode]::OwnerDrawFixed
$tabs.Padding = New-Object System.Drawing.Point(14,7)
$tabs.Cursor = [System.Windows.Forms.Cursors]::Hand
$tabs.Add_DrawItem({
    param($sender,$eventArgs)
    $tab = $script:tabs.TabPages[$eventArgs.Index]
    $bounds = $eventArgs.Bounds
    $selected = ($eventArgs.Index -eq $script:tabs.SelectedIndex)
    $fill = if ($selected) { [System.Drawing.Color]::FromArgb(25,58,61) } else { [System.Drawing.Color]::FromArgb(17,27,44) }
    $textColor = if ($selected) { [System.Drawing.Color]::FromArgb(113,213,192) } else { [System.Drawing.Color]::FromArgb(149,164,186) }
    $brush = New-Object System.Drawing.SolidBrush($fill)
    $textBrush = New-Object System.Drawing.SolidBrush($textColor)
    $format = New-Object System.Drawing.StringFormat
    $accentBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(113,213,192))
    $format.Alignment = [System.Drawing.StringAlignment]::Center
    $format.LineAlignment = [System.Drawing.StringAlignment]::Center
    try {
        $eventArgs.Graphics.FillRectangle($brush,$bounds)
        if ($selected) { $eventArgs.Graphics.FillRectangle($accentBrush,$bounds.X,($bounds.Bottom-3),$bounds.Width,3) }
        $textBounds = [System.Drawing.RectangleF]::new([single]$bounds.X, [single]$bounds.Y, [single]$bounds.Width, [single]$bounds.Height)
        $eventArgs.Graphics.DrawString($tab.Text,$script:tabs.Font,$textBrush,$textBounds,$format)
    } finally { $brush.Dispose(); $textBrush.Dispose(); $format.Dispose(); $accentBrush.Dispose() }
})
# Soft card surfaces behind the controls make the admin center feel like a first-party feature.
foreach ($cardSpec in @(
    @{ Page=$schedulePage; X=16; Y=74; W=1025; H=150 },
    @{ Page=$schedulePage; X=16; Y=226; W=1025; H=330 },
    @{ Page=$opsPage; X=16; Y=62; W=1025; H=285 },
    @{ Page=$logPage; X=12; Y=8; W=1025; H=510 },
    @{ Page=$healthPage; X=12; Y=101; W=1025; H=445 },
    @{ Page=$storagePage; X=12; Y=101; W=1025; H=445 },
    @{ Page=$databaseStudioPage; X=12; Y=101; W=1025; H=445 }
)) {
    $card = New-Object System.Windows.Forms.Panel
    $card.Location = New-Object System.Drawing.Point([int]$cardSpec.X,[int]$cardSpec.Y)
    $card.Size = New-Object System.Drawing.Size([int]$cardSpec.W,[int]$cardSpec.H)
    $card.BackColor = [System.Drawing.Color]::FromArgb(17,27,44)
    $card.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
    $cardSpec.Page.Controls.Add($card)
    $card.SendToBack()
}
foreach ($button in @($script:saveScheduleButton,$script:disableScheduleButton,$script:runBackupNowButton,$script:refreshScheduleButton,$script:openScheduleLogButton)) {
    $button.Cursor = [System.Windows.Forms.Cursors]::Hand
    $button.FlatAppearance.MouseOverBackColor = [System.Drawing.Color]::FromArgb(42,67,86)
}
$script:saveScheduleButton.FlatAppearance.MouseOverBackColor = [System.Drawing.Color]::FromArgb(40,145,126)
$script:runBackupNowButton.FlatAppearance.MouseOverBackColor = [System.Drawing.Color]::FromArgb(42,91,145)
$script:scheduleStatusLabel.BorderStyle = [System.Windows.Forms.BorderStyle]::None
$script:scheduleStatusLabel.Padding = New-Object System.Windows.Forms.Padding(12,8,12,8)
$script:scheduleStatusLabel.Font = New-Object System.Drawing.Font('Segoe UI',9)

foreach ($button in @($script:healthRunButton,$script:healthExportButton)) {
    $button.Cursor = [System.Windows.Forms.Cursors]::Hand
    $button.FlatAppearance.MouseOverBackColor = [System.Drawing.Color]::FromArgb(43, 77, 93)
}
$script:healthExportButton.BackColor = [System.Drawing.Color]::FromArgb(39, 61, 87)
foreach ($button in @($script:storageMoveButton,$script:storageRefreshButton,$script:storageExportButton,$script:storageOpenButton,$script:databaseStudioRefreshButton)) {
    $button.Cursor = [System.Windows.Forms.Cursors]::Hand
    $button.FlatAppearance.MouseOverBackColor = [System.Drawing.Color]::FromArgb(43, 77, 93)
}
$script:databaseStudioGrid.ColumnHeadersHeight = 34
$script:healthGrid.ColumnHeadersHeight = 34
$script:healthGrid.RowTemplate.Height = 30
$script:healthDetails.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
Write-SystemCenterEvent -Level 'Information' -Message 'تم تشغيل Dar System Center 0.8.25.0.'

[void]$form.ShowDialog()
