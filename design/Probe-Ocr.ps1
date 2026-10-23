# Diagnose Windows text recognition for Lin Brain. Output: voice/runtime/ocr-probe.log
$root = Split-Path -Parent $PSScriptRoot
$log = Join-Path $root 'voice/runtime/ocr-probe.log'
$list = Join-Path $root 'voice/runtime/ocr-probe-list.txt'
$out = Join-Path $root 'voice/runtime/ocr-probe-out.json'
Set-Content -LiteralPath $list -Value (Join-Path $root 'design\doc-samples\whiteboard.png') -Encoding UTF8
Remove-Item -LiteralPath $out -ErrorAction SilentlyContinue
$r = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'voice/ocr.ps1') $list $out 2>&1
Set-Content -LiteralPath $log -Value ("exit $LASTEXITCODE`n" + ($r | Out-String))
if (Test-Path $out) { Add-Content -LiteralPath $log -Value (Get-Content -Raw $out) } else { Add-Content -LiteralPath $log -Value 'no output file' }
Add-Content -LiteralPath $log -Value "PS $($PSVersionTable.PSVersion)"
