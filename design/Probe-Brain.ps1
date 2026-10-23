# Why is generation slower inside Lin than in llama-bench? Compares a visible and a hidden run, and reads Lin's status.
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root 'voice/runtime/probe-brain.txt'
$rt = Join-Path $root 'voice/models/reasoning/runtime'
$model = Join-Path $root 'voice/models/reasoning/Qwen3-4B-Q4_K_M.gguf'
$lines = @("Probe $(Get-Date -Format s)")
try {
  $s = Get-Content -Raw -LiteralPath (Join-Path $root 'voice/runtime/session.json') | ConvertFrom-Json; $u = [Uri]$s.url
  $st = Invoke-RestMethod -Uri ($u.GetLeftPart([UriPartial]::Authority) + '/api/status') -Headers @{ 'X-Lin-Token' = ($u.Fragment -replace '^#token=', '') } -TimeoutSec 5
  $lines += "Lin reasoning: " + ($st.reasoning | ConvertTo-Json -Compress -Depth 4)
} catch { $lines += "Lin status unavailable: $_" }
$p = Get-Process llama-server -ErrorAction SilentlyContinue | Select-Object -First 1
if ($p) { $lines += "llama-server pid $($p.Id) priority $($p.PriorityClass) affinity $($p.ProcessorAffinity) cpu-seconds $([math]::Round($p.CPU,1))" }
$scheme = (powercfg /getactivescheme) -join ' '; $lines += "Power: $scheme"
$lines += "Battery: " + ((Get-CimInstance Win32_Battery | Select-Object -First 1 | ForEach-Object { "status $($_.BatteryStatus) charge $($_.EstimatedChargeRemaining)%" }) -join '')
$visible = & (Join-Path $rt 'llama-bench.exe') -m $model -t 6 -p 0 -n 48 -r 1 -o csv 2>$null
$lines += "Visible run: " + ($visible | Select-Object -Last 1)
$tmp = Join-Path $root 'voice/runtime/probe-hidden.csv'
$h = Start-Process -FilePath (Join-Path $rt 'llama-bench.exe') -ArgumentList @('-m', "`"$model`"", '-t', '6', '-p', '0', '-n', '48', '-r', '1', '-o', 'csv') -WindowStyle Hidden -PassThru -RedirectStandardOutput $tmp
$h.WaitForExit()
$lines += "Hidden run: " + (Get-Content -LiteralPath $tmp | Select-Object -Last 1)
Set-Content -LiteralPath $out -Value $lines
