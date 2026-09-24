# Builds the Copilot Office deck to PPTX, PDF, and HTML using marp-cli.
# Usage: pwsh presentation/build.ps1
#
# Note: HTML export needs no browser. PPTX/PDF export drives a headless
# Chromium via marp-cli. The bundled puppeteer can fail to launch on some
# Node versions / when it hands off to a running Edge, so we auto-detect a
# clean Chromium (Playwright's) and pass it explicitly when available.
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$src = Join-Path $here 'CopilotOffice.md'

function Find-Browser {
    # Prefer a clean Playwright Chromium (most reliable with marp-cli).
    $pw = Get-ChildItem -Path "$env:USERPROFILE\AppData\Local\ms-playwright" `
        -Filter 'chrome.exe' -Recurse -ErrorAction SilentlyContinue |
        Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
    if ($pw) { return $pw }
    # Fall back to installed Edge / Chrome.
    foreach ($p in @(
        "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        "C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        "C:\Program Files\Google\Chrome\Application\chrome.exe",
        "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
    )) { if (Test-Path $p) { return $p } }
    return $null
}

$browser = Find-Browser
$browserArgs = @()
if ($browser) {
    Write-Host "Using browser: $browser" -ForegroundColor DarkGray
    $browserArgs = @('--browser-path', $browser)
} else {
    Write-Host "No browser found; letting marp-cli auto-detect (PPTX/PDF may fail)." -ForegroundColor Yellow
}

foreach ($ext in @('pptx', 'pdf', 'html')) {
    $out = Join-Path $here "CopilotOffice.$ext"
    Write-Host "Building $ext ..." -ForegroundColor Cyan
    if ($ext -eq 'html') {
        npx --yes @marp-team/marp-cli --html $src -o $out
    } else {
        npx --yes @marp-team/marp-cli --html @browserArgs $src -o $out
    }
    if ($LASTEXITCODE -ne 0) { throw "marp-cli failed for $ext (exit $LASTEXITCODE)" }
    Write-Host "  -> $out" -ForegroundColor Green
}
Write-Host "Done." -ForegroundColor Green
