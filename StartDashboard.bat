@echo off
echo ===================================================
echo   Starting CanSat Telemetry Dashboard (Windows)
echo ===================================================
echo.
echo Your web browser should open automatically. 
echo If it doesn't, please go to: http://localhost:8000
echo.
echo Press Ctrl+C in this window to stop the server when you are done.
echo.

:: Open the default web browser to localhost
start http://localhost:8000

:: Start the python HTTP server
python -m http.server 8000

pause
