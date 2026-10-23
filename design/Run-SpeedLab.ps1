# Closes Lin, runs the speed lab (voice/speed_lab.py), then reopens Lin with your data in the background.
$root = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $root 'voice/runtime'
$session = Join-Path $runtime 'session.json'
if (Test-Path -LiteralPath $session) {
    try {
        $s = Get-Content -Raw -LiteralPath $session | ConvertFrom-Json; $u = [Uri]$s.url
        Invoke-RestMethod -Method Post -Uri ($u.GetLeftPart([UriPartial]::Authority) + '/api/shutdown') -Headers @{ 'X-Lin-Token' = ($u.Fragment -replace '^#token=', ''); 'Content-Type' = 'application/json' } -Body '{}' -TimeoutSec 5 | Out-Null
        for ($i = 0; $i -lt 60 -and (Get-Process -Id $s.pid -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Milliseconds 500 }
    } catch { }
}
Push-Location (Join-Path $root 'voice')
& (Join-Path $root '.venv-voice/Scripts/python.exe') speed_lab.py *> (Join-Path $runtime 'speed-lab.out.txt')
Pop-Location
& (Join-Path $root 'Start-LinVoice.ps1') -NoBrowser | Out-Null
