@echo off
cd /d "%~dp0.."
set NODE=node
where node >nul 2>nul || set NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node.exe
echo Browser approval flow > voice\runtime\action-browser.log
"%NODE%" design\verify-actions.cjs >> voice\runtime\action-browser.log 2>&1
if errorlevel 1 (echo RESULT: FAILED>> voice\runtime\action-browser.log) else (echo RESULT: PASSED>> voice\runtime\action-browser.log)
