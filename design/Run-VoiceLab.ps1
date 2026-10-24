# Voice lab: closes Lin (the voice needs the graphics card to itself), makes 20 tricky lines at 12, 16 and 24 steps,
# shows the numbers, opens a page to listen to every clip, then opens Lin again.
# Output: voice/runtime/voice-lab/ (index.html, results.json, the clips) and voice/runtime/voice-lab.log
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $root 'voice/runtime'
$log = Join-Path $runtime 'voice-lab.log'
New-Item -ItemType Directory -Path $runtime -Force | Out-Null
$python = Join-Path $root '.venv-voice/Scripts/python.exe'
try {
    $s = Get-Content -Raw -LiteralPath (Join-Path $runtime 'session.json') | ConvertFrom-Json
    $u = [Uri]$s.url
    Invoke-RestMethod -Method Post -Uri "$($u.GetLeftPart([UriPartial]::Authority))/api/shutdown" -Headers @{ 'X-Lin-Token' = ($u.Fragment -replace '^#token=', ''); 'Content-Type' = 'application/json' } -Body '{}' -TimeoutSec 5 | Out-Null
    for ($i = 0; $i -lt 60 -and (Get-Process -Id $s.pid -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Milliseconds 500 }
    Write-Output 'Closed Lin so the voice lab has the graphics card.'
} catch { Write-Output 'Lin was not running.' }
$env:PYTHONIOENCODING = 'utf-8'
$env:PYTHONWARNINGS = 'ignore'   # hides the harmless ffmpeg notice
Push-Location (Join-Path $root 'voice')
$ErrorActionPreference = 'Continue'
& $python voice_lab.py 12 16 24 2>&1 | Tee-Object -FilePath $log
$code = $LASTEXITCODE
Pop-Location
$page = Join-Path $runtime 'voice-lab/index.html'
if ($code -eq 0 -and (Test-Path $page)) { Start-Process $page; Write-Output "RESULT: done. The listening page is open; the numbers are in $log" }
else { Write-Output "RESULT: FAILED (exit $code). See $log" }
Write-Output 'Opening Lin again...'
& (Join-Path $root 'Start-LinVoice.ps1')
