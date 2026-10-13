@echo off
setlocal
cd /d "%~dp0"
title Shopline

rem Prefer a portable node.exe shipped beside this file, otherwise use system Node.
set "NODE=node"
if exist "%~dp0node.exe" set "NODE=%~dp0node.exe"

"%NODE%" -v >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js was not found.
  echo.
  echo  Install the LTS version from https://nodejs.org and run this file again.
  echo  ^(Or drop a portable node.exe next to this Start.bat.^)
  echo.
  pause
  exit /b 1
)

echo.
echo  Shopline is starting...
echo  It will open http://localhost:4321 in your browser.
echo.
echo  Keep this window open while you use the app.
echo  Press Ctrl+C or close this window to stop.
echo.

rem Open the browser a couple of seconds from now, once the server is up.
start "" cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:4321"

"%NODE%" server.js
pause
