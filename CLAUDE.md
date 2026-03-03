# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

**Run the app (development):**
```
npm start
```
Electron launches and automatically spawns the Python backend.

**Install dependencies (one-time setup):**
```
pip install flask pdfplumber pypdf python-docx anthropic
npm install
```

**Build a distributable installer:**
```
# Windows
pip install pyinstaller
pyinstaller --onefile --name solicitationquoter-backend --noconsole python/server.py
rename dist dist-backend
npm run build:win

# Mac
pyinstaller --onefile --name solicitationquoter-backend --noconsole python/server.py
mv dist dist-backend
npm run build:mac
```
Output appears in `dist/`.

## Architecture

This is an **Electron + Python Flask** desktop app. The UI is served from local HTML files and communicates with a locally-spawned Flask backend.

### Process model
- `electron/main.js` spawns `python/server.py` as a child process on startup (port 5199), waits for it to respond to `/ping`, then loads `electron/index.html`.
- In a packaged build, it runs `solicitationquoter-backend.exe` from `process.resourcesPath` instead.
- On quit, the backend is killed via `taskkill` (Windows) or `SIGTERM` (Mac).

### IPC bridge (`electron/preload.js`)
The renderer accesses four methods exposed via `contextBridge` as `window.api`:
- `getPort()` — returns 5199 so the renderer knows where to POST
- `openFile()` — opens the native file picker (PDF/DOCX/TXT)
- `saveQuote({ bytes, name })` — opens a save dialog and writes the `.docx` bytes to disk
- `openUrl(url)` — opens a URL in the system browser

### Python backend (`python/server.py`)
Three routes:
- `GET /ping` — health check used by Electron during startup polling
- `POST /parse` — accepts a `multipart/form-data` upload with `file` and optional `api_key`. Extracts text, then runs rule-based regex extraction. If an API key is provided, also calls `claude-sonnet-4-20250514` to AI-extract fields and merges the results (AI wins on conflicts). Returns JSON with all solicitation fields.
- `POST /generate_quote` — accepts JSON `{ solicitation, vendor, line_items }`. Builds and returns a `.docx` file using `python-docx` with a formatted quote layout.

### UI (`electron/index.html`)
A single self-contained HTML file with all CSS and JS inline. Implements a 5-step wizard:
1. Upload document
2. Review/edit extracted solicitation data
3. Enter vendor/company info
4. Build line items table
5. Generate and download the `.docx` quote

The renderer fetches the backend port via `window.api.getPort()` on load, then uses `fetch()` to call `http://127.0.0.1:{port}/parse` and `/generate_quote` directly.

### Data flow
```
User picks file → Electron dialog (IPC) → renderer POSTs to Flask /parse
→ Python extracts text (pdfplumber/pypdf/python-docx)
→ Rule-based regex + optional Claude AI extraction
→ JSON returned to renderer → user edits fields
→ User fills vendor info + line items
→ renderer POSTs to Flask /generate_quote
→ Python builds .docx → bytes streamed back
→ renderer calls window.api.saveQuote() → native save dialog → file written to disk
```
