# PDF Viewer Continuous Scroll Design

**Date:** 2026-03-24
**Status:** Ready for review
**Goal:** Replace the single-page static canvas with a continuous multi-page scrollable viewer so the user can scroll through the entire PDF document naturally. `scrollPdfToBoundingBox` scrolls the panel to the correct vertical position for a given field's page and y-coordinate.

---

## Problem

The current PDF viewer renders one page at a time into a single `<canvas id="pdf-canvas">`. There is no way to scroll between pages — `renderPdfPage(n)` replaces the canvas content entirely, so the viewer behaves as a static window onto a single page. `scrollPdfToBoundingBox` navigates by re-rendering the target page and setting `pdfPanel.scrollTop`, but this destroys whatever page was previously visible.

---

## Approach

Render all pages upfront as stacked canvases inside a scrollable container. Solicitation documents are typically 5–50 pages; rendering all pages at load time is fast enough and avoids the complexity of virtual scrolling or lazy loading.

---

## Design

### HTML

The panel's inner content changes from a single canvas to a container div. The template string in `step2()` is updated:

**Before:**
```html
<div id="pdf-viewer-panel" class="pdf-viewer-panel collapsed">
  <canvas id="pdf-canvas"></canvas>
</div>
```

**After:**
```html
<div id="pdf-viewer-panel" class="pdf-viewer-panel collapsed">
  <div id="pdf-pages-container"></div>
</div>
```pas

Each page gets its own canvas appended to `#pdf-pages-container` at load time:
```html
<canvas id="pdf-page-1"></canvas>
<canvas id="pdf-page-2"></canvas>
<!-- ... -->
<canvas id="pdf-page-N"></canvas>
```

### CSS

`electron/index.html` inline styles — three changes:

1. Add `overflow-y: auto` to `.pdf-viewer-panel.expanded` (the fixed 480px height stays):
   ```css
   .pdf-viewer-panel.expanded { height: 480px; overflow-y: auto; }
   ```

2. Add `position: relative` to `#pdf-pages-container` so that canvases' `offsetTop` is measured relative to this container (which is the direct child of `pdfPanel`). This makes the scroll calculation in `scrollPdfToBoundingBox` correct:
   ```css
   #pdf-pages-container { position: relative; }
   ```

3. Replace `.pdf-viewer-panel canvas { width:100%; display:block }` with a scoped rule that also adds inter-page spacing:
   ```css
   #pdf-pages-container canvas { width: 100%; display: block; margin-bottom: 8px; }
   ```

### `loadPdfViewer()` — render all pages

A module-level boolean `_pdfLoading` guards against concurrent calls (e.g., toggle clicked while a `scrollPdfToBoundingBox` call is already loading). The function bails immediately if loading is in flight or the doc is already loaded.

Error messages are written into `#pdf-pages-container`, not into `#pdf-viewer-panel`. This preserves the panel's DOM structure so the container element always exists when `loadPdfViewer` is called again after an error.

`container.innerHTML = ''` clears any stale canvases (or prior error messages) before rendering, making the function safe to call again if `_pdfDoc` was reset externally.

**Note on mid-load re-render race:** If `step2()` re-renders while `loadPdfViewer` is still in flight (user navigated away mid-load), the old coroutine will continue running and write canvases into the newly-rendered container. PDF.js has no cancel API, so this race is not fully preventable. In practice it is not triggered by normal user flows; acknowledge as an acceptable edge case.

```javascript
let _pdfDoc = null
let _pdfLoading = false

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
      container.innerHTML = '<p style="padding:1rem;color:var(--color-text-muted)">PDF preview requires re-uploading the document in this session.</p>'
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
    if (container) container.innerHTML = '<p style="padding:1rem;color:var(--color-text-muted)">Could not load PDF preview.</p>'
  } finally {
    _pdfLoading = false
  }
}
```

### `scrollPdfToBoundingBox(bbox)` — scroll to field position

The function expands the panel (if collapsed), waits for `loadPdfViewer` to finish if it is in flight, then scrolls.

The scroll offset uses `getBoundingClientRect()` to compute the canvas position relative to the panel viewport — this is coordinate-system independent and correct regardless of CSS positioning on intermediate elements:

```
scrollTop = pdfPanel.scrollTop
           + targetCanvas.getBoundingClientRect().top
           - pdfPanel.getBoundingClientRect().top
           + (bbox.y0 * scale)
           - 50   // 50px context above the field
```

```javascript
window.scrollPdfToBoundingBox = async function(bbox) {
  if (!bbox || !bbox.page) return

  const pdfPanel = document.getElementById('pdf-viewer-panel')
  const pdfToggle = document.getElementById('pdf-toggle-btn')

  if (pdfPanel && pdfPanel.classList.contains('collapsed')) {
    pdfPanel.classList.remove('collapsed')
    pdfPanel.classList.add('expanded')
    if (pdfToggle) pdfToggle.textContent = 'Hide PDF'
  }

  if (!_pdfDoc && !_pdfLoading) await loadPdfViewer()
  // If still loading (race), wait for it to finish by polling _pdfLoading (10s timeout)
  if (_pdfLoading) {
    await new Promise(resolve => {
      const deadline = Date.now() + 10000
      const check = setInterval(() => {
        if (!_pdfLoading || Date.now() > deadline) { clearInterval(check); resolve() }
      }, 50)
    })
  }

  if (!_pdfDoc) return

  const targetCanvas = document.getElementById(`pdf-page-${bbox.page}`)
  if (!targetCanvas || !pdfPanel) return

  // Scale: canvas.width is the rendered pixel width; divide by unscaled page width to get scale
  const page = await _pdfDoc.getPage(bbox.page)
  const scale = targetCanvas.width / page.getViewport({ scale: 1 }).width

  // getBoundingClientRect gives positions relative to the viewport; combine with scrollTop
  // to get the panel-scroll-relative position
  const canvasTop = targetCanvas.getBoundingClientRect().top - pdfPanel.getBoundingClientRect().top
  const scrollTop = pdfPanel.scrollTop + canvasTop + (bbox.y0 * scale) - 50

  pdfPanel.scrollTo({ top: Math.max(0, scrollTop), behavior: 'smooth' })
}
```

### Toggle handler — `pdfLoaded` flag

The existing `pdfLoaded` closure variable in the toggle handler (step2.js lines 258–274) is replaced by checking `_pdfDoc` directly. After the rewrite, the toggle handler becomes:

```javascript
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
```

The `pdfLoaded` local variable is removed. The `_pdfLoading` guard inside `loadPdfViewer` prevents double-loading from concurrent calls.

### `renderPdfPage()` — removed

This function is no longer needed. All pages are rendered in `loadPdfViewer()`. It is deleted from `step2.js`.

### `step2()` re-render cleanup

When `step2()` re-renders, it sets `_pdfDoc = null` (already done at the top of `step2()`). Also reset `_pdfLoading = false` at the same location:

```javascript
function step2(c) {
  _pdfDoc = null
  _pdfLoading = false
  // ... rest of step2
}
```

The container div is destroyed and recreated as part of the full HTML re-render, so no stale canvases persist. If a `loadPdfViewer` coroutine is in flight when `step2()` fires, it will continue running (PDF.js has no cancel API) but will write into the freshly-rendered container — this is an acceptable edge case not triggered by normal user flows.

---

## Files Changed

| File | Change |
|------|--------|
| `electron/js/modules/step2.js` | Add `_pdfLoading` module var; rewrite `loadPdfViewer()` (container-first, `_pdfLoading` guard, `container.innerHTML = ''`, error to container not panel); rewrite `scrollPdfToBoundingBox()` (`getBoundingClientRect` scroll calc, 10s-timeout loading wait); update toggle handler to drop `pdfLoaded` var; delete `renderPdfPage()`; update panel HTML template to use `#pdf-pages-container`; reset `_pdfDoc = null` and `_pdfLoading = false` in `step2()` |
| `electron/index.html` | Add `overflow-y: auto` to `.pdf-viewer-panel.expanded`; add `#pdf-pages-container { position: relative }` rule; replace `.pdf-viewer-panel canvas` rule with `#pdf-pages-container canvas` (adds `margin-bottom: 8px`) |

---

## Out of Scope

- Highlight/outline overlay on canvas (not implemented)
- Lazy/virtual rendering for large documents
- Page number indicator or navigation controls
- Zoom controls
