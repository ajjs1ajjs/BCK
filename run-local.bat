@echo off
chcp 65001 >nul
title BCK Backup System
echo ============================================
echo    BCK Backup System — Universal Launcher
echo ============================================
echo.

REM ─── Check Node.js ───────────────────────────────
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [*] Node.js not found. Downloading...
    powershell -Command "& {Invoke-WebRequest -Uri 'https://nodejs.org/dist/v20.18.0/node-v20.18.0-x64.msi' -OutFile '%TEMP%\node-installer.msi'; Start-Process msiexec.exe -ArgumentList '/i \"%TEMP%\node-installer.msi\" /quiet /norestart' -Wait}"
    echo [*] Node.js installed. Please restart the script.
    pause
    exit /b
)
echo [v] Node.js detected: 
node --version

REM ─── Install root dependencies ───────────────────
if not exist "node_modules" (
    echo [*] Installing server dependencies...
    call npm install
) else (
    echo [v] Server dependencies OK
)

REM ─── Install frontend dependencies ───────────────
if not exist "frontend\node_modules" (
    echo [*] Installing frontend dependencies...
    cd frontend
    call npm install
    cd ..
) else (
    echo [v] Frontend dependencies OK
)

REM ─── Build frontend if needed ────────────────────
if not exist "frontend\build\index.html" (
    echo [*] Building frontend...
    cd frontend
    call npm run build
    cd ..
    echo [v] Frontend built
) else (
    echo [v] Frontend build OK
)

REM ─── Start server ────────────────────────────────
echo.
echo ============================================
echo    Starting server...
echo    Open: http://localhost:9000
echo    Login: admin
echo ============================================
node server.js
pause
