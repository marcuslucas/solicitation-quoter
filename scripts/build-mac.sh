#!/bin/bash
set -e

echo "→ Installing PyInstaller..."
python3 -m pip install pyinstaller
python3 -m pip install flask pdfplumber pypdf python-docx anthropic

echo "→ Building Python backend..."
# Output directly to dist-backend/ so it never conflicts with electron-builder's dist/
python3 -m PyInstaller --clean --onefile \
  --name solicitationquoter-backend \
  --distpath dist-backend \
  --workpath build-pyinstaller \
  --collect-all pdfminer \
  python/server.py

echo "→ Building Electron app..."
npm run build:mac

echo "✓ Mac build complete. Installer: dist/"
