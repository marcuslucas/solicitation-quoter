#!/bin/bash
set -e

echo "→ Installing PyInstaller..."
python3 -m pip install pyinstaller
python3 -m pip install flask pdfplumber pypdf python-docx anthropic

echo "→ Building Python backend..."
python3 -m PyInstaller --onefile --name solicitationquoter-backend --noconsole python/server.py
rm -rf dist-backend
mv dist dist-backend

echo "→ Building Electron app..."
npm run build:mac

echo "✓ Mac build complete. Installer: dist/"
