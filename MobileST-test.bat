@echo off
setlocal
title DeST Mobile UI Test
cd /d "%~dp0"

echo [1/3] Starting mobile stub server on port 5999...
start "DeST mobile stub" powershell.exe -NoExit -ExecutionPolicy Bypass -Command "Set-Location -LiteralPath '%~dp0'; node scripts\mobile-stub-server.mjs"
if errorlevel 1 goto :error

for /f %%P in ('powershell.exe -NoProfile -Command "$p=5180; while(Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue){$p++}; $p"') do set "MOBILE_UI_PORT=%%P"
echo [2/3] Starting mobile UI on port %MOBILE_UI_PORT%...
start "DeST mobile UI" powershell.exe -NoExit -ExecutionPolicy Bypass -Command "Set-Location -LiteralPath '%~dp0'; npm.cmd run dev:mobile -- --port %MOBILE_UI_PORT% --strictPort"
if errorlevel 1 goto :error

echo Waiting for Vite to start...
timeout /t 3 /nobreak >nul

echo [3/3] Generating QR Code...
node scripts\mobile-test-qr.mjs
if errorlevel 1 goto :error

start "" "%~dp0mobile-test-qr.png"
echo.
echo Scan the QR Code with your phone.
echo Keep this window open. Close the two PowerShell windows to stop the test.
pause
exit /b 0

:error
echo.
echo Failed to start the mobile test environment.
echo Check that Node.js and npm dependencies are installed.
pause
exit /b 1
