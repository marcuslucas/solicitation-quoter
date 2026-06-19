# Phase 9 — BBox Wiring + Test Coverage: Completion Report

**Date:** 2026-05-05
**Status:** Complete — all automated tests pass; manual tests documented below

---

## Files Modified

| File | Change summary |
|------|----------------|
| `electron/main.js` | Added module-level `viewerWin`; rewrote `open-pdf-viewer` handler |
| `electron/preload.js` | Added `bbox` param to `openPdfViewer`; added `onNavigateToBbox` |
| `electron/pdfviewer.html` | Added state vars, `currentViewport` assignment, `renderBboxOverlay()`, overlay/IPC wiring |
| `electron/js/modules/step2.js` | Replaced no-op stub with async `scrollPdfToBoundingBox` |

No expected output files were modified. `testdata/run.py` was not modified.

---

## Part A — Functions Added or Changed

### `electron/main.js`

**Added (module scope, line 11):**
```javascript
let viewerWin = null  // PDF viewer window — single-instance enforced
```

**Modified: `open-pdf-viewer` IPC handler**

BEFORE (lines 291–311):
```javascript
ipcMain.handle('open-pdf-viewer', (event, filePath, page, searchText) => {
  const viewerWin = new BrowserWindow({ ... })
  const params = encodeURIComponent(JSON.stringify({
    filePath, page: page || 1, searchText: searchText || ''
  }))
  viewerWin.loadFile(path.join(__dirname, 'pdfviewer.html'), { hash: params })
  return { status: 'opening' }
})
```

AFTER:
```javascript
ipcMain.handle('open-pdf-viewer', (event, filePath, page, searchText, bbox) => {
  bbox = bbox || null

  if (viewerWin && !viewerWin.isDestroyed()) {
    viewerWin.webContents.send('navigate-to-bbox', {
      filePath, page: page || 1, searchText: searchText || '', bbox
    })
    viewerWin.focus()
    return { status: 'navigated' }
  }

  viewerWin = new BrowserWindow({ ... })
  viewerWin.on('closed', () => { viewerWin = null })

  const params = encodeURIComponent(JSON.stringify({
    filePath, page: page || 1, searchText: searchText || '', bbox: bbox || null
  }))
  viewerWin.loadFile(path.join(__dirname, 'pdfviewer.html'), { hash: params })
  return { status: 'opening' }
})
```

Key invariant: `viewerWin` is declared at module scope (line 11), not inside the handler. The `closed` event nulls the reference. The `isDestroyed()` check prevents sending to a destroyed window.

---

### `electron/preload.js`

**Modified: `openPdfViewer`** — added `bbox` as 4th parameter:
```javascript
// BEFORE
openPdfViewer: (filePath, page, searchText) =>
  ipcRenderer.invoke('open-pdf-viewer', filePath, page, searchText),

// AFTER
openPdfViewer: (filePath, page, searchText, bbox) =>
  ipcRenderer.invoke('open-pdf-viewer', filePath, page, searchText, bbox),
```

**Added: `onNavigateToBbox`** — exposes IPC push-message receiver:
```javascript
onNavigateToBbox: (callback) =>
  ipcRenderer.on('navigate-to-bbox', (_, data) => callback(data)),
```

This is safe in both main window and pdfviewer.html contexts. The main window has the method but no code calls it.

---

### `electron/js/modules/step2.js`

**Replaced: `window.scrollPdfToBoundingBox`** — was a 3-line no-op stub, now a full async implementation:

```javascript
// BEFORE
// scrollPdfToBoundingBox — no-op stub. Inline viewer removed in Phase 10 (UI Fix 2).
// Wiring kept intact so flagged-field click handlers don't throw.
window.scrollPdfToBoundingBox = function() {}

// AFTER
window.scrollPdfToBoundingBox = async function(bbox) {
  // bbox is the parsed boundingBox object from data-bbox:
  // { page: 1, x0: 72.0, y0: 400.0, x1: 540.0, y1: 420.0 }
  if (!bbox) return

  const filename = window.S.file && window.S.file.name
  if (!filename) return

  const filePath = await window.api.getSessionFilePath(filename)
  if (!filePath) {
    if (typeof window.toast === 'function') {
      window.toast(
        'Source file not in session. Re-parse the solicitation to restore it.',
        'error'
      )
    }
    return
  }

  await window.api.openPdfViewer(filePath, bbox.page || 1, '', bbox)
}
```

Click handler at lines 553–563 was not modified — it already passes the parsed `bbox` object (not the element) to `scrollPdfToBoundingBox`:
```javascript
c.querySelectorAll('input[data-bbox]').forEach(el => {
  el.style.cursor = 'pointer'
  el.addEventListener('click', () => {
    const bbox = JSON.parse(el.dataset.bbox)
    if (typeof window.scrollPdfToBoundingBox === 'function') {
      window.scrollPdfToBoundingBox(bbox)
    }
  })
})
```

---

### `electron/pdfviewer.html`

**Added (state block, after `let renderPending = false`):**
```javascript
let currentViewport = null  // set in renderPage(); used by renderBboxOverlay()
let initBbox        = null  // bbox from hash params or navigate-to-bbox IPC
```

**Modified: `renderPage()`** — added `currentViewport = viewport` assignment immediately after `page.getViewport()`:
```javascript
// BEFORE
const viewport = page.getViewport({ scale: currentScale })
// Resize canvas to match viewport

// AFTER
const viewport = page.getViewport({ scale: currentScale })
currentViewport = viewport
// Resize canvas to match viewport
```

**Modified: hash-param parsing** — added `bbox: initBbox` destructuring:
```javascript
// BEFORE
;({ filePath, page, searchText } = JSON.parse(raw))

// AFTER
;({ filePath, page, searchText, bbox: initBbox } = JSON.parse(raw))
initBbox = initBbox || null
```

**Added: `renderBboxOverlay(bbox)` function** — placed in new `── BBOX OVERLAY ──` section after keyboard shortcuts and before `── INIT ──`. Converts PDF coordinate space (origin bottom-left, y upward) to canvas coordinate space (origin top-left, y downward) using:
```javascript
const left   = bbox.x0 * currentScale
const top    = currentViewport.height - bbox.y1 * currentScale
const width  = (bbox.x1 - bbox.x0) * currentScale
const height = (bbox.y1 - bbox.y0) * currentScale
```
Creates a `div#sol-bbox-overlay` with blue dashed border, appends to `#viewer-container` (already `position:relative`), then scrolls into view.

**Modified: initialization block** — added after `await goToPage(targetPage)`:
```javascript
// Draw bbox overlay for the initial bbox (if any)
if (initBbox) renderBboxOverlay(initBbox)

// Wire IPC listener for subsequent navigate-to-bbox messages from main.js
if (window.api && typeof window.api.onNavigateToBbox === 'function') {
  window.api.onNavigateToBbox(async ({ page: newPage, bbox: newBbox }) => {
    const pg = (newBbox && newBbox.page)
      ? newBbox.page
      : (newPage || currentPage)
    await goToPage(pg)
    renderBboxOverlay(newBbox || null)
  })
}
```

The IPC listener is registered **after** `await goToPage(targetPage)` completes, ensuring the PDF is fully rendered before the first navigation message could arrive.

---

## Part B — Test Coverage

No files were modified for Part B. The diagnostic confirmed all 6 expected output files were already on v2 schema and `run.py` already handles all v2 keys via `META_KEYS`.

---

## Validation Results

### Test 1 — Schema validation (automated)

```
_expected_output.json: OK
36C24225Q0696_expected_output.json: OK
70B06C26Q00000080_expected_output.json: OK
_expected_output.json: OK
_expected_output.json: OK
request-for-quotation_expected_output.json: OK
All OK: True
```

All 6 expected output files contain all required v2 schema keys.

---

### Test 2 — Full regression suite

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

Exit code: 0. All 6 fixtures pass.

---

### Test 3 — BBox overlay coordinate check (manual, requires running app)

**Steps:**
1. Parse the 70B bundle (upload all 3 files). Navigate to Step 2.
2. Open DevTools (Ctrl+Shift+I in the Step 2 window).
3. Run: `document.querySelector('input[data-bbox]').dataset.bbox`
4. Record the bbox values (e.g., `{"page":1,"x0":72.0,"y0":400.0,"x1":540.0,"y1":420.0}`).
5. Click that flagged field input.

**Expected:**
- PDF viewer window opens to the page number in `bbox.page`
- Blue dashed rectangle (rgba(59,130,246,0.15) fill, 2px dashed border) appears in the correct position
- Viewer auto-scrolls to bring the rectangle into view

---

### Test 4 — Single viewer window enforcement (manual)

**Steps:**
1. Click flagged field A — viewer opens to its page and shows overlay.
2. Without closing the viewer, click a different flagged field B.
3. Observe.

**Expected (from code):** The `open-pdf-viewer` handler checks `viewerWin && !viewerWin.isDestroyed()`. If alive, it calls `viewerWin.webContents.send('navigate-to-bbox', ...)` and `viewerWin.focus()` — no new window is created. The viewer navigates to the new page and draws the new overlay.

**Confirmed from code:** Only one `BrowserWindow` allocation path exists (the `else` branch after the `isDestroyed()` check). The `viewerWin.focus()` call brings the existing window to front.

---

### Test 5 — Viewer closed then reopened (manual)

**Steps:**
1. Click a flagged field — viewer opens.
2. Close the viewer window (click X).
3. Click a flagged field again.

**Expected (from code):** When the viewer window closes, `viewerWin.on('closed', () => { viewerWin = null })` fires, nulling the reference. On the next click, `viewerWin && !viewerWin.isDestroyed()` is `false` (null check fails), so the handler creates a fresh `BrowserWindow` and loads the PDF from the hash params including the new bbox.

**Confirmed from code:** No crash path exists — the null check is safe, and the new window creation path is identical to the original handler, so the PDF loads normally.

---

### Test 6 — Null bbox safety

**From code:** `window.scrollPdfToBoundingBox` has `if (!bbox) return` as its first line. Calling `window.scrollPdfToBoundingBox(null)` returns immediately with no side effects, no errors, and no IPC calls.

---

## Open Items

- **Task C (Phase 9.2):** Acquire 5 new SAM.gov fixtures. Requires manual PDF download. Target: 11/11 fixtures pass. This is the only remaining item for Phase 9.

---

*Generated: 2026-05-05. All code changes are complete and automated tests pass.*
