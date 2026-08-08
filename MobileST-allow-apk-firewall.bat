@echo off
setlocal
title DeST APK firewall allow
cd /d "%~dp0"

echo This will ask for Administrator once.
echo It allows inbound TCP 8731 so the phone can download the APK on LAN.
echo.

net session >nul 2>&1
if errorlevel 1 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b 0
)

netsh advfirewall firewall delete rule name="DeST APK serve" >nul 2>&1
netsh advfirewall firewall add rule name="DeST APK serve" dir=in action=allow protocol=TCP localport=8731 profile=private,domain
if errorlevel 1 (
  echo FAILED to add firewall rule.
  pause
  exit /b 1
)

echo OK: inbound TCP 8731 allowed on private/domain profiles.
echo Now run MobileST-serve-apk.bat, then scan the new QR.
echo.
pause
exit /b 0
