@echo off
cd /d "%~dp0.."
set NODE=node
where node >nul 2>nul || set NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node.exe
"%NODE%" design\probe-latency.cjs > voice\runtime\latency.log 2>&1
echo DONE>> voice\runtime\latency.log
