@echo off
rem Opens Lin as a Windows app (tray icon, Ctrl+Space quick bar). Install it once with design\Install-LinApp.cmd.
start "" "%~dp0.venv-voice\Scripts\pythonw.exe" "%~dp0voice\app_shell.py"
