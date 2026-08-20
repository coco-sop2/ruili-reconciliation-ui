@echo off
setlocal
cd /d "%~dp0app"
set "PATH=%~dp0runtime\node;%~dp0tools\OpenSSH;%SystemRoot%\System32;%SystemRoot%\System32\WindowsPowerShell\v1.0"
set "BILLCOMPARE_BUNDLED=1"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0app\start-billcompare.ps1"
endlocal
