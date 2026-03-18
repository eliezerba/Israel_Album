param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('v1', 'v2')]
    [string]$To
)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$indexPath = Join-Path $root 'index.html'
$v1Path = Join-Path $root 'index_v1.html'
$v2Path = Join-Path $root 'index_v2.html'

if (-not (Test-Path $indexPath)) {
    throw "index.html was not found in $root"
}

if (-not (Test-Path $v1Path)) {
    throw "index_v1.html was not found. Cannot restore V1."
}

if (-not (Test-Path $v2Path)) {
    Write-Host 'index_v2.html was missing. Creating it from current index.html...' -ForegroundColor Yellow
    Copy-Item -LiteralPath $indexPath -Destination $v2Path -Force
}

if ($To -eq 'v1') {
    # Preserve current V2 before restoring V1.
    Copy-Item -LiteralPath $indexPath -Destination $v2Path -Force
    Copy-Item -LiteralPath $v1Path -Destination $indexPath -Force
    Write-Host 'Switched to V1 (index_v1.html -> index.html).' -ForegroundColor Green
    exit 0
}

Copy-Item -LiteralPath $v2Path -Destination $indexPath -Force
Write-Host 'Switched to V2 (index_v2.html -> index.html).' -ForegroundColor Green
exit 0
