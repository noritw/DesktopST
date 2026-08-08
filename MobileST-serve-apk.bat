@echo off
setlocal
title DeST APK serve
cd /d "%~dp0"

if not exist "%~dp0out\apk\DeST-debug.apk" (
  echo [ERROR] out\apk\DeST-debug.apk not found.
  echo Run MobileST-build-apk.bat first.
  echo.
  pause
  exit /b 1
)

echo Starting LAN download page + QR...
echo.
echo IMPORTANT: keep this window open until the phone finishes downloading.
echo If the phone browser spins forever, Windows Firewall may be blocking.
echo.
node "%~dp0scripts\serve-apk.mjs"
set "ERR=%ERRORLEVEL%"
echo.
if not "%ERR%"=="0" echo serve FAILED. exit=%ERR%
pause
exit /b %ERR%
