# Installs the document readers for Lin Brain and the Google Workspace connector, each in its own Python
# environment inside L.I.N/tools so Lin's voice environment is never changed:
#   tools/docs-venv : MarkItDown (Microsoft, MIT) with PDF/Word/PowerPoint/Excel/Outlook support + pypdfium2
#   tools/gws-venv  : workspace-mcp (Google Workspace MCP server, MIT)
# Packages come from PyPI over HTTPS. Log: voice/runtime/install-docreaders.log
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$log = Join-Path $root 'voice/runtime/install-docreaders.log'
Set-Content -LiteralPath $log -Value "Document readers setup $(Get-Date -Format s)"
function Log($m) { Add-Content -LiteralPath $log -Value "$(Get-Date -Format HH:mm:ss) $m" }
function Run($label, $exe, $argv) {
  Log "== $label"
  $out = & $exe @argv 2>&1; $code = $LASTEXITCODE
  $out | Select-Object -Last 25 | ForEach-Object { Log "   $_" }
  if ($code -ne 0) { throw "$label failed (exit $code)" }
}
try {
  $base = (Get-Content -LiteralPath (Join-Path $root '.venv-voice/pyvenv.cfg') | Where-Object { $_ -match '^executable\s*=' }) -replace '^executable\s*=\s*', ''
  Log "Base Python: $base"
  $docs = Join-Path $root 'tools/docs-venv'
  if (-not (Test-Path (Join-Path $docs 'Scripts/python.exe'))) { Run 'Create docs-venv' $base @('-m', 'venv', $docs) }
  $py = Join-Path $docs 'Scripts/python.exe'
  Run 'Upgrade pip (docs)' $py @('-m', 'pip', 'install', '--disable-pip-version-check', '-q', '--upgrade', 'pip')
  Run 'Install MarkItDown + pypdfium2' $py @('-m', 'pip', 'install', '--disable-pip-version-check', '-q', 'markitdown[pdf,docx,pptx,xlsx,xls,outlook]', 'pypdfium2')
  Run 'Versions (docs)' $py @('-c', "import importlib.metadata as m; print({p: m.version(p) for p in ['markitdown','pdfminer.six','mammoth','python-pptx','openpyxl','pypdfium2']})")
  $gws = Join-Path $root 'tools/gws-venv'
  if (-not (Test-Path (Join-Path $gws 'Scripts/python.exe'))) { Run 'Create gws-venv' $base @('-m', 'venv', $gws) }
  $gpy = Join-Path $gws 'Scripts/python.exe'
  Run 'Upgrade pip (gws)' $gpy @('-m', 'pip', 'install', '--disable-pip-version-check', '-q', '--upgrade', 'pip')
  Run 'Install workspace-mcp' $gpy @('-m', 'pip', 'install', '--disable-pip-version-check', '-q', 'workspace-mcp')
  Run 'Version (gws)' $gpy @('-c', "import importlib.metadata as m; print('workspace-mcp', m.version('workspace-mcp'))")
  $exe = Join-Path $gws 'Scripts/workspace-mcp.exe'
  if (Test-Path $exe) { $help = (& $exe --help 2>&1) -join "`n"; Add-Content -LiteralPath (Join-Path $root 'voice/runtime/workspace-mcp-help.txt') -Value $help; Log "workspace-mcp help saved ($($help.Length) chars)" } else { Log 'workspace-mcp.exe not found' }
  # Windows OCR availability (used for photos and scanned PDFs).
  $ocr = & powershell -NoProfile -Command "Add-Type -AssemblyName System.Runtime.WindowsRuntime; `$null=[Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime]; `$e=[Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages(); if(`$e){'OCR ready: ' + `$e.RecognizerLanguage.DisplayName}else{'OCR unavailable'}" 2>&1
  Log "Windows OCR: $ocr"
  Log 'RESULT: DONE'
} catch { Log "RESULT: FAILED $($_.Exception.Message)" }
