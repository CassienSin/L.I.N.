---
name: lin-checks
description: Run Lin's test suites on this PC and report in plain words what passed, what failed and why. Use after changing Lin's code.
disable-model-invocation: true
---

# Lin checks

Run from the project root in PowerShell. Leave the window running until it finishes; never stop a run early.

1. Pick the suite:
   - Quick, no restart (about 30 s): `powershell -NoProfile -ExecutionPolicy Bypass -File design/Run-DocCheck.ps1` → log `voice/runtime/doc-check.log`.
   - Everything (about 15 min, restarts Lin with demo data, then back to the user's data): `powershell -NoProfile -ExecutionPolicy Bypass -File design/Run-CommandChecks.ps1` → log `voice/runtime/command-checks.log`.
   - Connected tools only, three runs: `design/Run-ToolsCheck.ps1` → `voice/runtime/tools-check.log`.
   Use the quick suite unless the user asks for everything or the change touched the browser UI or server routes.
2. Read the log. Lines starting with `==` are suite names; `passed:` / `FAILED:` give the result; the last line is `RESULT: PASSED` or `RESULT: FAILED`.
3. For each failure, open `voice/runtime/<test-name>.progress.txt` (browser checks) or the indented lines under it in the log (Python checks) and find the first error.
4. Report: one line for the overall result, then each failure as: the check, what it expected, what happened, and the likely cause in the code. Say plainly if a failure looks flaky (it passed before with the same code) rather than broken.
5. Do not change tests to make them pass unless the user asks; fix the code, or explain why the test is wrong.
