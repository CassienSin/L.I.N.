@echo off
rem Opens Lin. Starts her if she is not running, otherwise reuses the running session.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-LinVoice.ps1"
