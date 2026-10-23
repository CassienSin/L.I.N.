@echo off
echo started %date% %time% > "%~dp0..\voice\runtime\install-ghidra.out.txt"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-Ghidra.ps1" >> "%~dp0..\voice\runtime\install-ghidra.out.txt" 2>&1
echo exit %errorlevel% >> "%~dp0..\voice\runtime\install-ghidra.out.txt"
