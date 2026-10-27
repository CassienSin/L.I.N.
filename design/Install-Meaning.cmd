@echo off
title Lin - install search by meaning
echo.
echo  Downloads the small model Lin uses to search by meaning (multilingual-e5-small, about 470 MB),
echo  checks every file, and keeps it on this PC. Your notes and conversations are not uploaded.
echo.
cd /d "%~dp0..\voice"
"..\.venv-voice\Scripts\python.exe" download_embeddings.py
if errorlevel 1 (echo. & echo  The download did not finish. Run this again to retry.) else (echo. & echo  Done. Reopen Lin: she indexes your notes and conversations in the background while she is idle.)
echo.
pause
