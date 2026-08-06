@echo off
title DesktopST — npm run dev
cd /d "%~dp0"

REM 先建置手機 UI（約 6 秒），mobileServer 才有 out/mobile 可供應。
REM 這樣 QR 掃到的就是最新程式碼，不必再另外開 MobileST-*.bat。
echo [1/2] 建置手機 UI...
call npm run build:mobile
if errorlevel 1 (
  echo.
  echo 手機 UI 建置失敗。DeST 仍會啟動，但 QR 會是上一次的建置。
  echo.
)

echo [2/2] 啟動 DeST...
call npm run dev
if errorlevel 1 (
  echo.
  echo 執行失敗，請檢查上方訊息。
  pause
)
