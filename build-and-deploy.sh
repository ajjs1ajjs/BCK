#!/bin/bash
set -e
echo "Building BCK..."
cd frontend && npm install && npm run build && cd ..
echo "Build complete. Run: node server.js"
