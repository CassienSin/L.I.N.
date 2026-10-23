@echo off
cd /d "%~dp0..\voice"
"..\.venv-voice\Scripts\python.exe" runtime\transcribe_clip.py > runtime\clip.log 2>&1
