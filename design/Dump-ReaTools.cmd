@echo off
cd /d "%~dp0..\voice"
"..\.venv-voice\Scripts\python.exe" runtime\dump_rea_tools.py > runtime\dump-rea.log 2>&1
