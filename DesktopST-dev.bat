@echo off
title DesktopST — npm run dev
cd /d "D:\DesktopST"
call npm run dev
if errorlevel 1 (
  echo.
  echo 執行失敗，請檢查上方訊息。
  pause
)
