@echo off
setlocal
title 锐力对账系统 首次配置
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 Node.js，请先安装 Node.js 22.13 或更高版本。
  pause
  exit /b 1
)

where ssh >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 OpenSSH Client，请在 Windows 可选功能中安装 OpenSSH 客户端。
  pause
  exit /b 1
)

node scripts\setup.mjs
echo.
pause
