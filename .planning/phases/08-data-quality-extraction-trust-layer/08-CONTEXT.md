# Phase 8: Data Quality & Extraction Trust Layer — Context

**Gathered:** 2026-03-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Surface extraction quality to the user — warn when scope text is truncated, fix SAM.gov field mapping gaps, validate CSV column headers with specific error messages, and implement a full confidence scoring system: a modular Python extraction validator that produces a global accuracy score (0–100%) and per-field confidence scores, a step 2 UI that shows the overall score prominently and distinguishes flagged fields inline, an embedded PDF.js viewer (collapsible) that scrolls to a flagged field's bounding box region when clicked, and NAICS/PSC format validation. No new capabilities beyond what DATA-01 through DATA-05 define.

</domain>

<decisions>
## Implementation Decisions

### Scope Truncation Warning (DATA-01)
- **D-01:** Warning appears **inline in step 2** — a banner directly above the scope_of_work textarea reading "Scope truncated at 2000 characters" (no modal, no toast)
- **D-02:** "View full text" expands **in-place below the textarea** — not a modal dialog; modal adds unnecessary interaction cost for a read-only reference action
- **D-03:** The in-place expansion shows the full un-truncated text in a styled read-only block; it can be collapsed again after reading
- **D-04:** Warning is only shown when the backend signals truncation — backend must include a `scope_truncated: true` field in the `/parse` response when the extracted scope exceeded the limit

### SAM.gov Field Mapping (DATA-02)
- **D-05:** Audit what `/sam_lookup` currently returns and map any unmapped fields (candidates: `period_of_performance`, `estimated_value`, `contract_type` — confirm against live API schema)
- **D-06:** Mapping changes happen in `python/server.py` `sam_lookup()` — same file, same pattern as existing opp.get() calls
- **D-07:** If a SAM.gov field returns `null` or empty string in the API response, the field stays empty in the UI — no "null" string literals should ever populate a field

### CSV Header Validation (DATA-03)
- **D-08:** Validate against **exact expected headers**: `Description`, `Size/Type`, `UOM`, `Qty`, `Unit Price` (case-insensitive match acceptable)
- **D-09:** On mismatch: show a specific error naming the bad or missing column — e.g., "Column 3 should be 'UOM' but got 'Unit'" or "Missing required column: 'Qty'"
- **D-10:** **No column-mapping UI** — that is scope creep; validation either passes or fails with an actionable message
- **D-11:** Error message format: "Expected columns: Description, Size/Type, UOM, Qty, Unit Price — found: [actual headers]" with the specific mismatch highlighted
- **D-12:** If no header row detected (current heuristic), the validator should still check that data rows have the correct column count (5 columns) and show an error if not

### Confidence Scoring Backend (DATA-04a, DATA-04b, DATA-04c)
- **D-13:** Extraction validation logic lives in a **separate Python module** (`python/validator.py`) — not inline in server.py or extractor.py; called after `extract_data()` in `/parse`
- **D-14:** Module computes: `overallConfidence` (0–100 integer), per-field `confidence` (0–100), `status` ("ok" | "flagged"), `issue` (string or null), `boundingBox` (coordinates or null)
- **D-15:** `/parse` response structure gains: `{ "overallConfidence": 92, "fields": [...], "flags": [...] }` — existing fields remain unchanged; confidence data is additive
- **D-16:** Auto-approval threshold: `overallConfidence >= 95` — fields above pass silently; below threshold highlights the review panel automatically
- **D-17:** Threshold is **configurable** — defined as a constant in `validator.py`, not hardcoded inline (easy to change without searching)
- **D-18:** `boundingBox` coordinates come from pdfplumber when available — validator passes these through from the extraction layer; `null` for non-PDF sources or missed extractions

### Confidence Score UI (DATA-04d)
- **D-19:** Overall accuracy score displays as a **prominent badge at the top of the step 2 review panel** — e.g., "92% Confidence" using token-based colors (high = `--color-success`, medium = warning yellow TBD, low = `--color-error`)
- **D-20:** Flagged fields are distinguished **inline** — confidence percentage and issue text shown adjacent to the field (below the input, same location as Phase 6's `field-error` pattern)
- **D-21:** **No separate audit panel or section** — everything visible in the normal review flow without extra clicks
- **D-22:** Use Phase 4/5 CSS token system throughout — no new hardcoded color values
- **D-23:** When `overallConfidence >= 95`, the badge is shown but in a success/neutral state — no flagged fields, no highlighted inputs; review panel looks clean

### PDF Viewer for Zoom-to-Region (DATA-04d)
- **D-24:** Embed **PDF.js** viewer in step 2 as a **collapsible panel**, initially collapsed — the viewer is secondary to the field review UI, not full-width
- **D-25:** When user clicks a flagged field that has a `boundingBox`, the panel **expands and scrolls to the bounding box region** using PDF.js page coordinates
- **D-26:** **Graceful degradation**: if no `boundingBox` exists for a field (non-PDF source, extraction miss), clicking does nothing — no error shown, no broken state
- **D-27:** Panel is not shown at all for non-PDF uploads (TXT, DOCX sources) — only rendered when the source file was a PDF
- **D-28:** PDF.js is loaded from the local app bundle (not CDN) — Electron runs offline and CDN-loaded scripts are a security concern

### NAICS/PSC Format Validation (DATA-05)
- **D-29:** NAICS code validated as 5–6 digits; PSC code validated as a 4-character alphanumeric pattern (e.g., `1234`, `AA1B`) — inline error shown below the field in step 2 on blur
- **D-30:** Inline validation uses the existing `field-error` pattern from Phase 6 (red border + small message below)
- **D-31:** Validation fires on **blur** (when user leaves the field), not on every keystroke — avoids showing errors while typing

### Claude's Discretion
- Exact color/shade for medium confidence (e.g., 70–94%) — any Phase 4 warning token is fine
- Whether to show the confidence badge even on first parse before user has edited anything — Claude decides (reasonable default: yes, show immediately)
- Exact PDF.js version and bundle strategy — Claude picks the current stable release
- Confidence scoring algorithm specifics (e.g., what patterns trigger a "flagged" status) — Claude designs this based on field type and extraction patterns in extractor.py

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements (Phase 8)
- `.planning/REQUIREMENTS.md` §Data Quality — DATA-01 through DATA-05 definitions and acceptance criteria
- `.planning/ROADMAP.md` §Phase 8 — Goal, success criteria, and 7 must-haves for verification

### Existing Extraction & Backend
- `python/extractor.py` — existing field extraction logic; scope truncation at line 108; confidence module should call functions here
- `python/server.py` — `/parse` route (lines ~120–145) and `/sam_lookup` route (lines ~160–235); confidence data must be added to parse response here

### Existing Frontend (Step 2 & 3)
- `electron/js/modules/step2.js` — review step rendering; confidence badge and flagged field display go here; PDF viewer panel goes here
- `electron/js/modules/step3.js` — CSV import logic `doImportCsv()` at line 156; header validation changes go here

### Prior Phase Patterns
- `.planning/phases/06-error-states/06-CONTEXT.md` — `field-error` inline pattern (D-13/D-14) used by DATA-05 and DATA-04d flagged fields
- `.planning/phases/04-css-design-tokens/04-CONTEXT.md` — CSS token system; all new UI must use var(--color-*) tokens

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `field-error` CSS class + pattern (Phase 6): red border + message below input — reuse directly for NAICS/PSC validation (D-30) and flagged field display (D-20)
- `alert alert-error` / `alert alert-info` classes: reuse for scope truncation warning banner (D-01) and CSV validation errors (D-09)
- `parseCsvLine()` in step3.js: existing CSV parser utility; wrap with header validation layer (D-08)

### Established Patterns
- `/parse` response is additive — existing fields (`data.solicitation_number`, `data.scope_of_work`, etc.) are read by step2.js; confidence fields must be added without breaking existing reads
- `window.S.extracted` holds extracted data in the renderer; confidence data can live on `window.S.confidence` or be merged into `window.S.extracted` per-field
- Step 2 renders with `renderStep2(d)` where `d = window.S.extracted` — any new UI elements (score badge, PDF viewer toggle) belong in this render function

### Integration Points
- `python/validator.py` (new): called after `extract_data()` in `/parse` handler; returns confidence structure merged into response JSON
- `pdfplumber` already used in `python/extractor.py` for PDF text extraction — bounding box coordinates accessible from pdfplumber's `page.extract_words()` method with `x0, y0, x1, y1` per word
- PDF.js viewer: loaded in `electron/index.html` as a local asset; step2.js wires the collapsible panel and page-scroll calls via PDF.js viewer API

</code_context>

<specifics>
## Specific Ideas

- PDF.js panel is **initially collapsed** so it doesn't dominate the step 2 UI — user opens it by clicking a flagged field or a "View PDF" toggle
- Scope full-text expand is **in-place below the textarea** not a modal — expand/collapse toggle on the banner itself
- CSV errors must name the exact column: "Expected 'UOM' in column 3, got 'Unit'" is better than "column headers don't match"
- Confidence badge color: green for ≥95, yellow/amber for 70–94, red for <70 (Claude picks exact token)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 08-data-quality-extraction-trust-layer*
*Context gathered: 2026-03-23*
