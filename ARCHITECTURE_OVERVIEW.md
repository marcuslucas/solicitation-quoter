# Architecture Overview

## Process Model

```
┌─────────────────────────────────────────────────────┐
│  Electron Main Process (electron/main.js)           │
│                                                     │
│  • Spawns Python backend on startup                 │
│  • Polls /ping until ready                          │
│  • Loads index.html into BrowserWindow              │
│  • Handles IPC: openFile, saveQuote, pickLogo,      │
│    openUrl, restart-backend                         │
│  • On quit: taskkill (Win) / SIGTERM (Mac)          │
└──────────────┬──────────────────────────────────────┘
               │ spawns
               ▼
┌─────────────────────────────────────────────────────┐
│  Python Flask Backend (python/server.py :5199)      │
│                                                     │
│  GET  /ping            → health check               │
│  POST /parse           → extract fields from file   │
│  POST /generate_quote  → build .docx, return bytes  │
│  POST /sam_lookup      → fetch SAM.gov notice data  │
└─────────────────────────────────────────────────────┘
               ▲
               │ HTTP fetch (127.0.0.1:{port})
               │
┌─────────────────────────────────────────────────────┐
│  Renderer Process (Electron BrowserWindow)          │
│                                                     │
│  index.html ──loads──► JS modules                   │
│    state.js          — wizard state, localStorage   │
│    step1.js          — upload + SAM.gov lookup      │
│    step2.js          — review extracted fields,     │
│                         confidence badges, PDF view │
│    step3.js          — vendor info + line items     │
│    step4.js          — generate + download quote    │
│    index.js          — bootstrapper, step wiring    │
│    shared/utils.js   — API calls, formatting        │
│    shared/theme.js   — theme toggle                 │
└─────────────────────────────────────────────────────┘
```

## Data Flow

```
User picks file
  → IPC openFile()
  → renderer POSTs multipart to /parse
  → pdfplumber / pypdf / python-docx extracts text
  → extractor.py: regex rules + optional Claude AI
  → validator.py: confidence score per field (0-100)
  → JSON response: { fields[], flags[], overallConfidence }
  → step2.js renders review UI with confidence badges
  → user edits fields, clicks flagged items → PDF scroll
  → user fills vendor info + line items (step3)
  → renderer POSTs JSON to /generate_quote
  → generator.py builds .docx via python-docx
  → bytes streamed back
  → IPC saveQuote() → native save dialog → file on disk
```

## IPC Bridge (`electron/preload.js`)

| Method | Description |
|--------|-------------|
| `getPort()` | Returns active port (default 5199, env-overridable) |
| `openFile()` | Native file picker — PDF/DOCX/TXT |
| `saveQuote({ bytes, name })` | Save dialog → write .docx to disk |
| `openUrl(url)` | Open URL in system browser |
| `pickLogo()` | Native image picker → base64 encoded |

## Security Boundaries

- API key stored via Electron `safeStorage` — never sent from renderer
- Key injected into backend environment at spawn time
- File uploads validated: magic bytes checked, 50 MB limit enforced
- CORS restricted to `http://127.0.0.1:{port}`
- Temp files tracked and cleaned on process exit
