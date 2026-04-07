# Architecture

## Process Model

```
Electron Main Process (electron/main.js)
  │ spawns Python backend as child process
  │ polls /ping until ready
  │ loads index.html into BrowserWindow
  │ on quit: SIGTERM (Mac) / taskkill (Win)
  ▼
Python Flask Backend (python/server.py, port 5199)
  GET  /ping            → health check
  POST /parse           → extract fields from uploaded file
  POST /generate_quote  → build .docx from JSON, return bytes
  POST /sam_lookup      → fetch SAM.gov notice data by ID
  ▲
  │ HTTP fetch to 127.0.0.1:{port}
  │
Renderer (Electron BrowserWindow)
  index.html loads JS modules:
    state.js    → wizard state (S), localStorage
    step1.js    → upload, parse, SAM lookup
    step2.js    → review fields, confidence badges, PDF viewer
    step3.js    → vendor info, line items, CSV import
    step4.js    → generate quote, download
    index.js    → bootstrapper, settings, profiles, modals
    shared/     → utils.js (API, formatting), theme.js
```

## Data Flow

```
User picks file → IPC openFile() → native file picker
  → renderer POSTs multipart to /parse
  → server.py delegates to extractor.py
    → pdfplumber/pypdf extracts text
    → detect_format() classifies document     ← NEW (Phase 10)
    → format-specific regex extraction
    → generic fallback for missed fields       ← NEW (Phase 10)
    → optional Claude AI extraction (if key present)
    → merge results (AI wins conflicts)
  → validator.py scores confidence per field
  → JSON response: { fields[], flags[], overallConfidence }
  → step2.js renders review UI
  → user edits, advances through wizard
  → renderer POSTs JSON to /generate_quote
  → generator.py builds .docx via python-docx
  → bytes returned → IPC saveQuote() → native save dialog
```

## IPC Bridge (preload.js → window.api)

| Method | Purpose |
|--------|---------|
| getPort() | Backend port (default 5199, env-configurable) |
| openFile() | Native file picker for PDF/DOCX/TXT |
| saveQuote({ bytes, name }) | Save dialog → write .docx |
| openUrl(url) | Open in system browser |
| pickLogo() | Image picker → base64 (2MB limit) |
| storeApiKey(key) | Encrypt + store via safeStorage |
| loadApiKey() | Decrypt + return stored key |
| clearApiKey() | Delete stored key |
| restart-backend | Kill + respawn Python process |

## Security Boundaries

- API key stored via Electron safeStorage, injected into backend env at spawn
- Key never sent from renderer — backend reads from env
- File uploads: magic byte validation + 50MB limit
- CORS: 127.0.0.1:{port} only
- Temp files tracked and cleaned on process exit
- Context isolation enabled, nodeIntegration disabled

## Backend Module Responsibilities

| Module | Role |
|--------|------|
| server.py | Thin Flask controllers — route handling, request/response |
| extractor.py | Text extraction from files + regex field extraction + AI extraction |
| validator.py | Confidence scoring per field, flag generation, threshold logic |
| generator.py | .docx quote document construction |
| constants.py | PORT, MAX_FILE_SIZE, SCORED_FIELDS, SCOPE_MAX, etc. |
