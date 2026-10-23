# Sets up the analysis engine for rea: official Ghidra 12.1.4 (GitHub, NSA) and Eclipse Temurin JDK 21 (Adoptium).
# Both are checked against the SHA-256 their publishers list, unpacked into L.I.N/tools, and given to Lin's "rea"
# server as GHIDRA_INSTALL_DIR / JAVA_HOME. Nothing is installed system-wide. Log: voice/runtime/install-ghidra.log
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$root = Split-Path -Parent $PSScriptRoot
$tools = Join-Path $root 'tools'; $dl = Join-Path $tools 'downloads'
$log = Join-Path $root 'voice/runtime/install-ghidra.log'
New-Item -ItemType Directory -Force -Path $dl | Out-Null
Set-Content -LiteralPath $log -Value "Install Ghidra + JDK 21 $(Get-Date -Format s)"
function Log($m) { Add-Content -LiteralPath $log -Value "$(Get-Date -Format HH:mm:ss) $m" }
function Fetch($url, $file, $sha) {
  $path = Join-Path $dl $file
  if ((Test-Path $path) -and ((Get-FileHash -Algorithm SHA256 $path).Hash -eq $sha.ToUpper())) { Log "$file already downloaded and verified"; return $path }
  Log "Downloading $file ..."
  # Resumes after a stall or dropped connection (GitHub downloads here are slow and can stall).
  for ($try = 1; $try -le 8; $try++) {
    & curl.exe -L --fail --silent --show-error --retry 5 --retry-all-errors --speed-limit 2000 --speed-time 60 -C - -o $path $url
    if ($LASTEXITCODE -eq 0) { break }
    Log "Download interrupted (curl exit $LASTEXITCODE), resuming at $([math]::Round((Get-Item $path).Length/1MB)) MB (try $try)"
  }
  if ($LASTEXITCODE -ne 0) { throw "Download failed: $url" }
  $got = (Get-FileHash -Algorithm SHA256 $path).Hash
  if ($got -ne $sha.ToUpper()) { Remove-Item $path; throw "Checksum mismatch for $file" }
  Log "Verified $file ($([math]::Round((Get-Item $path).Length/1MB)) MB, sha256 $sha)"
  return $path
}
try {
  $hdr = @{ 'User-Agent' = 'Lin-local-setup'; 'Accept' = 'application/vnd.github+json' }
  # --- Ghidra 12.1.4 --------------------------------------------------------
  $rel = Invoke-RestMethod -ErrorAction Stop -Headers $hdr -Uri 'https://api.github.com/repos/NationalSecurityAgency/ghidra/releases/tags/Ghidra_12.1.4_build'
  $asset = $rel.assets | Where-Object { $_.name -like 'ghidra_12.1.4_PUBLIC_*.zip' } | Select-Object -First 1
  if (-not $asset) { throw 'Ghidra 12.1.4 zip not found in the official release.' }
  $sha = if ($asset.digest -match '^sha256:([0-9a-f]{64})$') { $Matches[1] } else { ([regex]'([0-9a-fA-F]{64})').Match(($rel.body -split "`n" | Where-Object { $_ -match $asset.name }) -join ' ').Value }
  if (-not $sha) { throw 'No published SHA-256 found for the Ghidra zip.' }
  $zip = Fetch $asset.browser_download_url $asset.name $sha
  $ghidra = Join-Path $tools 'ghidra_12.1.4_PUBLIC'
  if (-not (Test-Path (Join-Path $ghidra 'support/analyzeHeadless.bat'))) { Log 'Unpacking Ghidra ...'; & tar.exe -xf $zip -C $tools; if ($LASTEXITCODE -ne 0) { throw 'Unpacking Ghidra failed.' } }
  if (-not (Test-Path (Join-Path $ghidra 'support/analyzeHeadless.bat'))) { throw "Ghidra did not unpack to $ghidra" }
  Log "Ghidra ready: $ghidra"
  # --- JDK 21 ---------------------------------------------------------------
  $jdkInfo = (Invoke-RestMethod -ErrorAction Stop -Uri 'https://api.adoptium.net/v3/assets/latest/21/hotspot?architecture=x64&image_type=jdk&os=windows&vendor=eclipse') | Where-Object { $_.binary.package.name -like '*.zip' } | Select-Object -First 1
  if (-not $jdkInfo) { throw 'Temurin JDK 21 zip not found.' }
  $jzip = Fetch $jdkInfo.binary.package.link $jdkInfo.binary.package.name $jdkInfo.binary.package.checksum
  $jdkName = $jdkInfo.release_name   # e.g. jdk-21.0.9+10
  $jdk = Join-Path $tools $jdkName
  if (-not (Test-Path (Join-Path $jdk 'bin/javac.exe'))) { Log 'Unpacking JDK ...'; & tar.exe -xf $jzip -C $tools; if ($LASTEXITCODE -ne 0) { throw 'Unpacking the JDK failed.' } }
  if (-not (Test-Path (Join-Path $jdk 'bin/javac.exe'))) { throw "JDK did not unpack to $jdk" }
  Log "JDK ready: $jdk ($((& (Join-Path $jdk 'bin/java.exe') -version 2>&1 | Select-Object -First 1)))"
  # --- rea doctor and a read-only test inspection ------------------------------
  $entry = Join-Path $root 'tools/rea/node_modules/rea-agents/scripts/rea.mjs'
  $node = (Get-Command node -ErrorAction SilentlyContinue).Source
  $env:GHIDRA_INSTALL_DIR = $ghidra; $env:JAVA_HOME = $jdk; $env:REA_ANALYSIS_PROVIDER = 'ghidra'
  $doc = (& $node $entry doctor --json 2>&1) -join ' '
  Log ("doctor ghidra: " + (([regex]'\{"name":"ghidra"[^}]*\}').Match($doc).Value))
  $target = Join-Path $env:WINDIR 'System32\whoami.exe'
  Log "Test inspection (read-only) of $target ..."
  $insp = (& $node $entry inspect $target --provider ghidra --format json 2>&1) -join ' '
  Log ("inspect: " + $insp.Substring(0, [Math]::Min(1500, $insp.Length)))
  # --- Give the engine to Lin's rea server ------------------------------------------------
  $s = Get-Content -ErrorAction Stop -Raw -LiteralPath (Join-Path $root 'voice/runtime/session.json') | ConvertFrom-Json; $u = [Uri]$s.url
  $base = $u.GetLeftPart([UriPartial]::Authority); $h = @{ 'X-Lin-Token' = ($u.Fragment -replace '^#token=', ''); 'Content-Type' = 'application/json' }
  $cfg = Invoke-RestMethod -ErrorAction Stop -Uri "$base/api/mcp" -Headers $h
  $rea = $cfg.servers | Where-Object { $_.name -eq 'rea' }
  if (-not $rea) { throw 'rea is not in Lin Tools. Run Install-Rea.cmd first.' }
  $spec = @{ command = $rea.command; args = @($rea.args); cwd = $rea.cwd; enabled = $true
             env = @{ REA_MCP_INPUT_SCHEMA_PROFILE = 'full'; REA_ANALYSIS_PROVIDER = 'ghidra'; GHIDRA_INSTALL_DIR = $ghidra; JAVA_HOME = $jdk } }
  Invoke-RestMethod -ErrorAction Stop -Method Post -Uri "$base/api/mcp/save" -Headers $h -Body (@{ revision = $cfg.revision; name = 'rea'; spec = $spec } | ConvertTo-Json -Depth 5) | Out-Null
  Start-Sleep -Seconds 25
  $st = (Invoke-RestMethod -ErrorAction Stop -Uri "$base/api/mcp" -Headers $h).servers | Where-Object { $_.name -eq 'rea' }
  Log "rea in Lin: state $($st.state) error $($st.error) tools $($st.tools.Count) env $($st.env_keys -join ',')"
  Log 'RESULT: DONE'
} catch { Log "RESULT: FAILED $($_.Exception.Message) at line $($_.InvocationInfo.ScriptLineNumber)" }
