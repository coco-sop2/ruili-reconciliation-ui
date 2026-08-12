@echo off
setlocal
title 锐力对账系统 一键启动
cd /d "%~dp0"

echo ============================================
echo         锐力对账系统 一键启动
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 Node.js，请先安装 Node.js 22 或更高版本。
  pause
  exit /b 1
)

node scripts\start-all.mjs
if errorlevel 1 (
  echo.
  echo [错误] 启动未完成，请根据上方信息处理后重试。
  pause
  exit /b 1
)

echo.
echo 启动完成，关闭此窗口不会停止后台服务。
pause
