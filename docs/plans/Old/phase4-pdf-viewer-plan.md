# Phase 4 — PDF Source Viewer: Implementation Plan

**Document version:** 1.0  
**Status:** Planning  
**Scope:** PDF.js viewer window — open-to-page, text highlight, IPC security, error handling

---

## Diagnostic Answers

### 1. Electron version

`28.3.0` — from `package.json`: `"electron": "^28.3.0"`

---

### 2. Phase 2 IPC handlers

Two handlers were added in Phase 2 (confirmed in `electron/main.js`):

| Channel | Location | What it returns |
|---------|----------|-----------------|
| `get-session-file-path` | lines 284–289 | Sanitizes filename with `path.basename()`, resolves to `~/.sol-quoter/session/current/<filename>`, returns absolute path string if file exists, else `null` |
| `open-pdf-viewer` | lines 291–295 | Placeholder stub — logs `[open-pdf-viewer] filePath: <path> page: <n>` to console, returns `{ status: 'viewer_not_yet_implemented' }`. No window is created. |

`preload.js` already exposes both via `contextBridge`:
- `getSessionFilePath(filename)` → `ipcRenderer.invoke('get-session-file-path', filename)`
- `openPdfViewer(filePath, page, searchText)` → `ipcRenderer.invoke('open-pdf-viewer', filePath, page, searchText)`

---

### 3. `__dirname` in main.js

`main.js` lives at `electron/main.js`. Therefore `__dirname` = `<project_root>/electron/`.

Evidence from the file:
- `path.join(__dirname, '..', 'python', 'server.py')` — goes up one level to reach `python/`
- `path.join(__dirname, 'preload.js')` — preload in same dir
- `win.loadFile(path.join(__dirname, 'loading.html'))` — loads from `electron/`

So `pdfviewer.html` at `electron/pdfviewer.html` is referenced as `path.join(__dirname, 'pdfviewer.html')`.

---

### 4. Vendor directory

`electron/vendor/pdfjs/` already exists with four files:

```
electron/vendor/pdfjs/
  pdf.js          — CJS build, 23,078 lines (~700 KB)
  pdf.mjs         — ESM build
  pdf.worker.js   — CJS worker build, 61,667 lines
  pdf.worker.mjs  — ESM worker build
```

**Version: 3.32.2** (confirmed via `node -e` scan of the file header).

`pdfjs-dist@^3.11.174` is listed in `package.json` dependencies but is **not installed** in `node_modules/`. The vendored files are the canonical source — they are newer (3.32.2 > 3.11.174) and already committed.

No `pdf.min.js` or `pdf.worker.min.js` exist. The non-minified builds are what we have and will use.  
No `pdf_viewer.css` in the vendor directory — text layer CSS will be inlined in `pdfviewer.html`.

---

### 5. `open-pdf-viewer` placeholder behavior

```javascript
ipcMain.handle('open-pdf-viewer', (event, filePath, page, searchText) => {
  // Placeholder — full implementation in Phase 4
  console.log('[open-pdf-viewer] filePath:', filePath, 'page:', page)
  return { status: 'viewer_not_yet_implemented' }
})
```

No `BrowserWindow` is created. The renderer call currently resolves with the status object and nothing visible happens in the UI.

---

### 6. `loadFile()` vs `loadURL()`

The project uses both, for different purposes:

| Pattern | Where used |
|---------|------------|
| `loadFile(absolutePath)` | Main window: `loading.html`, `index.html`, `error.html` |
| `loadURL('data:text/html...')` | `generate-pdf` IPC handler (hidden offscreen window) |

`pdfviewer.html` must use `loadFile()`:

```javascript
viewerWin.loadFile(path.join(__dirname, 'pdfviewer.html'), { hash: encoded })
```

`loadFile` in Electron 28 supports an `options.hash` property which sets the URL fragment. The viewer reads `window.location.hash` to get its parameters. This is the correct approach — `loadURL('file://...')` works but path encoding on Windows (`C:\` → `C:/`) requires careful handling; `loadFile` avoids that.

---

### 7. Content Security Policy

**No CSP is set anywhere in the project:**
- No `<meta http-equiv="Content-Security-Policy">` in `index.html`
- No `session.defaultSession.webRequest.onHeadersReceived` in `main.js`

For `file://` pages in Electron 28, Chromium does not impose a default CSP. No CSP changes are needed for the viewer to function. The only consideration is Electron's built-in security flags — these are satisfied by `contextIsolation: true` and `nodeIntegration: false`, which are already the project defaults.

---

### 8. `main.js` location relative to `electron/`

`main.js` **is inside** `electron/`. The project root `package.json` sets `"main": "electron/main.js"`. So:

```
<project_root>/
  electron/          ← __dirname for main.js
    main.js
    preload.js
    index.html
    pdfviewer.html   ← new file, created in Phase 4
    vendor/
      pdfjs/
        pdf.js
        pdf.worker.js
    js/modules/
      step3.js
```

---

## Architecture Decisions

### PDF.js version and vendoring

**Decision: use the existing vendored 3.32.2 files. No download needed.**

The files at `electron/vendor/pdfjs/pdf.js` and `pdf.worker.js` are already present and the correct version. They are the CJS (CommonMark/UMD) builds, which expose `pdfjsLib` as a global when loaded via `<script>` — exactly what we need.

Do not reference `node_modules/pdfjs-dist` — it is not installed. Do not add a CDN reference — the app must work offline.

Pin the version in a comment at the top of `pdfviewer.html`:
```html
<!-- PDF.js 3.32.2 — vendored at electron/vendor/pdfjs/ — do not update without testing -->
```

---

### Parameter passing: URL hash scheme

Parameters are passed as a JSON-encoded, URI-encoded hash fragment:

**In main.js (IPC handler):**
```javascript
const payload = JSON.stringify({ filePath, page, searchText })
const encoded = encodeURIComponent(payload)
viewerWin.loadFile(path.join(__dirname, 'pdfviewer.html'), { hash: encoded })
```

**In pdfviewer.html (on load):**
```javascript
const raw = decodeURIComponent(window.location.hash.slice(1))  // strip leading '#'
const { filePath, page, searchText } = JSON.parse(raw)
```

**Why this approach:**
- `loadFile(path, { hash })` is the Electron-idiomatic way to pass data to a file:// page
- JSON preserves types (page is a number, not a string)
- No risk of path separator issues that affect `loadURL('file://...')` on Windows
- The hash is never sent to a server (file:// protocol)

---

### PDF.js worker in Electron

**Decision: use the local `pdf.worker.js` file via relative `workerSrc`.**

In `pdfviewer.html`:
```javascript
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'vendor/pdfjs/pdf.worker.js',
  document.baseURI
).href
```

Using `new URL(relative, document.baseURI)` resolves the worker path against the HTML file's location, producing a `file:///` URL. In Electron 28, Web Workers can be loaded from `file://` URLs in a renderer process loaded via `loadFile()`. This is the standard, well-supported approach.

**Fallback:** If worker loading fails (environment issue), PDF.js falls back to a synchronous fake-worker mode automatically. This is acceptable for a verification tool.

Do not use `blob:` URL for the worker — it requires reading the worker file first and creates unnecessary complexity. The `file://` path works in Electron.

---

### IPC security model: `read-file-as-array-buffer`

**New IPC handler required.** The viewer window cannot use `fs.readFile` directly (no Node integration). It calls an IPC handler in main.js to read the file.

**Security constraint:** Only files within the session directory may be read via this handler. This prevents any renderer content from using the channel to read arbitrary local files (e.g., sensitive files if XSS occurred).

**Implementation:**
```javascript
ipcMain.handle('read-file-as-array-buffer', async (event, filePath) => {
  const sessionDir = path.resolve(
    path.join(os.homedir(), '.sol-quoter', 'session', 'current')
  )
  const resolved = path.resolve(filePath)
  // path.sep suffix prevents partial-directory attacks (e.g., session-current-evil/)
  if (!resolved.startsWith(sessionDir + path.sep) && resolved !== sessionDir) {
    throw new Error('Access denied: file outside session directory')
  }
  return fs.readFileSync(resolved)
  // Returns Buffer → Electron serializes as Uint8Array in renderer
})
```

**Exact path restriction:**
- Allowed: `~/.sol-quoter/session/current/<any_filename>`
- Blocked: `~/.sol-quoter/session/` (parent)
- Blocked: `~/.sol-quoter/session/current-evil/` (sibling with prefix match)
- Blocked: `~/.sol-quoter/session/current/../../etc/passwd` (traversal — `path.resolve()` normalizes this away)
- Blocked: `/etc/passwd`, `C:\Windows\System32\...` (completely outside)

The `+ path.sep` suffix is the critical detail. Without it, `startsWith('/home/user/.sol-quoter/session/current')` would also pass for a path like `/home/user/.sol-quoter/session/current-evil/file.pdf`.

**ArrayBuffer in renderer:**
Electron IPC serializes `Buffer` as `Uint8Array` on the renderer side. PDF.js `getDocument()` accepts `Uint8Array` directly in its `data` option — no conversion needed:

```javascript
const uint8 = await window.api.readFileAsArrayBuffer(filePath)
const pdfDoc = await pdfjsLib.getDocument({ data: uint8 }).promise
```

---

### `pdfviewer.html` architecture: load sequence

```
1. Parse window.location.hash → { filePath, page, searchText }
2. Validate params (filePath truthy, page >= 1)
3. Show loading spinner
4. window.api.readFileAsArrayBuffer(filePath)
   → on error: show file-not-found banner, stop
5. pdfjsLib.getDocument({ data: uint8 }).promise
   → on error: show load-failure banner, stop
6. Store pdfDoc, totalPages = pdfDoc.numPages
7. Clamp page to [1, totalPages]
8. renderPage(targetPage, searchText)
   8a. Clear previous canvas + textLayer
   8b. pdfDoc.getPage(pageNum)
   8c. page.getViewport({ scale: 1.5 })
   8d. Size canvas to viewport.width × viewport.height
   8e. page.render({ canvasContext, viewport })
   8f. page.getTextContent()
   8g. Render text layer spans over canvas (see text layer section)
   8h. Run highlight pass (see highlight section)
9. Update page indicator "Page N of M"
10. Enable/disable Prev/Next buttons
```

---

### Text layer rendering

PDF.js 3.x requires explicit text layer rendering to enable text selection and highlighting. The text layer is a `<div>` positioned absolutely over the `<canvas>`, containing `<span>` elements aligned to the PDF coordinate space.

**Container setup:**
```html
<div id="viewer-container" style="position:relative;display:inline-block">
  <canvas id="pdf-canvas"></canvas>
  <div id="text-layer" class="textLayer"></div>
</div>
```

**Rendering (API for PDF.js 3.32.2):**
```javascript
const textContent = await page.getTextContent()

const textLayerDiv = document.getElementById('text-layer')
textLayerDiv.innerHTML = ''
textLayerDiv.style.width  = viewport.width  + 'px'
textLayerDiv.style.height = viewport.height + 'px'

const renderTask = pdfjsLib.renderTextLayer({
  textContentSource: textContent,   // 3.x API (preferred over textContent)
  container: textLayerDiv,
  viewport: viewport,
  textDivs: []
})
await renderTask.promise
```

**Required CSS (inlined in pdfviewer.html):**
```css
.textLayer {
  position: absolute;
  top: 0; left: 0;
  overflow: hidden;
  line-height: 1;
  user-select: text;
}
.textLayer span {
  position: absolute;
  white-space: pre;
  cursor: text;
  transform-origin: 0% 0%;
  color: transparent;   /* invisible — only highlight is visible */
}
```

The `color: transparent` makes the text layer invisible while preserving selection and highlight behavior. The canvas renders the actual visible text.

---

### Highlight strategy

After the text layer renders:

```javascript
function applyHighlight(searchText) {
  if (!searchText || !searchText.trim()) return
  const target = searchText.trim().toLowerCase().slice(0, 30)
  const spans = document.querySelectorAll('#text-layer span')
  let found = false
  spans.forEach(span => {
    if (span.textContent.toLowerCase().includes(target)) {
      span.classList.add('sol-highlight')
      if (!found) {
        span.scrollIntoView({ behavior: 'smooth', block: 'center' })
        found = true
      }
    }
  })
  // If not found: no error, no crash — page renders without highlight
}
```

```css
.sol-highlight {
  background: rgba(255, 220, 0, 0.45);
  border-radius: 2px;
  color: transparent;  /* keep text invisible; only background shows */
}
```

**Why 30 chars:** Spec text paragraphs start with product names or identifiers (e.g., "Smoke Canister for Training"). The opening 30 characters are unique per item and reliably appear within a single `<span>`. Matching the full spec text would fail because PDF.js splits text across many spans.

**Highlight only on target page:** When the user navigates to a different page, `applyHighlight` is called without `searchText` (pass empty string) — no highlights on other pages.

---

### Viewer UI layout

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  [← Prev]   Page 3 of 47   [Next →]   [−]  100%  [+]       Source Document  │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                                                                     │   │
│   │                    (PDF canvas + text layer)                        │   │
│   │                                                                     │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

Controls:
- **Prev / Next**: navigate pages, re-render canvas + text layer, highlight disabled on non-target pages
- **Zoom in/out**: adjust `scale` (0.75, 1.0, 1.25, 1.5, 2.0), re-render
- Default scale: **1.5** (readable for dense government documents)
- **Page indicator**: "Page N of M" — updated after each render

Window size: `{ width: 920, height: 1100 }` — tall enough for a letter-page PDF at 1.5× scale without scroll.

---

### Page navigation state management

```javascript
let pdfDoc = null
let currentPage = 1
let totalPages = 0
let targetPage = 1      // the page we opened to (for highlight logic)
let searchText = ''
let currentScale = 1.5

async function goToPage(pageNum) {
  pageNum = Math.max(1, Math.min(pageNum, totalPages))
  currentPage = pageNum
  await renderPage(pageNum, pageNum === targetPage ? searchText : '')
  document.getElementById('page-indicator').textContent = `Page ${currentPage} of ${totalPages}`
  document.getElementById('prev-btn').disabled = currentPage <= 1
  document.getElementById('next-btn').disabled = currentPage >= totalPages
}
```

Navigation does not persist state to localStorage — viewer is ephemeral.

---

## Error States

| Scenario | Detection | UI treatment |
|----------|-----------|--------------|
| Hash missing / malformed | `JSON.parse` throws | Show "Invalid viewer parameters. Close this window and try again from Step 3." |
| File not found (session cleared) | `readFileAsArrayBuffer` rejects with access denied or fs error | Show "Source file not available. Re-parse the solicitation to restore it." No crash. |
| PDF load failure (corrupt / unsupported) | `getDocument().promise` rejects | Show "Could not load PDF. The file may be corrupt or in an unsupported format." |
| Page number out of range | Detected after `pdfDoc.numPages` known | Silently clamp to page 1, render normally |
| Text highlight not found | `spans.forEach` finds no match | Render page normally, no error shown to user. Highlight is a UX enhancement, not a critical feature. |
| Text layer render failure | `renderTask.promise` rejects | Continue without text layer, apply no highlight. Canvas render is unaffected. |

All error banners are full-width, styled, positioned above the PDF area. After showing an error, the window remains open so the user can read the message and close it manually.

---

## Files Changed

| File | Change type | Description |
|------|-------------|-------------|
| `electron/pdfviewer.html` | **New** | Standalone viewer window |
| `electron/main.js` | **Edit** | Replace `open-pdf-viewer` placeholder; add `read-file-as-array-buffer` handler |
| `electron/preload.js` | **Edit** | Expose `readFileAsArrayBuffer` via contextBridge |
| `electron/js/modules/step3.js` | **Edit** | Replace `console.log` placeholder in `btn-view-source` handler with real IPC call |

---

## Detailed Change Specifications

### `electron/main.js` changes

**Replace** the `open-pdf-viewer` placeholder (lines 291–295) with:

```javascript
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
  const payload = JSON.stringify({ filePath, page: page || 1, searchText: searchText || '' })
  viewerWin.loadFile(path.join(__dirname, 'pdfviewer.html'), {
    hash: encodeURIComponent(payload)
  })
})
```

**Add** before the APP LIFECYCLE section:

```javascript
ipcMain.handle('read-file-as-array-buffer', (event, filePath) => {
  const sessionDir = path.resolve(path.join(os.homedir(), '.sol-quoter', 'session', 'current'))
  const resolved = path.resolve(filePath)
  if (!resolved.startsWith(sessionDir + path.sep) && resolved !== sessionDir) {
    throw new Error('Access denied: file outside session directory')
  }
  return fs.readFileSync(resolved)
  // Electron serializes Buffer as Uint8Array in renderer — PDF.js accepts Uint8Array
})
```

---

### `electron/preload.js` changes

**Add** to the `contextBridge.exposeInMainWorld('api', {...})` object:

```javascript
readFileAsArrayBuffer: (filePath) => ipcRenderer.invoke('read-file-as-array-buffer', filePath),
```

(`openPdfViewer` is already exposed — no change needed there.)

---

### `electron/pdfviewer.html` (new file)

Complete standalone HTML. Key sections:

**Script load order:**
```html
<script src="vendor/pdfjs/pdf.js"></script>
<!-- pdf.js sets window.pdfjsLib; must load before inline script -->
```

**Worker configuration (in inline script, before any PDF.js call):**
```javascript
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'vendor/pdfjs/pdf.worker.js',
  document.baseURI
).href
// Resolves to file:///path/to/electron/vendor/pdfjs/pdf.worker.js
```

**Parameter extraction (runs on DOMContentLoaded):**
```javascript
let params
try {
  params = JSON.parse(decodeURIComponent(window.location.hash.slice(1)))
} catch (e) {
  showError('Invalid viewer parameters. Close this window and try again.')
  return
}
const { filePath, page, searchText } = params
```

**PDF load:**
```javascript
let uint8
try {
  uint8 = await window.api.readFileAsArrayBuffer(filePath)
} catch (e) {
  showError('Source file not available. Re-parse the solicitation to restore it.')
  return
}

let pdfDoc
try {
  pdfDoc = await pdfjsLib.getDocument({ data: uint8 }).promise
} catch (e) {
  showError('Could not load PDF. The file may be corrupt or in an unsupported format.')
  return
}

totalPages = pdfDoc.numPages
targetPage = Math.max(1, Math.min(parseInt(page) || 1, totalPages))
await goToPage(targetPage)
```

**Canvas render:**
```javascript
async function renderPage(pageNum, highlightText) {
  const page = await pdfDoc.getPage(pageNum)
  const viewport = page.getViewport({ scale: currentScale })

  const canvas = document.getElementById('pdf-canvas')
  canvas.width  = viewport.width
  canvas.height = viewport.height
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise

  const textLayerDiv = document.getElementById('text-layer')
  textLayerDiv.innerHTML = ''
  textLayerDiv.style.width  = viewport.width  + 'px'
  textLayerDiv.style.height = viewport.height + 'px'

  try {
    const textContent = await page.getTextContent()
    await pdfjsLib.renderTextLayer({
      textContentSource: textContent,
      container: textLayerDiv,
      viewport,
      textDivs: []
    }).promise
    if (highlightText) applyHighlight(highlightText)
  } catch (_) {
    // text layer failure is non-fatal
  }
}
```

---

### `electron/js/modules/step3.js` changes

In `wireLineItemDelegation()`, the `btn-view-source` click handler (lines 394–398) currently logs to console. Replace with:

```javascript
const viewBtn = e.target.closest('.btn-view-source')
if (viewBtn) {
  const filename = viewBtn.dataset.file
  const page = parseInt(viewBtn.dataset.page) || 1
  const search = viewBtn.dataset.search || ''
  ;(async () => {
    const filePath = await window.api.getSessionFilePath(filename)
    if (!filePath) {
      window.toast('Source file not available. Re-parse the solicitation to restore.', 'error')
      return
    }
    await window.api.openPdfViewer(filePath, page, search)
  })()
  return
}
```

---

## CSP Analysis

No changes needed. Current state:

- No `<meta http-equiv="Content-Security-Policy">` in `index.html`
- No `session.defaultSession.webRequest.onHeadersReceived` in `main.js`
- `file://` pages in Electron 28 run without a default restrictive CSP

If a CSP is added to `index.html` in the future, it does **not** apply to `pdfviewer.html` — each HTML file has its own CSP context. The viewer window loads its own page; `index.html`'s CSP is irrelevant to it.

If a CSP is ever added to `pdfviewer.html` directly, it would need:
```
script-src 'self';
worker-src blob: file:;
```

---

## Acceptance Criteria

| # | Check | Expected |
|---|-------|----------|
| 1 | Click "View in Source PDF →" on item 4.1.1 | New `BrowserWindow` opens, title "Source Document" |
| 2 | Correct page displayed | SOW page containing section 4.1.1 is rendered |
| 3 | Yellow highlight visible | Highlight on spans containing opening text of spec |
| 4 | Prev / Next navigation | Pages advance and retreat correctly; page indicator updates |
| 5 | Zoom controls | Canvas re-renders at new scale |
| 6 | No session files | Toast shown in Step 3, no window opens, no crash |
| 7 | Session dir path restriction | `readFileAsArrayBuffer` rejects paths outside `~/.sol-quoter/session/current/` |
| 8 | Path traversal blocked | `../../../sensitive.txt` resolved and rejected |
| 9 | Window independence | Closing viewer has no effect on main app |
| 10 | Text not found | Page renders normally, no error, no crash |
| 11 | Page out of range | Clamped to page 1, renders normally |
| 12 | Corrupt PDF | Error banner shown, window stays open |
| 13 | Offline operation | Works with no internet connection (all assets local) |
| 14 | Multiple viewer windows | Opening two items opens two independent windows |

---

## Implementation Order

1. **`main.js`** — Replace placeholder, add `read-file-as-array-buffer` handler
2. **`preload.js`** — Add `readFileAsArrayBuffer` exposure
3. **`pdfviewer.html`** — Build the viewer (most of the work)
4. **`step3.js`** — Wire the button handler
5. **Manual test** — 70B bundle: parse → Step 3 → expand 4.1.1 → "View in Source PDF" → verify page + highlight

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| PDF.js `renderTextLayer` API changed in 3.32.2 | Low | Medium | Use `textContentSource` (3.x preferred API); fall back to no text layer on failure |
| Worker `file://` URL blocked by Electron sandbox | Low | Medium | `new URL(..., document.baseURI)` produces correct `file://` path; if blocked, PDF.js auto-falls-back to fake-worker |
| `loadFile(..., { hash })` escaping edge cases | Low | Low | `encodeURIComponent(JSON.stringify(...))` produces a hash-safe string with no `#`/`&`/`=` |
| `path.startsWith` path separator mismatch on Windows | Medium | High | `path.resolve()` normalizes separators; `+ path.sep` suffix prevents prefix collision |
| `source_page` off-by-one (Phase 1 mapping) | Medium | Low | Phase 4 viewer makes this immediately visible; fix is a one-line change to Phase 1 boundary calc |
| Highlight not found for items with short spec_text | Medium | Low | No error shown; page renders correctly; highlight is enhancement only |

---

*End of plan — version 1.0*
