@echo off
setlocal
title DeST Mobile UI - Real Data Test
cd /d "%~dp0"

echo DeST must already be running with mobileServer enabled.
echo Detecting this PC's LAN address and DeST access token automatically...
for /f %%P in ('powershell.exe -NoProfile -Command "$p=5180; while(Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue){$p++}; $p"') do set "MOBILE_UI_PORT=%%P"
echo Starting new mobile UI on port %MOBILE_UI_PORT%...
start "DeST mobile UI" powershell.exe -NoExit -ExecutionPolicy Bypass -Command "Set-Location -LiteralPath '%~dp0'; npm.cmd run dev:mobile -- --port %MOBILE_UI_PORT% --strictPort"
timeout /t 3 /nobreak >nul

set "MOBILE_REAL=1"
node scripts\mobile-test-qr.mjs
if errorlevel 1 goto :error
start "" "%~dp0mobile-test-qr.png"
echo.
echo Scan the QR Code. This uses the NEW mobile UI and REAL DeST data.
echo Keep DeST and the PowerShell UI window running.
pause
exit /b 0

:error
echo.
echo Could not create the real-data mobile test URL.
pause
exit /b 1
