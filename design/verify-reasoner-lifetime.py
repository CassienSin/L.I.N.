"""Verify child cleanup even if the owner exits abruptly. No user input used."""
import ctypes
from ctypes import wintypes
import json
from pathlib import Path
import subprocess
import sys
import time

root = Path(__file__).resolve().parents[1]
owner_code = """
import subprocess, sys, time
from process_lifetime import ProcessLifetime
child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW)
lifetime = ProcessLifetime(child)
print(child.pid, flush=True)
time.sleep(60)
"""
owner = subprocess.Popen([sys.executable, '-c', owner_code], cwd=root/'voice', stdout=subprocess.PIPE, text=True, creationflags=subprocess.CREATE_NO_WINDOW)
api = ctypes.WinDLL('kernel32',use_last_error=True)
api.OpenProcess.argtypes = [wintypes.DWORD,wintypes.BOOL,wintypes.DWORD]
api.OpenProcess.restype = wintypes.HANDLE
api.WaitForSingleObject.argtypes = [wintypes.HANDLE,wintypes.DWORD]
api.WaitForSingleObject.restype = wintypes.DWORD
api.CloseHandle.argtypes = [wintypes.HANDLE]
handle = None
try:
    child_pid = int(owner.stdout.readline().strip())
    handle = api.OpenProcess(0x100000,False,child_pid)
    assert handle, ctypes.get_last_error()
    assert api.WaitForSingleObject(handle,0) == 258, 'Child did not start'
    owner.terminate()
    owner.wait(timeout=5)
    assert api.WaitForSingleObject(handle,5000) == 0, 'Orphan child survived owner termination'
    result = {'passed':True,'check':'Windows job closes the child when its owner exits abruptly'}
    (root/'voice'/'reasoning-benchmark'/'lifetime-results.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps(result))
finally:
    if owner.poll() is None:
        owner.terminate()
    if handle:
        api.CloseHandle(handle)
