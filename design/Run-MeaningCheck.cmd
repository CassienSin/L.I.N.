@echo off
title Lin - search by meaning check
cd /d "%~dp0..\voice"
set PYTHONWARNINGS=ignore
"..\.venv-voice\Scripts\python.exe" verify_meaning.py
echo.
echo Finished. Send Claude everything above if it says FAILED.
pause
