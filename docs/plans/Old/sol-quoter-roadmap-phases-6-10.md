# Sol-Quoter — Implementation Roadmap
## Phases 6–10

**Document version:** 1.0  
**Status:** Planning  
**Generated:** 2026-04-30  
**Author:** Staff engineer review session

---

## Overview

This roadmap covers the next development cycle. Work is sequenced to:

1. Fix the structural fragility of the extractor before adding AI on top of it
2. Deliver the bounding-box wiring (the one incomplete feature from Phases 1–4)
3. Add AI-assisted extraction as an explicit, user-visible safety net
4. Add resizable columns (self-contained, low risk, high UX value)
5. Address .docx output issues (lowest priority, easiest to do)
6. Close the test coverage gaps throughout

**Guiding constraint:** No phase modifies already-working extraction paths. Every change is additive or isolated.

---

## Priority Order — Rationale

Before building features, you have a structural problem: the extractor breaks on formats it has never seen. Adding AI on top of a fragile regex base means you are paying API costs to paper over engineering gaps. The right order is:

1. Make the regex pipeline more resilient (Phase 6 — Extractor Hardening)
2. Add the confidence scoring layer that tells you when it fails (Phase 7 — Confidence Scoring)
3. Add AI extraction as a last resort with user consent (Phase 8 — AI Extraction)
4. Wire the one missing UI feature — bounding box scroll (Phase 9 — BBox Wiring + Test Coverage)
5. Cosmetic and output improvements (Phase 10 — .docx Overhaul + Column Resize)

Do not skip to Phase 8. You will be building AI on sand.

---

## Phase 6 — Extractor Hardening

**Objective:** Make the regex extractor more resilient on unknown solicitation formats, so that failure modes are explicit (low-confidence result) rather than silent (empty fields, wrong format detected, zero line items).

**Files:** `python/extractor.py`, `python/document_loader.py`, `testdata/run.py`

**Effort:** ~1 day  
**Risk:** Low — additive, no schema changes

---

### 6.1 Diagnose current failure modes

Before writing any code, you need to understand exactly how the extractor breaks on new formats. This is a diagnostic phase — run the extractor against `W911S225U14310001_CSS_08062025` and `N5005426Q0114_CSS_03312026` and capture what it actually produces vs. what it should produce.

**Diagnostic prompt for Claude Code:**

```
Read python/extractor.py in full. Do not write any code.

Run the extractor against these two fixtures and for each one, report:

1. What format does detect_format() return? Show the score dict.
2. Which extract_* function gets called?
3. What fields does it return? Show the full dict.
4. What line items does it extract? How many, and from what path 
   (SOW items, CLIN fallback, or the single-row fallback)?
5. What fields are empty strings?
6. What is the solicitation number it returns? 
   Compare to the actual number in the filename.

Fixtures:
  testdata/test_solicitations/W911S225U14310001_CSS_08062025/
  testdata/test_solicitations/N5005426Q0114_CSS_03312026/

For the W911S225U14310001 case specifically:
- The extractor returns "W911S225U1431" (missing last 4 chars)
- Find the exact regex pattern that produces this and explain why it truncates.
- Propose the corrected pattern. Do not apply it yet.

Do not modify any files. Report findings only.
```

---

### 6.2 Fix known truncation bug — W911S225U14310001

The solicitation number `W911S225U14310001` is returned as `W911S225U1431`. The pattern is too conservative on trailing characters. Fix it once the diagnostic has confirmed exactly which pattern is at fault.

---

### 6.3 Improve `detect_format()` for SAM export variants

SAM.gov exports have structural variation. The current scoring only triggers on `"Notice ID:"` in the first 2000 chars. Some exports use `"Solicitation Number:"` as the top-level label, which can mis-score as `agency_form`.

The fix is to expand the scoring fingerprints for `sam_export` without weakening the discrimination against `agency_form`. The diagnostic in 6.1 will identify the exact patterns needed.

---

### 6.4 Add `extraction_warnings` list to extractor output

Every format-specific extractor should return a list of warnings alongside the result dict. A warning is raised when:

- A required field (solicitation_number, due_date, contact_email, naics_code) is empty
- The format detected is `'unknown'`
- `extract_sow_line_items()` returns zero items AND `_extract_clin_items()` also returns zero items (true fallback to single-row)

This is not a confidence score yet (that is Phase 7). This is just structured logging that surfaces into the parse response so the UI can act on it.

Shape:
```python
result["extraction_warnings"] = [
    {"code": "missing_field", "field": "due_date"},
    {"code": "no_line_items", "source": "fallback_single_row"},
]
```

These warnings are included in the `/api/sol-quoter/parse` response JSON. The frontend does not act on them yet — that is Phase 7.

---

### 6.5 Write expected output for the 3 unvalidated fixtures

After fixing the truncation bug and improving SAM export detection, generate `_expected_output.json` for:

- `W911S225U14310001_CSS_08062025`
- `N5005426Q0114_CSS_03312026`
- `18Q0042`

Use the upgraded v2 schema (already defined in Phase 5 plan). These become regression anchors so future changes are caught.

**Prompt for Claude Code:**

```
Read testdata/run.py and all existing _expected_output.json files in full.

After the extractor fixes from Phase 6.2 and 6.3 have been applied, run the 
extractor against these three fixtures and capture the output:

  - testdata/test_solicitations/W911S225U14310001_CSS_08062025/
  - testdata/test_solicitations/N5005426Q0114_CSS_03312026/
  - testdata/test_solicitations/18Q0042/

For each fixture, create _expected_output.json using this schema:
{
  "_schema_version": 2,
  "solicitation_number": "",
  "format": "",
  "line_item_count": 0,
  "required_fields": ["solicitation_number", "due_date", "contact_email", "naics_code"],
  "line_items_sample": [],
  "notes": ""
}

Populate each field with the actual extracted value — these become the 
regression baseline. Note any field that looks wrong in the "notes" key.

Run python testdata/run.py after creating the files.
Expected: 6/6 fixtures validated, 0 skipped, exit 0.
Show full run.py output.
```

---

### Phase 6 Acceptance Criteria

| Check | Expected |
|-------|----------|
| `W911S225U14310001` solicitation number | Returns full `W911S225U14310001` (not truncated) |
| SAM export format detection | Both SAM fixtures return `sam_export` consistently |
| `extraction_warnings` in parse response | Present on all `/parse` responses; empty list `[]` on clean parses |
| `run.py` | 6/6 fixtures validated, exit 0 |

---

## Phase 7 — Confidence Scoring

**Objective:** Every parse result carries a structured confidence score that tells the UI (and the user) how reliable the extraction was. This is the foundation that makes AI extraction meaningful — you need to know *when* to trigger it.

**Files:** `python/extractor.py`, `python/server.py`, `electron/js/modules/step1.js`, `electron/js/modules/step2.js`

**Effort:** ~1 day  
**Risk:** Low — additive to parse response; no changes to extraction logic

---

### 7.1 Define the confidence schema

```python
{
  "confidence": {
    "overall": 0.82,          # float 0.0–1.0
    "format_detection": 1.0,  # 1.0 = known format, 0.5 = low-score, 0.0 = unknown
    "required_fields": 0.75,  # fraction of 4 required fields that are non-empty
    "line_items": 0.9,        # 1.0 = SOW+XLSX merge, 0.7 = SOW-only, 
                              # 0.4 = CLIN fallback, 0.1 = single-row fallback
    "warnings": []            # populated from extraction_warnings (Phase 6)
  }
}
```

`overall` is a weighted average: `0.3 * format + 0.4 * required_fields + 0.3 * line_items`.

These weights are not magic — they are adjustable constants in `extractor.py`. Name them.

---

### 7.2 Compute and attach confidence to every parse result

Add a `compute_confidence(result)` function in `extractor.py`. Call it at the end of `parse_solicitation_bundle()` before returning. The function reads `extraction_warnings` (Phase 6) and the result dict to produce the confidence dict.

---

### 7.3 Surface confidence in Step 2 UI

Step 2 currently shows extracted fields for review. Add a confidence indicator bar at the top of Step 2 that:

- Shows a colored bar: green (≥ 0.8), amber (0.5–0.79), red (< 0.5)
- Lists any extraction warnings from `result.confidence.warnings`
- If `overall < 0.6`, shows a banner: *"Extraction confidence is low. Review fields carefully or use AI-assisted extraction (Step 2 → AI Extract)."*

Do not add the AI button yet — that is Phase 8. The banner can say "AI extraction coming soon" or simply prompt careful review.

---

### Phase 7 Acceptance Criteria

| Check | Expected |
|-------|----------|
| 70B bundle parse | `confidence.overall` ≥ 0.85, green bar in Step 2 |
| Unknown-format fixture | `confidence.overall` ≤ 0.4, red bar, warning listed |
| SAM export fixtures | Amber or green depending on field completeness |
| No change to extraction output | All existing run.py tests still pass |

---

## Phase 8 — AI-Assisted Extraction

**Objective:** When confidence is below threshold, the user is offered the option to re-extract using the Claude API. The AI extraction is explicit, user-authorized, transparent, and auditable. No data is sent without consent.

**Files:** `python/extractor.py`, `python/server.py`, `electron/js/modules/step2.js`, `.env`

**Effort:** ~2 days  
**Risk:** Medium — introduces external API dependency, token cost, latency

---

### 8.1 Architecture decisions (locked)

These are not negotiable — they follow directly from your stated requirements:

| Decision | Rationale |
|----------|-----------|
| AI extraction is **user-triggered only** | No silent AI usage. User explicitly clicks "Extract with AI". |
| Triggered by confidence threshold OR user request | If `overall < 0.6` or if user clicks the button manually |
| API key in `.env`, never in source | Standard practice. `.env` in `.gitignore`. |
| Model: `claude-haiku-3-5` for header fields, `claude-sonnet-4-6` for line items | Haiku is fast and cheap for structured field extraction. Sonnet for line items where accuracy is critical. This is configurable. |
| Input to AI: extracted text chunks, not full PDF | Never send full document. Send only the relevant text slices. |
| Output: JSON matching existing extraction schema | No translation layer — AI returns the same dict shape as the regex extractor |
| Privacy mode: if `.env` has no `ANTHROPIC_API_KEY`, button is hidden | Zero cloud surface when key not configured |
| Usage limit: configurable `AI_MAX_CALLS_PER_SESSION` in `.env` | Prevents runaway usage. Default: 10. |

---

### 8.2 Text chunking strategy

This is the most important design decision. You must not send full PDFs.

The AI receives:
- **For header fields:** The first 4000 characters of the main document text (covers the cover page and header block where solicitation number, due date, NAICS, etc. live)
- **For line items:** The text of the SOW document only, chunked into 6000-character segments with 500-char overlap. Each chunk is sent independently if the full SOW is too long.

A solicitation with a 150-page main PDF still only sends the first 4000 chars for headers. The SOW (where line items live) is typically 20–60 pages and is the only document where chunked extraction applies.

This keeps costs predictable and avoids the context window problem.

---

### 8.3 AI extraction prompt design

The system prompt for header extraction:

```
You are extracting structured data from a government solicitation document.
Return ONLY a JSON object. No markdown, no explanation, no preamble.

Extract these fields. If a field cannot be found, use null (not an empty string):
  solicitation_number, project_title, due_date, contact_name, contact_email,
  contact_phone, naics_code, set_aside, place_of_performance, period_of_performance,
  issuing_agency, solicitation_type

Date format: return dates exactly as they appear in the document.
```

The user message is: `[document text chunk]`

For line items, the system prompt instructs the model to return a JSON array matching the line item schema exactly. Include a few-shot example in the system prompt using a synthetic (not real) solicitation example.

---

### 8.4 New Flask endpoint: `/api/sol-quoter/extract-ai`

```
POST /api/sol-quoter/extract-ai
Body: { "target": "headers" | "line_items", "session_id": "..." }
Response: { "result": {...}, "tokens_used": 1240, "model": "claude-haiku-3-5" }
```

This endpoint:
1. Reads the session files (already persisted from Phase 2)
2. Extracts the relevant text chunks
3. Calls the Anthropic API
4. Parses the response, validates against the schema
5. Returns the result — does NOT overwrite session state (the frontend merges)

The frontend decides what to do with the result. The backend is stateless for this call.

---

### 8.5 Step 2 UI — AI extraction panel

Add a collapsible panel at the top of Step 2, visible only when:
- `ANTHROPIC_API_KEY` is configured AND
- `confidence.overall < 0.6` OR user manually expands it

Panel content:
- Confidence score summary (from Phase 7)
- Toggle labeled **"AI-Assisted Extraction"** — off by default
- When toggled on: brief explanation of what data is sent and to where ("Your document text will be sent to Anthropic's API to improve extraction accuracy. No data is stored.")
- Two buttons: **"Extract Headers with AI"** and **"Extract Line Items with AI"**
- After extraction: show diff view — what changed vs. the regex result. User confirms or discards.

The diff view is the critical trust mechanism. The user sees exactly what the AI changed.

---

### 8.6 Merge strategy

AI result is not a wholesale replacement. It is a diff:

```javascript
// In step2.js
function mergeAiResult(current, aiResult) {
  const merged = { ...current }
  const changes = []
  for (const [key, value] of Object.entries(aiResult)) {
    if (value !== null && value !== current[key]) {
      changes.push({ field: key, before: current[key], after: value })
      merged[key] = value
    }
  }
  return { merged, changes }
}
```

Show the `changes` list to the user before they confirm. They can accept all, discard all, or selectively accept individual fields.

---

### 8.7 Prompt for Claude Code — AI extraction planning

```
Read the following files in full before responding. Do not write any code yet.

  - python/server.py
  - python/extractor.py
  - electron/js/modules/step2.js
  - electron/preload.js
  - docs/sol-quoter-roadmap-phases-6-10.md (Phase 8 section)

I need to add AI-assisted extraction as an explicit, user-triggered fallback.
The architecture decisions are documented in Phase 8 of the roadmap — do not 
propose alternatives to those decisions.

Before planning, answer these questions:

1. Where in server.py is the /parse route? What does it return? Show the 
   jsonify() call and the shape of the response object.

2. Where in step2.js are the extracted fields rendered? Show how the current 
   field values are set into the DOM. Are they editable inputs or read-only display?

3. Does preload.js currently expose any method that could be reused for the 
   new /extract-ai fetch? Show the existing fetch pattern from step1.js or step2.js.

4. How does step2.js currently receive S.sol (the parsed solicitation data)?
   Is it passed in as a parameter, read from window.S, or fetched on render?

5. What is the current S.sol schema? List all top-level keys.

6. Does .env exist? If so, what keys are currently in it?

Then produce an implementation plan covering:
- /extract-ai endpoint (Flask route, text chunking, API call, response shape)
- API key loading and missing-key behavior
- Step 2 UI changes (confidence panel, AI toggle, diff view)
- Merge logic
- Error handling: API timeout, malformed JSON response, rate limit
- Token usage tracking (stored in S.aiUsage for display)
- The exact prompt strings for header extraction and line item extraction
- Acceptance tests (manual) for the full flow

Plan only. No code.
```

---

### Phase 8 Acceptance Criteria

| Check | Expected |
|-------|----------|
| No API key configured | AI panel hidden, no button, no error |
| Low confidence parse triggers AI offer | Banner appears, toggle visible |
| User triggers AI extraction | Diff view shows before/after, user confirms |
| AI result merges correctly | Only changed fields updated in S.sol |
| AI extraction improves W911S225U14310001 | Solicitation number correct, required fields populated |
| Token usage visible | Shown in AI panel after extraction |
| Privacy: no key, no call | Zero network calls to Anthropic when key absent |

---

## Phase 9 — BBox Wiring + Test Coverage Closure

**Objective:** Wire the `scrollPdfToBoundingBox` stub (the one incomplete feature from Phases 1–4) and close all test coverage gaps.

**Files:** `electron/pdfviewer.html`, `electron/main.js`, `electron/preload.js`, `electron/js/modules/step2.js`, `testdata/run.py`, `testdata/test_solicitations/`

**Effort:** ~1 day  
**Risk:** Low (IPC wiring is well-understood from Phase 4; test work is mechanical)

---

### 9.1 Wire `scrollPdfToBoundingBox` 

The bounding box data is already extracted (`server.py:206–230`) and stored in `data-bbox` attributes on flagged field inputs in Step 2. The stub exists at `step2.js:10`. The PDF viewer window exists and has a text layer.

**Architecture:** Step 2 cannot talk to pdfviewer.html directly (different windows). The route is:

```
step2.js (renderer)
  → window.api.openPdfViewer(filePath, page, bboxJSON)   [preload IPC]
    → main.js: open-pdf-viewer handler
      → pdfviewer.html: reads bbox from hash params
        → after page render, calls scrollToBbox(bbox)
```

If the PDF viewer is already open (user clicked a previous field), main.js should find the existing viewer window and send it a new navigation command via `viewerWin.webContents.send('navigate-to-bbox', { page, bbox, search })` rather than opening a second window.

**Prompt for Claude Code:**

```
Read electron/main.js, electron/preload.js, electron/pdfviewer.html, 
and electron/js/modules/step2.js in full.

I need to wire the scrollPdfToBoundingBox stub in step2.js so that clicking 
a flagged field in Step 2 opens the PDF viewer to the correct page and 
scrolls to the bounding box of that field.

Current state (from the Phase 1–4 audit):
- step2.js:10 has: window.scrollPdfToBoundingBox = function() {}  (no-op stub)
- step2.js:215-225: click handlers on flagged field inputs call scrollPdfToBoundingBox
- Flagged fields have data-bbox attributes containing bounding box JSON
- server.py:206-230 extracts bbox data during parse
- pdfviewer.html already renders a text layer and has highlight logic

Required behavior:
1. User clicks a flagged field input in Step 2
2. If PDF viewer is not open: open it to the correct page, scroll to bbox
3. If PDF viewer is already open: navigate it to the new page/bbox without 
   opening a second window
4. The bbox is a dict: { page: 1, x0: 72.0, y0: 400.0, x1: 540.0, y1: 420.0 }
   These are PDF coordinate space values (origin bottom-left, points)
5. After navigating to the page, draw a highlight rectangle over the bbox area.
   Use a semi-transparent colored overlay div (not the text-layer approach — 
   the text layer approach only works for text; bbox can cover non-text regions).

Constraints:
- Never open more than one PDF viewer window at a time
- main.js must track the viewerWin reference and check if it is destroyed before 
  deciding to open a new one vs. send an IPC message to the existing one
- The bbox overlay should be visually distinct from the text-highlight (yellow): 
  use a blue semi-transparent rectangle with a dashed border

Before planning any changes, answer:
1. How does main.js currently open the pdfviewer window? Show the exact handler.
2. Does main.js currently store a reference to the viewer window? 
   If not, where would you add it?
3. How does pdfviewer.html currently receive its initial params (filePath, page, search)?
4. Does pdfviewer.html already have a mechanism for re-rendering to a new page 
   without reloading? Show the relevant function.
5. What IPC channels does preload.js currently expose to pdfviewer.html?

Then produce the implementation plan. No code yet.
```

---

### 9.2 Complete test coverage

**Task A — Upgrade existing expected output files to v2 schema**

The three existing `_expected_output.json` files (`36C24225Q0696`, `70B06C26Q00000080`, `request-for-quotation`) are missing `_schema_version`, `format`, `required_fields`, and `line_items_sample`. Add these keys. Do not change existing values.

**Task B — Write expected output for the 3 previously skipped fixtures**

This was Phase 6.5 above. By this point all three fixtures should have been diagnosed and the expected output files generated.

**Task C — Acquire 5 new solicitation fixtures**

Use these SAM.gov search queries to find real fixtures covering edge cases the current suite doesn't cover:

```
# Multi-format apparel (sizes in line items — tests size extraction path)
SAM.gov: NAICS 315990 "statement of work" "size" "unit price" 
         Type: Solicitation, Set-aside: Small Business

# Medical supplies (complex CLIN structure — tests CLIN fallback)  
SAM.gov: NAICS 339112 "CLIN" "line item" agency:VA
         Type: Solicitation

# IT services (no XLSX, no SOW attachment — tests main-doc-only path)
SAM.gov: NAICS 541519 "performance work statement" agency:DoD
         Type: RFQ

# Multi-award IDIQ (multiple option years — tests option year extraction)
SAM.gov: "option year" "IDIQ" "base period" NAICS 561210
         Type: Solicitation

# SAM export with full CLIN table in body (no attachment)
SAM.gov: NAICS 332510 "CLIN 0001" "CLIN 0002" "unit price"
         Type: Combined Synopsis/Solicitation
```

For each fixture acquired: place PDFs in `testdata/test_solicitations/[NUMBER]/`, run the extractor, inspect output, create `_expected_output.json`.

---

### Phase 9 Acceptance Criteria

| Check | Expected |
|-------|----------|
| Click flagged field in Step 2 | PDF viewer opens to correct page |
| Viewer already open, click different field | Viewer navigates (no second window) |
| BBox overlay visible | Blue dashed rectangle over the field region |
| `run.py` | 6/6 original fixtures validated + new fixtures, exit 0 |
| v2 schema | All `_expected_output.json` files have `_schema_version: 2` |

---

## Phase 10 — .docx Output Overhaul + Column Resize

These are independent. Column resize is lower risk. Do it first within the phase.

**Effort:** ~1 day total  
**Risk:** Low

---

### 10.1 Resizable column widths in line items table

The table is a standard HTML `<table>` rendered inside `step3.js`. The approach is CSS `<col>` widths + a `mousedown`/`mousemove`/`mouseup` resize handler on `<th>` dividers. Persist widths to `localStorage` keyed by `sol-quoter:col-widths`.

**Constraints:**
- Resize handles are the `<th>` right-edge div, not the text area
- Min column width: 48px. Max: unconstrained.
- Column widths persist across sessions (localStorage is fine here — it's a UI preference, not document state)
- The Description column must be the one users most want to expand; give it the most default width
- Do not touch the `<tfoot>` — it spans the full width regardless

**Prompt for Claude Code:**

```
Read electron/js/modules/step3.js and electron/index.html in full.

I need to add resizable column widths to the line items table in Step 3.

The table is rendered inside the step3() function in step3.js. It is a 
standard HTML <table> with these columns:
  [expand btn] [#] [Description] [Size/Type] [UOM] [Qty] [Unit Price] [Total] [actions]

Requirements:
1. Add a drag handle to the right edge of each <th> (except the expand and 
   actions columns, which have fixed widths).
2. Dragging the handle resizes that column. 
3. Column widths persist in localStorage with key "sol-quoter:col-widths".
4. On table re-render (render(3)), restore persisted widths.
5. Min width per column: 48px.
6. Do not use any library — pure DOM event handling.
7. The resize handle is a 4px-wide div absolutely positioned at the right edge 
   of the <th>. Cursor: col-resize. Color: var(--color-border) on hover.

Before implementing, answer:
1. Is the table re-rendered from scratch on every render(3) call, or is it 
   incrementally patched? (This determines whether widths must be re-applied 
   after each render.)
2. Are the <th> elements given IDs or data attributes currently? If not, 
   what is the cleanest way to identify them for width restoration?
3. Where in step3.js would you add the initResizableColumns() call to ensure 
   it fires after the table is in the DOM?

Then implement. Include the localStorage restore logic inside step3() after 
the table is rendered. Show the complete modified section of step3.js, not 
the full file.
```

---

### 10.2 .docx output fixes

These are the confirmed issues. Address them in order of severity:

**A. Row number overflow (confirmed bug)**
Line item numbers ≥ 100 overflow the `#` column in the .docx output. Fix the column width in `generator.py`. The `#` column should be wide enough for 3-digit numbers. This is a one-line fix in the table column width definition.

**B. Line item column schema — configurable fields**

Different quote types need different columns. The current schema is fixed: Description, Size/Type, UOM, Qty, Unit Price, Total.

For apparel: you need Size as a real column (not Size/Type combined) and potentially a Color column.
For other items: Size/Type may be unnecessary.

Add a `line_item_schema` setting to `S.vendor` with options:
- `"standard"` — current schema (Description, Size/Type, UOM, Qty, Unit Price, Total)
- `"apparel"` — (Description, Color, Size, UOM, Qty, Unit Price, Total)
- `"services"` — (Description, Period, UOM, Qty, Unit Price, Total)

This setting appears in a dropdown in Step 3's "Quote Details" card. It is saved in `S.vendor` and persisted to localStorage. The `generator.py` reads it from the quote input JSON and renders the appropriate columns.

**C. Section toggles (settings panel)**

Add a simple settings panel (collapsible card in Step 3) to enable/disable:
- Option years section
- Signature block
- Notes / T&C section

These are already conditionally rendered in `generator.py` but not exposed as user-controllable settings in the UI.

**Prompt for Claude Code — .docx fixes:**

```
Read python/generator.py and electron/js/modules/step3.js in full.
Read electron/js/modules/state.js to understand S.vendor schema.

I need three changes to the .docx output system:

CHANGE 1 — Fix row number column overflow
In generator.py, find where the line items table is built (the add_table call).
Find the column width for the # (item number) column.
Increase it so 3-digit numbers (100–999) render without overflow.
Show the current value and the corrected value.

CHANGE 2 — Line item schema selector
Add "line_item_schema" field to S.vendor in state.js with default value "standard".

Add a dropdown to Step 3's "Quote Details" card:
  <label>Line Item Format</label>
  <select data-vendor-field="line_item_schema">
    <option value="standard">Standard (Description, Size/Type, UOM, Qty, Price)</option>
    <option value="apparel">Apparel (Description, Color, Size, UOM, Qty, Price)</option>
    <option value="services">Services (Description, Period, UOM, Qty, Price)</option>
  </select>

In generator.py, read line_item_schema from the quote input and render the 
appropriate columns. Show the full implementation for all three schemas.

CHANGE 3 — Section toggles
Add a "Output Settings" collapsible card in Step 3 (below Option Years).
Checkboxes:
  - Include option years section (already exists as oy-on — move here)
  - Include signature block (new — default: true)  
  - Include notes / terms section (new — default: true)

Add corresponding keys to S.vendor: include_signature (bool), include_notes (bool).
Wire generator.py to read and respect these flags.

Before implementing, answer:
1. In generator.py, where are the option years section, signature block, 
   and notes section rendered? Show the line numbers and the conditional 
   check (if any) that currently controls them.
2. In state.js, what is the current default value for option_years_enabled?
   Is include_signature or include_notes currently in the schema?
3. Is there a collapsible card pattern already in index.html CSS? 
   Show the relevant classes if yes.

Implement all three changes. Show only modified sections, not full files.
```

---

### Phase 10 Acceptance Criteria

| Check | Expected |
|-------|----------|
| Item #100 in .docx | Single-line row number, no overflow |
| Apparel schema selected | .docx has Color + Size columns, no Size/Type column |
| Services schema selected | .docx has Period column |
| Signature block toggle off | No signature block in generated .docx |
| Column resize | Drag Description column wider, re-render Step 3, width persists |

---

## Summary Table

| Phase | Name | Primary Files | Effort | Risk | Blocks |
|-------|------|---------------|--------|------|--------|
| 6 | Extractor Hardening | `extractor.py`, `run.py` | 1 day | Low | Phase 7, 8 |
| 7 | Confidence Scoring | `extractor.py`, `server.py`, `step2.js` | 1 day | Low | Phase 8 |
| 8 | AI-Assisted Extraction | `extractor.py`, `server.py`, `step2.js` | 2 days | Medium | — |
| 9 | BBox Wiring + Test Coverage | `pdfviewer.html`, `main.js`, `step2.js`, `run.py` | 1 day | Low | — |
| 10 | .docx Overhaul + Column Resize | `generator.py`, `step3.js`, `state.js` | 1 day | Low | — |

**Total estimated effort:** 6 days. At a comfortable weekend-to-Tuesday pace, Phases 6–9 are achievable. Phase 10 is cleanup that can happen after.

---

## Dependency Graph

```
Phase 6 (Extractor Hardening)
  └── Phase 7 (Confidence Scoring)
        └── Phase 8 (AI Extraction)

Phase 9 (BBox + Tests) — independent, can run in parallel with 7/8

Phase 10 (.docx + Column Resize) — fully independent, lowest priority
```

Do not start Phase 8 without Phase 6 complete. The AI extraction prompt quality depends on you knowing exactly what the regex pipeline produces and where it fails. Sending garbage text to Claude because `detect_format` picked the wrong extractor is a waste of API calls and will produce confusing results.

---

## Conventions for Claude Code Prompts

All Claude Code prompts in this document follow the pattern established in `docs/plans/phase-prompts.md`:

1. Read-only diagnostic first (planning prompt) — no code written
2. Review the plan with the senior engineer
3. Implementation prompt references the plan
4. Validation steps are explicit and runnable
5. Report full output of all validation commands before finishing

Do not skip the planning prompt. The value of the two-phase workflow is that it surfaces assumptions before they become bugs.

---

*End of roadmap — Sol-Quoter Phases 6–10, version 1.0*
