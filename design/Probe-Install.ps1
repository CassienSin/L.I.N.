$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root 'voice/runtime/probe-install.txt'
$lines = @("Probe $(Get-Date -Format s)")
Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'curl|powershell|tar|MsMpEng' } | ForEach-Object {
  $cl = if ($_.CommandLine) { $_.CommandLine.Substring(0, [Math]::Min(200, $_.CommandLine.Length)) } else { '' }
  $lines += "$($_.ProcessId) $($_.Name) started $($_.CreationDate) kernel $([math]::Round($_.KernelModeTime/1e7)) s: $cl" }
$zip = Get-ChildItem (Join-Path $root 'tools/downloads') -ErrorAction SilentlyContinue
$zip | ForEach-Object { $lines += "$($_.Name) $($_.Length) bytes, modified $($_.LastWriteTime)" }
Set-Content -LiteralPath $out -Value $lines
