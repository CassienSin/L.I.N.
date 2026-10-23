@echo off
cd /d "%~dp0..\voice"
"..\.venv-voice\Scripts\python.exe" runtime\transcribe_parts.py > runtime\rea-video\transcribe.log 2>&1
