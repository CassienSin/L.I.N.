@echo off
rem Opens Lin with invented demo data, safe for screen recordings. Your own data is not opened.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-LinVoice.ps1" -Demo
