# PDF Viewer Continuous Scroll Design

**Date:** 2026-03-24
**Status:** Approved
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

The panel's inner content changes from a single canvas to a container div:

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
```

Each page gets its own canvas appended to `#pdf-pages-container` at load time:
```html
<canvas id="pdf-page-1"></canvas>
<canvas id="pdf-page-2"></canvas>
<!-- ... -->
<canvas id="pdf-page-N"></canvas>
```

### CSS

`electron/index.html` inline styles — two changes:

1. Add `overflow-y: auto` to `.pdf-viewer-panel.expanded` (the fixed 480px height stays):
   ```css
   .pdf-viewer-panel.expanded { height: 480px; overflow-y: auto; }
   ```

2. Replace `.pdf-viewer-panel canvas { width:100%; display:block }` with a scoped rule that also adds inter-page spacing:
   ```css
   #pdf-pages-container canvas { width: 100%; display: block; margin-bottom: 8px; }
   ```

### `loadPdfViewer()` — render all pages

Replace the current single-page render with a loop:

```javascript
async function loadPdfViewer() {
  try {
    if (!window.S.sourceFile) {
      // show "re-upload" message as before
      return
    }
    if (!window.pdfjsLib) throw new Error('PDF.js not loaded')

    const arrayBuffer = await window.S.sourceFile.arrayBuffer()
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer })
    _pdfDoc = await loadingTask.promise

    const container = document.getElementById('pdf-pages-container')
    if (!container) return

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
    const panel = document.getElementById('pdf-viewer-panel')
    if (panel) panel.innerHTML = '<p style="padding:1rem;color:var(--color-text-muted)">Could not load PDF preview.</p>'
  }
}
```

### `scrollPdfToBoundingBox(bbox)` — scroll to field position

The function expands the panel (if collapsed), ensures PDF is loaded, then scrolls:

```javascript
window.scrollPdfToBoundingBox = async function(bbox) {
  if (!bbox || !bbox.page) return

  const pdfPanel = document.getElementById('pdf-viewer-panel')
  const pdfToggle = document.getElementById('pdf-toggle-btn')

  if (pdfPanel && pdfPanel.classList.contains('collapsed')) {
    pdfPanel.classList.remove('collapsed')
    pdfPanel.classList.add('expanded')
    if (pdfToggle) pdfToggle.textContent = 'Hide PDF'
    if (!_pdfDoc) await loadPdfViewer()
  } else if (!_pdfDoc) {
    await loadPdfViewer()
  }

  if (!_pdfDoc) return

  // Find the canvas for the target page
  const targetCanvas = document.getElementById(`pdf-page-${bbox.page}`)
  if (!targetCanvas) return

  // Compute scroll position: canvas's offsetTop + scaled y0 - 50px context
  const page = await _pdfDoc.getPage(bbox.page)
  const unscaledViewport = page.getViewport({ scale: 1 })
  const scale = targetCanvas.width / unscaledViewport.width
  const scrollTop = targetCanvas.offsetTop + (bbox.y0 * scale) - 50

  pdfPanel.scrollTo({ top: Math.max(0, scrollTop), behavior: 'smooth' })
}
```

`targetCanvas.offsetTop` is relative to `#pdf-pages-container` which is the direct child of `pdfPanel` — so the offset is correct for `pdfPanel.scrollTop`.

### `renderPdfPage()` — removed

This function is no longer needed. All pages are rendered in `loadPdfViewer()`. It is deleted from `step2.js`.

### `step2()` re-render cleanup

When `step2()` re-renders, it sets `_pdfDoc = null` (already done). The container div is destroyed and recreated as part of the full re-render, so no stale canvases persist.

---

## Files Changed

| File | Change |
|------|--------|
| `electron/js/modules/step2.js` | Rewrite `loadPdfViewer()`, rewrite `scrollPdfToBoundingBox()`, delete `renderPdfPage()`, update panel HTML template to use `#pdf-pages-container` |
| `electron/index.html` | Add `overflow-y: auto` to `.pdf-viewer-panel.expanded`; update canvas CSS rule to `#pdf-pages-container canvas` with `margin-bottom: 8px` |

---

## Out of Scope

- Highlight/outline overlay on canvas (not implemented)
- Lazy/virtual rendering for large documents
- Page number indicator or navigation controls
- Zoom controls
