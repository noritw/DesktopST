@echo off
setlocal
title DeST Nutrition Desktop
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Cannot find node.exe in PATH.
  echo Install Node.js, then open a new terminal and try again.
  echo.
  pause
  exit /b 1
)

echo Building Nutrition Desktop...
call npm run build:nutrition:desktop
set "ERR=%ERRORLEVEL%"

echo.
if "%ERR%"=="0" (
  echo.
  echo [SUCCESS] Nutrition Desktop portable exe built.
  echo Output folder: nutrition\desktop\dist
) else (
  echo Finished with errors. exit=%ERR%
)
pause
exit /b %ERR%
