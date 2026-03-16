@echo off
setlocal

echo Installing PyInstaller...
pip install pyinstaller
if %errorlevel% neq 0 exit /b %errorlevel%

echo Building Python backend...
pyinstaller --onefile --name solicitationquoter-backend --noconsole python/server.py
if %errorlevel% neq 0 exit /b %errorlevel%

if exist dist-backend rmdir /s /q dist-backend
rename dist dist-backend
if %errorlevel% neq 0 exit /b %errorlevel%

echo Building Electron app...
npm run build:win
if %errorlevel% neq 0 exit /b %errorlevel%

echo Build complete. Installer: dist/
