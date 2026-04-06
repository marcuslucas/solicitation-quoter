# Solicitation Quoter — Project Handoff

## What It Does

Desktop app (Electron + Python Flask) that converts government solicitation documents into formatted quote `.docx` files. Users upload a PDF/DOCX/TXT, review AI-extracted fields, add vendor info and line items, then download a professional quote.

## Stack

| Layer | Technology |
|-------|-----------|
| UI | Electron + HTML/CSS/JS (modular, per-step JS files) |
| Backend | Python Flask (port 5199, configurable via `PORT` env var) |
| Parsing | pdfplumber, pypdf, python-docx |
| AI extraction | Claude `claude-sonnet-4-6` via Anthropic API |
| Quote output | python-docx `.docx` generation |
| Packaging | electron-builder (Windows NSIS / macOS DMG) |

## Key Files

| File | Role |
|------|------|
| `electron/main.js` | Spawns backend, manages IPC, handles quit/cleanup |
| `electron/preload.js` | Exposes `window.api` (getPort, openFile, saveQuote, openUrl, pickLogo) |
| `electron/index.html` | App shell — loads per-step JS modules |
| `electron/js/modules/` | step1–step5 + shared utilities + state |
| `python/server.py` | Thin Flask controller (ping, parse, generate_quote, sam_lookup) |
| `python/extractor.py` | Regex + AI field extraction, confidence scoring |
| `python/validator.py` | Per-field confidence scoring, flag output |
| `python/generator.py` | `.docx` quote builder |

## Run

```bash
npm start          # dev (auto-spawns Python backend)
npm run build:win  # package for Windows
```

## Current State

9-phase quality roadmap is **functionally complete**. Phase 8 UAT passed 9/9 tests. Phase 6 verification plan and Phase 8 final checkpoint are the only unchecked items in the roadmap — all features are working.
