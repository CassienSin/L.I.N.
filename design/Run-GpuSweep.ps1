# Tries the 4B brain with 0, 14, 22, 30 and all layers on the graphics card, next to the voice, using the
# real conversation probe each time. Results: voice/runtime/gpu-sweep.log. Restores brain.json afterwards.
$root = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $root 'voice/runtime'
$log = Join-Path $runtime 'gpu-sweep.log'
$brainJson = Join-Path $root 'voice/brain.json'
$original = Get-Content -Raw -LiteralPath $brainJson
Set-Content -LiteralPath $log -Value "GPU sweep $(Get-Date -Format s)"
function Log($m) { Add-Content -LiteralPath $log -Value "$(Get-Date -Format HH:mm:ss) $m" }
function Session { $s = Get-Content -Raw -LiteralPath (Join-Path $runtime 'session.json') | ConvertFrom-Json; $u = [Uri]$s.url; [pscustomobject]@{ Pid = $s.pid; Base = $u.GetLeftPart([UriPartial]::Authority); H = @{ 'X-Lin-Token' = ($u.Fragment -replace '^#token=', ''); 'Content-Type' = 'application/json' } } }
function Restart-Lin {
  try { $s = Session; Invoke-RestMethod -Method Post -Uri "$($s.Base)/api/shutdown" -Headers $s.H -Body '{}' -TimeoutSec 5 | Out-Null
        for ($i = 0; $i -lt 60 -and (Get-Process -Id $s.Pid -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Milliseconds 500 } } catch { }
  & (Join-Path $root 'Start-LinVoice.ps1') -NoBrowser | Out-Null
  for ($i = 0; $i -lt 240; $i++) { try { $s = Session; $st = Invoke-RestMethod -Uri "$($s.Base)/api/status" -Headers $s.H -TimeoutSec 3
      if ($st.ready -and -not $st.busy -and $st.reasoning.ready -and $st.transcription.ready) { return $st } } catch { }; Start-Sleep -Seconds 2 }
  throw 'Lin did not become ready.'
}
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
try {
  $configs = @(@{ m = 'Qwen3-4B-Q4_K_M.gguf'; n = 0; moe = $false }, @{ m = 'Qwen3-4B-Q4_K_M.gguf'; n = 14; moe = $false }, @{ m = 'Qwen3-4B-Q4_K_M.gguf'; n = 22; moe = $false },
               @{ m = 'Qwen3-4B-Q4_K_M.gguf'; n = 30; moe = $false }, @{ m = 'Qwen3-4B-Q4_K_M.gguf'; n = 99; moe = $false }, @{ m = 'Qwen3.6-35B-A3B-UD-Q3_K_XL.gguf'; n = 99; moe = $true })
  foreach ($c in $configs) {
    $n = "$($c.m.Substring(0,8))-$($c.n)"
    Set-Content -LiteralPath $brainJson -Value (@{ model = $c.m; gpu_layers = $c.n; cpu_moe = $c.moe; note = 'GPU sweep in progress' } | ConvertTo-Json)
    $st = Restart-Lin
    $mem = (& nvidia-smi --query-gpu=memory.used --format=csv,noheader 2>&1) -join ''
    Log "== gpu_layers $n -> running with $($st.reasoning.gpu_layers) on GPU ($($st.reasoning.gpu_note)); GPU memory used at idle: $mem"
    $p = Start-Process -FilePath $node -ArgumentList @("`"$(Join-Path $root 'design/probe-latency.cjs')`"", '--same-conversation') -NoNewWindow -PassThru -RedirectStandardOutput (Join-Path $runtime 'gpu-sweep-probe.out.txt') -RedirectStandardError (Join-Path $runtime 'gpu-sweep-probe.err.txt')
    $null = $p.Handle; if (-not $p.WaitForExit(12 * 60 * 1000)) { & taskkill /PID $p.Id /T /F | Out-Null; Log 'probe timed out'; continue }
    $r = Get-Content -Raw -LiteralPath (Join-Path $root 'voice/brain-benchmark/latency-conversation-results.json') | ConvertFrom-Json
    Copy-Item (Join-Path $root 'voice/brain-benchmark/latency-conversation-results.json') (Join-Path $runtime "gpu-sweep-$n.json") -Force
    foreach ($row in $r.rows) {
      $gens = ($row.segments | ForEach-Object { [math]::Round($_.gen_s, 1) }) -join ','
      $t = $row.timings.answer
      $rate = if ($t -and $t.generation_ms) { [math]::Round($t.generated_tokens / ($t.generation_ms / 1000), 1) } else { '-' }
      Log ("  {0,-40} first text {1,6}s  first audio {2,6}s  total {3,6}s  voice per sentence [{4}]  writing {5} tok/s" -f $row.text.Substring(0, [Math]::Min(40, $row.text.Length)), $row.first_text_s, $row.first_audio_ready_s, $row.total_s, $gens, $rate)
    }
    Log "  GPU memory used after: $((& nvidia-smi --query-gpu=memory.used --format=csv,noheader 2>&1) -join '')"
  }
  Log 'RESULT: DONE'
} catch { Log "RESULT: FAILED $($_.Exception.Message)" }
finally {
  Set-Content -LiteralPath $brainJson -Value $original
  try { Restart-Lin | Out-Null; Log 'Lin restarted with the original brain settings.' } catch { Log "Restart failed: $_" }
}
