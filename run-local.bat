@echo off
echo Starting BCK in dev mode...

start cmd /k "cd frontend && npm start"
timeout /t 3 /nobreak >nul
start cmd /k "node server.js"

echo Frontend: http://localhost:3000
echo Backend:  http://localhost:4000
pause
