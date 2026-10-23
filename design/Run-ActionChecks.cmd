@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Run-ActionChecks.ps1"
echo.
echo Finished. You can close this window.
pause
