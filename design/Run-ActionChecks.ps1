# Runs the action-layer checks and earlier regressions, restarts Lin with the new code,
# then runs the browser approval flow and a local-model routing probe.
# Output: voice/runtime/action-checks.log
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $root 'voice/runtime'
$log = Join-Path $runtime 'action-checks.log'
New-Item -ItemType Directory -Path $runtime -Force | Out-Null
Set-Content -LiteralPath $log -Value 'Lin action checks'
function Log($m) { $line = "$(Get-Date -Format 'HH:mm:ss') $m"; Write-Output $line; Add-Content -LiteralPath $log -Value $line }
function Run($label, $exe, $argv) {
    Log "== $label"
    $ErrorActionPreference = 'Continue'
    $out = & $exe @argv 2>&1
    $code = $LASTEXITCODE
    $out | ForEach-Object { Add-Content -LiteralPath $log -Value "   $_" }
    if ($code -ne 0) { Log "FAILED: $label (exit $code)"; $script:failed = $true } else { Log "passed: $label" }
}
function Get-Session {
    $s = Get-Content -Raw -LiteralPath (Join-Path $runtime 'session.json') | ConvertFrom-Json
    $u = [Uri]$s.url
    [pscustomobject]@{ Pid = $s.pid; Base = $u.GetLeftPart([UriPartial]::Authority); Token = ($u.Fragment -replace '^#token=', '') }
}
$failed = $false
try {
    $python = Join-Path $root '.venv-voice/Scripts/python.exe'
    $node = (Get-Command node -ErrorAction SilentlyContinue).Source
    if (-not $node) { $node = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node.exe' }
    Push-Location (Join-Path $root 'voice')
    Run 'Action layer unit checks' $python @('verify_actions.py')
    Run 'Sentence streaming checks' $python @('verify_streaming.py')
    Run 'Planner regression' $python @('verify_planner.py')
    Run 'Calendar regression' $python @('verify_calendar.py')
    Pop-Location

    try {
        $old = Get-Session
        Invoke-RestMethod -Method Post -Uri "$($old.Base)/api/shutdown" -Headers @{ 'X-Lin-Token' = $old.Token; 'Content-Type' = 'application/json' } -Body '{}' -TimeoutSec 5 | Out-Null
        Log "Stopped Lin (pid $($old.Pid))."
        for ($i = 0; $i -lt 60 -and (Get-Process -Id $old.Pid -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Milliseconds 500 }
    } catch { Log 'Lin was not running.' }
    & (Join-Path $root 'Start-LinVoice.ps1') -NoBrowser | ForEach-Object { Log $_ }
    $new = Get-Session
    $ready = $false
    for ($i = 0; $i -lt 240; $i++) {
        try {
            $st = Invoke-RestMethod -Uri "$($new.Base)/api/status" -Headers @{ 'X-Lin-Token' = $new.Token } -TimeoutSec 3
            if ($st.ready -and -not $st.busy -and $st.reasoning.ready) { $ready = $true; break }
        } catch { }
        Start-Sleep -Seconds 2
    }
    if (-not $ready) { throw 'Lin did not become ready within 8 minutes.' }
    Log "Lin restarted with the action layer (pid $($new.Pid))."
    Run 'Browser approval flow' $node @((Join-Path $root 'design/verify-actions.cjs'))
    Run 'Local model routing probe' $node @((Join-Path $root 'design/probe-routing.cjs'))
    if ($failed) { Log 'RESULT: FAILED' } else { Log 'RESULT: PASSED' }
} catch {
    Log "RESULT: FAILED - $($_.Exception.Message)"
}
