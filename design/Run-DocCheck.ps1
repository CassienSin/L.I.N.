# Quick check of document reading for Lin Brain (no restart of Lin needed): Word, PDF, scanned PDF, PowerPoint,
# Excel, OpenDocument, RTF, web page and a photo, read by tools/docs-venv with Windows text recognition.
# Output: voice/runtime/doc-check.log
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$log = Join-Path $root 'voice/runtime/doc-check.log'
Set-Content -LiteralPath $log -Value "Document check $(Get-Date -Format s)"
Push-Location (Join-Path $root 'voice')
$out = & (Join-Path $root '.venv-voice/Scripts/python.exe') 'verify_docs.py' 2>&1; $code = $LASTEXITCODE
$out | ForEach-Object { Add-Content -LiteralPath $log -Value "   $_" }
$out = & (Join-Path $root '.venv-voice/Scripts/python.exe') 'verify_brain.py' 2>&1; $code2 = $LASTEXITCODE
$out | Select-Object -Last 4 | ForEach-Object { Add-Content -LiteralPath $log -Value "   $_" }
Pop-Location
Add-Content -LiteralPath $log -Value $(if ($code -eq 0 -and $code2 -eq 0) { 'RESULT: PASSED' } else { "RESULT: FAILED (docs $code, notes $code2)" })
