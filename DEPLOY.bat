@echo off
echo === BCK Deployment ===

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo Node.js not found. Download from https://nodejs.org/
    pause
    exit /b 1
)

echo Installing dependencies...
call npm install

echo Building frontend...
cd frontend
call npm install
call npm run build
cd ..

if not exist db.json (
    echo {"backups":[],"schedules":[],"logs":[],"stats":{"totalBackups":0,"successfulBackups":0,"failedBackups":0,"lastBackup":null}} > db.json
)

echo.
echo === Deployment complete! ===
echo Run: node server.js
echo Then open http://localhost:6000
pause
