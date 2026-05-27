#!/bin/bash
echo "Starting BCK in dev mode..."

cd frontend
npm start &
FRONTEND_PID=$!
cd ..

node server.js &
BACKEND_PID=$!

echo "Frontend: http://localhost:3000"
echo "Backend:  http://localhost:4000"
wait
