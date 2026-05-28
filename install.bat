@echo off
chcp 65001 >nul
title BCK Backup System Installer
setlocal enabledelayedexpansion

echo ╔═══════════════════════════════════════════╗
echo ║        BCK Backup System Installer        ║
echo ╚═══════════════════════════════════════════╝
echo.

REM ─── Check Node.js ───────────────────────────────
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [*] Node.js not found. Downloading...
    echo     This may take a minute...
    powershell -Command "& {Invoke-WebRequest -Uri 'https://nodejs.org/dist/v20.18.0/node-v20.18.0-x64.msi' -OutFile '%TEMP%\node-installer.msi'}"
    echo [*] Installing Node.js...
    msiexec /i "%TEMP%\node-installer.msi" /quiet /norestart
    echo [*] Waiting for installation to complete...
    :wait_node
    timeout /t 3 /nobreak >nul
    where node >nul 2>&1
    if %ERRORLEVEL% neq 0 goto wait_node
    echo [v] Node.js installed
) else (
    echo [v] Node.js detected: 
    node --version
)

REM ─── Install dependencies ────────────────────────
echo.
echo [*] Installing server dependencies...
call npm install

echo [*] Installing frontend dependencies...
cd frontend
call npm install
cd ..

REM ─── Build frontend ──────────────────────────────
echo [*] Building frontend...
cd frontend
call npm run build
cd ..

REM ─── Create startup shortcut (optional) ──────────
set STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
if not exist "%STARTUP_DIR%\BCK.lnk" (
    echo [*] Creating desktop shortcut...
    powershell -Command "& {$WS = New-Object -ComObject WScript.Shell; $SC = $WS.CreateShortcut('%USERPROFILE%\Desktop\BCK.lnk'); $SC.TargetPath = 'cmd.exe'; $SC.Arguments = '/c cd /d %CD% && node server.js'; $SC.WindowStyle = 7; $SC.Description = 'BCK Backup System'; $SC.Save()}"
)

for /f "usebackq delims=" %%I in (`powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | Select-Object -First 1 -ExpandProperty IPAddress)"`) do set LOCAL_IP=%%I
if "%LOCAL_IP%"=="" set LOCAL_IP=127.0.0.1
if "%BCK_APP_URL%"=="" (
    set APP_URL=http://%LOCAL_IP%:9000
) else (
    set APP_URL=%BCK_APP_URL%
)
for /f "usebackq delims=" %%I in (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" 2^>nul`) do set JWT_SECRET=%%I
if "%JWT_SECRET%"=="" set JWT_SECRET=bck-super-secret-change-in-production-2024
(
    echo PORT=9000
    echo JWT_SECRET=%JWT_SECRET%
    echo DB_PATH=./db.json
    echo NODE_ENV=production
    echo HOST=0.0.0.0
    echo APP_URL=%APP_URL%
) > .env

REM ─── Done ────────────────────────────────────────
echo.
echo ╔═══════════════════════════════════════════╗
echo ║       Installation Complete!              ║
echo ╚═══════════════════════════════════════════╝
echo.
echo   URL:      %APP_URL%
echo   Login:    admin
echo.
echo   To start:  node server.js
echo   Or double-click the BCK desktop shortcut
echo.

pause
