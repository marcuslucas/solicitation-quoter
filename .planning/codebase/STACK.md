# Technology Stack

**Analysis Date:** 2026-03-17

## Languages

**Primary:**
- JavaScript (ES6+) - Used in `electron/main.js`, `electron/preload.js`, and `electron/index.html` for all Electron/UI code
- Python 3 - Used in `python/server.py` for Flask backend, document parsing, and text extraction

**Secondary:**
- HTML/CSS - Inline in `electron/index.html` for complete UI layout and styling

## Runtime

**Environment:**
- Node.js (version managed by Electron 28.3.0)
- Python 3.x (spawned as subprocess by Electron main process)

**Package Manager:**
- npm (Node Package Manager)
- pip (Python Package Manager)
- Lockfile: `package-lock.json` present for npm; Python uses direct package imports via `pip install`

## Frameworks

**Core:**
- Electron 28.3.0 - Desktop application framework for creating native cross-platform apps with HTML/CSS/JavaScript
- Flask (Python) - Lightweight web framework running on localhost:5199 for backend API routes

**Testing:**
- Not detected

**Build/Dev:**
- electron-builder 24.13.0 - Builds distributable installers (NSIS for Windows, DMG for macOS)
- PyInstaller - Used to package Python backend as standalone executable (`solicitationquoter-backend.exe` or `solicitationquoter-backend`)

## Key Dependencies

**Critical:**
- pdfplumber (Python) - PDF text extraction with fallback support
- pypdf (Python) - Alternative PDF parsing library (fallback when pdfplumber fails)
- python-docx (Python) - DOCX file parsing and quote generation (creates formatted .docx output)
- anthropic (Python) - Claude AI API client for optional AI-powered solicitation extraction
- Flask (Python) - Web framework for `/parse` and `/generate_quote` routes

**Infrastructure:**
- electron-builder - Packages app for Windows (NSIS installer) and macOS (DMG)
- PyInstaller - Bundles Python backend into single-file executable for distribution

## Configuration

**Environment:**
- PORT environment variable - Specifies backend port (default: 5199), set by Electron startup
- PYTHONUNBUFFERED=1 - Set by `electron/main.js` to disable Python buffering for real-time console output
- Electron app ID: `com.yourcompany.solicitationquoter`
- App name: "Solicitation Quoter"

**Build:**
- `electron-builder.json` - Configuration for Windows and macOS builds
  - Windows: NSIS installer with custom shortcuts
  - macOS: DMG with custom layout and Install Helper script
  - Backend binary bundled in `extraResources`

**API Keys Storage:**
- Electron `safeStorage` API - Encrypts Anthropic API keys and SAM.gov API keys
- Location: `userData/apikey.bin` (encrypted) or `userData/apikey.bin.plain` (fallback if encryption unavailable)
- Loaded on app startup via `window.api.loadApiKey()`
- Also supports legacy localStorage fallback for migration

## Platform Requirements

**Development:**
- Node.js with npm
- Python 3.x with pip
- Platform-specific build tools:
  - **Windows**: NSIS (bundled with electron-builder)
  - **macOS**: macOS SDK, xattr command for quarantine attribute removal
- Visual Studio Code or equivalent editor

**Production:**
- Windows: Windows 7+ for NSIS installer
- macOS: macOS 10.x+ for DMG distribution
- 2+ MB disk space for app
- Internet connection for Anthropic API calls (optional) and SAM.gov API calls (optional)

## Deployment Architecture

**Process Model:**
- Electron main process spawns Python Flask server as child process on startup
- Flask server listens on `http://127.0.0.1:5199` (localhost only, no network exposure)
- Electron main process polls `/ping` endpoint until backend responds
- UI loads after backend confirms readiness
- On app quit, Electron kills Python process via `taskkill` (Windows) or `SIGTERM` (Unix)

**IPC Bridge:**
- `electron/preload.js` exposes `window.api` object with safe IPC methods:
  - `getPort()` - Returns backend port
  - `openFile()` - File picker for documents
  - `saveQuote(bytes, name)` - Save generated quote to disk
  - `savePdf(bytes, name)` - Save PDF preview to disk
  - `openUrl(url)` - Open URL in system browser
  - `pickLogo()` - Logo image picker with 2MB size limit
  - `generatePdf(html)` - HTML to PDF conversion
  - `exportData(content, filename, ext)` - Export JSON/CSV data
  - `openJsonFile()` - Load saved quote JSON
  - `storeApiKey(key)` - Encrypt and store API key
  - `loadApiKey()` - Load encrypted API key
  - `clearApiKey()` - Delete stored API key

## Cross-Platform Notes

**Windows:**
- Backend spawned via `python` command
- Process termination: `taskkill /pid {pid} /f /t`
- DMG not applicable; uses NSIS installer instead
- Data directory: `%APPDATA%/Solicitation Quoter` (via Electron's `userData` path)

**macOS:**
- Backend spawned via `python3` command
- Process termination: SIGTERM signal
- Quarantine attribute removal: `xattr -d com.apple.quarantine` on helper binary
- DMG installer with Install Helper script for easy installation
- Data directory: `~/Library/Application Support/Solicitation Quoter`

---

*Stack analysis: 2026-03-17*
