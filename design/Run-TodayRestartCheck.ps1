# Restarts Lin, then runs the second (resume) phase of the Today verification.
# Output is written to voice/runtime/today-restart-check.log.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $root 'voice/runtime'
$log = Join-Path $runtime 'today-restart-check.log'
function Log($m) { $line = "$(Get-Date -Format 'HH:mm:ss') $m"; Write-Output $line; Add-Content -LiteralPath $log -Value $line }
Set-Content -LiteralPath $log -Value "Today restart check"
function Get-Session {
    $s = Get-Content -Raw -LiteralPath (Join-Path $runtime 'session.json') | ConvertFrom-Json
    $u = [Uri]$s.url
    [pscustomobject]@{ Pid = $s.pid; Base = $u.GetLeftPart([UriPartial]::Authority); Token = ($u.Fragment -replace '^#token=', '') }
}
try {
    $old = Get-Session
    try {
        Invoke-RestMethod -Method Post -Uri "$($old.Base)/api/shutdown" -Headers @{ 'X-Lin-Token' = $old.Token; 'Content-Type' = 'application/json' } -Body '{}' -TimeoutSec 5 | Out-Null
        Log "Asked running Lin (pid $($old.Pid)) to shut down."
    } catch { Log "No running Lin answered; starting fresh." }
    for ($i = 0; $i -lt 60 -and (Get-Process -Id $old.Pid -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Milliseconds 500 }
    if (Get-Process -Id $old.Pid -ErrorAction SilentlyContinue) { throw "Old Lin process $($old.Pid) is still running." }

    & (Join-Path $root 'Start-LinVoice.ps1') -NoBrowser | ForEach-Object { Log $_ }
    $new = Get-Session
    Log "Lin restarted as pid $($new.Pid). Waiting for models to load..."
    $ready = $false
    for ($i = 0; $i -lt 240; $i++) {
        try {
            $st = Invoke-RestMethod -Uri "$($new.Base)/api/status" -Headers @{ 'X-Lin-Token' = $new.Token } -TimeoutSec 3
            if ($st.ready -and -not $st.busy) { $ready = $true; break }
        } catch { }
        Start-Sleep -Seconds 2
    }
    if (-not $ready) { throw 'Lin did not become ready within 8 minutes.' }
    Log 'Lin is ready. Running verify-today resume phase...'

    $node = (Get-Command node -ErrorAction SilentlyContinue).Source
    if (-not $node) { $node = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node.exe' }
    if (-not (Test-Path -LiteralPath $node)) { throw "Node.js not found (looked for $node)." }
    $out = & $node (Join-Path $root 'design/verify-today.cjs') resume 2>&1
    $out | ForEach-Object { Log $_ }
    if ($LASTEXITCODE -ne 0) { throw "verify-today resume failed with exit code $LASTEXITCODE." }
    Log 'RESULT: PASSED'
} catch {
    Log "RESULT: FAILED - $($_.Exception.Message)"
}
