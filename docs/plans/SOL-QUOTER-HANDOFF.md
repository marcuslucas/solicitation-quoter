# Sol-Quoter — Project Handoff & Model Onboarding Document

**Generated:** June 12, 2026  
**Git HEAD:** `a074e37` — Phase 10 Complete  
**Status:** Production-ready, all planned phases complete  
**Purpose:** Complete context handoff for new development sessions and model onboarding

---

## What This Document Is

This is a complete onboarding document for a new AI model or developer picking up
Sol-Quoter after a gap in development. It covers architecture, current state, completed
work, known issues, and the exact prompt to use for a professional audit session.

Read this fully before touching any file.

---

## 1. What Sol-Quoter Does

Sol-Quoter is an Electron + Flask desktop application that converts government
solicitation PDFs into formatted .docx quote response documents.

**The core workflow:**
1. User uploads a government solicitation PDF (and optionally a Statement of Work PDF
   and an XLSX pricing sheet)
2. The app extracts structured data: solicitation number, due date, contact info, NAICS
   code, line items, quantities, spec text, and provenance metadata
3. User reviews and corrects extracted fields in a structured form
4. User enters vendor/company details and per-item pricing
5. App generates a professionally formatted .docx quote document ready to submit

**Who uses it:** Small businesses responding to federal government solicitations on
SAM.gov. The tool eliminates manual data entry from complex government PDFs.

---

## 2. Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Electron 28 |
| Frontend | Vanilla JS, modular per-step files, no framework |
| Backend | Python Flask on localhost:5199 |
| PDF parsing | pdfplumber + pypdf |
| XLSX parsing | openpyxl |
| Quote output | python-docx |
| PDF viewing | PDF.js 3.32.2 (vendored locally, no CDN) |
| Packaging target | .exe (Windows NSIS) + .dmg (macOS) |
| AI extraction | Anthropic API (optional, key in .env) |

---

## 3. Directory Structure

```
solicitation-quoter/
├── electron/
│   ├── main.js               # Electron main process, IPC handlers
│   ├── preload.js            # contextBridge API exposure (18 methods)
│   ├── index.html            # Main UI shell + all CSS
│   ├── loading.html          # Splash screen
│   ├── pdfviewer.html        # PDF.js viewer window (458 lines)
│   ├── js/
│   │   ├── modules/
│   │   │   ├── state.js      # Centralized S object (single source of truth)
│   │   │   ├── step1.js      # Upload + parse (calls Flask /parse)
│   │   │   ├── step2.js      # Field review + AI extraction panel
│   │   │   ├── step3.js      # Line items table + vendor details
│   │   │   ├── step4.js      # Quote generation + download
│   │   │   └── index.js      # App bootstrapper
│   │   └── shared/
│   │       ├── utils.js      # Shared utilities
│   │       └── theme.js      # Theme persistence
│   └── vendor/pdfjs/         # Vendored PDF.js (pdf.js + pdf.worker.js)
├── python/
│   ├── server.py             # Flask routes (thin controllers)
│   ├── extractor.py          # PDF parsing + field extraction (~1300 lines)
│   ├── generator.py          # .docx generation (~280 lines)
│   ├── validator.py          # Field confidence scoring
│   ├── document_loader.py    # Multi-format bundle loader
│   └── constants.py          # Shared constants (MAX_UPLOAD_BYTES etc.)
├── testdata/
│   ├── run.py                # Test harness (6 fixtures, exit 0 required)
│   └── test_solicitations/   # 6 fixture directories with _expected_output.json
├── docs/
│   └── plans/                # All phase planning docs and completion notes
├── .env                      # API keys (gitignored)
├── .gitignore
└── package.json
```

---

## 4. Conventions (Enforce These)

**Python:**
- snake_case, 4-space indent
- `print()` for logging (no logging module)
- All dict reads use `.get("key", default)` — never bare `dict["key"]`
- Flask routes are thin: validate input, call extractor/generator, return JSON

**JavaScript:**
- camelCase, 2-space indent
- State is centralized in `window.S` (state.js) — never store app state in DOM
- IPC: always via `window.api` (contextBridge) — never `nodeIntegration`
- All fetch calls target `http://127.0.0.1:${window.S.port}/api/sol-quoter/...`

**CSS:**
- Semantic tokens only: `var(--color-*)`, `var(--space-*)`, `var(--text-*)`
- No hardcoded hex values in component CSS (hex only in :root token definitions)

**Architecture:**
- Backend is stateless per-request except for session files in `~/.sol-quoter/session/current/`
- No component talks to another component directly — everything goes through `window.S`
- Plans written to `docs/plans/` before implementation (maintained throughout development)

---

## 5. Central State Object (window.S)

```javascript
const S = {
  step: 1,
  done: new Set(),
  port: null,             // Flask port (5199)
  apiKey: '',             // Per-session Anthropic key (optional)
  samKey: '',
  samNoticeId: '',
  file: null,             // Uploaded file reference
  filePath: null,
  extracted: {},          // Parsed solicitation data (set by step1.js after /parse)
  parseConfidence: null,  // Phase 7: parse quality score (separate from field validator)
  vendor: {
    company_name: '', address: '', city_state_zip: '', phone: '', email: '',
    website: '', prepared_by: '', title: '', quote_number: '', sam_uei: '',
    validity_period: '30 days', freight: '', tax_rate: '', notes: '',
    terms: 'Net 30. FOB Destination. Vendor certifies SAM.gov registration...',
    logo_b64: '', logo_ext: '', logo_name: '',
    delivery_days: '',
    option_years_enabled: false,
    option_years: [],
    line_item_schema: 'standard',  // Phase 10: 'standard'|'apparel'|'services'
    include_signature: true,       // Phase 10: toggle signature block in docx
    include_notes: true,           // Phase 10: toggle notes/terms in docx
  },
  aiUsage: { calls: 0, tokens: 0 }, // Phase 8: AI extraction usage tracking
  items: []               // Line items array
}
```

**Key separation to know:**
- `window.S.confidence` — field-level validation score from `validator.py` (exists since early phases)
- `window.S.parseConfidence` — parse quality score from `compute_confidence()` in extractor.py (added Phase 7)
- These are intentionally separate and must never overwrite each other

---

## 6. Supported Solicitation Formats

| Format key | Description | Example |
|-----------|-------------|---------|
| `sf1449` | Standard Form 1449 (most common DoD/civilian) | 70B06C26Q00000080 |
| `sam_export` | SAM.gov Combined Synopsis/Solicitation export PDF | W911S225U14310001 |
| `agency_form` | Agency-specific form (VA, etc.) | 36C24225Q0696 |
| `formal_rfq` | Formal Request for Quotation | request-for-quotation |

Format detection uses a scoring system in `detect_format()` in extractor.py.
Unknown formats return `'unknown'` and trigger a low confidence score.

---

## 7. Session Persistence

Session files live at `~/.sol-quoter/session/current/`.

The session directory contains:
- `manifest.json` — maps file roles (main, sow, pricing) to filenames
- The uploaded documents themselves (PDF, XLSX)

Session is cleared at the start of each new `/parse` call.
Session is NOT cleared on app quit (by design — allows session resume).
The `read-file-as-array-buffer` IPC handler in main.js enforces path traversal
protection: only files within the session directory can be read.

---

## 8. IPC Architecture

All renderer→main communication goes through `window.api` (contextBridge).
**Never use nodeIntegration. Never use remote module.**

Key IPC channels:
| Channel | Direction | Purpose |
|---------|-----------|---------|
| `open-pdf-viewer` | invoke | Opens pdfviewer.html with file + page + bbox params |
| `navigate-to-bbox` | main→renderer push | Navigates existing viewer to new page/bbox |
| `read-file-as-array-buffer` | invoke | Session-dir-restricted file read for PDF.js |
| `get-session-file-path` | invoke | Resolves filename to full session path |
| `open-path` | invoke | Opens a file with the OS default app |

The PDF viewer window (`pdfviewer.html`) shares `preload.js` with the main window.
`main.js` tracks the viewer window reference as `let viewerWin = null` (module scope).
The `closed` event on viewerWin nulls the reference, preventing ghost window references.

---

## 9. Extraction Pipeline

```
Upload files
    ↓
document_loader.py — classifies files by role (main/sow/pricing)
    ↓
extractor.py: parse_solicitation_bundle()
    ├── detect_format() — scores document against 4 known patterns
    ├── extract_{format}() — format-specific field extraction
    ├── extract_sow_line_items() — SOW text → structured line items
    ├── _extract_clin_items() — CLIN table fallback
    ├── XLSX merge — merges pricing sheet quantities/prices into line items
    ├── _assemble_warnings() — Phase 6: builds extraction_warnings list
    └── compute_confidence() — Phase 7: overall/format/fields/items scores
    ↓
server.py: /api/sol-quoter/parse — returns full result dict to frontend
    ↓
step1.js — stores result in window.S.extracted + window.S.parseConfidence
```

**Line item enrichment fields** (every item has all of these):
`sow_section`, `spec_text`, `source_page`, `source_file`, `_source`,
`qty_total`, `manufacturer_ref`, `part_number`, `quantities_by_period`

**`_source` values and their confidence mapping:**
- `"SOW+XLSX"` → 1.0 (best: spec text from SOW, pricing from XLSX)
- `"SOW"` or `"XLSX"` → 0.7
- `"CLIN"` → 0.4 (CLIN table fallback)
- single placeholder → 0.1

---

## 10. Confidence Scoring System (Phase 7)

`compute_confidence(result)` in extractor.py returns:

```python
{
  "overall": 0.82,           # Weighted average (0.0–1.0)
  "format_detection": 1.0,  # 1.0=known / 0.5=partial / 0.0=unknown
  "required_fields": 0.75,  # Fraction of 4 required fields non-empty
  "line_items": 0.9,         # Based on _source values
  "warnings": [...],         # Copy of extraction_warnings
  "reasons": [...]           # Human-readable explanation of score
}
```

Weight constants (adjustable in extractor.py):
- `_CONF_WEIGHT_FORMAT = 0.3`
- `_CONF_WEIGHT_FIELDS = 0.4`
- `_CONF_WEIGHT_ITEMS = 0.3`

Step 2 renders a three-state banner:
- Green (≥ 0.8): subtle indicator
- Amber (0.5–0.79): visible warning with reasons list
- Red (< 0.5): prominent banner, AI extraction panel auto-expands

---

## 11. AI-Assisted Extraction (Phase 8)

**Architecture (locked — do not change these decisions):**
- User-triggered only — no silent AI usage
- Panel hidden entirely when `ANTHROPIC_API_KEY` is blank in `.env`
- Call counter `_ai_call_count` in server.py memory — resets on restart
- Multi-chunk line item extraction counts as ONE call against limit
- Text sent: first 4000 chars for headers, SOW text in 6000-char chunks for line items
- AI result shown in diff view — user accepts/discards per field
- Accepted changes write to `window.S.extracted` via direct DOM input update
  (not full re-render, to avoid flash)

**Server-side endpoints added:**
- `GET /api/sol-quoter/ai-status` → `{available: bool, calls_remaining: int}`
- `POST /api/sol-quoter/extract-ai` → `{result, tokens_used, model, target}`

**`.env` keys:**
```
ANTHROPIC_API_KEY=
AI_MAX_CALLS=10
AI_HEADER_MODEL=claude-haiku-4-5-20251001
AI_LINE_ITEM_MODEL=claude-sonnet-4-6
```

---

## 12. PDF Viewer + BBox Wiring (Phase 9)

The PDF viewer (`pdfviewer.html`) is a full 458-line implementation:
- PDF.js canvas render with text layer
- Toolbar: prev/next/zoom/page indicator
- Search highlight via `sol-highlight` CSS class
- Keyboard shortcuts (arrow keys, +/-, Escape)
- Security: reads files via session-dir-restricted IPC only

**BBox overlay (Phase 9):**
When a user clicks a flagged field in Step 2, the PDF viewer opens to the
source page and draws a blue dashed rectangle over the field's bounding box.

Coordinate conversion (PDF space → canvas pixels):
```javascript
const left   = bbox.x0 * currentScale
const top    = currentViewport.height - bbox.y1 * currentScale
const width  = (bbox.x1 - bbox.x0) * currentScale
const height = (bbox.y1 - bbox.y0) * currentScale
```

PDF coordinate space: origin bottom-left, y increases upward.
Canvas coordinate space: origin top-left, y increases downward.
This is why `(H - y1)` is used for the canvas top, not `y0`.

---

## 13. .docx Output Schemas (Phase 10)

Three line item column layouts selectable in Step 3:

| Schema | Columns | Use case |
|--------|---------|---------|
| `standard` | # \| Description \| Size/Type \| UOM \| Qty \| Unit Price \| Total | Default |
| `apparel` | # \| Description \| Color \| Size \| UOM \| Qty \| Unit Price \| Total | Clothing/gear |
| `services` | # \| Description \| Period \| UOM \| Qty \| Unit Price \| Total | Service contracts |

All schemas sum to exactly 6.00" (Letter page minus 1.25" margins each side).
`#` column is 0.5" (widened in Phase 10 from 0.35" to prevent 3-digit overflow).

Section toggles (Output Settings card in Step 3):
- `include_signature` (default: true) — signature block in generated .docx
- `include_notes` (default: true) — notes/terms section in generated .docx

---

## 14. Test Harness

```bash
python testdata/run.py
```

6 fixtures, all must pass, exit code 0 required before any phase is marked complete.

| Fixture | Format | Line items | Notes |
|---------|--------|-----------|-------|
| 18Q0042 | sf1449 | 0 | 2018 Navy solicitation |
| 36C24225Q0696 | agency_form | 0 | VA medical, known place_of_performance partial match |
| 70B06C26Q00000080 | sf1449 | 118 | LLSM bundle, SOW+XLSX merge |
| N5005426Q0114_CSS_03312026 | sam_export | 0 | Navy pipes/fittings |
| request-for-quotation | formal_rfq | 0 | |
| W911S225U14310001_CSS_08062025 | sam_export | 0 | Army, amendment concatenation fix |

Known permanent warning (not a regression):
- `36C24225Q0696`: `place_of_performance` WARN — extractor returns Batavia VA address,
  expected has Buffalo VA. Multi-address document, known limitation.

---

## 15. Known Gaps and Open Items

From the post-Phase-10 state:

1. **`scrollPdfToBoundingBox`** — Phase 9 replaced the no-op stub. Verify it is
   functioning correctly by clicking a flagged field in Step 2.

2. **Phase 8 AI extraction not yet manually tested end-to-end** — the API key was
   left blank during development. Full manual test (Test 3 from Phase 8 validation)
   has not been run against a real Anthropic API key.

3. **5 new SAM.gov fixtures** — Phase 9 called for acquiring 5 new fixture PDFs
   covering edge cases (apparel, medical CLIN, IT services, IDIQ, SAM inline CLIN).
   These were never acquired. Test coverage remains at 6 fixtures.

4. **Phase 9 missing from git log** — the commit history shows Phase 8 → Phase 10
   directly. Phase 9 changes (BBox wiring, test coverage) are present in the code
   but were committed as part of Phase 10.

5. **`place_of_performance` multi-address** — 36C24225Q0696 returns a partial match.
   The extractor captures the first address but misses multi-address documents.
   Documented as known limitation in CLAUDE.md.

---

## 16. Development Workflow (How This Project Was Built)

Every phase followed this strict pattern:
1. **Planning prompt** → CC reads all relevant files, runs live diagnostics, produces
   an implementation plan with line-level insertion points
2. **Plan written to disk** → `docs/plans/phase-N-planning-output.md`
3. **Human reviews plan** — flags issues, approves or blocks before implementation
4. **Implementation prompt** → CC implements exactly what the plan specifies
5. **Validation** → all tests pass including `python testdata/run.py` exit 0
6. **Git commit** → phase committed before moving to next

This two-phase workflow caught real bugs before they became code:
- Phase 7: prevented `window.S.sol` / `window.S.extracted` naming collision
- Phase 8: prevented API key leaking in URL query parameters
- Phase 9: caught wrong function signature for scrollPdfToBoundingBox

**Do not skip the planning phase.** Do not implement from memory or assumption.
Read the actual files first, then plan, then implement.

---

## 17. Files That Must Never Be Modified Without a Plan

These files are load-bearing. Changes without a prior diagnostic have caused
problems in past sessions:

- `python/extractor.py` — 1300+ lines, multiple interdependent extraction paths
- `electron/main.js` — IPC handlers, window management, process lifecycle
- `electron/preload.js` — contextBridge surface; changes affect both windows
- `python/generator.py` — .docx output; breakage is invisible until Word is opened
- `electron/js/modules/state.js` — state schema; missing keys cause silent failures

---

## 18. Phase History Summary

| Phase | What Was Done | Key Files Changed |
|-------|--------------|------------------|
| 1–3 | Line item confidence plan | extractor.py, step1-3.js |
| 4–5 | Line item enrichment fields, test harness | extractor.py, run.py |
| 6 | Extractor hardening: W911 truncation fix, SAM export fingerprints, extraction_warnings | extractor.py |
| 7 | Confidence scoring: compute_confidence(), three-state banner in Step 2, reasons list | extractor.py, step2.js, index.html |
| 8 | AI-assisted extraction: /extract-ai endpoint, AI panel UI, diff view, merge logic | server.py, step2.js, state.js |
| 9 | BBox wiring: scrollPdfToBoundingBox live, single-window viewer, overlay coordinate math | main.js, preload.js, pdfviewer.html, step2.js |
| 10 | Column resize, .docx schemas (apparel/services), Output Settings toggles, # overflow fix | step3.js, generator.py, state.js, index.html |

---

## 19. Prompt for New Model Audit Session

Use the following prompt to onboard a new model (Fable 5 or Opus 4.8) for a
professional audit. Paste it as the first message in a new Claude Code session.

---

```
Read this handoff document first, then read every file listed below in full
before responding. Do not write any code. Do not modify any files.

HANDOFF DOCUMENT: docs/plans/SOL-QUOTER-HANDOFF.md

READ THESE FILES IN FULL:

Python backend:
  - python/server.py
  - python/extractor.py
  - python/generator.py
  - python/validator.py
  - python/document_loader.py
  - python/constants.py

Electron frontend:
  - electron/main.js
  - electron/preload.js
  - electron/index.html
  - electron/pdfviewer.html
  - electron/js/modules/state.js
  - electron/js/modules/step1.js
  - electron/js/modules/step2.js
  - electron/js/modules/step3.js
  - electron/js/modules/step4.js
  - electron/js/shared/utils.js
  - electron/js/shared/theme.js

Tests:
  - testdata/run.py

Then run the test suite and show full output:
  python testdata/run.py

YOUR ROLE:

You are a senior software engineer performing a professional pre-delivery audit
of Sol-Quoter, a production desktop application. The developer is preparing to
deliver this to a client and wants it to be as close to professional production
quality as possible.

This is a REPORT-ONLY audit. Do not fix anything. Flag everything.

Produce a written audit report covering every category below. For each finding,
state the file, the line number(s), the severity (Critical / High / Medium / Low),
and a clear description of the issue and why it matters. If you find nothing in a
category, state "None found."

Write the complete audit report to docs/plans/final-project-audit.md before
finishing your response.

AUDIT CATEGORIES:

1. SECURITY
   - Any nodeIntegration: true in BrowserWindow constructors
   - Any eval() calls anywhere
   - innerHTML assignments that use user-controlled data without escaping
   - File paths constructed from user input without sanitization
   - API keys, secrets, or credentials hardcoded outside .env
   - Path traversal vulnerabilities in file read handlers
   - IPC channels that accept arbitrary file paths from the renderer
   - CORS or localhost-binding issues in the Flask server
   - Any data sent to external services without explicit user consent
   - Electron security best practices: contextIsolation, sandbox, webSecurity

2. ERROR HANDLING
   - try/catch blocks with empty catch bodies (silently swallowing errors)
   - Flask routes that do not validate or sanitize request body fields
   - File reads or JSON.parse() calls without error handling
   - IPC handlers that do not handle exceptions (uncaught would crash main process)
   - Fetch calls in frontend with no .catch() or try/catch
   - Python functions that could throw on malformed input and are not guarded
   - Missing null/undefined checks before property access on objects that could be null

3. CODE QUALITY
   - Functions over 150 lines that are candidates for decomposition
   - Duplicate logic across files that should be a shared utility
   - Magic numbers or hardcoded strings that should be named constants
   - Inconsistent naming conventions (camelCase vs snake_case in wrong context)
   - Dead code: functions defined but never called, variables never read
   - Commented-out code blocks
   - TODO/FIXME comments — list each one
   - No-op stubs that were supposed to be replaced (check scrollPdfToBoundingBox
     was properly implemented in Phase 9)

4. ARCHITECTURE AND DESIGN
   - Any component that bypasses window.S and stores state in the DOM directly
   - Any renderer code that uses nodeIntegration or accesses Node APIs directly
   - Flask routes doing business logic that belongs in extractor/generator/validator
   - IPC channels that could be consolidated or are redundant
   - Any tight coupling between step modules (step1 calling step2 functions, etc.)
   - The vendor profile localStorage key 'vendor' is unnested while col-widths uses
     'sol-quoter:col-widths' — flag this inconsistency if present
   - Session file cleanup: are temp files cleaned up on parse failure or only on
     next successful parse?

5. PERFORMANCE
   - Any synchronous file reads on the main process that could block the UI
   - Large files read entirely into memory when streaming would be more appropriate
   - Any polling patterns (setInterval) that are not cleaned up
   - Re-renders triggered more frequently than necessary
   - localStorage reads inside render loops

6. ELECTRON-SPECIFIC
   - Is the app correctly preventing multiple instances (single instance lock)?
   - Does the app handle macOS 'activate' event correctly (re-open on dock click)?
   - Are all BrowserWindow instances properly destroyed on app quit?
   - Is the Python backend process guaranteed to terminate on app quit on Windows?
     (taskkill vs graceful shutdown — Windows is known to be problematic here)
   - Are there memory leaks from IPC listeners that are added but never removed?
   - Does pdfviewer.html properly handle the case where PDF.js fails to load?

7. PYTHON BACKEND
   - Are all Flask routes protected against large payload attacks?
     (check MAX_UPLOAD_BYTES enforcement)
   - Is the Flask server running in debug mode? (must be False for production)
   - Are there any bare except: clauses in Python code?
   - Does the extractor handle completely empty PDFs gracefully?
   - Does the extractor handle password-protected PDFs gracefully?
   - Are there any global mutable state variables in server.py beyond _ai_call_count?
   - Is python-docx producing documents that open correctly in both Word and
     LibreOffice? (check for any known compatibility issues in generator.py)

8. TESTING
   - Which code paths in extractor.py are not covered by any fixture?
   - Are there extraction functions that have no test at all?
   - Does run.py test anything about the generator output, or only parsing?
   - Are there integration-level gaps (e.g. the full parse→generate pipeline
     is never tested end-to-end in the test harness)?

9. PHASE COMPLETION VERIFICATION
   Verify each of these specific items is correctly implemented:
   - Phase 6: extraction_warnings assembled in BOTH extract_data() AND
     parse_solicitation_bundle() — confirm both call sites exist
   - Phase 7: window.S.parseConfidence set in step1.js, does NOT overwrite
     window.S.confidence — confirm the two keys coexist
   - Phase 8: _ai_call_count increments AFTER the API call succeeds, not before
     — confirm placement relative to the try/except block
   - Phase 8: AI panel completely hidden (not just collapsed) when
     ANTHROPIC_API_KEY is absent — confirm the gate condition
   - Phase 9: scrollPdfToBoundingBox is no longer a no-op — show the actual
     implementation and confirm it calls window.api.openPdfViewer with bbox
   - Phase 9: viewerWin.on('closed') handler nulls viewerWin — confirm it exists
   - Phase 10: add_table() uses cols=len(hdrs) — confirm not hardcoded to 7
   - Phase 10: include_signature conditional wraps ONLY the signature content,
     not the trailing blank paragraph or validity footer — confirm the indentation

10. PRODUCTION READINESS
    - Is there any console.log() debug output that should be removed before
      delivery? List every one found.
    - Are there any development-only flags, hardcoded localhost URLs, or
      dev-mode shortcuts in the code?
    - Is the app version in package.json up to date and meaningful?
    - Are there any npm packages in package.json that are outdated or have
      known vulnerabilities? (list any that you can identify)
    - Are there any Python packages in requirements.txt that are outdated?
    - Is there a user-facing error message for every failure mode, or do some
      failures die silently?
    - Is the .env file documented anywhere for the client? (a .env.example file)
    - Is there a README that covers installation and first-run setup?

KNOWN PERMANENT ISSUES (do not flag these as new findings):
  - 36C24225Q0696 place_of_performance WARN — known multi-address limitation
  - Phase 8 AI extraction has not been manually tested with a real API key

AUDIT OUTPUT FORMAT:

Structure the report as:

  # Sol-Quoter — Professional Audit Report
  ## Date: [today]
  ## Git HEAD: a074e37

  ## Executive Summary
  [Total findings by severity. Overall assessment: is this deliverable as-is,
   or are there blockers?]

  ## Critical Findings
  [Anything that is a security vulnerability, data loss risk, or crash condition]

  ## High Findings
  [Significant quality issues that should be fixed before client delivery]

  ## Medium Findings
  [Code quality, consistency, and robustness issues worth addressing]

  ## Low Findings
  [Minor polish items, suggestions, nice-to-haves]

  ## Phase Completion Verification
  [Pass/Fail for each of the 8 specific checks in Category 9]

  ## Recommended Fix Order
  [Prioritized list: fix these first, in this order, before delivery]

Do not write any code. Do not modify any files.
Write the complete report to docs/plans/final-project-audit.md before finishing.
```

---

## 20. After the Audit

Once the audit report is in `docs/plans/final-project-audit.md`, bring it back
to a human review session (this chat or a new one) before fixing anything.

The audit findings should be triaged:
- **Critical / High:** Fix before client delivery
- **Medium:** Fix if time allows, document if not
- **Low:** Backlog for future phase

For each fix: follow the same planning → review → implementation workflow
used throughout Phases 6–10. Do not fix audit findings inline during the
audit session itself.

---

*End of handoff document.*
*Sol-Quoter — Phases 1–10 complete — June 12, 2026*
