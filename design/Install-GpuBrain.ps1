# Downloads the official CUDA 12 build of llama.cpp b11669 (the same version Lin already uses on the CPU) plus its
# CUDA runtime DLLs from github.com/ggml-org/llama.cpp, checks each against the SHA-256 GitHub publishes, and unpacks
# them into voice/models/reasoning/runtime-cuda. Then benchmarks the brains on the GPU next to the running voice.
# Log: voice/runtime/install-gpu-brain.log
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$root = Split-Path -Parent $PSScriptRoot
$reason = Join-Path $root 'voice/models/reasoning'
$dest = Join-Path $reason 'runtime-cuda'
$dl = Join-Path $root 'tools/downloads'
$log = Join-Path $root 'voice/runtime/install-gpu-brain.log'
New-Item -ItemType Directory -Force -Path $dl, $dest | Out-Null
Set-Content -LiteralPath $log -Value "GPU brain setup $(Get-Date -Format s)"
function Log($m) { Add-Content -LiteralPath $log -Value "$(Get-Date -Format HH:mm:ss) $m" }
function Fetch($url, $file, $sha) {
  $path = Join-Path $dl $file
  if ((Test-Path $path) -and ((Get-FileHash -Algorithm SHA256 $path).Hash -eq $sha.ToUpper())) { Log "$file already downloaded and verified"; return $path }
  Log "Downloading $file ..."
  for ($try = 1; $try -le 8; $try++) {
    & curl.exe -L --fail --silent --show-error --retry 5 --retry-all-errors --speed-limit 2000 --speed-time 60 -C - -o $path $url
    if ($LASTEXITCODE -eq 0) { break }
    Log "Download interrupted (curl exit $LASTEXITCODE), resuming (try $try)"
  }
  if ($LASTEXITCODE -ne 0) { throw "Download failed: $url" }
  if ((Get-FileHash -Algorithm SHA256 $path).Hash -ne $sha.ToUpper()) { Remove-Item $path; throw "Checksum mismatch for $file" }
  Log "Verified $file ($([math]::Round((Get-Item $path).Length/1MB)) MB)"
  return $path
}
try {
  $smi = (& nvidia-smi --query-gpu=name,driver_version,memory.total,memory.used,memory.free --format=csv,noheader 2>&1) -join ' '
  Log "GPU: $smi"
  $rel = Invoke-RestMethod -ErrorAction Stop -Headers @{ 'User-Agent' = 'Lin-local-setup'; 'Accept' = 'application/vnd.github+json' } -Uri 'https://api.github.com/repos/ggml-org/llama.cpp/releases/tags/b11669'
  Log ("Assets: " + (($rel.assets | Where-Object { $_.name -match 'win' } | ForEach-Object { $_.name }) -join ', '))
  $bin = $rel.assets | Where-Object { $_.name -match '^llama-b11669-bin-win-cuda-12[\d.]*-x64\.zip$' } | Sort-Object name -Descending | Select-Object -First 1
  $rt = $rel.assets | Where-Object { $_.name -match '^cudart-llama-bin-win-cuda-12[\d.]*-x64\.zip$' } | Sort-Object name -Descending | Select-Object -First 1
  if (-not $bin -or -not $rt) { throw 'The CUDA 12 build was not found in release b11669.' }
  foreach ($a in @($bin, $rt)) {
    if ($a.digest -notmatch '^sha256:([0-9a-f]{64})$') { throw "No published SHA-256 for $($a.name)." }
    $zip = Fetch $a.browser_download_url $a.name $Matches[1]
    & tar.exe -xf $zip -C $dest
    if ($LASTEXITCODE -ne 0) { throw "Unpacking $($a.name) failed." }
  }
  if (-not (Test-Path (Join-Path $dest 'llama-server.exe'))) { throw 'llama-server.exe is missing after unpacking.' }
  Log "GPU runtime ready: $dest"
  @{ build = 'b11669'; files = @($bin.name, $rt.name); sha256 = @($bin.digest, $rt.digest); source = 'https://github.com/ggml-org/llama.cpp/releases/tag/b11669' } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $root 'voice/reasoning-gpu-source.json')
  # Benchmarks run next to the running Lin, so the voice already holds its share of the graphics memory.
  $bench = Join-Path $dest 'llama-bench.exe'
  $runs = @(
    @{ name = '4B CPU only'; model = 'Qwen3-4B-Q4_K_M.gguf'; args = @('-ngl', '0') },
    @{ name = '4B 18 layers on GPU'; model = 'Qwen3-4B-Q4_K_M.gguf'; args = @('-ngl', '18') },
    @{ name = '4B all layers on GPU'; model = 'Qwen3-4B-Q4_K_M.gguf'; args = @('-ngl', '99') },
    @{ name = '35B experts in RAM, rest on GPU'; model = 'Qwen3.6-35B-A3B-UD-Q3_K_XL.gguf'; args = @('-ngl', '99', '-ncmoe', '99') },
    @{ name = '35B CPU only'; model = 'Qwen3.6-35B-A3B-UD-Q3_K_XL.gguf'; args = @('-ngl', '0') }
  )
  foreach ($r in $runs) {
    $m = Join-Path $reason $r.model
    $out = & $bench -m $m -t 6 -p 256 -n 48 -r 1 -o csv @($r.args) 2>&1
    $rows = $out | Where-Object { $_ -match '^"' -and $_ -notmatch 'build_commit' }
    $tps = ($rows | ForEach-Object { ($_ -split '","')[-2] }) -join ' / '
    $free = (& nvidia-smi --query-gpu=memory.used --format=csv,noheader 2>&1) -join ''
    Log "BENCH $($r.name): prompt / write tokens per second = $tps  (GPU used after: $free)"
    if (-not $rows) { Log "  output: $((($out | Select-Object -Last 3) -join ' ').Substring(0, [Math]::Min(400, (($out | Select-Object -Last 3) -join ' ').Length)))" }
  }
  Log 'RESULT: DONE'
} catch { Log "RESULT: FAILED $($_.Exception.Message) at line $($_.InvocationInfo.ScriptLineNumber)" }
