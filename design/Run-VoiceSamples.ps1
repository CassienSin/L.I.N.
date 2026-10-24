# Voice samples: closes Lin (the voice needs the graphics card), makes new designed voices, livelier styles and a rhythm
# comparison, opens a page to listen (letters only; the key is at the bottom), then opens Lin again.
# Nothing changes until you pick: tell Claude the letters (or run: python voice_samples.py use <letters> in voice/).
# Output: voice/runtime/voice-samples/ (index.html, key.json, the clips) and voice/runtime/voice-samples.log
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $root 'voice/runtime'
$log = Join-Path $runtime 'voice-samples.log'
New-Item -ItemType Directory -Path $runtime -Force | Out-Null
$python = Join-Path $root '.venv-voice/Scripts/python.exe'
try {
    $s = Get-Content -Raw -LiteralPath (Join-Path $runtime 'session.json') | ConvertFrom-Json
    $u = [Uri]$s.url
    Invoke-RestMethod -Method Post -Uri "$($u.GetLeftPart([UriPartial]::Authority))/api/shutdown" -Headers @{ 'X-Lin-Token' = ($u.Fragment -replace '^#token=', ''); 'Content-Type' = 'application/json' } -Body '{}' -TimeoutSec 5 | Out-Null
    for ($i = 0; $i -lt 60 -and (Get-Process -Id $s.pid -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Milliseconds 500 }
    Write-Output 'Closed Lin so the voice samples have the graphics card.'
} catch { Write-Output 'Lin was not running.' }
$env:PYTHONIOENCODING = 'utf-8'
$env:PYTHONWARNINGS = 'ignore'   # hides the harmless ffmpeg notice
Push-Location (Join-Path $root 'voice')
$ErrorActionPreference = 'Continue'
& $python voice_samples.py 2>&1 | Tee-Object -FilePath $log
$code = $LASTEXITCODE
Pop-Location
$page = Join-Path $runtime 'voice-samples/index.html'
if ($code -eq 0 -and (Test-Path $page)) { Start-Process $page; Write-Output "RESULT: done. The listening page is open; the numbers are in $log" }
else { Write-Output "RESULT: FAILED (exit $code). See $log" }
Write-Output 'Opening Lin again...'
& (Join-Path $root 'Start-LinVoice.ps1')
