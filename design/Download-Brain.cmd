@echo off
cd /d "%~dp0..\voice"
"..\.venv-voice\Scripts\python.exe" download_brain.py > runtime\download-brain.out.txt 2>&1
