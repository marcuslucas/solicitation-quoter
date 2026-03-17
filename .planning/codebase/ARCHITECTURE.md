# Architecture

**Analysis Date:** 2026-03-17

## Pattern Overview

**Overall:** Client-Server Desktop Application (Electron + Python Flask)

**Key Characteristics:**
- Monolithic desktop UI (single HTML file) bundled with Electron
- Lightweight HTTP-based communication between frontend and backend
- Backend spawned as child process during app startup
- Rule-based extraction with optional Claude AI enhancement
- Document generation with python-docx

## Layers

**Presentation Layer (Electron Renderer):**
- Purpose: Renders the UI and handles user interactions
- Location: `electron/index.html` (2122 lines, self-contained)
- Contains: HTML, inline CSS with theming support, vanilla JavaScript
- Depends on: IPC bridge to Electron main process (via `window.api`)
- Used by: End users

**Electron Main Process (Native Bridge):**
- Purpose: Manages window lifecycle, spawns backend, exposes system APIs
- Location: `electron/main.js` (271 lines)
- Contains: Window management, file dialogs, IPC handlers, API key storage (encrypted)
- Depends on: Node.js, Electron APIs
- Used by: Renderer via IPC; spawns backend process

**Backend Application Layer (Python Flask):**
- Purpose: Document parsing, solicitation data extraction, quote generation
- Location: `python/server.py` (637 lines)
- Contains: Three main routes (/parse, /generate_quote, /sam_lookup), extraction logic
- Depends on: Flask, pdfplumber, pypdf, python-docx, Anthropic SDK
- Used by: Renderer via HTTP fetch

## Data Flow

**Document Upload → Quote Generation:**

1. **User uploads document**
   - Renderer calls `window.api.openFile()` → native file picker → user selects PDF/DOCX/TXT
   - Renderer receives file path (not file data)

2. **Extract solicitation data**
   - Renderer POSTs file to `http://127.0.0.1:5199/parse` with optional API key
   - Backend `parse_route()`:
     - Saves multipart file to temp location
     - Parses text using `parse_document()` (PDF → pdfplumber/pypdf, DOCX → python-docx, TXT → raw)
     - Calls `extract_data()`:
       - Rule-based regex extraction via `extract()` function (pattern matching against solicitation fields)
       - If API key provided: calls Claude Sonnet 4.6 via `ai_extract()` for enhanced extraction
       - Merges results (AI wins on conflicts)
     - Calls `extract_line_items()` to derive line items from quantities, CLIN blocks, or AI results
   - Returns JSON: `{ solicitation, line_items, _method: "rules|ai+rules|sam_gov" }`

3. **User edits fields**
   - Renderer displays extracted data in step 2 (solicitation review)
   - User can manually edit any field in-place

4. **User enters vendor info**
   - Step 3: Company name, address, phone, email, website, SAM UEI, quote number, validity period, etc.
   - Supports logo upload via `window.api.pickLogo()` → base64 encoding

5. **User builds line items**
   - Step 4: Add/edit/delete line items (description, size, unit, qty, unit_price)
   - Can import from extracted data or manually create

6. **Generate and download quote**
   - Renderer POSTs to `http://127.0.0.1:5199/generate_quote` with JSON body containing solicitation, vendor, line_items
   - Backend `gen_route()`:
     - Calls `generate_quote()` which builds a `.docx` document using python-docx
     - Formats with company logo, header tables, solicitation info, scope, line items table, totals, option year pricing, signature block
     - Returns binary `.docx` data
   - Renderer receives bytes, calls `window.api.saveQuote({ bytes, name })` → native save dialog → file written to disk

**SAM.gov Lookup Flow:**

1. User provides notice ID and SAM.gov API key in Step 1 (optional)
2. Renderer POSTs to `http://127.0.0.1:5199/sam_lookup`
3. Backend queries SAM.gov API with date range, extracts opportunity data
4. Returns pre-filled solicitation with line items

**State Management:**

- **Renderer state:** Wizard step position, extracted solicitation data, vendor info, line items, theme preference (localStorage)
- **Backend state:** None (stateless HTTP); temporary files cleaned up after parsing
- **API key storage:** Encrypted via Electron's `safeStorage.encryptString()` on supported platforms; stored in `userData` directory

## Key Abstractions

**Document Parser:**
- Purpose: Extract text from multiple file formats
- Examples: `parse_pdf()`, `parse_docx()`, `parse_document()`
- Pattern: Polymorphic by file extension; graceful fallback (pdfplumber → pypdf for PDFs)

**Solicitation Extractor:**
- Purpose: Convert unstructured text to structured solicitation object
- Examples: `extract()` (rules-based), `ai_extract()` (AI-based), `extract_line_items()`
- Pattern: Regex-based field matching with multi-pattern fallback; line item derivation hierarchy (AI items > quantities > CLIN blocks > fallback single item)

**Quote Generator:**
- Purpose: Build formatted `.docx` document from solicitation + vendor + line items
- Examples: `generate_quote()` with nested helpers (`bg()`, `run()`, `heading()`, `fmt_num()`)
- Pattern: Table-based layout; helper functions for styling consistency

**IPC Bridge:**
- Purpose: Expose safe system APIs to untrusted renderer
- Examples: `window.api.openFile()`, `window.api.saveQuote()`, `window.api.storeApiKey()`
- Pattern: Context isolation with `contextBridge` (no `nodeIntegration`)

## Entry Points

**Electron Main Process:**
- Location: `electron/main.js` (spawned by `npm start`)
- Triggers: Package.json `"main": "electron/main.js"`
- Responsibilities: Create window, start backend, expose IPC handlers

**Renderer Entry:**
- Location: `electron/index.html`
- Triggers: Electron loads after backend `/ping` responds
- Responsibilities: 5-step wizard (upload, review solicitation, vendor info, line items, generate quote)

**Backend Entry:**
- Location: `python/server.py`
- Triggers: Spawned by main process (dev: `python3 python/server.py`, packaged: binary from `dist-backend/`)
- Responsibilities: Parse documents, extract data, generate quotes, proxy to SAM.gov

**Backend Routes:**
- `GET /ping` — Health check (no auth)
- `POST /parse` — Document upload & extraction (requires `file` field; optional `api_key`)
- `POST /generate_quote` — Quote generation (requires JSON: `solicitation`, `vendor`, `line_items`)
- `POST /sam_lookup` — SAM.gov lookup (requires `notice_id` and `sam_api_key`)

## Error Handling

**Strategy:** Graceful degradation with user-facing error pages

**Patterns:**

- **Backend startup failure:** Main process loads `electron/error.html` after 30 retries to `/ping`
- **Document parsing failure:** Backend returns JSON `{ error: "..." }` (400/500); renderer displays alert
- **AI extraction failure:** Backend logs error, falls back to rules-only extraction
- **File I/O:** Temp files cleaned up in `finally` blocks; dialogs can be canceled (returns `{ canceled: true }`)
- **API key storage:** Tries encrypted storage first; falls back to plaintext `.plain` file if unavailable

## Cross-Cutting Concerns

**Logging:** All output via `console.log()` / `console.error()`. Backend prefixes with `[backend]` or `[backend error]`. No centralized log aggregation.

**Validation:** Backend validates file types by extension; truncates text to 14K characters before AI extraction; `fmt_num()` safely parses quantities and prices (rejects NaN).

**Authentication:** API keys (Claude, SAM.gov) passed per-request in request body; no session management. Electron's `safeStorage` encrypts Claude API key at rest.

**Security:** Renderer isolated (`contextIsolation: true`, `nodeIntegration: false`). Backend allows CORS only from `http://127.0.0.1:5199`. File dialogs require user interaction. No arbitrary code execution.

**Performance:** Single-threaded Electron window; backend processes requests sequentially. Quote generation is synchronous (acceptable for <100 line items). No caching of parsed documents.

---

*Architecture analysis: 2026-03-17*
