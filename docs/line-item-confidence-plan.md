# Sol-Quoter — Line Item Confidence & Verification System
## Implementation Plan

**Document version:** 1.0  
**Status:** Planning  
**Scope:** Phases 1–5 covering data enrichment, UI verification tools, PDF source viewer, session persistence, and test coverage expansion  
**Does not cover:** AI extraction overhaul (separate future plan), NEXUS product database integration (separate future plan), .docx output format redesign (pending employer feedback)

---

## Executive Summary

The extractor overhaul (Phases 0–4) is complete. The tool reliably parses solicitations, extracts 118 line items from the LLSM bundle, and generates a .docx quote. The next problem is **trust**. A vendor using this tool to quote a federal contract needs to verify that every line item is correct before submitting. Currently there is no way to do that without manually cross-referencing the source PDFs.

This plan builds a verification layer on top of the working extraction pipeline:

- Every line item carries its full spec text, source file, and page number
- The UI exposes all of that in a compact, non-disruptive way
- A built-in PDF viewer opens to the exact source page with the relevant text highlighted
- Session files persist so source documents are always accessible
- Quantities across all contract periods are visible so the user understands volume commitment before pricing
- The tab order and column legibility issues are fixed for power-user workflow

---

## Assumptions and Constraints

| Item | Decision | Rationale |
|------|----------|-----------|
| PDF.js | Vendored locally, no CDN | App must work fully offline; final deliverable is a .exe/.dmg installer |
| File persistence | Session directory (`~/.sol-quoter/session/`) | Source files must survive beyond the parse request for the PDF viewer to function; also unlocks future features |
| Quantity display | Sum of all periods as primary qty; per-period breakdown in detail panel | Employer workflow: single unit price across all periods; volume context needed for pricing decisions |
| AI extraction | Not in scope | Keep all data local; regex pipeline is reliable enough; full AI overhaul planned separately |
| .docx format | Not in scope | Pending employer feedback on required format |
| eval table parser | Not in scope | 2-way SOW+XLSX merge produces correct results; 3-way merge deferred |
| NEXUS integration | Not in scope | Future phase; unit price field stays manual for now |

---

## Current State Baseline

### Working
- `document_loader.py` — magic-byte dispatch, ZIP/PDF/DOCX/TXT handling
- `detect_format()` — scoring-based, 4 formats
- `extract_sf1449()` — 13/15 fields correct, scope fix applied
- `extract_sow_line_items()` — 118 items from LLSM SOW, spec regex working
- `extract_pricing_spreadsheet()` — XLSX column parsing, P1–P5 quantities
- `merge_line_item_sources()` — 2-way SOW+XLSX merge on sow_section key
- `parse_solicitation_bundle()` — multi-file parse, classify_document routing
- Multi-file upload UI — Step 1 accepts PDF + SOW + XLSX together

### Known gaps addressed in this plan
- `spec_text` not stored per item (body text discarded after title extraction)
- `source_page` not stored (page number of SOW section not tracked)
- `source_file` not stored per item (which uploaded file it came from)
- `_source` provenance not tagged (SOW+XLSX vs SOW-only vs XLSX-only)
- Quantities: only P1 exposed; P2–P5 present in dict but not surfaced in UI
- Total qty across periods not computed
- Tab order: horizontal (wrong for power users)
- Row number column too narrow — wraps on 2-digit numbers
- Unit price and qty inputs too small to read on some screen sizes
- Uploaded files cleaned up immediately after parse — PDF viewer has no files to open
- No inline PDF viewer for source verification

---

## Phase 1 — Data Enrichment (Backend Only)

**Objective:** Every line item in the parsed JSON carries the data the UI needs to power verification. No UI changes in this phase.

**Files changed:** `python/extractor.py` only

**Effort:** ~2 hours  
**Risk:** Low — additive only, no existing fields modified

---

### 1a. Store `spec_text` per line item

In `extract_sow_line_items()`, the variable `body` already contains the full paragraph text between section headers. It is computed but never stored.

**Change:** Add `"spec_text"` field to each item dict.

```python
# In the items.append({...}) call inside extract_sow_line_items()
# Add this field:
"spec_text": body.strip()[:2000],  # cap at 2000 chars — sufficient for any SOW paragraph
```

---

### 1b. Store `source_page` per line item

The SOW is loaded via `document_loader.load_document()` which returns a `DocumentResult` with a `page_texts: list[str]` field. Each page's text is already separated. We can determine which page a section appeared on by checking which page text contains the section header.

**Change:** Pass `page_texts` into `extract_sow_line_items()` as an optional second argument. During extraction, for each match, find the page index whose text contains the section number.

```python
def extract_sow_line_items(text: str, page_texts: list[str] | None = None) -> list[dict]:
    text = text.replace('\r\n', '\n').replace('\r', '\n')
    matches = list(_SOW_SECTION_RE.finditer(text))
    
    # Build page boundary map if page_texts provided
    page_map = []  # list of (start_char, end_char, page_number)
    if page_texts:
        pos = 0
        for i, pt in enumerate(page_texts):
            normalized = pt.replace('\r\n', '\n').replace('\r', '\n')
            page_map.append((pos, pos + len(normalized), i + 1))
            pos += len(normalized) + 2  # +2 for the \n\n join
    
    def find_page(char_pos: int) -> int | None:
        for start, end, page_num in page_map:
            if start <= char_pos < end:
                return page_num
        return None
    
    # ... existing loop, add to each item:
    "source_page": find_page(m.start()) if page_map else None,
```

**Update `parse_solicitation_bundle()`** to pass `doc_result.page_texts` when calling `extract_sow_line_items()`.

---

### 1c. Store `source_file` per line item

`parse_solicitation_bundle()` already knows which file is the SOW. Pass the original filename through.

**Change:** In `parse_solicitation_bundle()`, when calling `extract_sow_line_items()`, set `source_file` on each returned item.

```python
for item in sow_items:
    item["source_file"] = sow_file_name  # e.g. "70B06C26Q00000080Attachment1LLSMSOW.pdf"
```

---

### 1d. Add `_source` provenance tag

In `merge_line_item_sources()`, tag each merged item based on which sources contributed data.

```python
# After merge logic, before return:
for item in merged:
    has_sow = item.get("spec_text") is not None
    has_xlsx = item.get("qty_period_1") not in (None, "N/A")
    if has_sow and has_xlsx:
        item["_source"] = "SOW+XLSX"
    elif has_sow:
        item["_source"] = "SOW"
    elif has_xlsx:
        item["_source"] = "XLSX"
    else:
        item["_source"] = "unknown"
```

---

### 1e. Compute total quantity across all periods

In `merge_line_item_sources()`, after merging, compute and store total estimated quantity.

```python
for item in merged:
    periods = item.get("quantities_by_period", {})
    period_values = [v for v in periods.values() if isinstance(v, (int, float))]
    item["qty_total"] = sum(period_values) if period_values else None
    # Override qty to use total as primary (was period_1 only)
    item["qty"] = item["qty_total"] if item["qty_total"] is not None else item.get("qty_period_1", "N/A")
```

---

### Phase 1 Acceptance Criteria

Run against the 70B bundle (main + SOW + XLSX). Verify in the parsed JSON:

| Check | Expected |
|-------|----------|
| `line_items[0]["spec_text"]` | Contains "M201A1" (from 4.1.1 SOW body) |
| `line_items[0]["source_page"]` | Integer (1 or 2 — whichever page 4.1.1 appears on) |
| `line_items[0]["source_file"]` | `"70B06C26Q00000080Attachment1LLSMSOW.pdf"` |
| `line_items[0]["_source"]` | `"SOW+XLSX"` |
| `line_items[0]["qty_total"]` | Sum of P1–P5 (e.g. 5700 if each period is 1140) |
| `line_items[0]["qty"]` | Same as `qty_total` |
| Zero regressions | Run `testdata/run.py` — all existing format tests pass |

---

## Phase 2 — Session File Persistence

**Objective:** Uploaded source files survive the parse request and remain accessible for the PDF viewer. Also enables "resume previous session" to retain file access, not just state.

**Files changed:** `python/server.py`, `python/extractor.py` (minor), `electron/main.js`

**Effort:** ~3 hours  
**Risk:** Medium — touches server file handling and IPC

---

### 2a. Session directory structure

Create a persistent session directory on first use:

```
~/.sol-quoter/
  session/
    current/
      manifest.json          # session metadata: files, parse timestamp, solicitation number
      [original filenames]   # uploaded files copied here, original names preserved
  logs/                      # future use
```

**Why `~/.sol-quoter/` not a temp dir:** Temp dirs are OS-managed and may be cleaned at any time. The session directory is app-managed and survives across app restarts, enabling "resume session" to also restore file access.

---

### 2b. Server changes — `python/server.py`

Replace the temp file + immediate cleanup pattern with a session copy pattern:

```python
import shutil, hashlib, datetime

SESSION_DIR = Path.home() / ".sol-quoter" / "session" / "current"

@app.route("/api/sol-quoter/session/clear", methods=["POST"])
def clear_session():
    """Wipe the current session directory. Called on new upload or explicit clear."""
    if SESSION_DIR.exists():
        shutil.rmtree(SESSION_DIR)
    SESSION_DIR.mkdir(parents=True, exist_ok=True)
    return jsonify({"status": "cleared"})

# In /parse route:
# 1. Clear previous session
# 2. Save each uploaded file to SESSION_DIR with original filename
# 3. Run parse_solicitation_bundle with SESSION_DIR paths
# 4. Write manifest.json to SESSION_DIR
# 5. NO cleanup — files stay for the session
# 6. Return parsed result + session file paths in response
```

Add file paths to the parse response:
```json
{
  "_session_files": {
    "main": "/Users/name/.sol-quoter/session/current/70B06C26Q00000080.pdf",
    "sow": "/Users/name/.sol-quoter/session/current/70B06C26Q00000080Attachment1LLSMSOW.pdf",
    "pricing": "/Users/name/.sol-quoter/session/current/70B_Attachment_2_Pricing.xlsx"
  }
}
```

---

### 2c. Store session file paths in wizard state

In `step1.js`, when the parse response arrives, store `_session_files` in `S.sessionFiles`. This is the map the PDF viewer uses to find source documents.

---

### 2d. New IPC endpoint — `get-session-file-path`

In `main.js`, expose a handler that takes a filename and returns the absolute path if it exists in the current session:

```javascript
ipcMain.handle('get-session-file-path', (event, filename) => {
  const sessionPath = path.join(os.homedir(), '.sol-quoter', 'session', 'current', filename)
  return fs.existsSync(sessionPath) ? sessionPath : null
})
```

---

### 2e. Clear session on new upload

When the user starts a new upload (drops files or clicks upload on Step 1), call `POST /api/sol-quoter/session/clear` before uploading. This ensures the session directory always reflects the current parse, not a stale one.

Also add a **"Clear & Reparse"** button on Step 2 that clears the session and resets the wizard to Step 1. This addresses the developer pain point of wanting fresh state without restarting the app.

---

### Phase 2 Acceptance Criteria

| Check | Expected |
|-------|----------|
| After parse, session files exist | `~/.sol-quoter/session/current/` contains the 3 uploaded files |
| `manifest.json` written | Contains solicitation number and timestamp |
| `S.sessionFiles` populated | Contains absolute paths for main, sow, pricing |
| New upload clears session | Previous session files replaced |
| "Clear & Reparse" button | Resets wizard to Step 1, clears session dir |
| Resume session still works | `S` state restored from localStorage; session files still accessible if not cleared |

---

## Phase 3 — Line Items Table UI Overhaul

**Objective:** Fix the power-user workflow issues in the line items table and add the inline detail expansion panel. Depends on Phase 1 data being present.

**Files changed:** `electron/js/modules/step3.js`, `electron/index.html`

**Effort:** ~4 hours  
**Risk:** Low-medium — self-contained to Step 3

---

### 3a. Column legibility fixes

**Row number wrapping:**
```css
/* In the # column th and td */
.lt-col-num {
  min-width: 2.5rem;
  white-space: nowrap;
  text-align: center;
}
```

**Unit price and qty input legibility:**
The inputs are too small on some screen sizes. Minimum readable width for a few digits:
```css
.lt-input-qty   { min-width: 4rem; text-align: right; }
.lt-input-price { min-width: 6rem; text-align: right; }
```
Also increase font size to match the rest of the table row (currently inheriting a smaller size).

---

### 3b. Tab order — vertical column navigation

Current behavior: Tab moves horizontally (unit price → next row's description).  
Required behavior: Tab moves vertically (unit price → next row's unit price).

**Implementation:** Intercept `keydown` on unit price inputs. On Tab (no shift), prevent default and focus `unit_price` input of the next row. On Shift+Tab, focus previous row's unit price.

```javascript
function wireTabOrder() {
  const priceInputs = document.querySelectorAll('.lt-input-price')
  priceInputs.forEach((input, idx) => {
    input.addEventListener('keydown', e => {
      if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault()
        const next = priceInputs[idx + 1]
        if (next) next.focus()
      } else if (e.key === 'Tab' && e.shiftKey) {
        e.preventDefault()
        const prev = priceInputs[idx - 1]
        if (prev) prev.focus()
      }
    })
  })
}
```

Call `wireTabOrder()` after the table renders (after `renderLineItems()`).

---

### 3c. Expand column and chevron button

Add a new first column to the line items table: a narrow chevron toggle column. No header text.

```
[▶] [#] [Description] [Size/Type] [UOM] [Qty] [Unit Price] [Total] [—] [Dup] [×]
```

The chevron button:
- Rotates 90° when expanded (CSS transform, no JS needed for animation)
- Is keyboard accessible (button element, not div)
- Has `aria-expanded` attribute for accessibility

---

### 3d. Inline detail expansion panel

When chevron clicked, insert a detail row directly below the item row. The detail row spans all columns.

**Detail panel layout:**
```
┌─────────────────────────────────────────────────────────────────┐
│ Section: 4.1.1    [SOW+XLSX ●]                                  │
│ Manufacturer: Defense Technologies    Part #: 1063              │
│                                                                 │
│ Estimated Quantities:                                           │
│ P1: 1,140  │  P2: 1,140  │  P3: 1,140  │  P4: 1,140  │  P5: 1,140  │  Total: 5,700 │
│                                                                 │
│ Specification:                                                  │
│ This hand delivered smoke canister shall be equipped with an    │
│ M201A1 or equivalent fuze with an average 1.5 second fuze       │
│ delay. It shall have a sufficient number of gas ports...        │
│                                                      [View in Source PDF →] │
└─────────────────────────────────────────────────────────────────┘
```

**Source provenance badge colors (CSS variables):**
```css
.badge-sow-xlsx { background: var(--color-success); color: #fff; }
.badge-sow      { background: var(--color-info);    color: #fff; }
.badge-xlsx     { background: var(--color-warning); color: #000; }
.badge-unknown  { background: var(--color-muted);   color: #fff; }
```

**Behavior rules:**
- Only one row expanded at a time — opening a new one collapses the previous
- Expansion state resets on re-render (acceptable — state is not persisted)
- If `spec_text`, `manufacturer_ref`, `part_number` are all empty/null: show "No additional detail available"
- Period quantities show "—" if null (item exists in SOW but not in XLSX for that period)
- "View in Source PDF →" button is only rendered if `source_file` and `source_page` are non-null

**Data source:** `S.items[i]` already carries all Phase 1 fields if the parse was run after Phase 1 is deployed. The render function reads directly from the item object.

---

### Phase 3 Acceptance Criteria

| Check | Expected |
|-------|----------|
| Row number "10" | Displays on one line, no wrapping |
| Unit price input | Readable at normal screen size, minimum 6 chars wide |
| Tab from row 1 unit price | Focus moves to row 2 unit price |
| Shift+Tab from row 2 unit price | Focus moves to row 1 unit price |
| Expand item 4.1.1 | Shows "Defense Technologies", "1063", spec paragraph, period quantities, "SOW+XLSX" green badge |
| Expand item 4.1.1 again | Panel collapses |
| Expand item 2 while item 1 open | Item 1 collapses, item 2 opens |
| Item with no spec_text | Shows "No additional detail available" |
| "View in Source PDF" button | Appears only when source_file + source_page present |

---

## Phase 4 — PDF Source Viewer

**Objective:** "View in Source PDF" opens an in-app viewer window, navigates to the exact page, and highlights the relevant spec text. Full offline capability. Uses PDF.js vendored locally.

**Files changed/created:** `electron/pdfviewer.html` (new), `electron/main.js`, `electron/preload.js`, `electron/js/modules/step3.js`

**Effort:** ~6 hours  
**Risk:** Medium-high — new Electron window, PDF.js integration, IPC wiring

---

### 4a. Vendor PDF.js locally

Download the pre-built PDF.js distribution from Mozilla (https://mozilla.github.io/pdf.js/) and add to the project:

```
electron/
  vendor/
    pdfjs/
      pdf.min.js         # core library
      pdf.worker.min.js  # worker (must be same version as core)
      pdf_viewer.css     # viewer CSS
```

**Version:** Use the latest stable release. Pin the version in a comment at the top of `pdfviewer.html`.

**Critical:** `pdf.js` and `pdf.worker.js` must be the same version. Mismatched versions cause silent failures.

---

### 4b. `electron/pdfviewer.html` — viewer window

A standalone HTML page that:
1. Reads parameters from its URL hash: `#file=<encoded_path>&page=<n>&search=<encoded_text>`
2. Loads the PDF from the local filesystem via `window.api.readFileAsArrayBuffer(path)`
3. Renders it with PDF.js canvas renderer
4. Navigates to the specified page on load
5. Highlights matching text using the PDF.js text layer

**IPC required:**
```javascript
// preload.js — add:
readFileAsArrayBuffer: (filePath) => ipcRenderer.invoke('read-file-as-array-buffer', filePath)

// main.js — add:
ipcMain.handle('read-file-as-array-buffer', async (event, filePath) => {
  // Security check: only allow files within the session directory
  const sessionDir = path.join(os.homedir(), '.sol-quoter', 'session', 'current')
  const resolved = path.resolve(filePath)
  if (!resolved.startsWith(sessionDir)) {
    throw new Error('Access denied: file outside session directory')
  }
  return fs.readFileSync(resolved).buffer
})
```

**Why security check:** The IPC handler reads arbitrary files by path. Restricting to the session directory prevents any page content from using this to read sensitive local files — important even in a local app.

---

### 4c. Text highlighting in PDF.js

PDF.js renders a transparent text layer over the canvas. After the page renders, search the text layer for matching text and apply a highlight span:

```javascript
async function highlightText(pageNum, searchText) {
  const page = await pdfDoc.getPage(pageNum)
  const textContent = await page.getTextContent()
  
  // Wait for text layer to render
  await nextFrame()
  
  const textLayer = document.querySelector('.textLayer')
  if (!textLayer || !searchText) return
  
  const spans = textLayer.querySelectorAll('span')
  const target = searchText.toLowerCase().slice(0, 60)  // first 60 chars of spec text
  
  spans.forEach(span => {
    if (span.textContent.toLowerCase().includes(target.slice(0, 20))) {
      span.classList.add('sol-highlight')
    }
  })
}
```

```css
.sol-highlight {
  background: rgba(255, 220, 0, 0.4);
  border-radius: 2px;
  padding: 1px 0;
}
```

**Why first 60 chars of spec_text:** The full spec paragraph may span multiple text layer spans. Matching on the opening phrase is reliable — it's unique per item and appears at the start of the paragraph on the page.

---

### 4d. Open viewer from Step 3

In `step3.js`, when "View in Source PDF →" is clicked:

```javascript
async function openSourceViewer(item) {
  const filePath = await window.api.getSessionFilePath(item.source_file)
  if (!filePath) {
    showToast('Source file not available. Re-parse to restore session files.')
    return
  }
  
  const params = new URLSearchParams({
    page: item.source_page || 1,
    search: (item.spec_text || '').slice(0, 80)
  })
  
  window.api.openPdfViewer(filePath, item.source_page, (item.spec_text || '').slice(0, 80))
}
```

In `main.js`:
```javascript
ipcMain.handle('open-pdf-viewer', (event, filePath, page, searchText) => {
  const viewerWin = new BrowserWindow({
    width: 900,
    height: 1100,
    title: 'Source Document',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  })
  const url = `file://${__dirname}/pdfviewer.html#file=${encodeURIComponent(filePath)}&page=${page}&search=${encodeURIComponent(searchText)}`
  viewerWin.loadURL(url)
})
```

---

### 4e. Viewer UI controls

The viewer window needs minimal controls:
- Current page / total pages indicator
- Previous / Next page buttons
- Zoom in / out (PDF.js provides scale parameter)
- Close button (or just close the window)

Keep it simple — this is a verification tool, not a full PDF reader.

---

### Phase 4 Acceptance Criteria

| Check | Expected |
|-------|----------|
| Click "View in Source PDF" on item 4.1.1 | New window opens |
| Correct page displayed | Window shows the SOW page containing section 4.1.1 |
| Highlight visible | Yellow highlight on "Smoke Canister for Training (Reduced Toxicity)" text |
| No session files | Toast message shown, no crash |
| Security check | Files outside session dir cannot be opened via IPC |
| Window is independent | Closing viewer does not affect main app |
| Offline | Works with no internet connection |

---

## Phase 5 — Test Coverage Expansion

**Objective:** The tool must be dependable across solicitations it has never seen. Current fixtures are limited to 5-7 documents, all of which shaped the parser. New fixtures from outside that set will expose real robustness gaps.

**Files changed:** `testdata/` only — no production code changes unless regressions found

**Effort:** ~1 day (fixture acquisition) + ~2 hours (assertions)  
**Risk:** Low — but will likely surface 1-3 parser bugs that require Phase 5b fixes

---

### 5a. Target solicitation profiles

Acquire at least 5 new test solicitations matching these criteria:

| Profile | Why it tests the parser |
|---------|------------------------|
| DoD supply contract with 30+ CLINs and XLSX pricing | Different line item numbering (CLIN vs SOW 4.x.x) |
| VA medical supplies with size/qty matrix | Size-based quantities, different NAICS |
| GSA IT hardware with multiple attachments | Multiple SOW-style attachments, possible format variant |
| DHS/CBP law enforcement equipment (different from LLSM) | Same agency, different solicitation — tests SF-1449 robustness |
| Army clothing/uniform with size breakdown | W911S format, confirms sam_export with size matrix still works |

**Search approach (Perplexity prompt):**
```
Find federal government solicitations on SAM.gov from 2024-2025 with these characteristics:
- 30 or more line items
- Separate XLSX pricing schedule attachment
- Separate Statement of Work PDF attachment
- Agencies: DHS, DoD, VA, GSA
- Categories: law enforcement equipment, medical supplies, IT hardware, uniforms, vehicle parts

For each, provide: solicitation number, agency, approximate line item count, SAM.gov link.
Need 5 examples with varied formats.
```

---

### 5b. Fixture structure

Each new fixture follows the existing convention:

```
testdata/test_solicitations/
  [SOLICITATION_NUMBER]/
    [main].pdf
    [sow_attachment].pdf         # if applicable
    [pricing_attachment].xlsx    # if applicable
    _expected_output.json        # ground truth
    _notes.md                    # format notes, any parser quirks found
```

`_expected_output.json` structure:
```json
{
  "solicitation_number": "...",
  "format": "sf1449|sam_export|agency_form|formal_rfq",
  "line_item_count": 42,
  "line_items_sample": [
    { "sow_section": "...", "description": "...", "_source": "SOW+XLSX" }
  ],
  "required_fields": ["solicitation_number", "due_date", "contact_email", "naics_code"]
}
```

---

### 5c. Regression harness update

Update `testdata/run.py` to:
1. Accept a `--fixture` argument to run a single fixture
2. Report line item count vs expected count (not just pass/fail)
3. Report which required fields are missing (not just whether extraction succeeded)
4. Exit with non-zero code if any fixture fails (enables future CI use)

---

### Phase 5 Acceptance Criteria

| Check | Expected |
|-------|----------|
| 5 new fixtures acquired | All have _expected_output.json |
| All existing fixtures pass | Zero regressions |
| New fixtures pass | Line item count within ±5 of expected for each |
| Required fields present | solicitation_number, due_date, contact_email, naics_code extracted for each |
| Any parser bugs found | Fixed before Phase 5 is marked complete |

---

## Implementation Order and Dependencies

```
Phase 1 (Data Enrichment)
  └── Phase 2 (Session Persistence)   ← Phase 1 data needed in S.items before Phase 3 UI
        └── Phase 3 (UI Overhaul)     ← Phase 2 session files needed for Phase 4 viewer
              └── Phase 4 (PDF Viewer)
  
Phase 5 (Test Coverage)              ← Independent, run in parallel or after Phase 4
```

Phase 5 can begin any time after Phase 1 is complete. Running it earlier is better — it may surface parser bugs that affect the Phase 3/4 experience.

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `source_page` mapping is off-by-one on some documents | Medium | Low | Phase 1 acceptance criteria include visual spot-check; Phase 4 viewer makes it obvious if wrong |
| PDF.js text layer not rendered when highlight runs | Medium | Medium | Add `requestAnimationFrame` delay; fall back to no highlight (no crash) |
| New solicitation formats break existing parsers | High | Medium | Phase 5 finds these; format detection scoring means unknown formats degrade gracefully |
| Session directory grows unbounded | Low | Low | Clear on new upload; manual clear button; no automatic rotation needed for v1 |
| File path security — IPC handler reads local files | Low | High | Session directory restriction in Phase 4 IPC handler; no user-supplied paths accepted |
| Tab order fix breaks keyboard navigation for screen readers | Low | Medium | Use `button` elements throughout; test with macOS VoiceOver |

---

## Future Work (Not in Scope)

The following are documented here so they don't get lost, but are not part of this plan:

**AI extraction overhaul** — Replace blind truncation in `ai_extract()` with targeted section extraction. Full overhaul as a separate plan once the rule-based pipeline is fully validated.

**NEXUS product database integration** — Connect unit price field to company product database. Line item `part_number` and `manufacturer_ref` are the natural join keys. Architecture: REST call from the Step 3 unit price field on blur, returns price if match found.

**.docx output format redesign** — Pending employer feedback. When received, develop a settings system that enables/disables sections (option year table, signature block, notes, etc.).

**Eval table parser (Phase 3 partial)** — `extract_eval_table_items()` was planned but deferred. The 2-way SOW+XLSX merge produces correct results. Add the eval table as a third source only if a solicitation is found where it adds value the SOW text doesn't already provide.

**Electron installer (.exe / .dmg)** — Final step. Use `electron-builder` with NSIS (Windows) and DMG (macOS). PyInstaller for the Flask backend. This is a packaging task, not a feature task — do it last after all features are stable.

---

## Prompt Library

The following prompts are ready to use with Claude Code, one per phase.

---

### Phase 1 Prompt — Data Enrichment

```
Read python/extractor.py fully before making any changes.

I need to add four new fields to line items during extraction. 
Make these changes in order and show me the result of each before continuing.

CHANGE 1 — spec_text
In extract_sow_line_items(), the variable `body` contains the full spec 
paragraph for each item but is not stored. Add to each item dict:
  "spec_text": body.strip()[:2000]

CHANGE 2 — source_page
Add an optional second parameter to extract_sow_line_items():
  def extract_sow_line_items(text: str, page_texts: list | None = None) -> list[dict]:

Build a page boundary map from page_texts (list of per-page text strings, 
joined with \n\n to form `text`). For each match, find which page it falls 
on by comparing the match character position against page boundaries.
Add to each item: "source_page": <int or None>

Update parse_solicitation_bundle() to pass doc_result.page_texts when 
calling extract_sow_line_items() for SOW documents.

CHANGE 3 — source_file
In parse_solicitation_bundle(), after calling extract_sow_line_items(),
set source_file on each returned item:
  item["source_file"] = sow_filename  # original filename, not full path

CHANGE 4 — _source provenance + qty_total
In merge_line_item_sources(), after the merge loop:

a) Tag each item with _source:
   - has spec_text AND qty_period_1 is not None → "SOW+XLSX"
   - has spec_text only → "SOW"
   - has qty_period_1 only → "XLSX"
   - neither → "unknown"

b) Compute qty_total = sum of all non-None period values in quantities_by_period
   Set item["qty_total"] = total (or None if no period data)
   Override item["qty"] = qty_total if not None, else keep existing qty value

VALIDATION — after all changes:
python3 -c "
from document_loader import load_document
from extractor import parse_solicitation_bundle
files = [
  {'path': 'path/to/70B06C26Q00000080.pdf', 'filename': '70B06C26Q00000080.pdf'},
  {'path': 'path/to/70B06C26Q00000080Attachment1LLSMSOW.pdf', 'filename': '70B06C26Q00000080Attachment1LLSMSOW.pdf'},
  {'path': 'path/to/pricing.xlsx', 'filename': 'pricing.xlsx'},
]
result = parse_solicitation_bundle(files)
item = result['line_items'][0]
print('sow_section:', item.get('sow_section'))
print('spec_text[:80]:', (item.get('spec_text') or '')[:80])
print('source_page:', item.get('source_page'))
print('source_file:', item.get('source_file'))
print('_source:', item.get('_source'))
print('qty_total:', item.get('qty_total'))
print('qty:', item.get('qty'))
"

Expected: spec_text contains "M201A1", source_page is an integer, 
_source is "SOW+XLSX", qty_total is a number > 0.

Then run: python testdata/run.py
Expected: zero regressions on all existing fixtures.
```

---

### Phase 2 Prompt — Session File Persistence

```
Read python/server.py and electron/main.js and electron/preload.js fully 
before making any changes.

I need uploaded files to persist in a session directory instead of being 
cleaned up immediately after parse. This is required for the PDF viewer 
in a later phase.

SESSION DIRECTORY: ~/.sol-quoter/session/current/
Create it if it doesn't exist. Use pathlib.Path.home() / ".sol-quoter" / "session" / "current"

CHANGE 1 — server.py: session directory management

Add a helper function:
  def get_session_dir() -> Path:
      d = Path.home() / ".sol-quoter" / "session" / "current"
      d.mkdir(parents=True, exist_ok=True)
      return d

Add a new route:
  POST /api/sol-quoter/session/clear
  → wipe and recreate the session directory
  → return {"status": "cleared"}

CHANGE 2 — server.py: /parse route file handling

Replace the current temp-file + finally-cleanup pattern with:
1. Call clear_session (wipe and recreate session dir)
2. Save each uploaded file to SESSION_DIR using its original filename
3. Track saved paths in a list
4. Run parse_solicitation_bundle with the session file paths
5. Write a manifest.json to SESSION_DIR:
   {
     "timestamp": "<ISO datetime>",
     "solicitation_number": "<from parse result>",
     "files": {
       "main": "<filename>",
       "sow": "<filename or null>",
       "pricing": "<filename or null>"
     }
   }
6. Add "_session_files" to the parse response:
   {
     "main": "<absolute path or null>",
     "sow": "<absolute path or null>", 
     "pricing": "<absolute path or null>"
   }
7. No cleanup — files stay until next upload or explicit clear

CHANGE 3 — server.py: validate_upload accepts .xlsx

Ensure validate_upload() accepts .xlsx/.xls files in addition to PDF/DOCX/TXT.
Check magic bytes: PK header (ZIP) is valid for XLSX.

CHANGE 4 — main.js: IPC handler for session file path

Add handler:
  ipcMain.handle('get-session-file-path', (event, filename) => {
    const sessionDir = path.join(os.homedir(), '.sol-quoter', 'session', 'current')
    const filePath = path.join(sessionDir, filename)
    return fs.existsSync(filePath) ? filePath : null
  })

CHANGE 5 — preload.js: expose new APIs

Add to the contextBridge exposeInMainWorld object:
  getSessionFilePath: (filename) => ipcRenderer.invoke('get-session-file-path', filename)
  clearSession: () => fetch('/api/sol-quoter/session/clear', {method: 'POST'})

CHANGE 6 — step1.js: store session files + clear on new upload

In the parse response handler, store result._session_files in S.sessionFiles.
Before starting a new upload/parse, call window.api.clearSession().

Add a "Clear & Reparse" button somewhere accessible on Step 2 that:
1. Calls window.api.clearSession()
2. Resets wizard to Step 1 (call goTo(1) or equivalent)

VALIDATION:
1. Upload the 70B bundle (3 files)
2. Check that ~/.sol-quoter/session/current/ contains the 3 files + manifest.json
3. Check that S.sessionFiles contains correct absolute paths
4. Start a new upload — verify session dir is cleared and repopulated
5. Click "Clear & Reparse" — verify wizard resets to Step 1
```

---

### Phase 3 Prompt — Line Items Table UI Overhaul

```
Read electron/js/modules/step3.js and electron/index.html (Step 3 section) 
fully before making any changes.

Make these changes in order. Show me the result of each before continuing.

CHANGE 1 — Column legibility
a) Row number column: add min-width: 2.5rem and white-space: nowrap 
   to the # column th and td. Row numbers must never wrap.
b) Unit price input: ensure min-width is at least 6rem and font size 
   matches surrounding text. Must be legible for 5-6 digit values.
c) Qty display: ensure min-width 4rem, right-aligned, legible.

CHANGE 2 — Tab order (vertical navigation)
After renderLineItems() completes, call wireTabOrder().

wireTabOrder() should:
- Select all unit price inputs (.lt-input-price or equivalent selector)
- On each input, listen for keydown
- Tab (no shift): prevent default, focus next unit price input
- Shift+Tab: prevent default, focus previous unit price input
- First/last item: wrap-around is optional but do not crash

CHANGE 3 — Expand column and chevron toggle
Add a new column as the first column of the line items table.
- Header: empty (no label)
- Width: 2rem
- Each row gets a <button class="expand-btn" aria-expanded="false">▶</button>
- CSS: .expand-btn.open { transform: rotate(90deg); }
- Transition: transform 0.15s ease

CHANGE 4 — Inline detail panel
When expand-btn is clicked:

a) If this row is already open: remove the detail row, set aria-expanded="false", 
   remove .open class. Done.

b) If another row is open: close it first (remove its detail row, reset its button).

c) Insert a new <tr class="detail-row"> immediately after the clicked item row.
   The detail row has a single <td colspan="[all columns]">.
   
   Inside the td, render this structure:
   
   <div class="detail-panel">
     <div class="detail-meta">
       <span class="detail-section">Section: {sow_section}</span>
       <span class="detail-badge badge-{_source_css}">{_source}</span>
     </div>
     
     [If manufacturer_ref or part_number present:]
     <div class="detail-refs">
       <span>Manufacturer: {manufacturer_ref || '—'}</span>
       <span>Part #: {part_number || '—'}</span>
     </div>
     
     <div class="detail-quantities">
       <span class="qty-label">Estimated Quantities:</span>
       <span>P1: {qty_period_1 ?? '—'}</span>
       <span>P2: {qty_period_2 ?? '—'}</span>
       <span>P3: {qty_period_3 ?? '—'}</span>
       <span>P4: {qty_period_4 ?? '—'}</span>
       <span>P5: {qty_period_5 ?? '—'}</span>
       <span>Total: {qty_total ?? '—'}</span>
     </div>
     
     [If spec_text present:]
     <div class="detail-spec">
       <span class="spec-label">Specification:</span>
       <p class="spec-text">{spec_text}</p>
     </div>
     
     [If source_file and source_page present:]
     <div class="detail-actions">
       <button class="btn-view-source" 
               data-file="{source_file}" 
               data-page="{source_page}"
               data-search="{spec_text_first_80_chars}">
         View in Source PDF →
       </button>
     </div>
     
     [If no spec_text AND no manufacturer_ref AND no part_number:]
     <p class="detail-empty">No additional detail available</p>
   </div>

Badge CSS classes:
  _source "SOW+XLSX" → badge-sow-xlsx (green background)
  _source "SOW"      → badge-sow      (blue background)
  _source "XLSX"     → badge-xlsx     (amber background)
  _source "unknown"  → badge-unknown  (gray background)
Use CSS variables for colors, not hardcoded hex.

The "View in Source PDF →" button click handler for now should just:
  console.log('View source:', file, page, search)
(The full handler is wired in Phase 4)

VALIDATION:
1. Parse 70B bundle, go to Step 3
2. Row number "10" → single line, no wrap ✓
3. Unit price input → legible at normal zoom ✓
4. Tab from row 1 unit price → row 2 unit price focused ✓
5. Click expand on item 4.1.1:
   - Panel shows "Defense Technologies", "1063" ✓
   - Shows period quantities P1–P5 ✓
   - Shows spec text containing "M201A1" ✓
   - Badge shows "SOW+XLSX" in green ✓
   - "View in Source PDF →" button present ✓
6. Click expand again → panel collapses ✓
7. Click item 2 while item 1 open → item 1 collapses, item 2 opens ✓
```

---

### Phase 4 Prompt — PDF Source Viewer

```
Read electron/main.js, electron/preload.js, and electron/js/modules/step3.js 
fully before making any changes.

I need a PDF viewer window that opens to a specific page and highlights text.
Using PDF.js vendored locally (offline-capable — no CDN).

STEP 1 — Download and vendor PDF.js
Download the latest stable PDF.js prebuilt distribution from:
  https://github.com/mozilla/pdf.js/releases
Extract to: electron/vendor/pdfjs/
Required files:
  electron/vendor/pdfjs/build/pdf.min.js
  electron/vendor/pdfjs/build/pdf.worker.min.js
  electron/vendor/pdfjs/web/pdf_viewer.css

Verify by checking both files exist and are non-empty.

STEP 2 — IPC handler: read file as ArrayBuffer (main.js)

Add handler with security restriction:
  ipcMain.handle('read-file-as-array-buffer', async (event, filePath) => {
    const sessionDir = path.join(os.homedir(), '.sol-quoter', 'session', 'current')
    const resolved = path.resolve(filePath)
    if (!resolved.startsWith(sessionDir)) {
      throw new Error('Access denied: file outside session directory')
    }
    const buffer = fs.readFileSync(resolved)
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  })

Add IPC handler for opening the viewer window:
  ipcMain.handle('open-pdf-viewer', (event, filePath, page, searchText) => {
    const viewerWin = new BrowserWindow({
      width: 920,
      height: 1100,
      title: 'Source Document',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        nodeIntegration: false,
        contextIsolation: true
      }
    })
    const encoded = encodeURIComponent(JSON.stringify({ filePath, page, searchText }))
    viewerWin.loadFile('pdfviewer.html', { hash: encoded })
  })

STEP 3 — preload.js: expose new APIs

Add:
  readFileAsArrayBuffer: (filePath) => ipcRenderer.invoke('read-file-as-array-buffer', filePath),
  openPdfViewer: (filePath, page, searchText) => ipcRenderer.invoke('open-pdf-viewer', filePath, page, searchText)

STEP 4 — electron/pdfviewer.html (new file)

Create a complete standalone HTML file. It must:

1. Load PDF.js from local vendor path (relative path from pdfviewer.html location):
   <script src="vendor/pdfjs/build/pdf.min.js"></script>

2. Set workerSrc:
   pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/build/pdf.worker.min.js'

3. On load: parse window.location.hash to get { filePath, page, searchText }

4. Load PDF via window.api.readFileAsArrayBuffer(filePath), then 
   pdfjsLib.getDocument({ data: arrayBuffer })

5. Render the target page to a <canvas> element

6. Render the text layer over the canvas (required for highlighting):
   Use pdfjsLib TextLayer or the manual approach:
   - getTextContent() on the page
   - Create a div.textLayer positioned over the canvas
   - Render text spans matching PDF coordinate space

7. After text layer renders, highlight matching text:
   - Search spans for text containing the first 30 chars of searchText
   - Add class "sol-highlight" to matching spans

8. Show page controls:
   - "< Prev" / "Next >" buttons
   - "Page N of M" indicator
   - Page navigation updates canvas and text layer, re-runs highlight

CSS for highlight:
  .sol-highlight { background: rgba(255, 220, 0, 0.45); border-radius: 2px; }

Handle errors gracefully:
  - File not found: show "Source file not available. Re-parse the solicitation."
  - Page out of range: show page 1 instead
  - No text match: render page normally with no highlight (do not crash)

STEP 5 — Wire "View in Source PDF →" button in step3.js

Replace the console.log placeholder from Phase 3 with:
  
  document.addEventListener('click', async e => {
    const btn = e.target.closest('.btn-view-source')
    if (!btn) return
    
    const filename = btn.dataset.file
    const page = parseInt(btn.dataset.page) || 1
    const search = btn.dataset.search || ''
    
    const filePath = await window.api.getSessionFilePath(filename)
    if (!filePath) {
      // Show user-facing message (use existing toast/notification pattern)
      showToast('Source file not available. Re-parse the solicitation to restore.')
      return
    }
    
    await window.api.openPdfViewer(filePath, page, search)
  })

VALIDATION:
1. Parse 70B bundle
2. Go to Step 3, expand item 4.1.1
3. Click "View in Source PDF →"
4. New window opens showing the SOW PDF ✓
5. Correct page is displayed (page containing section 4.1.1) ✓
6. Yellow highlight visible on "Smoke Canister for Training" text ✓
7. Page navigation buttons work ✓
8. Close window → main app unaffected ✓
9. Click button when session is cleared → toast shown, no crash ✓
10. No internet connection → still works ✓
```

---

### Phase 5 Prompt — Test Coverage Expansion

```
Read testdata/run.py fully before making any changes.

I need to improve the regression harness and add new test fixtures.

CHANGE 1 — run.py improvements

Add --fixture argument:
  python testdata/run.py --fixture 70B06C26Q00000080
  (runs only that fixture; default is all fixtures)

Improve reporting:
- For each fixture, show: fields extracted vs expected, line item count vs expected
- Show specifically which required fields are missing (not just pass/fail)
- Exit code 1 if any fixture fails (enables future CI)

Required fields to check for every fixture:
  solicitation_number, due_date, contact_email, naics_code

CHANGE 2 — New fixture structure

For each new solicitation I provide, create:
  testdata/test_solicitations/[NUMBER]/_expected_output.json
  
Template:
{
  "solicitation_number": "",
  "format": "",
  "line_item_count": 0,
  "line_items_sample": [],
  "required_fields": ["solicitation_number", "due_date", "contact_email", "naics_code"],
  "notes": ""
}

CHANGE 3 — Run all fixtures and report

After structure changes, run:
  python testdata/run.py

Show full output. For any failures, identify whether it is:
a) A parser bug (wrong field extracted)
b) A missing field (extractor doesn't find it)
c) A format detection issue (wrong format detected)

Do not fix any bugs found in this prompt — report them only.
I will file them as separate tasks.
```

---

*End of plan — version 1.0*
