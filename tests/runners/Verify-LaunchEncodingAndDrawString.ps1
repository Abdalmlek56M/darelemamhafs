$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

# JSON files shipped with the source must be strict UTF-8 without a BOM.
# Runtime/build output is deliberately excluded: WebView2 and other vendor-generated
# manifests may legitimately use a BOM and are not authored project source files.
$generatedPathPattern = '(?i)(^|[\\/])(?:bin|obj|publish|node_modules|dist|\.git|\.vs|TestResults|WebView2|EBWebView|artifacts|coverage)(?:[\\/]|$)|(^|[\\/])[^\\/]*\.WebView2(?:[\\/]|$)'
$jsonFiles = @()
foreach ($relative in @('frontend','backend','desktop-host','tests')) {
    $folder = Join-Path $projectRoot $relative
    if (-not (Test-Path -LiteralPath $folder -PathType Container)) { continue }
    if ($relative -eq 'frontend') {
        $candidates = @(Get-ChildItem -LiteralPath $folder -Filter '*.json' -File)
    } else {
        $candidates = @(Get-ChildItem -LiteralPath $folder -Filter '*.json' -File -Recurse | Where-Object {
            $relativePath = $_.FullName.Substring($projectRoot.Length)
            # Avoid PowerShell 5.1 TrimStart overload ambiguity with two-character strings.
            if ($relativePath.Length -gt 0 -and ($relativePath[0] -eq [char]92 -or $relativePath[0] -eq [char]47)) {
                $relativePath = $relativePath.Substring(1)
            }
            $relativePath -notmatch $generatedPathPattern
        })
    }
    $jsonFiles += $candidates
}
$scannerSource = [System.IO.File]::ReadAllText($MyInvocation.MyCommand.Path, [System.Text.Encoding]::UTF8)
if ($scannerSource -match 'TrimStart\s*\(\s*\[char\[\]\]') {
    throw 'FAIL: JSON path normalization must not cast a multi-character separator string to System.Char.'
}
if ($scannerSource -notmatch '\[char\]92' -or $scannerSource -notmatch '\[char\]47') {
    throw 'FAIL: JSON path normalization is missing the Windows/Unix separator character checks.'
}
Write-Host 'PASS: JSON path normalization is compatible with Windows PowerShell 5.1.' -ForegroundColor Green

if ($jsonFiles.Count -eq 0) { throw 'FAIL: No source JSON files were selected for encoding validation.' }
foreach ($file in $jsonFiles) {
    $bytes = [System.IO.File]::ReadAllBytes($file.FullName)
    if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
        throw ('FAIL: UTF-8 BOM is not allowed in authored source JSON: ' + $file.FullName.Substring($projectRoot.Length + 1))
    }
}

# Windows PowerShell 5.1 interprets UTF-8 scripts without a BOM using the active ANSI code page.
# Every authored PowerShell script containing non-ASCII text must therefore have a UTF-8 BOM.
$powerShellFiles = @()
foreach ($relativeFolder in @('tools', 'tests\runners')) {
    $folderPath = Join-Path $projectRoot $relativeFolder
    if (Test-Path -LiteralPath $folderPath -PathType Container) {
        $powerShellFiles += @(Get-ChildItem -LiteralPath $folderPath -Filter '*.ps1' -File -Recurse)
    }
}
$strictUtf8 = [System.Text.UTF8Encoding]::new($false, $true)
$nonAsciiPowerShellCount = 0
foreach ($file in $powerShellFiles) {
    $bytes = [System.IO.File]::ReadAllBytes($file.FullName)
    $hasBom = $bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF
    $offset = if ($hasBom) { 3 } else { 0 }
    try {
        $sourceText = $strictUtf8.GetString($bytes, $offset, $bytes.Length - $offset)
    } catch {
        throw ('FAIL: PowerShell source is not valid UTF-8: ' + $file.FullName.Substring($projectRoot.Length + 1))
    }
    if ($sourceText -match '[^\x00-\x7F]') {
        $nonAsciiPowerShellCount++
        if (-not $hasBom) {
            throw ('FAIL: UTF-8 BOM is required for PowerShell source containing non-ASCII text: ' + $file.FullName.Substring($projectRoot.Length + 1))
        }
    }
}
Write-Host ('PASS: ' + $nonAsciiPowerShellCount + ' PowerShell source files containing non-ASCII text have UTF-8 BOM; all ' + $powerShellFiles.Count + ' PowerShell source files are valid UTF-8.') -ForegroundColor Green

$packagePath = Join-Path $projectRoot 'frontend\package.json'
$package = [System.IO.File]::ReadAllText($packagePath, [System.Text.Encoding]::UTF8) | ConvertFrom-Json -ErrorAction Stop
if ($package.version -ne '0.8.25.0') { throw 'FAIL: frontend package version is not 0.8.25.0.' }
Write-Host ('PASS: ' + $jsonFiles.Count + ' authored JSON files are BOM-free; generated bin/obj/publish/WebView2 artifacts are excluded; frontend/package.json parses as strict JSON.') -ForegroundColor Green

# CMD treats a UTF-8 BOM before @echo off as part of the command name.
$batchFiles = @(Get-ChildItem -LiteralPath $projectRoot -Filter '*.bat' -File)
$testsFolder = Join-Path $projectRoot 'tests'
if (Test-Path -LiteralPath $testsFolder -PathType Container) {
    $batchFiles += @(Get-ChildItem -LiteralPath $testsFolder -Filter '*.bat' -File -Recurse)
}
foreach ($file in $batchFiles) {
    $bytes = [System.IO.File]::ReadAllBytes($file.FullName)
    if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
        throw ('FAIL: UTF-8 BOM is not allowed in BAT entrypoint: ' + $file.FullName.Substring($projectRoot.Length + 1))
    }
}
$startBat = [System.IO.File]::ReadAllText((Join-Path $projectRoot 'START_DAR.bat'), [System.Text.Encoding]::ASCII)
if ($startBat -notmatch '(?m)^@echo off\s*$') { throw 'FAIL: START_DAR.bat does not begin with a valid @echo off command.' }
Write-Host ('PASS: ' + $batchFiles.Count + ' BAT files are BOM-free; START_DAR.bat has a valid first command.') -ForegroundColor Green

# Graphics.DrawString must receive RectangleF, not the DrawItem Rectangle, to avoid PowerShell overload binding to Point.
$systemCenter = [System.IO.File]::ReadAllText((Join-Path $projectRoot 'tools\SystemCenter.ps1'), [System.Text.Encoding]::UTF8)
if ($systemCenter -notmatch '\$textBounds\s*=\s*\[System\.Drawing\.RectangleF\]::new\(') { throw 'FAIL: DrawItem does not convert tab bounds to RectangleF.' }
if ($systemCenter -notmatch 'DrawString\(\$tab\.Text,\$script:tabs\.Font,\$textBrush,\$textBounds,\$format\)') { throw 'FAIL: DrawString does not use the RectangleF text bounds.' }
if ($systemCenter -match 'DrawString\(\$tab\.Text,\$script:tabs\.Font,\$textBrush,\$bounds,\$format\)') { throw 'FAIL: DrawString still receives the raw Rectangle bounds.' }
Write-Host 'PASS: Owner-drawn System Center tabs pass RectangleF to Graphics.DrawString.' -ForegroundColor Green

Write-Output 'DAR_TEST_RESULT=PASS'
