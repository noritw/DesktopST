@echo off
setlocal
title DeST Mobile APK Build
cd /d "%~dp0"

echo.
echo Starting DeST mobile APK build...
echo If this window closes instantly, Node.js may be missing from PATH.
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Cannot find node.exe in PATH.
  echo Install Node.js, then open a new terminal and try again.
  echo.
  pause
  exit /b 1
)

node "%~dp0scripts\build-mobile-apk.mjs"
set "ERR=%ERRORLEVEL%"

echo.
if not "%ERR%"=="0" (
  echo APK build FAILED. exit=%ERR%
) else (
  echo APK build script finished. exit=%ERR%
)
echo.
pause
exit /b %ERR%
