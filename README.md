# SolQuoter

> Desktop application for converting U.S. government solicitation documents into professional vendor quote packages.

---

## What It Does

SolQuoter is an Electron + Python desktop app targeting small-to-mid-size government contractors. The core workflow is a 4-step wizard:

1. **Upload** — user drags in a PDF, DOCX, or TXT solicitation (or fetches directly from SAM.gov by Notice ID)
2. **Review** — AI-extracted fields are displayed with per-field confidence scores; user corrects flagged items; source PDF scrolls to the matching bounding box
3. **Configure** — user fills vendor info, line items, and pricing
4. **Generate** — app produces a formatted `.docx` quote file, downloaded via native save dialog

The result is a production-ready vendor quote that maps directly to the solicitation's requirements — without manual copy-paste from government PDFs.

---

## Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Desktop shell | Electron 28 | Native file I/O, safeStorage, IPC bridge |
| UI | HTML/CSS/JS (modular) | Per-step JS modules, semantic CSS tokens |
| Backend | Python Flask on `127.0.0.1:5199` | Spawned at startup, configurable via `PORT` env var |
| Document parsing | pdfplumber, pypdf, python-docx | Magic-byte validated, 50 MB limit |
| AI extraction | Anthropic `claude-sonnet-4-6` | Optional; falls back to regex rules without API key |
| Confidence scoring | Custom `validator.py` | Per-field 0–100 score + flag output |
| Quote output | python-docx | `.docx` generation with vendor branding |
| Packaging | electron-builder | Windows NSIS installer / macOS DMG |

---

## Architecture

### Process Model

```
┌──────────────────────────────────────────────┐
│  Electron Main Process (electron/main.js)    │
│                                              │
│  • Spawns Python backend on startup          │
│  • Polls /ping until ready                   │
│  • Loads BrowserWindow → index.html          │
│  • IPC handlers: openFile, saveQuote,        │
│    pickLogo, openUrl, restart-backend        │
│  • Quit: taskkill (Win) / SIGTERM (Mac)      │
│  • API key injected via Electron safeStorage │
└──────────────────┬───────────────────────────┘
                   │ spawns
                   ▼
┌──────────────────────────────────────────────┐
│  Python Flask (python/server.py :5199)       │
│                                              │
│  GET  /ping            → health check        │
│  POST /parse           → extract fields      │
│  POST /generate_quote  → build .docx bytes   │
│  POST /sam_lookup      → SAM.gov notice data │
└──────────────────────────────────────────────┘
                   ▲
                   │ HTTP fetch (localhost)
                   │
┌──────────────────────────────────────────────┐
│  Renderer (Electron BrowserWindow)           │
│                                              │
│  state.js          wizard state + localStorage│
│  step1.js          upload + SAM.gov lookup   │
│  step2.js          field review + PDF viewer │
│  step3.js          vendor info + line items  │
│  step4.js          generate + download       │
│  shared/utils.js   API calls, formatting     │
│  shared/theme.js   theme switching           │
│  js/init-pdfjs.js  PDF.js bootstrapper       │
└──────────────────────────────────────────────┘
```

### Data Flow

```
User picks file
  → IPC openFile()
  → renderer POSTs multipart to /parse
  → pdfplumber / pypdf / python-docx extracts raw text
  → extractor.py: regex rules + optional Claude AI
  → validator.py: confidence score per field (0–100)
  → JSON: { fields[], flags[], overallConfidence }
  → step2.js renders review UI with confidence badges
  → user corrects flagged fields; PDF scrolls to source
  → step3.js: vendor info + line items
  → renderer POSTs JSON to /generate_quote
  → generator.py builds .docx via python-docx
  → bytes streamed back to renderer
  → IPC saveQuote() → native save dialog → .docx on disk
```

### IPC Bridge (`electron/preload.js`)

| Method | Description |
|--------|-------------|
| `getPort()` | Returns active port (default 5199) |
| `openFile()` | Native picker — PDF / DOCX / TXT |
| `saveQuote({ bytes, name })` | Save dialog → write .docx |
| `openUrl(url)` | Opens URL in system browser |
| `pickLogo()` | Native image picker → base64 |

### Security Boundaries

- API key stored via Electron `safeStorage` — encrypted at rest, never touches the renderer
- Key injected into Python subprocess environment at spawn time only
- Uploads validated by magic bytes before processing; 50 MB hard limit enforced
- CORS restricted to `http://127.0.0.1:{port}` — no external network exposure
- Temp files tracked and deleted on process exit

---

## Key Files

```
electron/
  main.js           Backend spawn, IPC handlers, quit/cleanup
  preload.js        window.api surface (contextIsolation)
  index.html        App shell, design tokens, modal scaffolding

electron/js/
  state.js          Wizard state, localStorage persistence
  modules/
    step1.js        File upload, SAM.gov lookup trigger
    step2.js        Field review, confidence badges, PDF.js viewer
    step3.js        Vendor info, line items, vendor profiles
    step4.js        Quote generation, download
    shared/
      utils.js      fetch wrappers, formatting helpers
      theme.js      Theme switching + persistence
  init-pdfjs.js     PDF.js worker initialization

python/
  server.py         Thin Flask controller (4 routes)
  extractor.py      Regex + Claude AI field extraction
  validator.py      Per-field confidence scoring, flag output
  generator.py      .docx quote builder (python-docx)
  constants.py      Field definitions, regex patterns
```

---

## Running Locally

### Prerequisites

- Node.js 18+
- Python 3.10+
- `pip install flask pdfplumber pypdf python-docx anthropic`

### Start (development)

```bash
npm install
npm start          # Launches Electron; Python backend auto-spawns
```

### Build

```bash
npm run build:win  # Windows NSIS installer
npm run build:mac  # macOS DMG
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `5199` | Flask backend port |

---

## Configuration (in-app Settings)

| Setting | Storage | Notes |
|---------|---------|-------|
| Anthropic API Key | Electron safeStorage | Optional — enables AI extraction |
| SAM.gov API Key | Electron safeStorage | Optional — enables Notice ID lookup; keys expire every 90 days |
| Default Quote Validity | localStorage | Defaults to `30 days` |

---

## Feature Overview

### Document Input
- Drag-and-drop or native file picker (PDF, DOCX, TXT)
- SAM.gov lookup by Notice ID (requires free SAM.gov API key)
- 50 MB upload limit with magic-byte validation

### AI Extraction (Step 2)
- Per-field confidence badges (0–100%)
- Flagged fields highlighted for user review
- PDF.js continuous-scroll viewer with bounding-box auto-scroll to source text
- Scope truncation warnings for long fields
- Manual override on any extracted field

### Vendor Configuration (Step 3)
- Vendor profiles: save, load, import/export
- Line item table with quantity/unit/price
- Logo upload (base64, embedded in output)

### Quote Generation (Step 4)
- Produces a formatted `.docx` via native save dialog
- Quote history tracked in localStorage
- Export history as CSV or JSON backup

### Theming
- Multiple color themes selectable in-app
- Default: dark terminal aesthetic (green-on-black)
- Fully token-driven — no hardcoded hex values

---

## Technical Risks & Recommended Next Steps

### Risks

| Area | Risk | Severity |
|------|------|----------|
| **Python subprocess** | No restart-on-crash recovery beyond manual `restart-backend` IPC | Medium |
| **SAM.gov API keys** | 90-day expiry with no in-app expiry warning | Low–Medium |
| **localStorage state** | Wizard state and history stored in renderer localStorage; lost if Electron profile cleared | Medium |
| **PDF bounding-box accuracy** | Regex-based coordinate mapping may degrade on non-standard PDF layouts | Medium |
| **Claude model pinning** | `claude-sonnet-4-6` hardcoded in extractor — breaking changes on model deprecation | Low |
| **No automated tests** | 9-phase UAT was manual; no unit or integration test suite exists | High |
| **Single-port assumption** | Port collision on 5199 handled by env var, but no automatic fallback port scanning | Low |
| **ROADMAP.md stale** | Phase 6 and Phase 8 still marked "In Progress" — minor but confuses future contributors | Low |

### Recommended Next Steps (Priority Order)

**1. Test Coverage (High Priority)**
Add at minimum:
- Unit tests for `extractor.py` and `validator.py` (pytest) — these are the highest-risk logic layers
- Integration tests for all 4 Flask routes with fixture documents
- Smoke test in CI that boots the Flask server and hits `/ping`

**2. State Persistence**
Move wizard state from `localStorage` to a proper user data file via `app.getPath('userData')` in the main process. localStorage is fragile in Electron (cleared by profile wipe, not user-visible).

**3. Backend Health & Recovery**
Add automatic backend restart on crash detection — currently the renderer has no recovery path if Python exits unexpectedly mid-session. Main process should monitor the child process and attempt one restart before surfacing an error.

**4. SAM.gov Key Expiry Warning**
Store key creation date alongside the key; surface an in-app warning banner when within 14 days of the 90-day expiry.

**5. Model Version Management**
Move `claude-sonnet-4-6` to a constants file or settings entry. This prevents a silent extraction failure if the model is deprecated without a code change.

**6. ROADMAP.md Cleanup**
Update Phase 6 and Phase 8 status to "Complete" to keep project docs consistent.

**7. Error Telemetry (Optional)**
Add local-only error logging (main process log file under `app.getPath('logs')`) for parse and generation failures. No remote telemetry — just on-disk logs the user can provide for support.

---

## Project Status

9-phase quality roadmap is **functionally complete** as of 2026-03-29.

Phase 8 UAT: **9/9 passed**.

Outstanding doc items only:
- `ROADMAP.md` Phase 6 + Phase 8 status lines need updating to "Complete"
- `08-06-PLAN.md` human verification checkbox (UAT already passed manually)

---

*SolQuoter is a local-only desktop application. No document content, extracted fields, or user data is transmitted to any remote server. The Anthropic API call (if configured) sends only extracted text snippets for field classification — no full documents.*
