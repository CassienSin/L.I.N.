# Installs rea (reverse-engineering MCP server, npm package rea-agents) into L.I.N/tools/rea - not globally -
# then registers it in Lin's Tools as "rea" (every tool starts as Ask first). Log: voice/runtime/install-rea.log
$ErrorActionPreference = 'Continue'  # npm writes notices to stderr; failures are checked by exit code
$root = Split-Path -Parent $PSScriptRoot
$log = Join-Path $root 'voice/runtime/install-rea.log'
Set-Content -LiteralPath $log -Value "Install rea $(Get-Date -Format s)"
function Log($m) { Add-Content -LiteralPath $log -Value "$(Get-Date -Format HH:mm:ss) $m" }
try {
  $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
  $node = if ($nodeCmd) { $nodeCmd.Source } else { Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node.exe' }
  $ver = (& $node -v).Trim(); Log "node $node $ver"
  $npm = Join-Path (Split-Path $node) 'npm.cmd'
  if (-not (Test-Path $npm)) { $c = Get-Command npm -ErrorAction SilentlyContinue; if ($c) { $npm = $c.Source } else { throw "npm was not found next to $node or on PATH." } }
  Log "npm $npm $((& $npm -v) -join '')"
  $v = [version]($ver.TrimStart('v')); if (-not (($v.Major -eq 22 -and $v.Minor -ge 19) -or ($v.Major -eq 24 -and $v.Minor -ge 11) -or $v.Major -ge 26)) { throw "rea needs Node 22.19+, 24.11+ or 26+; this PC has $ver." }
  Log "java: $((Get-Command java -ErrorAction SilentlyContinue).Source) JAVA_HOME=$env:JAVA_HOME GHIDRA_INSTALL_DIR=$env:GHIDRA_INSTALL_DIR"
  $dest = Join-Path $root 'tools/rea'; New-Item -ItemType Directory -Force -Path $dest | Out-Null
  $latest = ((& $npm view rea-agents version 2>$null) | Where-Object { $_ -match '^\d+\.\d+' } | Select-Object -Last 1); if (-not $latest) { throw 'npm could not look up rea-agents.' }; $latest = $latest.Trim(); Log "rea-agents latest: $latest"
  $out = & $npm install --prefix $dest --no-fund --no-audit "rea-agents@$latest" 2>&1; $out | ForEach-Object { Log "  $_" }
  if ($LASTEXITCODE -ne 0) { throw "npm install failed (exit $LASTEXITCODE)." }
  $rea = Join-Path $dest 'node_modules/.bin/rea.cmd'; if (-not (Test-Path $rea)) { throw "rea.cmd not found after install." }
  $env:PATH = (Split-Path $node) + ';' + $env:PATH
  $doc = & $rea doctor --json 2>&1; Log "doctor: $(($doc -join ' ').Substring(0, [Math]::Min(3000, ($doc -join ' ').Length)))"
  # Register in Lin (the running session).
  $s = Get-Content -ErrorAction Stop -Raw -LiteralPath (Join-Path $root 'voice/runtime/session.json') | ConvertFrom-Json; $u = [Uri]$s.url
  $base = $u.GetLeftPart([UriPartial]::Authority); $h = @{ 'X-Lin-Token' = ($u.Fragment -replace '^#token=', ''); 'Content-Type' = 'application/json' }
  $cfg = Invoke-RestMethod -ErrorAction Stop -Uri "$base/api/mcp" -Headers $h
  # Run rea's entry script with this exact node, so it works even when node is not on PATH.
  $pkg = Get-Content -ErrorAction Stop -Raw -LiteralPath (Join-Path $dest 'node_modules/rea-agents/package.json') | ConvertFrom-Json
  $bin = if ($pkg.bin -is [string]) { $pkg.bin } elseif ($pkg.bin.rea) { $pkg.bin.rea } else { ($pkg.bin.PSObject.Properties | Select-Object -First 1).Value }
  $entry = (Resolve-Path (Join-Path $dest "node_modules/rea-agents/$bin")).Path; Log "entry $entry"
  $body = @{ revision = $cfg.revision; name = 'rea'; spec = @{ command = $node; args = @($entry, 'mcp'); env = @{ REA_MCP_INPUT_SCHEMA_PROFILE = 'full' }; cwd = $dest; enabled = $true } } | ConvertTo-Json -Depth 5
  $r = Invoke-RestMethod -ErrorAction Stop -Method Post -Uri "$base/api/mcp/save" -Headers $h -Body $body
  Start-Sleep -Seconds 25
  $st = (Invoke-RestMethod -ErrorAction Stop -Uri "$base/api/mcp" -Headers $h).servers | Where-Object { $_.name -eq 'rea' }
  Log "rea in Lin: state $($st.state) error $($st.error) tools $($st.tools.Count): $(($st.tools | ForEach-Object { $_.name }) -join ', ')"
  Log 'RESULT: DONE'
} catch { Log "RESULT: FAILED $($_.Exception.Message) at line $($_.InvocationInfo.ScriptLineNumber)" }
