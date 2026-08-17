@echo off
setlocal
title DeST Nutrition APK
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Cannot find node.exe in PATH.
  echo Install Node.js, then open a new terminal and try again.
  echo.
  pause
  exit /b 1
)

node "%~dp0scripts\build-nutrition-apk.mjs"
set "ERR=%ERRORLEVEL%"

echo.
if "%ERR%"=="0" echo Nutrition APK installed and launched.
if not "%ERR%"=="0" echo Finished with errors. exit=%ERR%
pause
exit /b %ERR%
