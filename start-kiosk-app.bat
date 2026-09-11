@echo off
title Bimby TM31 Kiosk App Mode
echo ===================================================
echo   AVVIO BIMBY TM31 IN APP/KIOSK MODE (800x480)
echo ===================================================
echo.
start msedge.exe --app="http://localhost:3001" --window-size=800,480
