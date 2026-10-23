param([switch]$NoBrowser, [switch]$Demo)
# Starts Lin, or reuses the running session. -Demo uses the invented demo data in voice/demo.
# Only one Lin runs at a time (they share the graphics card), so switching between your own
# data and the demo closes the other one first.
$linRoot = $PSScriptRoot
$linPython = Join-Path $linRoot '.venv-voice/Scripts/python.exe'
$linRuntime = Join-Path $linRoot 'voice/runtime'
New-Item -ItemType Directory -Path $linRuntime -Force | Out-Null
$linSessionPath = Join-Path $linRuntime 'session.json'
$linWanted = [bool]$Demo
if (Test-Path -LiteralPath $linSessionPath) {
    try {
        $linExisting = Get-Content -Raw -LiteralPath $linSessionPath | ConvertFrom-Json
        $linUri = [Uri]$linExisting.url
        if ($linUri.Scheme -eq 'http' -and $linUri.Host -eq '127.0.0.1') {
            $linToken = $linUri.Fragment -replace '^#token=', ''
            $linBase = $linUri.GetLeftPart([UriPartial]::Authority)
            $linStatus = Invoke-RestMethod -Uri ($linBase + '/api/status') -Headers @{ 'X-Lin-Token' = $linToken } -TimeoutSec 2
            if ($null -ne $linStatus.ready) {
                if ([bool]$linStatus.demo -eq $linWanted) {
                    if (-not $NoBrowser) { Start-Process $linExisting.url }
                    Write-Output 'Reusing the running Lin voice session.'
                    exit 0
                }
                Write-Output ($(if ($linWanted) { 'Closing Lin with your data to open the demo…' } else { 'Closing the demo to open Lin with your data…' }))
                Invoke-RestMethod -Method Post -Uri ($linBase + '/api/shutdown') -Headers @{ 'X-Lin-Token' = $linToken; 'Content-Type' = 'application/json' } -Body '{}' -TimeoutSec 5 | Out-Null
                for ($i = 0; $i -lt 60 -and (Get-Process -Id $linExisting.pid -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Milliseconds 500 }
            }
        }
    } catch { }
}
$linLaunchId = [Guid]::NewGuid().ToString('N')
$linArgs = @('voice/server.py', '--launch-id', $linLaunchId)
if ($linWanted) { $linArgs += '--demo' }
$linProcess = Start-Process -FilePath $linPython -ArgumentList $linArgs -WorkingDirectory $linRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $linRuntime 'server.log') -RedirectStandardError (Join-Path $linRuntime 'server-error.log')
for ($linAttempt = 0; $linAttempt -lt 120; $linAttempt++) {
    Start-Sleep -Milliseconds 250
    if ($linProcess.HasExited) { throw 'Lin could not start. See voice/runtime/server-error.log.' }
    if (Test-Path -LiteralPath $linSessionPath) {
        $linSession = Get-Content -Raw -LiteralPath $linSessionPath | ConvertFrom-Json
        if ($linSession.launch_id -eq $linLaunchId) {
            if (-not $NoBrowser) { Start-Process $linSession.url }
            Write-Output ($(if ($linWanted) { 'Lin is starting with demo data.' } else { 'Lin voice is starting. Use the window to unload the voice when finished.' }))
            exit 0
        }
    }
}
throw 'Lin did not produce a launch link. See voice/runtime/server-error.log.'
