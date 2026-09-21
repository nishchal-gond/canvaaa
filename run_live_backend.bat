@echo off
title LPH Live Backend ^& Cloudflare Tunnel
echo ====================================================
echo   LPH Sales Display - Starting Live Backend & Tunnel
echo ====================================================
echo.

echo [1/3] Running database migration...
call npm run migrate
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Migration failed! Make sure PostgreSQL is running.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo [2/3] Starting backend server on port 8000...
start "LPH Backend Server" cmd /k "cd backend && node src/server.js"

echo.
echo [3/3] Starting Cloudflare Tunnel to expose backend to Vercel...
echo Live URL will appear below:
echo ====================================================
"C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel --url http://localhost:8000
