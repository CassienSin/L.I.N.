# Checks for the Tidepool command screen. Runs the unit checks, restarts Lin with demo data for the
# browser checks, then switches Lin back to your own data and confirms it loads.
# Output: voice/runtime/command-checks.log
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $root 'voice/runtime'
$log = Join-Path $runtime 'command-checks.log'
New-Item -ItemType Directory -Path $runtime -Force | Out-Null
Set-Content -LiteralPath $log -Value 'Lin command screen checks'
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
    $python = Join-Path $root '.venv-voice/Scripts/python.exe'
    $node = (Get-Command node -ErrorAction SilentlyContinue).Source
    if (-not $node) { $node = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node.exe' }
    Push-Location (Join-Path $root 'voice')
    Run 'Map, demo, profile and follow-up checks' $python @('verify_command_data.py')
    Run 'Action layer unit checks' $python @('verify_actions.py')
    Run 'Sentence streaming checks' $python @('verify_streaming.py')
    Run 'Connected tools (MCP) checks' $python @('verify_mcp.py')
    Run 'Greeting, honesty and Save to brain checks' $python @('verify_presence.py')
    Run 'Conversation memory: saving, recall, private and forget checks' $python @('verify_conversations.py')
    Run 'Claude through Claude Code (a stand-in; nothing is sent)' $python @('verify_claude.py')
    Run 'Voice: what she reads, tidied audio, no cut-offs' $python @('verify_voice.py')
    Run 'Search by meaning (stand-in model; the real model too once installed)' $python @('verify_meaning.py')
    Run 'Lin Brain reads documents (PDF, Word, PowerPoint, Excel, photos)' $python @('verify_docs.py')
    Run 'Notes regression' $python @('verify_brain.py')
    Run 'Planner regression' $python @('verify_planner.py')
    Run 'Calendar regression' $python @('verify_calendar.py')
    Run 'Build demo data' $python @('make_demo.py')
    Pop-Location

    try {
        $old = Get-Session
        Invoke-RestMethod -Method Post -Uri "$($old.Base)/api/shutdown" -Headers @{ 'X-Lin-Token' = $old.Token; 'Content-Type' = 'application/json' } -Body '{}' -TimeoutSec 5 | Out-Null
        for ($i = 0; $i -lt 60 -and (Get-Process -Id $old.Pid -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Milliseconds 500 }
        Log "Stopped the running Lin (pid $($old.Pid)) so the checks use the latest code."
    } catch { Log 'Lin was not running.' }
    # Demo Lin answers "Claude" questions with voice/claude_stand_in.py, so the checks never use your Claude plan.
    $env:LIN_CLAUDE_STAND_IN_FILE = Join-Path $runtime 'claude-stand-in.txt'
    Set-Content -LiteralPath $env:LIN_CLAUDE_STAND_IN_FILE -Value 'ok'
    Log 'Starting Lin with demo data…'
    & (Join-Path $root 'Start-LinVoice.ps1') -Demo -NoBrowser | ForEach-Object { Log $_ }
    Wait-Ready 'Demo Lin' | Out-Null
    RunNode 'Command screen in the browser (demo data)' (Join-Path $root 'design/verify-command.cjs')
    RunNode 'Approval flow in the browser (demo data)' (Join-Path $root 'design/verify-actions.cjs')
    RunNode 'Connected tools in the browser (demo data)' (Join-Path $root 'design/verify-tools.cjs')
    RunNode 'Fly-to-source on the map (demo data)' (Join-Path $root 'design/verify-fly.cjs')
    RunNode 'Work panel, greeting and Save to brain in the browser (demo data)' (Join-Path $root 'design/verify-presence.cjs')
    RunNode 'Conversation memory in the browser (demo data)' (Join-Path $root 'design/verify-memory.cjs')
    RunNode 'Claude as the online brain in the browser (demo data, stand-in)' (Join-Path $root 'design/verify-claude.cjs')
    RunNode 'Documents in Lin Brain and the Google preset (demo data)' (Join-Path $root 'design/verify-docs.cjs')
    RunNode 'Fast and Smart brain switch (demo data)' (Join-Path $root 'design/verify-brain-switch.cjs')

    Remove-Item Env:LIN_CLAUDE_STAND_IN_FILE -ErrorAction SilentlyContinue
    Log 'Switching Lin back to your own data…'
    & (Join-Path $root 'Start-LinVoice.ps1') -NoBrowser | ForEach-Object { Log $_ }
    $s = Wait-Ready 'Lin with your data'
    $h = @{ 'X-Lin-Token' = $s.Token }
    $status = Invoke-RestMethod -Uri "$($s.Base)/api/status" -Headers $h
    $graph = Invoke-RestMethod -Uri "$($s.Base)/api/graph" -Headers $h
    $profile = Invoke-RestMethod -Uri "$($s.Base)/api/profile" -Headers $h
    $page = Invoke-WebRequest -UseBasicParsing -Uri "$($s.Base)/"
    if ($status.demo -or $graph.demo -or $profile.demo) { throw 'Lin is still using demo data.' }
    if ($page.Content -notmatch 'map-canvas') { throw 'The command screen did not load.' }
    Log "Your own data: $($graph.nodes.Count) map items, $($graph.edges.Count) connections, profile name '$($profile.name)'."
    if ($failed) { Log 'RESULT: FAILED' } else { Log 'RESULT: PASSED' }
} catch {
    Log "RESULT: FAILED - $($_.Exception.Message)"
}
