@echo off
title Lin - install Claude Code and sign in
echo.
echo  This sets up Claude as Lin's online brain, using Anthropic's own installer:
echo      irm https://claude.ai/install.ps1 ^| iex
echo  Then Claude Code asks you to sign in. Sign in with your Claude account (your Pro plan)
echo  in the browser window it opens. Lin never sees your password, a key or a token.
echo.
set "CLAUDE="
if exist "%USERPROFILE%\.local\bin\claude.exe" set "CLAUDE=%USERPROFILE%\.local\bin\claude.exe"
if not defined CLAUDE for /f "delims=" %%c in ('where claude 2^>nul') do if not defined CLAUDE set "CLAUDE=%%c"
if defined CLAUDE goto signin
echo  Installing Claude Code... (it shows no progress while it downloads)
powershell -NoProfile -Command "irm https://claude.ai/install.ps1 | iex"
if exist "%USERPROFILE%\.local\bin\claude.exe" set "CLAUDE=%USERPROFILE%\.local\bin\claude.exe"
if not defined CLAUDE (
  echo.
  echo  Claude Code did not install. See https://code.claude.com/docs/en/troubleshoot-install
  goto end
)
:signin
echo.
"%CLAUDE%" --version
"%CLAUDE%" auth status --text
if errorlevel 1 (
  echo.
  echo  Signing in. Choose your Claude account ^(not the Console / API option^).
  "%CLAUDE%" auth login
  "%CLAUDE%" auth status --text
)
echo.
echo  Done. In Lin, open Settings, then Brain, choose "Ask me first", and press Check again.
:end
echo.
pause
