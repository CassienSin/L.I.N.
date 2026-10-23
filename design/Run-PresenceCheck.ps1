# Checks for the Tidepool command screen. Runs the unit checks, restarts Lin with demo data for the
# browser checks, then switches Lin back to your own data and confirms it loads.
# Output: voice/runtime/command-checks.log
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $root 'voice/runtime'
$log = Join-Path $runtime 'presence-check.log'
New-Item -ItemType Directory -Path $runtime -Force | Out-Null
Set-Content -LiteralPath $log -Value 'Lin presence check'
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
function Wait-Ready($label) {
    $s = Get-Session
    for ($i = 0; $i -lt 240; $i++) {
        try {
            $st = Invoke-RestMethod -Uri "$($s.Base)/api/status" -Headers @{ 'X-Lin-Token' = $s.Token } -TimeoutSec 3
            if ($st.ready -and -not $st.busy -and $st.reasoning.ready -and $st.transcription.ready) { Log "$label ready (pid $($s.Pid), demo: $($st.demo))."; return $s }
        } catch { }
        Start-Sleep -Seconds 2
    }
    throw "$label did not become ready within 8 minutes."
}
function RunNode($label, $scriptPath) {
    # Output goes to files (not a pipe), and a stuck run is stopped after 16 minutes.
    Log "== $label"
    $stem = [IO.Path]::GetFileNameWithoutExtension($scriptPath)
    $outFile = Join-Path $runtime "$stem.out.txt"; $errFile = Join-Path $runtime "$stem.progress.txt"
    $p = Start-Process -FilePath $node -ArgumentList @("`"$scriptPath`"") -NoNewWindow -PassThru -RedirectStandardOutput $outFile -RedirectStandardError $errFile
    $null = $p.Handle
    if (-not $p.WaitForExit(16 * 60 * 1000)) { & taskkill /PID $p.Id /T /F | Out-Null; $code = 'timeout' } else { $p.WaitForExit(); $code = $p.ExitCode }
    Get-Content -LiteralPath $errFile, $outFile -ErrorAction SilentlyContinue | ForEach-Object { Add-Content -LiteralPath $log -Value "   $_" }
    if ($code -ne 0) { Log "FAILED: $label (exit $code)"; $script:failed = $true } else { Log "passed: $label" }
}
$failed = $false
try {
    $node = (Get-Command node -ErrorAction SilentlyContinue).Source
    if (-not $node) { $node = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node.exe' }
    Log 'Starting Lin with demo data...'
    & (Join-Path $root 'Start-LinVoice.ps1') -Demo -NoBrowser | ForEach-Object { Log $_ }
    Wait-Ready 'Demo Lin' | Out-Null
    RunNode 'Fly-to-source and neighbourhoods (demo data)' (Join-Path $root 'design/verify-fly.cjs')
    RunNode 'Work panel, greeting and Save to brain in the browser (demo data)' (Join-Path $root 'design/verify-presence.cjs')
    RunNode 'Fast and Smart brain switch (demo data)' (Join-Path $root 'design/verify-brain-switch.cjs')
    Log 'Switching Lin back to your own data...'
    & (Join-Path $root 'Start-LinVoice.ps1') -NoBrowser | ForEach-Object { Log $_ }
    Wait-Ready 'Lin with your data' | Out-Null
    if ($failed) { Log 'RESULT: FAILED' } else { Log 'RESULT: PASSED' }
} catch { Log "RESULT: FAILED - $($_.Exception.Message)" }
