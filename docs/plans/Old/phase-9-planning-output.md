# Phase 9 — BBox Wiring + Test Coverage: Diagnostic Report & Implementation Plan

**Date:** 2026-05-05
**Scope:** Phase 9 of sol-quoter-roadmap-phases-6-10.md
**Status:** Planning — no code written

---

## Files Read

- `electron/main.js` — full (332 lines)
- `electron/preload.js` — full (21 lines)
- `electron/pdfviewer.html` — full (457 lines)
- `electron/js/modules/step2.js` — full (574 lines)
- `testdata/run.py` — full (382 lines)
- `docs/plans/phase-8-planning-output.md` — full
- `docs/plans/sol-quoter-roadmap-phases-6-10.md` — Phase 9 section
- All 6 `_expected_output.json` files

---

## Part A — BBox Wiring — Diagnostic Answers

### Q1 — `open-pdf-viewer` IPC handler in full

**`main.js` lines 291–311 — exact handler:**

```javascript
ipcMain.handle('open-pdf-viewer', (event, filePath, page, searchText) => {
  const viewerWin = new BrowserWindow({
    width: 920,
    height: 1100,
    minWidth: 600,
    minHeight: 700,
    title: 'Source Document Viewer',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  })
  const params = encodeURIComponent(JSON.stringify({
    filePath,
    page: page || 1,
    searchText: searchText || ''
  }))
  viewerWin.loadFile(path.join(__dirname, 'pdfviewer.html'), { hash: params })
  return { status: 'opening' }
})
```

**How it opens:** Creates a new `BrowserWindow` unconditionally on every invocation. Encodes `filePath`, `page`, and `searchText` as a JSON string, URI-encodes it, and passes it as the URL hash when calling `loadFile()`.

**viewerWin reference:** `viewerWin` is a **local variable** inside the handler. It is not stored anywhere after the handler returns. The reference is lost at end-of-call — there is no way to reach the viewer window after creation.

---

### Q2 — Mechanism to check if viewer window is already open

**Absent.** There is no module-level variable for the viewer window, no `BrowserWindow.getAllWindows()` scan, and no reference store anywhere in `main.js`. Every click that triggers `open-pdf-viewer` creates a brand-new `BrowserWindow`.

**Where to add the module-level variable:** After line 10 (`let backend = null`), at line 11. This keeps all module-level process handles together:

```javascript
let win = null        // line 9
let backend = null    // line 10
let viewerWin = null  // INSERT HERE — line 11
```

---

### Q3 — pdfviewer.html preload: same or separate?

**Same `preload.js`.** The `BrowserWindow` constructor at lines 292–302 uses:

```javascript
webPreferences: {
  preload: path.join(__dirname, 'preload.js'),
  nodeIntegration: false,
  contextIsolation: true
}
```

This is identical to the main window's `webPreferences` at line 108. Both windows share `preload.js` and thus both have `window.api` with the same 18 methods.

**Consequence for Phase 9:** Any new method added to `preload.js` will be exposed in both windows. For `onNavigateToBbox`, this is harmless — the main window will have the method available but nothing in `index.html` calls it.

---

### Q4 — How pdfviewer.html receives initial parameters

**Hash-parsing code — `pdfviewer.html` lines 402–415:**

```javascript
let filePath, page, searchText
try {
  const raw = decodeURIComponent(window.location.hash.slice(1))
  ;({ filePath, page, searchText } = JSON.parse(raw))
} catch (e) {
  showError('Invalid viewer parameters. Close this window and try again from Step 3.')
  return
}
```

**State variables initialized from params:**

- `filePath`: used directly for the `readFileAsArrayBuffer` call (line 430)
- `targetPage = parseInt(page) || 1` (line 423), then clamped to `[1, totalPages]` (line 447)
- `initSearch = (searchText || '').trim()` (line 422)

`bbox` is not currently in the hash params — it must be added.

---

### Q5 — `renderPage()` function: viewport, canvas, container CSS

**Function signature (line 286):**

```javascript
async function renderPage(pageNum, highlightText) {
```

**First ~30 lines (lines 286–325):**

```javascript
async function renderPage(pageNum, highlightText) {
  if (!pdfDoc) return
  pageNum = Math.max(1, Math.min(pageNum, totalPages))
  currentPage = pageNum

  if (renderPending) return
  renderPending = true

  try {
    const page     = await pdfDoc.getPage(pageNum)
    const viewport = page.getViewport({ scale: currentScale })

    // Resize canvas to match viewport
    canvas.width  = viewport.width
    canvas.height = viewport.height

    // Render PDF to canvas
    const ctx = canvas.getContext('2d')
    await page.render({ canvasContext: ctx, viewport }).promise

    // Clear and resize text layer
    textLayerDiv.innerHTML    = ''
    textLayerDiv.style.width  = viewport.width  + 'px'
    textLayerDiv.style.height = viewport.height + 'px'

    // Render text layer (needed for highlight; non-fatal if it fails)
    try {
      const textContent = await page.getTextContent()
      ...
```

**`viewport` storage:** Created at line 297 (`const viewport = page.getViewport(...)`). It is **local to `renderPage()`** — scoped inside the function body and not assigned to any module-level variable. It is not accessible outside `renderPage()` after the function returns.

**`canvas` storage:** Module-level constant at line 217: `const canvas = document.getElementById('pdf-canvas')`. Accessible everywhere in the IIFE.

**Canvas container `position:relative`:** `#viewer-container` CSS at lines 96–102:

```css
#viewer-container {
  position: relative;
  display: inline-block;
  box-shadow: 0 2px 16px rgba(0, 0, 0, 0.7);
  align-self: flex-start;
}
```

**`position: relative` is already set.** No CSS change is needed for the overlay.

---

### Q6 — contextBridge methods available to pdfviewer.html; IPC receive capability

`pdfviewer.html` shares `preload.js` with the main window. The full `window.api` (all 18 methods) is available, including `readFileAsArrayBuffer` which `pdfviewer.html` already calls at line 430.

**Can pdfviewer.html receive IPC messages from main?**

No, not currently. All 18 `window.api` methods in `preload.js` use `ipcRenderer.invoke()` — they are **renderer → main** one-way calls only. There is no `ipcRenderer.on()` exposed anywhere in `preload.js`. For main to push a message to the viewer window via `webContents.send('navigate-to-bbox', ...)`, the viewer needs a corresponding `ipcRenderer.on()` listener exposed through `contextBridge`.

**Change required in `preload.js`:** Add one new method to the `window.api` object:

```javascript
onNavigateToBbox: (callback) => ipcRenderer.on('navigate-to-bbox', (_, data) => callback(data)),
```

This allows `pdfviewer.html` to register a callback via `window.api.onNavigateToBbox(handler)` and receive messages pushed from `main.js:viewerWin.webContents.send('navigate-to-bbox', ...)`.

---

### Q7 — No-op stub, click handler, and data attributes

**No-op stub — `step2.js` lines 8–10:**

```javascript
// scrollPdfToBoundingBox — no-op stub. Inline viewer removed in Phase 10 (UI Fix 2).
// Wiring kept intact so flagged-field click handlers don't throw.
window.scrollPdfToBoundingBox = function() {}
```

**Complete click handler — `step2.js` lines 553–563:**

```javascript
  // Wire flagged field click → PDF viewer scroll (Plan 05 wires the actual viewer)
  c.querySelectorAll('input[data-bbox]').forEach(el => {
    el.style.cursor = 'pointer'
    el.addEventListener('click', () => {
      const bbox = JSON.parse(el.dataset.bbox)
      // scrollPdfToBoundingBox is defined in Plan 05; graceful no-op if not yet available
      if (typeof window.scrollPdfToBoundingBox === 'function') {
        window.scrollPdfToBoundingBox(bbox)
      }
    })
  })
```

**Data attributes on flagged field `<input>` elements:**

From the template at lines 402–414 (the `items = fields.map(...)` block):

```javascript
<input data-field="${k}"
       class="${invalidClass}"
       value="${esc(String(d[k] || ''))}"
       placeholder="Not found"
       ${flagged && flagged.boundingBox ? ` data-bbox='${JSON.stringify(flagged.boundingBox)}'` : ''}
/>
```

| Attribute | Present? | Example value |
|-----------|----------|---------------|
| `data-field` | Always | `"solicitation_number"` |
| `data-bbox` | Only when `flagged.boundingBox` exists | `'{"page":1,"x0":72.0,"y0":400.0,"x1":540.0,"y1":420.0}'` |
| `data-file` | **Absent** | — |
| `data-page` | **Absent** | — (page is inside `data-bbox` as `bbox.page`) |
| `data-search` | **Absent** | — |

The click handler passes only `bbox` to `scrollPdfToBoundingBox`. The file path is not available from the element — it must be resolved from `window.S` state inside the function itself.

---

### Q8 — Last 15 lines of `step2()` (Phase 8 `checkAiStatus` placement)

**`step2.js` lines 553–567:**

```javascript
  // Wire flagged field click → PDF viewer scroll (Plan 05 wires the actual viewer)
  c.querySelectorAll('input[data-bbox]').forEach(el => {
    el.style.cursor = 'pointer'
    el.addEventListener('click', () => {
      const bbox = JSON.parse(el.dataset.bbox)
      // scrollPdfToBoundingBox is defined in Plan 05; graceful no-op if not yet available
      if (typeof window.scrollPdfToBoundingBox === 'function') {
        window.scrollPdfToBoundingBox(bbox)
      }
    })
  })

  // Phase 8: check AI availability and render panel asynchronously
  checkAiStatus()
}
```

`checkAiStatus()` is the last statement in `step2()`. The stub replacement is in lines 8–10 (file-top, before the function). No conflict: the stub is a module-level assignment, the click handler wiring is inside `step2()`. Replacing the stub does not touch the click handler — the handler already calls `window.scrollPdfToBoundingBox(bbox)` and the replacement function will be in scope.

---

## Part B — Test Coverage — Diagnostic Answers

### Q9 — Keys in pre-Phase-6 expected output files and missing v2 keys

**`36C24225Q0696_expected_output.json` — all keys present:**

`_schema_version`, `format`, `solicitation_number`, `title`, `type`, `agency`, `due_date`, `posting_date`, `contact_name`, `contact_email`, `contact_phone`, `naics_code`, `psc_code`, `set_aside`, `place_of_performance`, `period_of_performance`, `estimated_value`, `scope_of_work`, `line_item_count`, `line_items_sample`, `required_fields`, `notes`

**Missing v2 keys:** None. All 7 required v2 keys (`_schema_version`, `solicitation_number`, `format`, `line_item_count`, `required_fields`, `line_items_sample`, `notes`) are present.

---

**`70B06C26Q00000080_expected_output.json` — all keys present:**

`_schema_version`, `format`, `solicitation_number`, `title`, `type`, `agency`, `due_date`, `posting_date`, `contact_name`, `contact_email`, `contact_phone`, `naics_code`, `psc_code`, `set_aside`, `place_of_performance`, `period_of_performance`, `estimated_value`, `contract_type`, `minimum_guarantee`, `scope_of_work`, `line_item_count`, `line_items_sample`, `required_fields`, `notes`

**Missing v2 keys:** None. All 7 required v2 keys are present.

---

**`request-for-quotation_expected_output.json` — all keys present:**

`_schema_version`, `format`, `solicitation_number`, `title`, `type`, `agency`, `due_date`, `posting_date`, `contact_name`, `contact_email`, `contact_phone`, `naics_code`, `psc_code`, `set_aside`, `place_of_performance`, `period_of_performance`, `estimated_value`, `scope_of_work`, `line_item_count`, `line_items_sample`, `required_fields`, `notes`

**Missing v2 keys:** None. All 7 required v2 keys are present.

**Summary for Q9:** All three pre-Phase-6 expected output files are already fully upgraded to v2 schema. Task A from Phase 9.2 is already complete. No file edits are needed.

---

### Q10 — Phase-6 expected output files: `_schema_version` values

| Fixture | `_schema_version` | Confirmed v2? |
|---------|--------------------|---------------|
| `W911S225U14310001_CSS_08062025/_expected_output.json` | `2` | Yes |
| `N5005426Q0114_CSS_03312026/_expected_output.json` | `2` | Yes |
| `18Q0042/_expected_output.json` | `2` | Yes |

All three Phase-6 fixtures are already on v2 schema.

---

### Q11 — `run.py` complete output verbatim

```
----------------------------------------------------
FIXTURE: 18Q0042
[detect_format] scores={'sam_export': 0, 'agency_form': 0, 'formal_rfq': 2, 'sf1449': 3} -> sf1449
Detected format: sf1449
  Extracted (single)
  Format          : sf1449
  Solicitation #  : N0016418Q0042
  Line items      : 0
  Format detected : sf1449 (expected: sf1449)  OK
  Line items      : 0 extracted, expected 0  OK
  Required fields : solicitation_number OK,  due_date OK,  contact_email OK,  naics_code OK
  Fields          : 6 exact, 0 partial, 0 mismatch / 6 compared
  Result          : PASS
----------------------------------------------------
FIXTURE: 36C24225Q0696
[detect_format] scores={'sam_export': 0, 'agency_form': 6, 'formal_rfq': 0, 'sf1449': 0} -> agency_form
Detected format: agency_form
  Extracted (single)
  Format          : agency_form
  Solicitation #  : 36C24225Q0696
  Line items      : 0
  Format detected : agency_form (expected: agency_form)  OK
  Line items      : 0 extracted, expected 0  OK
  Required fields : solicitation_number OK,  due_date OK,  contact_email OK,  naics_code OK,  contact_name OK
  Fields          : 10 exact, 0 partial, 1 mismatch / 11 compared
    WARN  place_of_performance         got "Buffalo VA Medical Center, Batavia VA Medical Center, 3"
                                       exp "Buffalo VA Medical Center, 3495 Bailey Avenue, Buffalo "
  Result          : PASS (with 1 field warning(s))
----------------------------------------------------
FIXTURE: 70B06C26Q00000080
[parse_solicitation_bundle] 70B06C26Q00000080+Attachment+1+-+LLSM+SOW.pdf -> role=sow, chars=72905
[parse_solicitation_bundle] 70B06C26Q00000080+Attachment+2-Pricing+Sheeet.xlsx -> role=pricing, chars=0
[detect_format] scores={'sam_export': 0, 'agency_form': 0, 'formal_rfq': 0, 'sf1449': 11} -> sf1449
[parse_solicitation_bundle] 70B06C26Q00000080.pdf -> role=main, chars=174674
[detect_format] scores={'sam_export': 0, 'agency_form': 0, 'formal_rfq': 0, 'sf1449': 11} -> sf1449
Detected format: sf1449
[parse_solicitation_bundle] line_items=118 (sow=118, pricing=118)
  Extracted (bundle)
  Format          : sf1449
  Solicitation #  : 70B06C26Q00000080
  Line items      : 118
  Format detected : sf1449 (expected: sf1449)  OK
  Line items      : 118 extracted, expected 118  OK
  Required fields : solicitation_number OK,  due_date OK,  contact_email OK,  naics_code OK,  set_aside OK
  Fields          : 11 exact, 2 partial, 0 mismatch / 13 compared
    PART  period_of_performance        (substring match)
    PART  scope_of_work                (substring match)
  Sample items    : all 3 found OK
  Result          : PASS
----------------------------------------------------
FIXTURE: N5005426Q0114_CSS_03312026
[detect_format] scores={'sam_export': 10, 'agency_form': 0, 'formal_rfq': 0, 'sf1449': 0} -> sam_export
Detected format: sam_export
  Extracted (single)
  Format          : sam_export
  Solicitation #  : N5005426Q0114
  Line items      : 0
  Format detected : sam_export (expected: sam_export)  OK
  Line items      : 0 extracted, expected 0  OK
  Required fields : solicitation_number OK,  due_date OK,  contact_email OK,  naics_code OK
  Fields          : 7 exact, 0 partial, 0 mismatch / 7 compared
  Result          : PASS
----------------------------------------------------
FIXTURE: request-for-quotation
[detect_format] scores={'sam_export': 0, 'agency_form': 0, 'formal_rfq': 6, 'sf1449': 0} -> formal_rfq
Detected format: formal_rfq
  Extracted (single)
  Format          : formal_rfq
  Solicitation #  : 69056725Q000044
  Line items      : 0
  Format detected : formal_rfq (expected: formal_rfq)  OK
  Line items      : 0 extracted, expected 0  OK
  Required fields : solicitation_number OK,  due_date OK,  contact_email OK,  naics_code OK
  Fields          : 14 exact, 0 partial, 0 mismatch / 14 compared
  Result          : PASS
----------------------------------------------------
FIXTURE: W911S225U14310001_CSS_08062025
[detect_format] scores={'sam_export': 10, 'agency_form': 0, 'formal_rfq': 0, 'sf1449': 0} -> sam_export
Detected format: sam_export
  Extracted (single)
  Format          : sam_export
  Solicitation #  : W911S225U14310001
  Line items      : 0
  Format detected : sam_export (expected: sam_export)  OK
  Line items      : 0 extracted, expected 0  OK
  Required fields : solicitation_number OK,  due_date OK,  contact_email OK,  naics_code OK
  Fields          : 7 exact, 0 partial, 0 mismatch / 7 compared
  Result          : PASS
====================================================
SUMMARY: 6 fixture(s) validated, 0 skipped (no expected output)
  PASS : 6
```

**All 6 fixtures pass. Exit code 0.** No failures.

---

### Q12 — `run.py` validation: handling of `_schema_version` and `required_fields`

**`META_KEYS` constant — `run.py` lines 44–47:**

```python
META_KEYS = {
    "_schema_version", "format", "line_item_count", "line_items_sample",
    "required_fields", "notes", "contract_type", "minimum_guarantee",
}
```

**Field comparison loop — `run.py` lines 178–183:**

```python
for key, exp_val in expected.items():
    if key in META_KEYS or exp_val is None:
        continue
    actual_val = get_field(result, key)
    status = compare_field(exp_val, actual_val)
    field_results.append((key, status, exp_val, actual_val))
```

**Behavior for each v2 key:**

| Key | Handling |
|-----|----------|
| `_schema_version` | In `META_KEYS` → silently skipped from field comparison |
| `format` | In `META_KEYS` → skipped from field comparison; handled separately as hard-fail check (lines 139–148) using `result.get("_format")` |
| `line_item_count` | In `META_KEYS` → skipped from field comparison; handled separately as hard-fail check (lines 151–159) |
| `required_fields` | In `META_KEYS` → skipped from field comparison; used separately at line 162 to build the required-field presence check list |
| `line_items_sample` | In `META_KEYS` → skipped from field comparison; used separately for sample-item search (lines 201–218) |
| `notes` | In `META_KEYS` → silently skipped |
| `contract_type` | In `META_KEYS` → silently skipped |
| `minimum_guarantee` | In `META_KEYS` → silently skipped |

**Conclusion:** `run.py` handles all v2 schema keys correctly. No changes to `run.py` are needed for Part B.

---

## Plan A — BBox Wiring

### A1 — Complete IPC Architecture

The full data flow for Phase 9 bbox wiring, step by step:

**1. `step2.js` — user clicks a flagged field input**

```
User clicks input[data-bbox]
  → click handler fires at step2.js:556
  → JSON.parse(el.dataset.bbox) produces bbox = { page, x0, y0, x1, y1 }
  → window.scrollPdfToBoundingBox(bbox) is called
```

**2. `window.scrollPdfToBoundingBox(bbox)` — new implementation in step2.js**

```
async function:
  1. read filename from window.S.file.name
  2. if no filename: return (no-op, no error)
  3. call window.api.getSessionFilePath(filename) → full absolute session path
  4. if null: toast error "Source file not in session. Re-parse to restore."
  5. call window.api.openPdfViewer(filePath, bbox.page || 1, '', bbox)
```

**3. `preload.js` — `openPdfViewer` method**

Current signature:
```javascript
openPdfViewer: (filePath, page, searchText) => ipcRenderer.invoke('open-pdf-viewer', filePath, page, searchText)
```

New signature (add `bbox` param):
```javascript
openPdfViewer: (filePath, page, searchText, bbox) => ipcRenderer.invoke('open-pdf-viewer', filePath, page, searchText, bbox)
```

Also add new method for push-message reception:
```javascript
onNavigateToBbox: (callback) => ipcRenderer.on('navigate-to-bbox', (_, data) => callback(data)),
```

**4. `main.js` — `open-pdf-viewer` IPC handler (modified)**

```
handler fires with (filePath, page, searchText, bbox)
  → bbox = bbox || null
  → if viewerWin && !viewerWin.isDestroyed():
      viewerWin.webContents.send('navigate-to-bbox', { filePath, page, bbox, searchText })
      viewerWin.focus()
      return { status: 'navigated' }
  → else:
      viewerWin = new BrowserWindow({ ...same options... })
      viewerWin.on('closed', () => { viewerWin = null })
      params = JSON.stringify({ filePath, page: page||1, searchText: searchText||'', bbox: bbox||null })
      viewerWin.loadFile(pdfviewer.html, { hash: encodeURIComponent(params) })
      return { status: 'opening' }
```

**5. `pdfviewer.html` — initial load: reads bbox from hash**

Current hash parsing destructures `{ filePath, page, searchText }`. Add `bbox`:
```javascript
;({ filePath, page, searchText, bbox: initBbox } = JSON.parse(raw))
```

Add module-level `let initBbox = null` and `let currentViewport = null`.

After `await goToPage(targetPage)` (line 453), call `renderBboxOverlay(initBbox)`.

**6. `pdfviewer.html` — subsequent navigation: receives `navigate-to-bbox` IPC**

In the IIFE init section, after the initial render:
```javascript
if (window.api && window.api.onNavigateToBbox) {
  window.api.onNavigateToBbox(async ({ page: newPage, bbox: newBbox }) => {
    const pg = (newBbox && newBbox.page) ? newBbox.page : (newPage || currentPage)
    await goToPage(pg)
    renderBboxOverlay(newBbox || null)
  })
}
```

---

### A2 — `viewerWin` tracking in `main.js`

**Module-scope variable placement:**

Add at line 11, immediately after `let backend = null`:

```javascript
let win = null       // line 9
let backend = null   // line 10
let viewerWin = null // line 11 — PDF viewer window; single-instance enforced
```

**Destroyed-check pattern:**

```javascript
if (viewerWin && !viewerWin.isDestroyed()) {
  // window is alive — send navigate message
} else {
  // window is dead or was never created — create it
}
```

`BrowserWindow.isDestroyed()` is the authoritative Electron API for this check. A raw `!== null` check is insufficient because the reference may still be non-null after the window is closed (the variable isn't auto-nulled). `isDestroyed()` is synchronous and safe to call when guarded by `viewerWin &&`.

**The `closed` event handler that nulls the reference:**

Inside the new-window creation branch:
```javascript
viewerWin = new BrowserWindow({ ... })
viewerWin.on('closed', () => { viewerWin = null })
```

This fires when the user closes the PDF viewer window. Nulling `viewerWin` ensures the next bbox click creates a fresh window rather than trying to send to a destroyed one.

**Why this prevents multiple viewer windows:** Every call to the IPC handler now checks the existing reference first. If alive, it reuses it. Only if destroyed/null does it allocate a new `BrowserWindow`. Because `viewerWin` is module-level (not local), it persists across handler calls.

---

### A3 — How `pdfviewer.html` receives `bbox`

**For initial load — hash param parsing change:**

Current: `{ filePath, page, searchText } = JSON.parse(raw)`.

Change: add `bbox` to the destructuring. The hash params object sent by `main.js` will include `bbox: bbox || null`. In `pdfviewer.html`, add a module-level variable:

```javascript
let initBbox = null  // add alongside other module-level state vars (after line 214)
```

In the hash-parsing block (currently lines 402–415), add:
```javascript
;({ filePath, page, searchText, bbox: initBbox } = JSON.parse(raw))
```

After `await goToPage(targetPage)` (line 453), add:
```javascript
if (initBbox) renderBboxOverlay(initBbox)
```

**For subsequent navigation — IPC channel and preload exposure:**

The channel name is `'navigate-to-bbox'`. Main sends it via:
```javascript
viewerWin.webContents.send('navigate-to-bbox', { filePath, page, bbox, searchText })
```

The preload exposure needed (new method in `window.api`):
```javascript
onNavigateToBbox: (callback) => ipcRenderer.on('navigate-to-bbox', (_, data) => callback(data)),
```

In `pdfviewer.html`, after the initial render completes, register the callback:
```javascript
window.api.onNavigateToBbox(async ({ page: newPage, bbox: newBbox }) => {
  const pg = (newBbox && newBbox.page) ? newBbox.page : (newPage || currentPage)
  await goToPage(pg)
  renderBboxOverlay(newBbox || null)
})
```

The callback fires whenever main sends a navigate-to-bbox message to this window. It navigates to the correct page, re-renders, then draws the overlay.

---

### A4 — `renderBboxOverlay()` function plan

**Variables it needs:**

| Variable | Module-level now? | Action needed |
|----------|-------------------|---------------|
| `canvas` | Yes (line 217: `const canvas = document.getElementById('pdf-canvas')`) | None |
| `viewport` | **No — local to `renderPage()`** | Add `let currentViewport = null` module-level; assign inside `renderPage()` |

**Making `viewport` accessible:**

Add to the module-level state block (after `let renderPending = false` at line 214):
```javascript
let currentViewport = null  // set in renderPage() after page.getViewport()
```

Inside `renderPage()`, after line 297 (`const viewport = page.getViewport({ scale: currentScale })`):
```javascript
currentViewport = viewport
```

This gives `renderBboxOverlay()` access to the current page's viewport (page dimensions in canvas-pixel space).

**Coordinate conversion math:**

```
Given:
  bbox = { x0, y0, x1, y1 }  — PDF coordinate space
    origin: bottom-left corner of page
    y increases upward (PDF spec)

  currentViewport:
    width  = pageWidth  * currentScale   (canvas pixels)
    height = pageHeight * currentScale   (canvas pixels)

  Conversions:
    canvas_left   = x0 * currentScale
    canvas_top    = currentViewport.height - y1 * currentScale
    canvas_width  = (x1 - x0) * currentScale
    canvas_height = (y1 - y0) * currentScale
```

**Why `(H - y1)` for canvas top, not `y0`:**

In PDF space, `y0` is the **bottom** edge of the bounding box and `y1` is the **top** edge (`y0 < y1`, y increases upward). The canvas origin is at the top-left, with y increasing downward. To find the canvas pixel position of the box's top edge:

- The box top edge is at PDF y-coordinate `y1`
- Distance from the bottom of the PDF page to `y1` = `y1` points
- Distance from the **top** of the PDF page to `y1` = `pageHeight - y1` points
- In canvas pixels: `(pageHeight - y1) * scale` = `currentViewport.height - y1 * currentScale`

Using `y0` instead would place the top of the overlay div at the box's bottom edge, drawing the box upside-down (wrong position, wrong direction).

**Overlay element: create-or-reuse pattern:**

```javascript
function renderBboxOverlay(bbox) {
  // Clear any existing overlay
  const existing = document.getElementById('sol-bbox-overlay')
  if (existing) existing.remove()

  if (!bbox || !currentViewport) return

  const left   = bbox.x0 * currentScale
  const top    = currentViewport.height - bbox.y1 * currentScale
  const width  = (bbox.x1 - bbox.x0) * currentScale
  const height = (bbox.y1 - bbox.y0) * currentScale

  const overlay = document.createElement('div')
  overlay.id = 'sol-bbox-overlay'
  overlay.style.cssText = [
    'position:absolute',
    `left:${left}px`,
    `top:${top}px`,
    `width:${width}px`,
    `height:${height}px`,
    'background:rgba(59,130,246,0.15)',
    'border:2px dashed rgba(59,130,246,0.8)',
    'border-radius:2px',
    'pointer-events:none',
    'box-sizing:border-box',
  ].join(';')

  document.getElementById('viewer-container').appendChild(overlay)
  overlay.scrollIntoView({ behavior: 'smooth', block: 'center' })
}
```

**Visual spec:** fill `rgba(59,130,246,0.15)` (blue 15% opacity), border `2px dashed rgba(59,130,246,0.8)` (blue 80% opacity dashed), `border-radius:2px`, `position:absolute` (works because `#viewer-container` is already `position:relative`), `pointer-events:none` (does not intercept clicks on the canvas).

**Canvas container `position:relative` requirement:** Already satisfied. `#viewer-container` has `position: relative` in CSS at line 98. No CSS change needed.

**Scroll timing:** `overlay.scrollIntoView(...)` is called **after** `document.getElementById('viewer-container').appendChild(overlay)`. The element must be in the DOM before `scrollIntoView` fires. The call is synchronous so the order is correct.

---

### A5 — Call site in `step2.js`

**Exact replacement for the no-op stub:**

Replace lines 8–10:
```javascript
// scrollPdfToBoundingBox — no-op stub. Inline viewer removed in Phase 10 (UI Fix 2).
// Wiring kept intact so flagged-field click handlers don't throw.
window.scrollPdfToBoundingBox = function() {}
```

With:
```javascript
window.scrollPdfToBoundingBox = async function(bbox) {
  const filename = window.S.file && window.S.file.name
  if (!filename) return
  const filePath = await window.api.getSessionFilePath(filename)
  if (!filePath) {
    window.toast && window.toast('Source file not in session. Re-parse the solicitation to restore it.', 'error')
    return
  }
  window.api.openPdfViewer(filePath, bbox.page || 1, '', bbox)
}
```

**How `fieldEl` is passed:** The click handler does **not** pass `fieldEl`. It only passes `bbox`:

```javascript
el.addEventListener('click', () => {
  const bbox = JSON.parse(el.dataset.bbox)
  if (typeof window.scrollPdfToBoundingBox === 'function') {
    window.scrollPdfToBoundingBox(bbox)  // only bbox, not el
  }
})
```

The implementation does not need `fieldEl` — all required information is available from `bbox.page` (page to navigate to) and `window.S.file.name` (filename to resolve).

**`getSessionFilePath` returns null:** If the session file is not found, `filePath` is `null`. The function calls `window.toast()` with an actionable error message and returns early without calling `openPdfViewer`. This prevents passing `null` as a file path to the viewer.

---

### A6 — Regression risk

**`viewerWin` reference in `main.js`:**

Adding `let viewerWin = null` at the module level does not affect any other IPC handler. No other handler references the PDF viewer window. `generate-pdf` creates its own local `pdfWin` and destroys it immediately (lines 173–181) — independent, no naming conflict.

**`preload.js` addition of `onNavigateToBbox`:**

The new method is added to the same `window.api` contextBridge object. Since both the main window and `pdfviewer.html` share `preload.js`, both windows will have `window.api.onNavigateToBbox` available. In the main window (`index.html`), the method exists but is never called — there is no code in any step module that calls `window.api.onNavigateToBbox`. This is safe and harmless.

**Replacing the no-op stub in `step2.js`:**

`window.scrollPdfToBoundingBox` is assigned at lines 8–10, in module scope, before any function definitions. It is called only from the single click handler at lines 554–563. No other code in any file calls `window.scrollPdfToBoundingBox`. Replacing the stub affects exactly one call site.

**`openPdfViewer` signature change in `preload.js`:**

The existing signature is `(filePath, page, searchText)`. The new signature adds `bbox` as a fourth parameter. All existing calls that pass only three arguments continue to work, with `bbox` being `undefined` in the main.js handler (treated as `null` via `bbox = bbox || null`). The `View PDF` button in step2 (line 509: `window.api.openPath(pdfPath)`) uses `openPath`, not `openPdfViewer` — no conflict.

---

## Plan B — Test Coverage

### B1 — Key-value pairs to add to each pre-Phase-6 expected output file

**Finding:** All three files already contain all required v2 schema keys with correct values. Cross-reference:

| Key | 36C24225Q0696 | 70B06C26Q00000080 | request-for-quotation |
|-----|:---:|:---:|:---:|
| `_schema_version` | 2 ✓ | 2 ✓ | 2 ✓ |
| `solicitation_number` | "36C24225Q0696" ✓ | "70B06C26Q00000080" ✓ | "69056725Q000044" ✓ |
| `format` | "agency_form" ✓ | "sf1449" ✓ | "formal_rfq" ✓ |
| `line_item_count` | 0 ✓ | 118 ✓ | 0 ✓ |
| `required_fields` | [...] ✓ | [...] ✓ | [...] ✓ |
| `line_items_sample` | [] ✓ | [3 items] ✓ | [] ✓ |
| `notes` | "..." ✓ | "..." ✓ | "..." ✓ |

**Action required: none.** Task A from Phase 9.2 is already complete. These files do not need editing.

---

### B2 — `run.py` changes needed for `_schema_version` and `required_fields`

**No changes needed.** `run.py` already handles both keys correctly:

- `_schema_version` is in `META_KEYS` → silently skipped from field comparison; never causes a failure
- `required_fields` is in `META_KEYS` → skipped from field comparison AND correctly used at line 162 to extend the required-field check: `req_fields = list(dict.fromkeys(DEFAULT_REQUIRED + list(expected.get("required_fields", []))))`

The Q11 run confirms this: all 6 fixtures including files with `_schema_version: 2` and `required_fields` arrays pass cleanly with no errors.

---

### B3 — Execution order for Part B

**The correct order is: verify current state → no writes needed → confirm 6/6 pass.**

Since all expected output files already have v2 schema, and `run.py` already passes 6/6:

1. **No file edits needed** for expected output files (v2 upgrade is already done)
2. **No `run.py` changes needed** (META_KEYS handling already correct)
3. **Confirm baseline:** Run `python testdata/run.py` → 6/6 pass (confirmed in Q11 above)

The only remaining open item for Phase 9.2 is **Task C — Acquire 5 new fixtures**. This requires manually downloading PDFs from SAM.gov using the five search queries specified in the roadmap. This cannot be automated and is outside the scope of coding work. It is the only incomplete sub-task in Phase 9.2.

**Task C scope recap** (from roadmap Phase 9.2):
- 5 new fixture directories in `testdata/test_solicitations/`
- Each needs: the PDF, and `_expected_output.json` in v2 schema
- After each is created: run `python testdata/run.py` and confirm the new fixture validates
- Final target: 11/11 pass (6 existing + 5 new)

---

## Summary of Changes by File

### Part A — BBox Wiring

| File | Change | Scope |
|------|--------|-------|
| `electron/main.js` | Add `let viewerWin = null` at line 11; modify `open-pdf-viewer` handler to accept `bbox`, check existing window, reuse or create | ~15 lines modified/added |
| `electron/preload.js` | Add `bbox` param to `openPdfViewer`; add `onNavigateToBbox` method | 2 lines modified |
| `electron/pdfviewer.html` | Add `let initBbox`, `let currentViewport`; extend hash parsing for `bbox`; assign `currentViewport` inside `renderPage()`; add `renderBboxOverlay()` function; call it after initial `goToPage()`; register `onNavigateToBbox` listener | ~40 lines added/modified |
| `electron/js/modules/step2.js` | Replace 3-line no-op stub with async `scrollPdfToBoundingBox` implementation | 3 lines replaced with ~10 |

### Part B — Test Coverage

| File | Change | Scope |
|------|--------|-------|
| `testdata/test_solicitations/*/` expected files | **None** — all already on v2 schema | — |
| `testdata/run.py` | **None** — META_KEYS already handles v2 keys correctly | — |
| `testdata/test_solicitations/[5 new]/` | New fixture directories with PDFs + `_expected_output.json` (manual acquisition from SAM.gov required) | Manual task, out of scope for code phase |

---

*End of Phase 9 diagnostic report and implementation plan.*
*Generated: 2026-05-05. No code was modified during this analysis.*
