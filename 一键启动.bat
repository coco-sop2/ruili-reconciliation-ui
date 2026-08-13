@echo off
setlocal EnableExtensions
title Billcompare Launcher
cd /d "%~dp0" || (
  echo [ERROR] Cannot open the project directory.
  pause
  exit /b 1
)

echo ============================================
echo              Billcompare Launcher
echo ============================================
echo.

where node.exe >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found. Install Node.js 22.13 or newer.
  pause
  exit /b 1
)

node.exe "%~dp0scripts\start-all.mjs" %*
set "LAUNCH_EXIT=%ERRORLEVEL%"
if not "%LAUNCH_EXIT%"=="0" (
  echo.
  echo [ERROR] Startup failed. Review the message and log path above.
  pause
  exit /b %LAUNCH_EXIT%
)

echo.
echo Startup completed. Closing this window will not stop the services.
pause
exit /b 0
