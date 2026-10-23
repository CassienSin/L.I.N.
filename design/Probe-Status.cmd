@echo off
wmic process where "name='node.exe' or name='powershell.exe'" get ProcessId,ParentProcessId,CreationDate,CommandLine /format:list > "%~dp0..\voice\runtime\probe-procs.txt" 2>&1
tasklist >> "%~dp0..\voice\runtime\probe-procs.txt"
