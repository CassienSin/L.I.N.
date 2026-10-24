# Installs Lin as a Windows app: adds pywebview and pystray to Lin's own Python (.venv-voice), draws her icon,
# and puts a "Lin" shortcut on the Desktop and in the Start menu. Nothing else on the PC changes.
# Undo: delete the two shortcuts (and turn off "Start with Windows" in the tray menu first, if you turned it on).
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$python = Join-Path $root '.venv-voice/Scripts/python.exe'
$pythonw = Join-Path $root '.venv-voice/Scripts/pythonw.exe'
$shell = Join-Path $root 'voice/app_shell.py'
Write-Output 'Adding pywebview and pystray to Lin''s Python...'
& $python -m pip install --disable-pip-version-check pywebview pystray
if ($LASTEXITCODE -ne 0) { throw 'pip could not install pywebview and pystray. Check the internet connection and try again.' }
& $python -c "import webview, pystray; print('pywebview', webview.__version__ if hasattr(webview, '__version__') else 'ok', '| pystray ok')"
Write-Output 'Drawing Lin''s icon...'
& $python $shell --make-icon
$icon = Join-Path $root 'voice/ui/lin.ico'
$wsh = New-Object -ComObject WScript.Shell
foreach ($folder in @([Environment]::GetFolderPath('Desktop'), (Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs'))) {
    $lnk = $wsh.CreateShortcut((Join-Path $folder 'Lin.lnk'))
    $lnk.TargetPath = $pythonw
    $lnk.Arguments = "`"$shell`""
    $lnk.WorkingDirectory = $root
    $lnk.IconLocation = $icon
    $lnk.Description = 'Lin, your assistant on this PC'
    $lnk.Save()
    Write-Output "Shortcut: $(Join-Path $folder 'Lin.lnk')"
}
Write-Output ''
Write-Output 'Done. Open Lin from the Desktop or the Start menu. She lives in the tray; press Ctrl+Space anywhere for the quick bar.'
