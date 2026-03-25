# PDF Viewer, Clear Fields & Session Resume Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three broken features in step 2: the PDF viewer renders a blank canvas, the PDF button is missing after session restore, and the Clear Fields button does nothing.

**Architecture:** All three bugs are in the same subsystem (step 2 UI). Fix 1 replaces pdfjs-dist 5.x (ESM-only, worker fails in Electron) with 4.x (UMD build, loads via `<script src>`, worker uses standard `importScripts`). Fix 2 persists `sourceType` in session JSON so the PDF button renders on resume. Fix 3 adds the missing `clearExtracted` global function to index.js.

**Tech Stack:** Electron renderer (file:// protocol, contextIsolation:true, nodeIntegration:false), pdfjs-dist 4.x (UMD), vanilla JS, localStorage session.

---

## File Map

| File | Change |
|------|--------|
| `electron/vendor/pdfjs/pdf.js` | Replace with pdfjs-dist 4.x UMD build (was .mjs) |
| `electron/vendor/pdfjs/pdf.worker.js` | Replace with pdfjs-dist 4.x worker (was .mjs) |
| `electron/js/init-pdfjs.js` | Remove ES module import; becomes regular script that sets workerSrc |
| `electron/index.html` | Add `<script src="vendor/pdfjs/pdf.js">` before init-pdfjs; fix script tag order |
| `electron/js/modules/step2.js` | Fix canvas width calculation: use `setTimeout(300)` + reliable width fallback |
| `electron/js/modules/shared/utils.js` | Include `sourceType` in session JSON saved by `goTo()` |
| `electron/js/modules/index.js` | Add `clearExtracted()` function; restore `sourceType` in `resumeSession()` |

---

### Task 1: Switch PDF.js from 5.x ESM to 4.x UMD

pdfjs-dist 5.x is ESM-only. ES module workers (`new Worker(url, {type:'module'})`) fail silently in Electron's renderer process. pdfjs-dist 4.x has a UMD build that loads via a plain `<script src>` tag and uses standard `importScripts()` workers which work correctly in Electron.

**Files:**
- Modify: `electron/vendor/pdfjs/` (replace files)
- Modify: `electron/js/init-pdfjs.js`
- Modify: `electron/index.html`

- [ ] **Step 1: Install pdfjs-dist 4.x and copy vendor files**

```bash
cd C:/Users/marcu/Desktop/solicitation-quoter
npm install pdfjs-dist@4.9.155
# The UMD build is in legacy/build/, NOT build/ (build/ contains only .mjs ESM files)
ls node_modules/pdfjs-dist/legacy/build/
```

Expected output includes: `pdf.js` and `pdf.worker.js`

```bash
cp node_modules/pdfjs-dist/legacy/build/pdf.js electron/vendor/pdfjs/pdf.js
cp node_modules/pdfjs-dist/legacy/build/pdf.worker.js electron/vendor/pdfjs/pdf.worker.js
```

Verify:
```bash
ls electron/vendor/pdfjs/
# Should show: pdf.js  pdf.worker.js  pdf.mjs  pdf.worker.mjs
# (old .mjs files can stay — they won't be loaded)
```

- [ ] **Step 2: Rewrite init-pdfjs.js as a plain script (not a module)**

Replace the entire content of `electron/js/init-pdfjs.js`:

```javascript
// init-pdfjs.js — sets PDF.js worker path after pdf.js UMD script loads
// Loaded as a plain <script src> (not module) — window.pdfjsLib is set by pdf.js UMD.
// Must use an absolute file:// URL for workerSrc — bare relative paths fail in Electron's
// file:// renderer when passed directly to new Worker(). Build the URL from location.href.
if (window.pdfjsLib) {
  const base = location.href.replace(/\/[^/]+$/, '/')
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = base + 'vendor/pdfjs/pdf.worker.js'
}
```

- [ ] **Step 3: Update index.html script tags**

In `electron/index.html`, find the existing `init-pdfjs.js` script tag near the bottom of `<body>` (before `</body>`):

```html
<script src="js/init-pdfjs.js" type="module"></script>
```

Replace it with TWO plain script tags (no `type="module"` — plain scripts load synchronously before DOM is fully ready but after their declared position, which is fine here):

```html
<script src="vendor/pdfjs/pdf.js"></script>
<script src="js/init-pdfjs.js"></script>
```

Both tags have `src` attribute first → passes `test_arch01` (no inline JS).

- [ ] **Step 4: Update step2.js to reference .js extension (not .mjs)**

In `electron/js/modules/step2.js`, find any remaining references to `pdf.mjs` or `pdf.worker.mjs` and update them. Also remove any dynamic `import()` call if one slipped back in.

```bash
grep -n "pdf\.mjs\|pdf\.worker\.mjs\|import(" electron/js/modules/step2.js
```

If any matches: update to `pdf.js` / `pdf.worker.js`. If no matches, skip.

- [ ] **Step 5: Run architecture tests**

```bash
cd C:/Users/marcu/Desktop/solicitation-quoter
python -m pytest tests/test_arch01.py tests/test_arch02.py tests/test_arch03.py -v
```

Expected: all pass. If `test_no_script_logic_block` fails, the `<script src="vendor/pdfjs/pdf.js">` tag somehow matched — check that `src` is the very first attribute after `<script `.

- [ ] **Step 6: Commit**

```bash
git add electron/vendor/pdfjs/pdf.js electron/vendor/pdfjs/pdf.worker.js electron/js/init-pdfjs.js electron/index.html package.json package-lock.json
git commit -m "fix: switch pdfjs-dist 5.x ESM to 4.x UMD for Electron worker compatibility"
```

---

### Task 2: Fix canvas rendering (blank canvas)

Even with the correct PDF.js version, `renderPdfPage()` uses `canvas.parentElement?.offsetWidth` to size the canvas. The panel is still mid-transition when this runs (0.2s CSS height animation), and the panel may report `offsetWidth = 0` because of how the browser handles layout in collapsed containers. A 2-frame rAF delay (~32ms) is not enough. Fix: wait for the CSS transition to finish (200ms) and fall back to a reliable width source.

**Files:**
- Modify: `electron/js/modules/step2.js`

- [ ] **Step 1: Replace the rAF delay with a post-transition delay and robust width measurement**

In `electron/js/modules/step2.js`, find `renderPdfPage`:

```javascript
async function renderPdfPage(pageNum) {
  if (!_pdfDoc) return
  const page = await _pdfDoc.getPage(pageNum)
  const canvas = document.getElementById('pdf-canvas')
  if (!canvas) return
  // Wait for CSS transition/layout to complete before measuring width
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  const ctx = canvas.getContext('2d')
  // Scale to fit panel width — fall back to main content area width if panel not yet laid out
  const panelWidth = (canvas.parentElement?.offsetWidth || 0) > 50
    ? canvas.parentElement.offsetWidth
    : (document.querySelector('.content')?.offsetWidth || document.querySelector('.card')?.offsetWidth || 600)
```

Replace with:

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
```

- [ ] **Step 2: Fix the same race in scrollPdfToBoundingBox**

`scrollPdfToBoundingBox` also measures `canvas.parentElement?.offsetWidth` directly after expanding the panel. Find in `step2.js`:

```javascript
  const panelWidth = canvas.parentElement?.offsetWidth || 600
  const scale = panelWidth / unscaledViewport.width
```

Replace with:

```javascript
  let panelWidth = canvas.parentElement?.offsetWidth || 0
  if (panelWidth < 10) {
    let el = canvas.parentElement?.parentElement
    while (el && panelWidth < 10) { panelWidth = el.offsetWidth; el = el.parentElement }
  }
  panelWidth = panelWidth || 600
  const scale = panelWidth / unscaledViewport.width
```

- [ ] **Step 3: Verify no new arch test failures**

```bash
python -m pytest tests/test_arch01.py -v
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add electron/js/modules/step2.js
git commit -m "fix: wait for CSS transition and fix width fallback in PDF canvas rendering"
```

---

### Task 3: Show PDF button on session restore

`window.S.sourceType` is the flag that controls whether the "View PDF Source" button renders in step 2. It is explicitly set to `null` in `resumeSession()` because it wasn't being saved to the session JSON. Fix: save `sourceType` in the session object in `goTo()`, and restore it in `resumeSession()`.

**Files:**
- Modify: `electron/js/modules/shared/utils.js` — add `sourceType` to session
- Modify: `electron/js/modules/index.js` — restore `sourceType` in `resumeSession()`

- [ ] **Step 1: Add sourceType to session save in utils.js**

In `electron/js/modules/shared/utils.js`, find `goTo()`:

```javascript
const sess = {step:n, done:[...S.done], extracted:S.extracted, vendor:S.vendor, items:S.items}
```

Replace with:

```javascript
const sess = {step:n, done:[...S.done], extracted:S.extracted, vendor:S.vendor, items:S.items, sourceType:S.sourceType||null}
```

- [ ] **Step 2: Restore sourceType in resumeSession() in index.js**

In `electron/js/modules/index.js`, find `resumeSession()`:

```javascript
  // confidence/sourceFile are not persisted — step 2 renders gracefully without them
  window.S.confidence = null
  window.S.sourceFile = null
  window.S.sourceType = null
```

Replace with:

```javascript
  // sourceType is persisted so the PDF button renders correctly on resume
  // sourceFile (File object) cannot be serialized — PDF viewer shows message if clicked
  window.S.confidence = null
  window.S.sourceFile = null
  window.S.sourceType = sess.sourceType || null
```

- [ ] **Step 3: Commit**

```bash
git add electron/js/modules/shared/utils.js electron/js/modules/index.js
git commit -m "fix: persist sourceType in session so PDF button appears on resume"
```

---

### Task 4: Fix Clear Fields button

The "Clear Fields" button in step 2 calls `window.clearExtracted?.()`. This function is never defined anywhere — it's only referenced, never implemented. Fix: add it to `index.js` and expose it as a window global. It should reset all extracted fields to empty strings and re-render step 2.

**Files:**
- Modify: `electron/js/modules/index.js`

- [ ] **Step 1: Add clearExtracted function to index.js**

In `electron/js/modules/index.js`, find the `resumeSession()` and `dismissSession()` functions (added recently). Add `clearExtracted` immediately after `dismissSession`:

```javascript
function clearExtracted() {
  // Reset all extracted field values to empty — user wants to start fresh
  if (window.S.extracted) {
    const method = window.S.extracted._method  // preserve extraction method badge
    Object.keys(window.S.extracted).forEach(k => {
      if (k !== '_method') window.S.extracted[k] = ''
    })
    window.S.extracted._method = method
  }
  window.S.confidence = null  // clear confidence indicators too
  goTo(2)  // re-render step 2 with cleared fields
}
```

- [ ] **Step 2: Expose clearExtracted as a window global**

In the same file, find the existing window global exposures (near the bottom, where `window.resumeSession` and `window.dismissSession` are set):

```javascript
window.resumeSession = resumeSession
window.dismissSession = dismissSession
```

Add immediately after:

```javascript
window.clearExtracted = clearExtracted
```

- [ ] **Step 3: Commit**

```bash
git add electron/js/modules/index.js
git commit -m "fix: implement clearExtracted() for step 2 Clear Fields button"
```

---

### Task 5: Run full test suite and verify

- [ ] **Step 1: Run all tests**

```bash
cd C:/Users/marcu/Desktop/solicitation-quoter
python -m pytest tests/ --ignore=tests/test_sec01.py -v 2>&1
```

Expected: all tests pass (30 passed). `test_sec01.py` is excluded — pre-existing env failure unrelated to this work.

- [ ] **Step 2: Manual smoke test checklist**

Start the app: `npm start`

**PDF viewer (fresh upload):**
1. Upload a PDF solicitation
2. Navigate to step 2 — "View PDF Source" button appears
3. Click "View PDF Source" — panel expands and PDF renders (not blank)
4. Click "Hide PDF" — panel collapses
5. Upload a DOCX — no PDF viewer button appears

**PDF viewer (session restore):**
1. Upload a PDF, parse it, navigate to step 2
2. Close and reopen the app
3. Click "Resume" on the resume banner
4. Verify "View PDF Source" button IS visible (sourceType restored)
5. Click it — shows "PDF preview requires re-uploading the document in this session." (expected — File object not serializable)

**Clear Fields:**
1. On step 2, click "Clear Fields"
2. All input fields become empty
3. Confidence indicators clear (no badges on empty fields)

**Session resume:**
1. Upload → parse → edit some fields → navigate to step 3
2. Close and reopen the app
3. Click "Resume" — restores to step 3 with your vendor/item data intact

- [ ] **Step 3: Final commit if any tweaks needed**

```bash
git add -p  # review any last changes
git commit -m "fix: smoke test cleanup"
```
