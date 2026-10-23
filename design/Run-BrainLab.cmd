@echo off
cd /d "%~dp0..\voice"
"..\.venv-voice\Scripts\python.exe" brain_lab.py Qwen3.6-35B-A3B-UD-Q3_K_XL.gguf Qwen3-4B-Q4_K_M.gguf > runtime\brain-lab.log 2>&1
