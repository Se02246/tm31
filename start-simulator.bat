@echo off
title Simulatore Kiosk Bimby TM31 (800x480)
echo ===================================================
echo   AVVIO SIMULATORE DISPLAY TOUCH BIMBY TM31
echo   Risoluzione: 800 x 480 px (Native Electron Kiosk)
echo ===================================================
echo.
echo Avvio della finestra Kiosk in corso...
if exist ".\node_modules\.bin\electron.cmd" (
  call ".\node_modules\.bin\electron.cmd" electron-main.js
) else (
  call npx electron electron-main.js
)
pause
