$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root 'voice/runtime/probe-status.txt'
$lines = @()
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'verify-|Run-CommandChecks|playwright|headless' } | ForEach-Object {
  $lines += "$($_.ProcessId) parent $($_.ParentProcessId) $($_.Name) started $($_.CreationDate): $($_.CommandLine.Substring(0, [Math]::Min(220, $_.CommandLine.Length)))"
}
Set-Content -LiteralPath $out -Value $lines
