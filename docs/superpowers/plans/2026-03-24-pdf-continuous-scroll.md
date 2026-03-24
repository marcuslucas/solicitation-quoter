# PDF Viewer Continuous Scroll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-page static PDF canvas with a scrollable multi-page viewer that renders all pages stacked vertically, and update `scrollPdfToBoundingBox` to scroll smoothly to the correct page and y-position.

**Architecture:** Add `_pdfLoading` guard to prevent concurrent loads. `loadPdfViewer()` renders all pages into `#pdf-pages-container` (one `<canvas id="pdf-page-N">` per page). `scrollPdfToBoundingBox` uses `getBoundingClientRect()` for panel-relative scroll offset. `renderPdfPage()` is deleted — it is no longer needed.

**Tech Stack:** Electron renderer (file:// protocol), pdfjs-dist 3.x UMD (`window.pdfjsLib`), vanilla JS, inline CSS in `electron/index.html`.

---

## File Map

| File | Change |
|------|--------|
| `electron/index.html` | Three CSS changes: `overflow-y: auto` on `.pdf-viewer-panel.expanded`; new `#pdf-pages-container { position: relative }` rule; replace `.pdf-viewer-panel canvas` rule with `#pdf-pages-container canvas` (adds `margin-bottom: 8px`) |
| `electron/js/modules/step2.js` | Add `_pdfLoading` module var; rewrite `loadPdfViewer()`; update panel HTML template; reset `_pdfLoading` in `step2()`; delete `renderPdfPage()`; rewrite `scrollPdfToBoundingBox()`; update toggle handler |

---

### Task 1: Update CSS in index.html

**Files:**
- Modify: `electron/index.html`

- [ ] **Step 1: Read the current CSS block**

Open `electron/index.html` and find this block around line 282–286 (include the comment line in any string match):

```css
/* Phase 8: PDF Viewer Panel */
.pdf-viewer-panel{overflow:hidden;transition:height 0.2s ease;border:1px solid var(--color-border);border-radius:var(--radius-sm);background:var(--color-surface);margin-top:var(--space-md)}
.pdf-viewer-panel.collapsed{height:0;border:none}
.pdf-viewer-panel.expanded{height:480px}
.pdf-viewer-panel canvas{width:100%;display:block}
```

- [ ] **Step 2: Apply three CSS changes**

Replace that block with (preserve the comment line):

```css
/* Phase 8: PDF Viewer Panel */
.pdf-viewer-panel{overflow:hidden;transition:height 0.2s ease;border:1px solid var(--color-border);border-radius:var(--radius-sm);background:var(--color-surface);margin-top:var(--space-md)}
.pdf-viewer-panel.collapsed{height:0;border:none}
.pdf-viewer-panel.expanded{height:480px;overflow-y:auto}
#pdf-pages-container{position:relative}
#pdf-pages-container canvas{width:100%;display:block;margin-bottom:8px}
```

Changes:
1. `.pdf-viewer-panel.expanded` — added `overflow-y:auto`
2. New `#pdf-pages-container{position:relative}` — required for `offsetTop`-based calculations (not used in scroll math, but needed for CSS stacking context correctness)
3. `.pdf-viewer-panel canvas` replaced by `#pdf-pages-container canvas` — scoped rule, adds `margin-bottom:8px`

- [ ] **Step 3: Run architecture tests**

```bash
cd C:/Users/marcu/Desktop/solicitation-quoter
python -m pytest tests/test_arch01.py tests/test_arch02.py tests/test_arch03.py -v
```

Expected: all pass. The CSS change does not affect any arch test regex.

- [ ] **Step 4: Commit**

```bash
git add electron/index.html
git commit -m "fix: add overflow-y scroll and position:relative for PDF continuous viewer"
```

---

### Task 2: Rewrite loadPdfViewer, update HTML template, delete renderPdfPage

**Files:**
- Modify: `electron/js/modules/step2.js`

This task covers: adding `_pdfLoading`, rewriting `loadPdfViewer()` to render all pages, updating the `pdfPanelHtml` template string to use `#pdf-pages-container`, resetting `_pdfLoading` in `step2()`, and deleting `renderPdfPage()`.

- [ ] **Step 1: Add `_pdfLoading` module variable**

In `electron/js/modules/step2.js`, find the PDF viewer state section (lines 8–9):

```javascript
// ── PDF VIEWER STATE ──────────────────────────────────────────────────────────
let _pdfDoc = null
```

Replace with:

```javascript
// ── PDF VIEWER STATE ──────────────────────────────────────────────────────────
let _pdfDoc = null
let _pdfLoading = false
```

- [ ] **Step 2: Rewrite `loadPdfViewer()`**

Replace the entire `loadPdfViewer` function (lines 11–37) with:

```javascript
async function loadPdfViewer() {
  if (_pdfLoading || _pdfDoc) return
  _pdfLoading = true
  try {
    // Resolve container first — all messages go here so panel structure is preserved
    const container = document.getElementById('pdf-pages-container')
    if (!container) return

    // Clear any stale canvases or prior error messages
    container.innerHTML = ''

    if (!window.S.sourceFile) {
      // Note: using <div> + var(--space-md) (consistent with existing codebase style, not <p style="padding:1rem"> as in spec)
      container.innerHTML = '<div style="padding:var(--space-md);color:var(--color-text-muted)">PDF preview requires re-uploading the document in this session.</div>'
      return
    }
    if (!window.pdfjsLib) throw new Error('PDF.js not loaded')

    const arrayBuffer = await window.S.sourceFile.arrayBuffer()
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer })
    _pdfDoc = await loadingTask.promise

    // Wait for CSS transition before measuring width
    await new Promise(resolve => setTimeout(resolve, 220))

    for (let i = 1; i <= _pdfDoc.numPages; i++) {
      const page = await _pdfDoc.getPage(i)
      const canvas = document.createElement('canvas')
      canvas.id = `pdf-page-${i}`
      container.appendChild(canvas)

      let panelWidth = container.offsetWidth || 0
      if (panelWidth < 10) {
        let el = container.parentElement
        while (el && panelWidth < 10) { panelWidth = el.offsetWidth; el = el.parentElement }
      }
      panelWidth = panelWidth || 600

      const scale = panelWidth / page.getViewport({ scale: 1 }).width
      const viewport = page.getViewport({ scale })
      canvas.width = viewport.width
      canvas.height = viewport.height
      const ctx = canvas.getContext('2d')
      await page.render({ canvasContext: ctx, viewport }).promise
    }
  } catch (err) {
    console.error('PDF viewer load error:', err)
    const container = document.getElementById('pdf-pages-container')
    if (container) container.innerHTML = '<div style="padding:var(--space-md);color:var(--color-text-muted)">Could not load PDF preview.</div>'  // <div> consistent with codebase style
  } finally {
    _pdfLoading = false
  }
}
```

- [ ] **Step 3: Delete `renderPdfPage()`**

Delete the entire `renderPdfPage` function (currently lines 39–60):

```javascript
async function renderPdfPage(pageNum) {
  if (!_pdfDoc) return
  const page = await _pdfDoc.getPage(pageNum)
  const canvas = document.getElementById('pdf-canvas')
  if (!canvas) return
  // Wait for CSS height transition to complete (0.2s) before measuring width
  await new Promise(resolve => setTimeout(resolve, 220))
  const ctx = canvas.getContext('2d')
  // Use panel offsetWidth; if still 0, walk up to the nearest card for width
  let panelWidth = canvas.parentElement?.offsetWidth || 0
  if (panelWidth < 10) {
    let el = canvas.parentElement?.parentElement
    while (el && panelWidth < 10) { panelWidth = el.offsetWidth; el = el.parentElement }
  }
  panelWidth = panelWidth || 600
  const unscaledViewport = page.getViewport({ scale: 1 })
  const scale = panelWidth / unscaledViewport.width
  const viewport = page.getViewport({ scale })
  canvas.height = viewport.height
  canvas.width = viewport.width
  await page.render({ canvasContext: ctx, viewport }).promise
}
```

- [ ] **Step 4: Update panel HTML template**

In `step2()`, find the `pdfPanelHtml` template string (around line 184–190):

```javascript
  const pdfPanelHtml = isPdf ? `
    <div class="card">
      <button class="btn btn-sm" id="pdf-toggle-btn" style="text-transform:uppercase;letter-spacing:0.6px;font-weight:600;font-size:var(--text-base)">View PDF Source</button>
      <div id="pdf-viewer-panel" class="pdf-viewer-panel collapsed">
        <canvas id="pdf-canvas"></canvas>
      </div>
    </div>` : ''
```

Replace with:

```javascript
  const pdfPanelHtml = isPdf ? `
    <div class="card">
      <button class="btn btn-sm" id="pdf-toggle-btn" style="text-transform:uppercase;letter-spacing:0.6px;font-weight:600;font-size:var(--text-base)">View PDF Source</button>
      <div id="pdf-viewer-panel" class="pdf-viewer-panel collapsed">
        <div id="pdf-pages-container"></div>
      </div>
    </div>` : ''
```

- [ ] **Step 5: Reset `_pdfLoading` in `step2()`**

Find the top of `step2()` (around line 104–105):

```javascript
function step2(c) {
  _pdfDoc = null  // Reset PDF doc reference on re-render
```

Replace with:

```javascript
function step2(c) {
  _pdfDoc = null      // Reset PDF doc reference on re-render
  _pdfLoading = false // Reset loading flag on re-render
```

- [ ] **Step 6: Run architecture tests**

```bash
cd C:/Users/marcu/Desktop/solicitation-quoter
python -m pytest tests/test_arch01.py tests/test_arch02.py tests/test_arch03.py -v
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add electron/js/modules/step2.js
git commit -m "fix: render all PDF pages stacked vertically in scrollable container"
```

---

### Task 3: Rewrite scrollPdfToBoundingBox and update toggle handler

**Files:**
- Modify: `electron/js/modules/step2.js`

- [ ] **Step 1: Rewrite `scrollPdfToBoundingBox`**

Find the entire `window.scrollPdfToBoundingBox` function (lines 62–100):

```javascript
window.scrollPdfToBoundingBox = async function(bbox) {
  // bbox: { page, x0, y0, x1, y1 }
  if (!bbox || !bbox.page) return

  const pdfPanel = document.getElementById('pdf-viewer-panel')
  const pdfToggle = document.getElementById('pdf-toggle-btn')

  // Expand panel if collapsed (D-25)
  if (pdfPanel && pdfPanel.classList.contains('collapsed')) {
    pdfPanel.classList.remove('collapsed')
    pdfPanel.classList.add('expanded')
    if (pdfToggle) pdfToggle.textContent = 'Hide PDF'
    if (!_pdfDoc) await loadPdfViewer()
  }

  if (!_pdfDoc) return

  // Navigate to the correct page
  await renderPdfPage(bbox.page)

  // Scroll canvas container to approximate y position
  // pdfplumber coordinates: y0 is distance from top of page in points (72 dpi)
  const canvas = document.getElementById('pdf-canvas')
  if (!canvas) return
  const page = await _pdfDoc.getPage(bbox.page)
  const unscaledViewport = page.getViewport({ scale: 1 })
  let panelWidth = canvas.parentElement?.offsetWidth || 0
  if (panelWidth < 10) {
    let el = canvas.parentElement?.parentElement
    while (el && panelWidth < 10) { panelWidth = el.offsetWidth; el = el.parentElement }
  }
  panelWidth = panelWidth || 600
  const scale = panelWidth / unscaledViewport.width
  // pdfplumber y0 is from top; PDF.js viewport also measures from top
  const scrollY = bbox.y0 * scale - 50 // 50px offset to show context above
  if (pdfPanel) {
    pdfPanel.scrollTop = Math.max(0, scrollY)
  }
}
```

Replace with:

```javascript
window.scrollPdfToBoundingBox = async function(bbox) {
  // bbox: { page, x0, y0, x1, y1 }
  if (!bbox || !bbox.page) return

  const pdfPanel = document.getElementById('pdf-viewer-panel')
  const pdfToggle = document.getElementById('pdf-toggle-btn')

  // Expand panel if collapsed
  if (pdfPanel && pdfPanel.classList.contains('collapsed')) {
    pdfPanel.classList.remove('collapsed')
    pdfPanel.classList.add('expanded')
    if (pdfToggle) pdfToggle.textContent = 'Hide PDF'
  }

  // Load if not yet loaded
  if (!_pdfDoc && !_pdfLoading) await loadPdfViewer()
  // If load is in flight (race), wait for it to finish (10s timeout)
  if (_pdfLoading) {
    await new Promise(resolve => {
      const deadline = Date.now() + 10000
      const check = setInterval(() => {
        if (!_pdfLoading || Date.now() > deadline) { clearInterval(check); resolve() }
      }, 50)
    })
  }

  if (!_pdfDoc) return

  // Find the canvas for the target page
  const targetCanvas = document.getElementById(`pdf-page-${bbox.page}`)
  if (!targetCanvas || !pdfPanel) return

  // Scale: canvas.width (rendered pixels) / unscaled page width
  const page = await _pdfDoc.getPage(bbox.page)
  const scale = targetCanvas.width / page.getViewport({ scale: 1 }).width

  // getBoundingClientRect is coordinate-system independent — no offsetParent dependency
  // pdfplumber y0 is from top of page; PDF.js viewport also measures from top
  const canvasTop = targetCanvas.getBoundingClientRect().top - pdfPanel.getBoundingClientRect().top
  const scrollTop = pdfPanel.scrollTop + canvasTop + (bbox.y0 * scale) - 50

  pdfPanel.scrollTo({ top: Math.max(0, scrollTop), behavior: 'smooth' })
}
```

- [ ] **Step 2: Update toggle handler — remove `pdfLoaded` variable**

Find the toggle handler block in `step2()` (around lines 254–275):

```javascript
  // PDF viewer toggle per D-24
  const pdfToggle = document.getElementById('pdf-toggle-btn')
  const pdfPanel = document.getElementById('pdf-viewer-panel')
  if (pdfToggle && pdfPanel) {
    let pdfLoaded = false
    pdfToggle.addEventListener('click', async () => {
      const isCollapsed = pdfPanel.classList.contains('collapsed')
      if (isCollapsed) {
        pdfPanel.classList.remove('collapsed')
        pdfPanel.classList.add('expanded')
        pdfToggle.textContent = 'Hide PDF'
        if (!pdfLoaded) {
          await loadPdfViewer()
          pdfLoaded = true
        }
      } else {
        pdfPanel.classList.remove('expanded')
        pdfPanel.classList.add('collapsed')
        pdfToggle.textContent = 'View PDF Source'
      }
    })
  }
```

Replace with:

```javascript
  // PDF viewer toggle per D-24
  const pdfToggle = document.getElementById('pdf-toggle-btn')
  const pdfPanel = document.getElementById('pdf-viewer-panel')
  if (pdfToggle && pdfPanel) {
    pdfToggle.addEventListener('click', async () => {
      const isCollapsed = pdfPanel.classList.contains('collapsed')
      if (isCollapsed) {
        pdfPanel.classList.remove('collapsed')
        pdfPanel.classList.add('expanded')
        pdfToggle.textContent = 'Hide PDF'
        if (!_pdfDoc) await loadPdfViewer()
      } else {
        pdfPanel.classList.remove('expanded')
        pdfPanel.classList.add('collapsed')
        pdfToggle.textContent = 'View PDF Source'
      }
    })
  }
```

The `pdfLoaded` closure variable is removed. `_pdfDoc` now serves as the "already loaded" guard. The `_pdfLoading` guard inside `loadPdfViewer()` prevents double-loads from concurrent calls.

**Note:** If `_pdfLoading` is true when the toggle is clicked (a `scrollPdfToBoundingBox` load is in flight), `loadPdfViewer()` returns immediately and pages will render once that load finishes. The panel will expand but pages may appear with a short delay — this is acceptable behavior.

- [ ] **Step 3: Run full test suite**

```bash
cd C:/Users/marcu/Desktop/solicitation-quoter
python -m pytest tests/ --ignore=tests/test_sec01.py -v
```

Expected: 30 passed. (`test_sec01.py` excluded — pre-existing env failure unrelated to this work.)

- [ ] **Step 4: Commit**

```bash
git add electron/js/modules/step2.js
git commit -m "fix: scrollPdfToBoundingBox uses getBoundingClientRect; drop pdfLoaded closure"
```

---

### Task 4: Manual smoke test

The automated tests cover architecture rules and Python backend. The PDF viewer is Electron UI — verify manually by running `npm start`.

- [ ] **Continuous scroll:**
  1. Upload a multi-page PDF solicitation
  2. Navigate to step 2 → click "View PDF Source"
  3. Panel expands and all pages render stacked vertically
  4. Scroll the panel — all pages are visible

- [ ] **Field → PDF scroll:**
  1. On step 2 with a PDF source, ensure a field has a confidence badge (requires AI key)
  2. Click the field — panel expands (if collapsed) and scrolls to the correct page and approximate y-position

- [ ] **Toggle hide/show:**
  1. Click "Hide PDF" — panel collapses
  2. Click "View PDF Source" — panel expands, pages still rendered (no double-render)

- [ ] **Session restore:**
  1. Upload PDF, parse, navigate to step 2
  2. Close and reopen → click Resume
  3. "View PDF Source" button is visible (sourceType restored)
  4. Click it → shows "PDF preview requires re-uploading…" (File object not serializable)

- [ ] **DOCX source:**
  1. Upload a .docx file
  2. Navigate to step 2 — "View PDF Source" button is NOT shown
