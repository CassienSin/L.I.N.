@echo off
title Lin - install the Windows app
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-LinApp.ps1"
echo.
echo Finished. You can close this window.
pause
