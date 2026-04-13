# Solicitation Quoter

Desktop app (Electron + Python Flask) that converts government solicitation PDFs into formatted `.docx` quote documents. Upload a solicitation → review extracted fields → add vendor info → generate quote.

## Directory Structure

```
electron/                    # Electron desktop app
  main.js                    — Main process: spawns backend, IPC, window lifecycle
  preload.js                 — Context-isolated IPC bridge (window.api)
  index.html                 — App shell, loads JS modules
  js/modules/
    state.js                 — Wizard state object (S), localStorage persistence
    step1.js                 — Upload + parse + SAM.gov lookup
    step2.js                 — Review extracted fields, confidence badges, PDF viewer
    step3.js                 — Vendor info + line items table + CSV import
    step4.js                 — Generate quote + download
    index.js                 — Bootstrapper, step wiring, cross-cutting (settings, profiles, modals)
    shared/utils.js          — API calls, formatting helpers, render(), esc()
    shared/theme.js          — Theme switching, CSS variable application
  loading.html               — Startup splash
  error.html                 — Backend startup failure fallback

python/                      # Flask backend (port 5199, configurable via PORT env var)
  server.py                  — Thin Flask controllers: /ping, /parse, /generate_quote, /sam_lookup
  extractor.py               — Regex field extraction + optional Claude AI extraction
  validator.py               — Per-field confidence scoring (0-100), flag generation
  generator.py               — .docx quote builder via python-docx
  constants.py               — Shared constants (port, max sizes, field names, SCORED_FIELDS)

docs/                        # Project documentation (context files)
  architecture.md            — System design, data flow, process model, security boundaries
  conventions.md             — Naming, code style, import order, error handling patterns
  integrations.md            — External APIs (Anthropic Claude, SAM.gov, Google Fonts)
  requirements.md            — v1 requirements (all complete), v2 backlog
  roadmap.md                 — Completed phases, active work, next priorities
  field-mapping.md           — Solicitation format definitions and field extraction patterns

testdata/                    # Manual test fixtures
  run.py                     — CLI test harness for extraction + generation
  quote_input.json           — Sample vendor + line items
  solicitation.txt           — Sample solicitation text
  test_solicitations/
    (W911S2..., N50054...), SAM-export format extracts correctly,
    (36C24225Q0696),        Agency form format  — all fields broken (see field-mapping.md),
    (request-for-quotation.pdf / 69056725Q000044), Formal RFQ format  — untested
```

## Tech Stack

| Layer         | Tech                                                         |
| ------------- | ------------------------------------------------------------ |
| UI            | Electron 28.3 + vanilla HTML/CSS/JS (modular per-step files) |
| Backend       | Python Flask on localhost:5199                               |
| PDF parsing   | pdfplumber (primary), pypdf (fallback)                       |
| DOCX parsing  | python-docx                                                  |
| AI extraction | Claude claude-sonnet-4-6 via Anthropic SDK (optional)        |
| Quote output  | python-docx .docx generation                                 |
| Packaging     | electron-builder (Win NSIS / macOS DMG) + PyInstaller        |

## Conventions

- **Python**: snake_case functions/variables, 4-space indent, print() for logging
- **JavaScript**: camelCase functions/variables, 2-space indent, console.log/error for logging
- **State**: Centralized `S` object in state.js; step modules read/write `window.S`
- **Events**: All via addEventListener, no inline handlers. data-\* attributes for delegation
- **CSS**: Semantic tokens only (--color-_, --space-_, --text-\*). No hardcoded hex/px outside :root
- **IPC**: All system APIs via window.api (preload.js contextBridge). Never nodeIntegration
- **Backend**: Thin controllers in server.py. Logic in extractor.py, generator.py, validator.py
- **Errors**: Python returns {error: "message"} with HTTP status. JS shows specific actionable messages
- **Tests**: No automated tests yet (v2 backlog). Manual testing via testdata/run.py

## Current State (as of Phase 10 start)

### What's working

- SAM-export format (W911S2.., N50054..) extracts correctly
- Full wizard flow: upload → review → vendor info → generate .docx
- SAM.gov lookup, confidence badges, PDF viewer (inline, pre-fix)

### What's not working

- Agency form format (36C24225Q0696) — all fields broken (see field-mapping.md)
- Formal RFQ format (request-for-quotation.pdf / 69056725Q000044) — untested
- Scope truncation expand-in-place (step2.js)
- PDF viewer opens inline instead of separate window (step2.js), button opens default machine PDF src

### Phase 10 complete

- Multi-format parser working in production (100% confidence on both test solicitations)
- Zombie process issue documented: always run taskkill on old python
  processes if extraction reverts to broken results after code changes
- UI fixes complete: scope toggle in-place, PDF opens via shell.openPath()
- Minor formatting gaps remain (due_date timezone suffix, multi-address
  place_of_performance, full period_of_performance) — queued for next session

## Active Priorities

### CRITICAL — Phase 10: Multi-Format Parser (NEW)

The extractor currently handles SAM.gov-style structured solicitations well but fails on other formats.
Three confirmed format types need support:

1. **SAM-export** (W911S2.., N50054..): Clean key-value pairs on labeled pages → WORKING
2. **Agency form** (36C242..): Structured header table on page 1 + flowing prose → BROKEN (see docs/field-mapping.md)
3. **Formal RFQ** (690567..): Cover page + lettered sections (A/B/C/D/E) with data in prose → NOT TESTED

Parser architecture: format detection → strategy selection → format-specific extraction → generic fallback → confidence scoring.
No AI dependency — all extraction must work with regex/rules only for privacy (documents stay local).

Read docs/field-mapping.md before touching extractor.py.

### CRITICAL — UI Fixes

1. **Scope truncation expand-in-place**: Currently opens second element below. Fix: single element with state toggle
2. **PDF viewer as separate window**: Replace inline viewer with button → window.open() with blob URL

### UI Bug 1: Scope truncation expand-in-place (step2.js)

**Current behavior**: Scope of work field is truncated with a "show more"
link. Clicking it inserts a second expanded element below instead of
replacing the truncated text in-place.
**Screenshot**: testdata/test_solicitations/36C24225Q0696/36C24225Q0696_truncation_bug.png
**Expected**: Single element toggles between truncated/full text.
No duplicate element. Button label changes "Show more" ↔ "Show less".
**Location**: step2.js, look for scope/truncat/expand in function names.

### UI Bug 2: PDF viewer separate window (step2.js)

**Current behavior**: PDF renders inline in the review step.
**Expected**: A "View PDF" button opens window.open() with a blob URL.
Inline viewer removed entirely.
**Location**: step2.js, look for PDF/viewer/embed/iframe references.

### NEXT — Workspace Architecture

- docs/ context files are the source of truth for each domain
- .planning/phases/ is historical archive only — never load these files
- This file (claude.md) is always read first

### Test Fixtures

Each folder in testdata/test_solicitations/ contains:

- The PDF
- \_expected_output.json — ground truth for that format - SAM-export format (W911S2.., N50054..) no expected output, works well
- \_failed_parse.png — screenshot of current wrong output (where applicable)

Claude Code should validate extraction output against \_expected_output.json if they are available.

## Key Decisions Log

| Decision                               | Rationale                                             |
| -------------------------------------- | ----------------------------------------------------- |
| window.X globals over ES modules       | nodeIntegration:false blocks require() in renderer    |
| data-\* attribute delegation           | Consistent event wiring without inline handlers       |
| :focus-visible over :focus             | Avoids mouse-click outline noise                      |
| applyTheme on documentElement only     | Single source of truth for CSS selectors              |
| CONFIDENCE_THRESHOLD = 95              | Auto-approve above threshold; flag below              |
| psutil lazy-imported in \_watch_parent | Avoids import-time overhead                           |
| ThreadPoolExecutor for parse timeout   | Wraps parse+extract as unit, prevents partial results |
| No detached:true in spawn()            | Detached prevents SIGTERM propagation on macOS        |

| place_of_performance multi-address | PDF lists all facility names then all
addresses separately — interleaved format in expected JSON is not derivable
from source. Extracted value is the full available block. Expected JSON
updated to match reality. |

| due_date internal comma (formal_rfq) | Raw PDF text contains "09/02/2025,
at 2:00 pm" — comma is in the source, not a parser artifact. Expected JSON
updated to match raw value. |

| issuing_agency separator (formal_rfq) | PDF has org lines on separate lines
with no separator — joined with comma. Expected JSON updated to match. |

| Zombie process failure mode | If live extraction reverts to broken results
after code changes, run taskkill /F /IM python.exe and restart npm start
before debugging anything else. |

## Routing Rules

Before any non-trivial task:

1. Read this file (claude.md) for orientation
2. Read the relevant docs/ file for domain context
3. Read the relevant source files
4. Skip .planning/phases/ unless specifically asked about historical decisions
5. Skip node_modules/, dist/, dist-backend/, build/

For parser work → read docs/field-mapping.md + python/extractor.py
For UI work → read electron/js/modules/step{N}.js + electron/index.html CSS
For backend work → read python/server.py + relevant module (extractor/generator/validator)
For quote generation → read python/generator.py + testdata/quote_input.json

## Notes

If live extraction shows pre-Phase-10 results after code changes, run taskkill /F /IM python.exe and restart npm start before debugging anything else.
