#!/bin/bash
set -e

echo "→ Installing PyInstaller..."
pip install pyinstaller

echo "→ Building Python backend..."
pyinstaller --onefile --name solicitationquoter-backend --noconsole python/server.py
rm -rf dist-backend
mv dist dist-backend

echo "→ Building Electron app..."
npm run build:mac

echo "✓ Mac build complete. Installer: dist/"
