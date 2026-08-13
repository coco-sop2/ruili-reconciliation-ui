@echo off
setlocal EnableExtensions
title Billcompare First-time Setup
cd /d "%~dp0" || (
  echo [ERROR] Cannot open the project directory.
  pause
  exit /b 1
)

where node.exe >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found. Install Node.js 22.13 or newer.
  pause
  exit /b 1
)

where ssh.exe >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Windows OpenSSH Client was not found.
  pause
  exit /b 1
)

node.exe "%~dp0scripts\setup.mjs" %*
set "SETUP_EXIT=%ERRORLEVEL%"
echo.
pause
exit /b %SETUP_EXIT%
