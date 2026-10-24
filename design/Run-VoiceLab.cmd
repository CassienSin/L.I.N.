@echo off
title Lin - voice lab
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Run-VoiceLab.ps1"
echo.
echo Finished. You can close this window.
pause
