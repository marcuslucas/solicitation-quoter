# Sol-Quoter — Frontend Audit Report (Session 2 of 2)

## Date: June 12, 2026
## Git HEAD: a074e37

Scope: Electron frontend (`main.js`, `preload.js`, `index.html`, `pdfviewer.html`,
`state.js`, `step1–4.js`, `shared/utils.js`, `shared/theme.js`, `index.js`,
`init-pdfjs.js`) plus `package.json` and a cross-reference of `python/server.py`
endpoints. Session 1 covered the Python backend
([backend-audit-session1.md](backend-audit-session1.md)); findings there are not
repeated here.

---

## Executive Summary — Frontend Only

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High     | 5 |
| Medium   | 11 |
| Low      | 11 |

**Overall:** The renderer security fundamentals are correct — `contextIsolation:
true` and `nodeIntegration: false` on every window, no `webSecurity` override,
no `eval()`, and all user-controlled data is escaped before `innerHTML`. But
there are five delivery blockers:

1. **Three wired UI features are dead** — `window.pickLogo`, `window.removeLogo`,
   and `window.loadDemoData` are referenced by buttons but never defined
   anywhere, so "Upload Logo", "Remove" logo, and "Load Demo Data" silently do
   nothing (H-1). This was flagged in a prior audit
   (`docs/plans/Old/final-project-audit.md`) and remains unfixed.
2. **No single-instance lock** (H-2) — launching the app twice spawns a second
   Flask backend that fails to bind port 5199.
3. **Electron 28 is end-of-life** (H-3) — ~1.5 years of unpatched Chromium
   security fixes.
4. **The vendored PDF.js (3.11.174) is vulnerable to CVE-2024-4367** (H-4) —
   a malicious PDF opened in the viewer can execute arbitrary JavaScript in the
   viewer renderer.
5. **No README and no `.env.example`** (H-5) — the client gets no install,
   first-run, or packaging documentation.

All 8 Phase-completion checks PASS (evidence in the Phase Completion section).

---

## Critical Findings

None found. (The PDF.js CVE, H-4, would be Critical for a browser-exposed app but
is contained by `contextIsolation`/`nodeIntegration:false` to the viewer
renderer, so it is rated High.)

---

## High Findings

### H-1. Logo upload, logo remove, and demo-data features are dead (undefined functions)

- **File:** `electron/js/modules/step3.js:820-821`, `electron/js/modules/step1.js:445`
- **Severity:** High

```js
// step3.js
document.getElementById('logo-pick-btn')?.addEventListener('click', () => window.pickLogo?.())
document.getElementById('logo-remove-btn')?.addEventListener('click', () => window.removeLogo?.())
// step1.js
?.addEventListener("click", () => window.loadDemoData?.());
```

`window.pickLogo`, `window.removeLogo`, and `window.loadDemoData` are **never
defined** anywhere in the live codebase (verified by grep across `electron/`;
the only `pickLogo` definition is `window.api.pickLogo` in preload, which is a
different symbol). Because each call site uses optional chaining (`?.()`),
clicking the buttons throws no error — they silently do nothing. User impact:

- The "Upload Logo (PNG / JPG)" button on Step 3 does nothing. Logos can never
  be added through the UI, even though `generator.py` and the Step 4 preview both
  render `vendor.logo_b64`.
- The "Remove" logo button (shown when a logo exists) does nothing.
- The "Load Demo Data" quick action on Step 1 does nothing.

The backend IPC (`pick-logo` in main.js:199, with a 2 MB limit) is fully
implemented and unreachable. This was previously documented as
"Finding 1.3 / Fix #2 / Fix #3" in `docs/plans/Old/final-project-audit.md` and
was never addressed. For a client delivery this is a visible broken feature.

### H-2. No single-instance lock — second launch spawns a conflicting backend

- **File:** `electron/main.js` (no `app.requestSingleInstanceLock()` anywhere)
- **Severity:** High (per audit instruction)

`app.whenReady().then(createWindow)` runs unconditionally. There is no
`requestSingleInstanceLock()` / `second-instance` handling. Launching the app a
second time (double-click while already running) creates a second window that
calls `startBackend()`, which spawns another `server.py` trying to bind
`127.0.0.1:5199`. The second backend fails to bind (Flask exits), and
`waitForBackend()` eventually times out → the second window loads `error.html`.
Worse, on quit the `kill()` path uses `taskkill /pid <backend.pid> /f /t` for
only the most recently spawned backend reference, so an orphaned first backend
can survive. Add a single-instance lock and focus the existing window on
re-launch.

### H-3. Electron 28 is end-of-life

- **File:** `package.json:12` (`"electron": "^28.3.0"`)
- **Severity:** High

Electron 28 reached end-of-life in 2024. At the delivery date it is missing
~1.5 years of Chromium and V8 security patches. A desktop app that loads
remote-sourced content (Google Fonts via `@import` in index.html:7, SAM.gov data,
user PDFs) on an unpatched Chromium is a real exposure. Upgrade to a currently
supported Electron line (30+) before delivery and re-test the
`printToPDF`/offscreen and `safeStorage` paths.

### H-4. Vendored PDF.js 3.11.174 is vulnerable to CVE-2024-4367 (arbitrary JS from a malicious PDF)

- **File:** `package.json:16` (`"pdfjs-dist": "^3.11.174"`); vendored at
  `electron/vendor/pdfjs/pdf.js` + `pdf.worker.js`; loaded by
  `electron/pdfviewer.html:199,481` and `electron/index.html:742`
- **Severity:** High

PDF.js before 4.2.67 is affected by CVE-2024-4367 — a crafted font in a PDF can
execute arbitrary JavaScript when `isEvalSupported` is left at its default
(`true`). `pdfviewer.html:481` calls
`pdfjsLib.getDocument({ data: arrayBuffer }).promise` with no `isEvalSupported:
false`, and the documents opened are exactly the untrusted government PDFs the
user uploads. Execution is confined to the viewer renderer
(`contextIsolation: true`, `nodeIntegration: false`), but that renderer still has
`window.api` access (`readFileAsArrayBuffer` — restricted to the session dir,
`openPdfViewer`, `getSessionFilePath`), so it is not harmless. Fix: upgrade the
vendored PDF.js to ≥ 4.2.67 (keep `pdf.js` and `pdf.worker.js` in sync), or as an
interim mitigation pass `isEvalSupported: false` to `getDocument`.

### H-5. No README.md and no .env.example

- **File:** project root (both absent)
- **Severity:** High (per audit instruction)

There is no `README.md` covering installation, first-run setup, or how to package
for Windows (`npm run build:win`) and macOS (`npm run build:mac`). There is no
`.env.example` documenting the environment variables the client must set
(`ANTHROPIC_API_KEY`, `AI_MAX_CALLS`, `AI_HEADER_MODEL`, `AI_LINE_ITEM_MODEL`,
`PORT`). The `.env.example` gap was already raised in Session 1 (backend H-2);
it is reaffirmed here as a delivery blocker. The only setup documentation that
exists is `docs/plans/SOL-QUOTER-HANDOFF.md`, which is an internal handoff, not
client-facing.

---

## Medium Findings

### M-1. localStorage keys are inconsistently namespaced (confirmed)

- **File:** across `step3.js:84`, `index.js`, `utils.js`, `theme.js`,
  `step3.js:504`
- **Severity:** Medium

The audit's suspected inconsistency is confirmed. Complete key inventory:

| Key | Namespacing | File |
|-----|-------------|------|
| `vendor` | none | step3.js:84 |
| `session` | none | utils.js, index.js, step4.js |
| `quoteHistory` | none | step4.js, index.js |
| `validity` | none | index.js |
| `samKey` | none | index.js |
| `vendorProfiles` | none | index.js |
| `quoteSeq` | none | utils.js |
| `apiKey` | none (legacy) | index.js |
| `sq-apikey` | `sq-` prefix (legacy) | index.js |
| `sq-theme` | `sq-` prefix | theme.js |
| `sol-quoter:col-widths` | `sol-quoter:` prefix | step3.js:504 |

Three different conventions (none / `sq-` / `sol-quoter:`) for keys owned by the
same app. Collision risk is low (single origin), but it is a real consistency
defect and makes "clear all app data" logic error-prone. Pick one prefix
(`sol-quoter:`) and migrate.

### M-2. `scrollPdfToBoundingBox` only works for drag-dropped files, not dialog-picked files

- **File:** `electron/js/modules/step2.js:13`
- **Severity:** Medium

```js
const filename = window.S.file && window.S.file.name
if (!filename) return
```

When the user selects a file through the native dialog (`pickFile()` in
step1.js:82), `window.S.file` is `null` and only `window.S.filePath` is set. So
clicking a flagged field to jump to its bounding box in the PDF returns early and
does nothing — the Phase 9 bbox-navigation feature is silently unavailable for
dialog-picked files. The separate "View PDF" button (step2.js:527) works in both
cases because it falls back to `window.S.filePath`; `scrollPdfToBoundingBox`
should use the same fallback.

### M-3. `open-path` and `open-url` IPC handlers accept arbitrary input from the renderer without validation

- **File:** `electron/main.js:169` (`open-url` → `shell.openExternal`), `:171`
  (`open-path` → `shell.openPath`)
- **Severity:** Medium

```js
ipcMain.handle('open-url',  (_, url)      => shell.openExternal(url))
ipcMain.handle('open-path', (_, filePath) => shell.openPath(filePath))
```

Unlike `read-file-as-array-buffer` (which correctly restricts to the session
dir, main.js:329-340) and `get-session-file-path` (which `path.basename()`-sanitizes,
main.js:285-290), these two pass renderer-supplied input straight to the OS.
`shell.openExternal` will launch arbitrary protocol handlers; `shell.openPath`
opens any local path with its default app. The renderer is trusted today, but
this is the exact surface H-3/H-4 would pivot through if the renderer were ever
compromised. Constrain `open-path` to the session directory (the only legitimate
caller, step2.js:528, passes the source PDF path) and allowlist `open-url` to
`http(s):`.

### M-4. Synchronous file I/O on the main process blocks the UI

- **File:** `electron/main.js:162,192,205,227,239,250,257,260,265,266,289,338`
  and `:17,22`
- **Severity:** Medium

All file reads/writes in main-process IPC handlers are synchronous
(`fs.readFileSync`/`fs.writeFileSync`). `read-file-as-array-buffer` (main.js:338)
reads an entire PDF — up to the 50 MB upload cap — synchronously into memory,
blocking the main process (and therefore every window, including the main UI)
for the duration. `pick-logo` reads up to 2 MB sync; `save-quote`/`save-pdf`
write the whole document sync. For a desktop app these are usually small, but a
large PDF opened in the viewer will visibly freeze the UI. Prefer the async
`fs.promises` variants in IPC handlers.

### M-5. `saveSettings` swallows backend-restart failure silently

- **File:** `electron/js/modules/index.js:26-46`
- **Severity:** Medium

The whole API-key-save + `restartBackend()` block is wrapped in
`try { ... } catch(e) {}` (empty). If `storeApiKey` or `restartBackend` rejects,
the user still sees "Settings saved" (line 48) and the AI panel will behave as if
the new key is active when the backend may not have restarted with it. Surface a
toast on failure instead of swallowing.

### M-6. Stale/contradictory confidence-banner copy contradicts the shipped AI feature

- **File:** `electron/js/modules/step2.js:392-394`
- **Severity:** Medium

The red (low-confidence) banner prints "AI-assisted extraction will be available
in a future update." — but Phase 8 shipped the AI panel, which is rendered
directly above this banner (`#ai-panel-container`) whenever a key is configured.
A client seeing "future update" next to a working AI panel is confusing and reads
as unfinished. Update or remove the copy.

### M-7. Auto-expand threshold for the AI panel disagrees with the red-banner threshold

- **File:** `electron/js/modules/step2.js:222-223` vs `:385`
- **Severity:** Medium

`renderAiPanel()` auto-expands the AI panel when `parseConfidence.overall < 0.6`,
but the "red / low confidence" banner — which the handoff (§10) says should
trigger the AI panel to auto-expand — uses `< 0.5`. So for scores in [0.5, 0.6)
the panel auto-expands while the banner is amber, and the two thresholds drift.
Pick one constant and share it.

### M-8. `window.S.files` is not in the state schema and breaks session resume

- **File:** `electron/js/state.js:5-26` (no `files` key); `step1.js:69,149`;
  `index.js:571-573` (`resumeSession`)
- **Severity:** Medium

`step1.js` introduces `window.S.files` (the multi-file upload array) and
`window.S.sourceFile`/`window.S.sourceType` ad hoc — none are declared in
`state.js`. On session resume (`resumeSession`, index.js:563), `File` objects
cannot be serialized to localStorage, so `sourceFile` is set to `null` and the
"View PDF" / bbox features silently degrade after a resume even though the
banner/button still render (the code comments acknowledge this at index.js:570-573).
Declare these keys in the schema and gate the PDF UI on their actual presence
after resume.

### M-9. Full Step 3 re-render on every row mutation

- **File:** `electron/js/modules/step3.js:43,55,62,69,77` (`window.render(3)`)
- **Severity:** Medium

`addRow`, `addRows`, `dupRow`, `delRow`, and `clearRows` each call
`window.render(3)`, which rebuilds the entire Step 3 DOM — all vendor cards plus
the full line-items table — and re-wires every listener. With the 118-item LLSM
bundle (the `70B06C26Q00000080` fixture), tabbing past the last row auto-adds a
row (`setupLineItemTabNav`, step3.js:274) and triggers a full 118-row rebuild per
keystroke-add. This will feel janky on large solicitations. Append a single row
to the DOM instead of re-rendering.

### M-10. `generate-pdf` loads renderer-built HTML into a fresh BrowserWindow via a data: URL

- **File:** `electron/main.js:173-182`
- **Severity:** Medium

`pdfWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))`
where `html` is `buildQuoteHTML(true)` containing user/vendor/solicitation values.
The values are escaped via `window.esc` in step4.js, so this is not an active
XSS, but loading constructed HTML into a Chromium window is a fragile pattern and
the offscreen window has no explicit `nodeIntegration:false`/`sandbox`
(it relies on Electron 28 defaults). Set `webPreferences:{ nodeIntegration:false,
contextIsolation:true, sandbox:true, javascript:false }` on the PDF window — it
only needs to render static HTML, so JavaScript can be disabled outright.

### M-11. `sandbox` is not enabled on any BrowserWindow

- **File:** `electron/main.js:109,174,311-315`
- **Severity:** Medium

The main window, the PDF-generation window, and the PDF viewer window all set
`contextIsolation:true` + `nodeIntegration:false` but do **not** set
`sandbox:true`. Sandboxing the renderer is an additional defense-in-depth layer
that limits a compromised renderer (relevant given H-4) to OS-sandboxed
primitives. The preload uses only `ipcRenderer` + `contextBridge`, which are
sandbox-compatible, so enabling `sandbox:true` should be low-risk. Recommended
before delivery.

---

## Low Findings

### L-1. console.* inventory (renderer + main)

All non-vendor `console` calls are operational/diagnostic, not leftover debug
prints; keeping them is reasonable, but they are noise in a delivered build:

| File:Line | Call | Assessment |
|-----------|------|------------|
| main.js:66-67 | `console.log('[backend]', …)` (stdout+stderr) | Operational — backend log relay |
| main.js:68 | `console.error('[backend error]', …)` | Operational |
| step1.js:168 | `console.warn('[step1] Session clear failed …')` | Operational |
| pdfviewer.html:333 | `console.warn('[pdfviewer] text layer render failed …')` | Operational |
| pdfviewer.html:338 | `console.error('[pdfviewer] renderPage error:', err)` | Operational |
| pdfviewer.html:474 | `console.error('[pdfviewer] readFileAsArrayBuffer error:', e)` | Operational |
| pdfviewer.html:483 | `console.error('[pdfviewer] getDocument error:', e)` | Operational |

(Vendor `electron/vendor/pdfjs/*` console calls are third-party and out of scope.)
No `console.log` debug statements in app step modules. Consider gating the
`[backend]` stdout relay behind `!app.isPackaged` so the shipped app doesn't echo
backend chatter.

### L-2. Empty catch blocks (silent swallow) — full list

`utils.js:48,102,116`; `step3.js:84,523`; `step4.js:290,361,379`;
`index.js:46,32-ish(31/44/45),61(has fallback),254-ish,554,559,581`;
`step2.js:537`; `main.js:17,22,92`. The large majority wrap best-effort
`localStorage` writes and are acceptable. The two worth attention are
`index.js:46` (swallows backend restart failure — see M-5) and `step2.js:537`
(swallows session-clear failure on "Clear & Reparse", leaving stale session
files). The rest can keep their empty catches but a one-line comment each would
help maintainers.

### L-3. Unguarded `JSON.parse` of a DOM dataset value

- **File:** `electron/js/modules/step2.js:575` — `JSON.parse(el.dataset.bbox)`
  inside the flagged-field click handler. `dataset.bbox` is server-produced
  (`JSON.stringify(boundingBox)`), so malformed input is unlikely, but a parse
  failure would throw an uncaught error in the handler. Wrap in try/catch.
  (All other `JSON.parse` sites are already guarded.)

### L-4. Native `prompt()`/`confirm()` dialogs in a desktop app

- **File:** `step3.js:47` (`prompt('How many rows?')`), `step3.js:74,89`,
  `step4.js:360`, `utils.js:101`, `index.js:65,321,347` (`confirm(...)`)
- **Severity:** Low

The app uses the browser-native `prompt()` and `confirm()` for "add N rows",
"clear all", "start over", "overwrite/delete profile", and "clear history". These
render as jarring Chromium modal dialogs that clash with the themed UI and block
the renderer. The app already has a toast system and modal-overlay pattern;
replacing these with in-app modals would feel more professional. (`alert()` is
not used anywhere — good.)

### L-5. Toast close button is double-wired

- **File:** `electron/js/modules/shared/utils.js:56,63`
- The toast HTML embeds an inline `onclick="this.parentElement.remove()"` (line
  56) **and** an `addEventListener('click', …)` is attached to the same `.toast-x`
  (line 63). Both fire on click; harmless but redundant. The inline handler also
  means a CSP that forbids inline handlers would break it.

### L-6. `pdfjs-dist` npm dependency is vestigial

- **File:** `package.json:16` — PDF.js is loaded from the vendored
  `electron/vendor/pdfjs/` copy, not from `node_modules`. The `pdfjs-dist`
  dependency is unused at runtime and only adds confusion about which copy is
  authoritative (and which version the CVE in H-4 applies to). Either remove it,
  or drive the vendored files from it during build so versions can't drift.

### L-7. Duplicate `lineTotal`/`grandTotal`/`updTotals` in utils.js and step3.js

- **File:** `utils.js:18-37` and `step3.js:11-36` — both define the three
  totals functions; `step3.js:842` re-assigns `window.updTotals` to its own copy,
  overwriting the utils version (load order: utils → step3). The utils copies of
  `lineTotal`/`grandTotal` are still used by step4 via `window.grandTotal`. Having
  two near-identical implementations is a maintenance trap (a formula fix in one
  won't reach the other). Consolidate into utils.js.

### L-8. Undefined CSS custom properties in Step 4 inline styles

- **File:** `electron/js/modules/step4.js:218` (`var(--gold)`), `:227`
  (`var(--muted)`) — these tokens do not exist in the `:root` palette (the real
  tokens are `--color-primary` and `--color-text-muted`). The `border:1px solid
  var(--gold)` and `color:var(--muted)` silently resolve to no value / inherit, so
  the intended gold border on the TOTAL card and the muted helper text don't
  render as designed. Use the correct `--color-*` tokens.

### L-9. No hardcoded backend URLs — but the default port literal is duplicated

- **File:** all renderer fetches correctly use `http://127.0.0.1:${window.S.port}`
  (step1.js:187, step2.js:189,311, step4.js:264, index.js:201, preload.js:21).
  `window.S.port` is sourced from `window.api.getPort()` (index.js:531), which
  returns the main-process `PORT`. **No hardcoded `:5199` URL bug exists.** The
  literal default `'5199'` is duplicated between `main.js:8` and
  `python/constants.py`; acceptable but worth a shared source if the port ever
  changes.

### L-10. `onNavigateToBbox` preload binding has no removal path

- **File:** `electron/preload.js:19` — `onNavigateToBbox` wraps
  `ipcRenderer.on('navigate-to-bbox', …)` with no corresponding
  `removeListener`. The viewer registers it exactly once per window load
  (pdfviewer.html:501, outside `renderPage`), so no leak occurs in practice (PASS
  in Phase verification), but exposing an `off`/`removeNavigateToBbox` would make
  the API safe against future repeat-registration.

### L-11. `app.version` is `1.0.0` — acceptable but generic

- **File:** `package.json:3` — `"version": "1.0.0"` is meaningful for a first
  delivery. No action required; noted for completeness.

---

## Category-by-Category Summary

**1. Security — Frontend**
- `nodeIntegration: true`: **None found** (false/omitted-default on all three
  windows: main.js:109, 174, 311-315).
- `eval()`: **None found** in app code (vendor PDF.js may use eval internally —
  see H-4).
- `innerHTML` with unescaped user data: **None found.** Every dynamic
  `innerHTML` that interpolates `window.S.extracted`, vendor, item, profile,
  history, or PDF-derived values routes through `window.esc()` (step1/2/3/4,
  index.js, utils.toast). The one raw interpolation is `logo_b64` into a
  `data:image/...;base64,...` URI (step3.js:629, step4.js:41) — base64's alphabet
  (`[A-Za-z0-9+/=]`) cannot break out of the quoted attribute, so it is safe.
- IPC accepting arbitrary paths: `open-path`/`open-url` unvalidated (M-3);
  `read-file-as-array-buffer` and `get-session-file-path` are correctly
  restricted/sanitized.
- `contextIsolation`: **true on all windows** (confirmed).
- `sandbox`: **not enabled** anywhere (M-11).
- `webSecurity`: **never disabled** (good — None found).
- preload over-exposure: the 18 `window.api` methods are all thin
  `ipcRenderer.invoke` wrappers or the one `navigate-to-bbox` listener; no raw
  `ipcRenderer`, `require`, `fs`, or `child_process` is exposed. `clearSession`
  uses `fetch` directly from preload (preload.js:21) rather than IPC — harmless
  but inconsistent with the others. No over-exposure found.

**2. Error Handling — Frontend**
- Empty catch bodies: L-2 (list). Notable: M-5.
- Fetch with no error handling: **None found** — every `fetch` (step1 doParse,
  step2 doAiExtract/checkAiStatus, step4 doGenerate/doGeneratePdf, index
  doSamLookup) is inside try/catch; preload `clearSession` callers wrap it.
- IPC invoke with no error handling: mostly wrapped; the async IIFE in step3
  view-source (step3.js:399-406) and `scrollPdfToBoundingBox` (step2.js) call
  `window.api` without try/catch — low risk because those handlers don't reject
  except `read-file-as-array-buffer`, which the viewer catches.
- Null/undefined guards: `window.S.extracted`/`vendor`/`aiUsage` are always
  initialized objects (state.js) and never set to null by the flow;
  `parseConfidence` is read with `pc && typeof pc.overall === 'number'` guards
  (step2.js:345). No missing-guard crash found.
- `JSON.parse` without try/catch: one (L-3, step2 bbox).
- Backend not running at startup: handled — `waitForBackend()` rejects after 30
  tries and `createWindow` loads `error.html` (main.js:141-143). User sees a
  fallback page, not a blank window.
- Non-PDF upload: validated client-side by extension in `validateDroppedFile`
  (step1.js:27-44) with a clear error, and again server-side by magic bytes
  (Session 1). Good.

**3. Code Quality — Frontend**
- Functions over 150 lines: `step3()` (step3.js:575-831, ~257 lines) and
  `buildQuoteHTML()` (step4.js:7-176, ~170 lines) are the two over 150;
  `step2()` (~259 lines incl. wiring, 327-585) is the largest. All three are
  monolithic render-and-wire functions — decomposition candidates (extract the
  table/card builders). `renderAiPanel` (step2.js:216-304, ~89) and
  `doParse` (step1.js:130-301, ~170) are also long; `doParse` exceeds 150.
- Duplicate logic: L-7 (totals in utils + step3); the Step 4 preview HTML
  (`buildQuoteHTML`) duplicates the entire layout/color scheme of
  `python/generator.py` by design (documented exception, step4.js:16-35).
- Magic numbers/strings: abort timeout `90000` (step1.js:144), AI default
  `?? 10` calls (step2.js:221), scale steps and `100`ms highlight delay
  (pdfviewer), `MAX_UNDO 30` (utils), `MAX_LOGO 2*1024*1024` (main.js:206),
  default port `'5199'` (main.js:8). Mostly fine inline; the abort timeout and
  AI-call default would be better named.
- Dead code: H-1 (three undefined functions wired to buttons); L-7 (shadowed
  totals).
- Commented-out code blocks: **None found** (only explanatory comments).
- TODO/FIXME: **None found.**
- console.*: L-1.
- CSS vars referenced in JS not in `:root`: L-8 (`--gold`, `--muted`). All other
  `var(--color-*)`/`var(--space-*)`/`var(--text-*)` references resolve.

**4. Architecture — Frontend**
- State outside `window.S`: the undo/redo stacks (`utils.js:67-68`),
  `_importBatch` (index.js:362), and `dragDepth` (step1.js:305) are module-level,
  but all are transient and reset correctly — none is persistent app state stored
  in the DOM. `window.S.files`/`sourceFile`/`sourceType` live on `S` but are
  undeclared in the schema (M-8). No DOM-as-state-store found.
- Cross-module direct calls: step modules communicate only through `window.S` and
  `window.*` globals (e.g. `window.next`, `window.goTo`, `window.render`); no
  `step1` calling a `step2()` internal directly. `index.js` orchestrates. The
  coupling is loose-via-globals, which is the project's documented pattern.
- localStorage key inconsistency: M-1 (confirmed).
- Module-level accumulators never reset (leak pattern): **None found** — undo
  stack is capped at 30, `_importBatch`/`dragDepth` reset.
- localStorage key list: see M-1 table.
- `_pendingAiChanges` cleanup: correctly nulled after accept (step2.js:152) and
  discard (step2.js:164). See Phase verification.

**5. Performance — Frontend**
- Synchronous main-process file reads: M-4.
- Excessive re-render: M-9 (Step 3 full rebuild per row op). Vendor/field inputs
  correctly update state on `input` **without** re-rendering (only `updTotals` on
  freight/tax) — good.
- localStorage in render loops: **None found** — `nextQuoteNum` reads once per
  Step 3 render; `loadColWidths`/`saveColWidths` read on resize-end only.
- Uncleared timers: **None found** — `boundsTimer` (main.js, cleared),
  `abortTimeout` (step1, cleared), `t1`/`t2` (step4, cleared), toast timer
  (cleared on manual close), `applyHighlight` 100ms (fires once). No `setInterval`
  anywhere.
- Large PDFs into memory: yes — `readFileAsArrayBuffer` loads the whole file
  (up to 50 MB) into an ArrayBuffer and hands it to `getDocument({data})`
  (pdfviewer.html:472,481). No streaming/range requests. M-4-adjacent;
  acceptable for typical solicitations but a hardening opportunity.

**6. Electron-Specific**
- Single-instance lock: **absent** (H-2).
- macOS `activate`: **handled** — `app.on('activate', …)` recreates the window
  when none are open (main.js:345). PASS.
- Window cleanup: `viewerWin.on('closed', () => viewerWin = null)` (main.js:317)
  nulls the viewer ref; the main `win` is not explicitly destroyed but is GC'd on
  quit. `generate-pdf` destroys its offscreen window in a `finally` (main.js:180).
  Adequate.
- Backend termination on Windows: `kill()` (main.js:87-94) uses
  `taskkill /pid <pid> /f /t`, wired to `window-all-closed` (344),
  `before-quit` (346), and `process.on('exit')` (347). It does **not** fire if the
  main process is force-killed, and only tracks the latest `backend` reference
  (see H-2). The Python side also self-terminates via the `PARENT_PID` watchdog
  (Session 1) — but that watchdog depends on `psutil`, which Session 1 (H-1)
  found missing from requirements.txt. So on a clean install, **neither** the JS
  `kill()` (if it misses) nor the Python watchdog (no psutil) reliably reaps the
  backend — this is the cross-session root cause of the documented zombie-process
  issue.
- IPC listener leaks: `onNavigateToBbox` registered once per viewer window
  (pdfviewer.html:501), not per render. PASS. L-10 notes the missing removal path.
- PDF.js load failure in pdfviewer: handled — a `#status-overlay` error state
  shows specific messages for invalid params (line 450), missing path (456),
  unreadable file (475), and corrupt/failed PDF load (484). The window does not
  go blank. **However**, if `vendor/pdfjs/pdf.js` itself fails to load (line 199),
  `pdfjsLib` is undefined and the inline script throws at line 438 before any
  error UI runs — the overlay would stay on "Loading document…" forever. Minor
  gap.

**7. Phase Completion — Frontend** — see next section (all 8 PASS).

**8. Production Readiness — Frontend** — console inventory L-1; version L-11;
deps H-3/H-4/L-6; README + .env.example H-5; native dialogs L-4. No dev-only
flags or hardcoded localhost-bug found (L-9). The app has a user-facing error
path for backend-down (error.html), parse failure (step1 alert), generation
failure (step4 retry), SAM failure (step2 inline), and PDF-viewer failures —
failure modes are surfaced, not silent, **except** the three dead buttons (H-1)
and swallowed restart failure (M-5).

---

## Phase Completion Verification — Frontend

| # | Check | Verdict |
|---|-------|---------|
| 1 | Phase 7: `parseConfidence` set, does not overwrite `confidence` | **PASS** |
| 2 | Phase 8: AI panel HTML not injected when `aiAvailable` false | **PASS** |
| 3 | Phase 8: `_pendingAiChanges` set before diff, nulled after accept/discard | **PASS** |
| 4 | Phase 9: `scrollPdfToBoundingBox` implemented, calls `openPdfViewer` w/ bbox | **PASS** |
| 5 | Phase 9: `viewerWin.on('closed')` nulls `viewerWin` | **PASS** |
| 6 | Phase 9: `onNavigateToBbox` registered once, not in `renderPage` | **PASS** |
| 7 | Phase 10: `data-col` on the 6 resizable `<th>`, keys match `RESIZABLE_COLS` | **PASS** |
| 8 | Phase 10: `initResizableColumns()` called at end of `step3()` after `updTotals()` | **PASS** |

### 1. Phase 7 — parseConfidence coexists with confidence: PASS

`step1.js:201-211`:

```js
window.S.extracted = data.data;
window.S.parseConfidence = (data.data && data.data.confidence)
  ? data.data.confidence : null
window.S.sessionFiles = data._session_files || {};
window.S.confidence = {
  overallConfidence: data.overallConfidence || null,
  fields: data.fields || [],
  flags: data.flags || [],
};
```

`parseConfidence` (the extractor's `compute_confidence` block) and `confidence`
(the validator's field scores) are written to two distinct keys; neither
overwrites the other. Step 2 reads them independently (`window.S.confidence` at
step2.js:339, `window.S.parseConfidence` at :342).

### 2. Phase 8 — AI panel fully gated (no DOM injected): PASS

`step2.js:216-219`:

```js
function renderAiPanel() {
  const container = document.getElementById('ai-panel-container')
  if (!container) return
  if (!window.S.aiAvailable) { container.innerHTML = ''; return }
```

When `window.S.aiAvailable` is false (set by `checkAiStatus()` from
`/ai-status`), the container is emptied and the function returns before any panel
HTML is built — it is not merely CSS-hidden. `aiAvailable` is false unless the
backend reports a configured key (env or `X-Api-Key`).

### 3. Phase 8 — _pendingAiChanges lifecycle: PASS

Set before the diff renders (`step2.js:77-78`):
```js
const { changes } = mergeAiResult(window.S.extracted, aiResult)
window.S._pendingAiChanges = changes
```
Nulled on accept (`step2.js:152`) and on discard (`step2.js:164`):
```js
window.S._pendingAiChanges = null
```

### 4. Phase 9 — scrollPdfToBoundingBox real implementation: PASS

`step2.js:8-28` is a full implementation (no longer a no-op); it resolves the
session file path and calls the viewer with the bbox:
```js
const filePath = await window.api.getSessionFilePath(filename)
...
await window.api.openPdfViewer(filePath, bbox.page || 1, '', bbox)
```
(Functional caveat M-2: it only resolves a filename for drag-dropped files.)

### 5. Phase 9 — viewerWin closed handler: PASS

`main.js:317`: `viewerWin.on('closed', () => { viewerWin = null })`.

### 6. Phase 9 — onNavigateToBbox registered once: PASS

`pdfviewer.html:500-509` registers the listener once, after the initial
`goToPage(targetPage)` (line 495), at the top level of the IIFE — not inside
`renderPage()` (288) or `goToPage()` (345). No per-render accumulation.

### 7. Phase 10 — data-col on 6 resizable headers matches RESIZABLE_COLS: PASS

`step3.js:685-690` headers: `data-col="description"`, `"size"`, `"uom"`,
`"qty"`, `"unitprice"`, `"total"`. `RESIZABLE_COLS` keys (step3.js:507-514):
`description, size, uom, qty, unitprice, total`. Exact match. (The two
non-resizable headers — expand and `#` — correctly have no `data-col`.)

### 8. Phase 10 — initResizableColumns last, after updTotals: PASS

`step3.js:828-830`, the final two statements of `step3()`:
```js
  // Initial totals display
  updTotals()
  initResizableColumns()
}
```

---

## Combined Executive Summary (Both Sessions)

### 1. Is Sol-Quoter deliverable to a client as-is?

**Not as-is.** The application is functionally complete and well-structured — all
6 backend fixtures pass (exit 0), all 15 phase-completion checks across both
sessions pass except one (backend Phase-6 warning assembly), and the security
fundamentals (localhost-only bind, debug off, contextIsolation, no eval, escaped
output, no hardcoded secrets) are sound. But there are blocking issues that a
client would hit on day one:

- **A privacy/consent violation** (backend C-1): with an API key configured,
  every parse silently sends document text to Anthropic, contradicting the
  product's "documents stay local" guarantee and the user-triggered-AI design.
- **Visibly broken features** (frontend H-1): logo upload/remove and demo data
  buttons do nothing.
- **Reliability traps**: missing `psutil` (backend H-1) + missing single-instance
  lock (frontend H-2) together produce the zombie-backend and port-conflict
  failures; the fake 30-second parse timeout (backend H-3) can hang the UI for
  minutes.
- **Stale platform/dependency security**: EOL Electron 28 (frontend H-3) and a
  PDF.js with a known arbitrary-JS CVE (frontend H-4) that processes untrusted
  PDFs.
- **No client-facing docs**: no README, no `.env.example` (frontend H-5 /
  backend H-2).

None of these is architecturally deep; all are fixable in a focused pass. After
the top fixes below, the app is deliverable.

### 2. Top 5 fixes before delivery (across both sessions)

1. **Stop silent AI transmission** (backend C-1) — remove the env-key auto-call
   from `extract_data()`; AI must run only through the user-triggered
   `/extract-ai` endpoint. This is the single highest-priority item: it is a
   privacy promise broken by default.
2. **Fix backend process lifecycle** — add `psutil` to `requirements.txt`
   (backend H-1) **and** add an Electron single-instance lock (frontend H-2).
   Together these eliminate the documented zombie-process / port-5199-conflict
   failures.
3. **Fix the dead UI features** (frontend H-1) — implement `pickLogo`,
   `removeLogo`, and `loadDemoData`, or remove the buttons. A client must not see
   buttons that do nothing.
4. **Patch the PDF/runtime security stack** — upgrade vendored PDF.js to
   ≥ 4.2.67 or set `isEvalSupported:false` (frontend H-4), and move off EOL
   Electron 28 (frontend H-3). These directly affect a security-conscious
   client's acceptance.
5. **Ship client documentation + a real timeout** — add `README.md` and
   `.env.example` (frontend H-5 / backend H-2), and make the 30-second parse
   timeout actually return early (backend H-3) so a bad file doesn't freeze the
   app.

### 3. Overall security posture — anything that would concern a security-conscious client?

The posture is **moderate, with three items a security reviewer would raise**:

- **Default-on data exfiltration to a third party** (backend C-1). The most
  serious: a tool sold on "documents stay local" silently POSTs solicitation text
  to Anthropic whenever a key is present, with no per-request consent and no
  metering. This is the finding most likely to fail a client security review.
- **Known-vulnerable PDF renderer on untrusted input** (frontend H-4) plus an
  **EOL browser engine** (frontend H-3). The app's whole purpose is to open
  government PDFs of unknown provenance; doing so on PDF.js 3.11.174 (CVE-2024-4367)
  inside an unpatched Electron 28 is a concrete, demonstrable risk, even though
  `contextIsolation` limits the blast radius.
- **A loopback HTTP API reachable from the browser** (backend M-3). The Flask
  server reflects `Origin: null`/`file://`, and `/parse` is a multipart "simple
  request" that any visited webpage can POST to — clearing the user's session and
  writing files into the session dir without a CORS preflight. Localhost-only and
  desktop context soften this, but a shared-secret header between Electron and
  Flask would close it.

Reassuringly, the things that are often wrong are right here: no `nodeIntegration`,
no `webSecurity` disable, no `eval` in app code, output is escaped against XSS,
secrets live in gitignored `.env` (not in git), uploads are size- and
magic-byte-validated, the server binds 127.0.0.1 only with debug off, and the
file-read IPC is correctly confined to the session directory. Fix C-1, H-3, and
H-4, add the CORS hardening, and the posture moves to good for a desktop app.

---

## Recommended Fix Order — Full Project (Top 10)

1. **Backend C-1** — remove silent env-key AI calls from `extract_data()`.
   *(privacy/cost; ~1 line + test)*
2. **Backend H-1 + Frontend H-2** — add `psutil` to requirements; add Electron
   single-instance lock. *(kills zombie backend + port conflict)*
3. **Frontend H-1** — implement or remove `pickLogo`/`removeLogo`/`loadDemoData`.
   *(visible broken features)*
4. **Frontend H-4** — upgrade vendored PDF.js ≥ 4.2.67 (or `isEvalSupported:false`).
   *(untrusted-PDF code execution)*
5. **Frontend H-3** — upgrade off EOL Electron 28; re-test printToPDF + safeStorage.
6. **Backend H-3** — make the 30s parse timeout return early
   (`shutdown(wait=False)` / cancel futures).
7. **Frontend H-5 + Backend H-2** — add `README.md` and `.env.example`.
8. **Backend M-1/M-7 + Frontend M-5** — return JSON (not HTML 500s) from
   `extract-ai`, validate `/generate_quote` numeric vendor fields, and stop
   swallowing backend-restart failures in `saveSettings`.
9. **Backend M-3 + Frontend M-3/M-11** — tighten CORS null-origin reflection /
   add an Electron↔Flask shared secret; constrain `open-path`/`open-url`; enable
   `sandbox:true`.
10. **Backend H-4 (Phase 6) + Frontend M-2/M-6/M-8** — assemble
    `extraction_warnings` in `extract_data()` too; fix bbox navigation for
    dialog-picked files; correct the stale "future update" AI banner copy;
    declare `S.files`/`sourceFile` in the state schema. Then sweep the Mediums/Lows
    (dead temp-file subsystem, native dialogs, undefined CSS vars, duplicate
    totals) as polish.

---

*End of frontend audit — Session 2 of 2. Combined with
[backend-audit-session1.md](backend-audit-session1.md), this completes the
pre-delivery audit of Sol-Quoter at HEAD a074e37.*
