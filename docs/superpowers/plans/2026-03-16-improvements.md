# SolQuoter Improvements Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship four improvements — theme label copy, vendor profile manager, API key security hardening, and distribution build scripts.

**Architecture:** All renderer changes are inline edits to `electron/index.html` (all CSS + JS inline, ~1800 lines). IPC additions go in `electron/main.js` and `electron/preload.js`. Backend temp-file fix is in `python/server.py`. Distribution scripts are new files under `scripts/`.

**Tech Stack:** Electron 28, Python Flask, localStorage (renderer state), Electron safeStorage (OS-level key encryption), electron-builder (DMG/NSIS packaging)

**Spec:** `docs/superpowers/specs/2026-03-16-improvements-design.md`

---

## File Map

| File | Change |
|------|--------|
| `electron/index.html` | Theme label (1 line); profiles modal HTML + JS (~180 lines); security renderer changes (~25 lines); no-retention notice (1 line) |
| `electron/preload.js` | Add 4 entries: `openJsonFile`, `storeApiKey`, `loadApiKey`, `clearApiKey` |
| `electron/main.js` | Add `open-json-file`, `store-api-key`, `load-api-key`, `clear-api-key` IPC handlers |
| `python/server.py` | Harden temp file cleanup in `/parse` route (lines 525–534) |
| `electron-builder.json` | Add `dmg.contents` section |
| `scripts/build-mac.sh` | New: one-command Mac build |
| `scripts/build-win.bat` | New: one-command Windows build |
| `scripts/Install Helper.command` | New: Mac DMG Gatekeeper bypass + install |
| `scripts/README-BUILD.md` | New: developer build prerequisites |

---

## Chunk 1: Theme Label

### Task 1: Update legacy theme section label

**Files:**
- Modify: `electron/index.html:728`

- [ ] **Step 1: Make the change**

  In `electron/index.html`, find line 728 (inside `openThemes()` render). Change:
  ```html
  <span>Legacy Themes</span>
  ```
  to:
  ```html
  <span>Legacy / Fun Themes</span>
  ```

- [ ] **Step 2: Verify manually**

  Run `npm start`. Open Settings → Themes. Confirm the collapsible section toggle reads "Legacy / Fun Themes ▶". Click it to expand — legacy themes appear. Close and re-open the modal — section is collapsed again (no legacy theme active by default).

- [ ] **Step 3: Commit**

  ```bash
  git add electron/index.html
  git commit -m "feat: rename legacy themes section to Legacy / Fun Themes"
  ```

---

## Chunk 2: Vendor Profiles

### Task 2: Add IPC for JSON file picker and profiles export

**Files:**
- Modify: `electron/main.js`
- Modify: `electron/preload.js`

- [ ] **Step 1: Add `open-json-file` handler to `electron/main.js`**

  Add this after the existing `ipcMain.handle('open-file', ...)` block. The handler reads the file in the main process and returns the full content as a string — the renderer cannot use `fetch('file:///')` due to CSP restrictions:

  ```javascript
  ipcMain.handle('open-json-file', async () => {
    const r = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (r.canceled || !r.filePaths[0]) return null
    return fs.readFileSync(r.filePaths[0], 'utf8')
  })
  ```

  Confirm `fs` is already imported at the top of `main.js` (it is — used by other handlers). `dialog` is already imported from `'electron'`.

- [ ] **Step 2: Expose `openJsonFile` in preload**

  In `electron/preload.js`, add inside the `contextBridge.exposeInMainWorld` object:
  ```javascript
  openJsonFile: () => ipcRenderer.invoke('open-json-file'),
  ```

- [ ] **Step 3: Verify IPC wiring manually**

  Run `npm start`. Open the browser DevTools console (View → Toggle Developer Tools). Run:
  ```javascript
  window.api.openJsonFile().then(t => console.log('result:', typeof t, t ? t.slice(0,50) : null))
  ```
  Pick any `.json` file when the dialog opens. Console should log `result: string` with the first 50 chars. If you cancel, it should log `result: object null`.

- [ ] **Step 4: Commit**

  ```bash
  git add electron/main.js electron/preload.js
  git commit -m "feat: add open-json-file IPC for vendor profile import"
  ```

### Task 3: Add profiles modal HTML

**Files:**
- Modify: `electron/index.html` — add modal after line ~539 (after the `</div>` closing the settings overlay, before `<!-- THEMES MODAL -->`)

- [ ] **Step 1: Insert profiles modal HTML**

  In `electron/index.html`, find the line `<!-- THEMES MODAL -->` (around line 541). Insert the following block immediately before it:

  ```html
  <!-- PROFILES MODAL -->
  <div class="overlay hidden" id="profiles-overlay" onclick="if(event.target===this)closeProfiles()">
    <div class="modal" style="width:520px;max-height:85vh">
      <h2>Vendor Profiles</h2>
      <div style="margin-bottom:16px">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--muted);margin-bottom:8px">Save Current</div>
        <div style="display:flex;gap:8px">
          <input id="profile-name-input" placeholder="Profile name..." style="flex:1" />
          <button class="btn btn-primary btn-sm" onclick="saveCurrentProfile()">Save</button>
        </div>
      </div>
      <div style="margin-bottom:16px">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--muted);margin-bottom:8px">Saved Profiles</div>
        <div id="profiles-list"></div>
      </div>
      <div style="border-top:1px solid var(--border);padding-top:14px">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--muted);margin-bottom:8px">Import / Export</div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-ghost btn-sm" onclick="exportProfiles()">Export All</button>
          <button class="btn btn-ghost btn-sm" onclick="importProfiles()">Import</button>
        </div>
        <div id="import-conflicts" class="hidden" style="margin-top:12px"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="closeProfiles()">Close</button>
      </div>
    </div>
  </div>
  ```

- [ ] **Step 2: Add Profiles button to Step 3 card header**

  In `step3()` (around line 1042), find the Company Information card title:
  ```html
  <div class="card-title"><span class="dot"></span>Company Information</div>
  ```
  Change it to:
  ```html
  <div class="card-title"><span class="dot"></span>Company Information<button class="btn btn-ghost btn-sm ml-auto" onclick="openProfiles()" style="-webkit-app-region:no-drag">Profiles</button></div>
  ```

- [ ] **Step 3: Verify modal opens (stub check)**

  Run `npm start`. Navigate to Step 3. The Company Information card header should show a "Profiles" button on the right. Clicking it should open an overlay with "Vendor Profiles" title. The modal closes by clicking outside or the Close button. (The list will be empty and JS errors will fire for missing functions — that's expected until Task 4.)

### Task 4: Add vendor profiles JS logic

**Files:**
- Modify: `electron/index.html` — add JS block after the `// ── SAM MODAL` section (around line 1642)

- [ ] **Step 1: Add the profiles JS block**

  In `electron/index.html`, find the comment `// ── SAM MODAL` (around line 1642). Insert the following block immediately before it:

  ```javascript
  // ── VENDOR PROFILES ──────────────────────────────────────────────────────────
  function getProfiles() {
    try { return JSON.parse(localStorage.getItem('vendorProfiles') || '[]') } catch { return [] }
  }
  function setProfiles(arr) {
    try { localStorage.setItem('vendorProfiles', JSON.stringify(arr)) } catch(e) {}
  }
  function openProfiles() {
    document.getElementById('profile-name-input').value = ''
    document.getElementById('import-conflicts').classList.add('hidden')
    _importBatch = null
    renderProfilesList()
    document.getElementById('profiles-overlay').classList.remove('hidden')
  }
  function closeProfiles() { document.getElementById('profiles-overlay').classList.add('hidden') }

  function renderProfilesList() {
    const profiles = getProfiles()
    const list = document.getElementById('profiles-list')
    if (!profiles.length) {
      list.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:8px 0">No saved profiles.</div>'
      return
    }
    list.innerHTML = profiles.map((p, i) => `
      <div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--border)">
        <div style="flex:1">
          <div style="font-size:12px;font-weight:600">${esc(p.name)}</div>
          <div style="font-size:10px;color:var(--muted)">${new Date(p.createdAt).toLocaleDateString()}</div>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="loadProfile(${i})">Load</button>
        <button class="btn btn-danger btn-sm" onclick="deleteProfile(${i})">✕</button>
      </div>`).join('')
  }

  function saveCurrentProfile() {
    const name = document.getElementById('profile-name-input').value.trim()
    if (!name) { toast('Enter a profile name', 'error'); return }
    const profiles = getProfiles()
    const existing = profiles.findIndex(p => p.name === name)
    if (existing >= 0) {
      if (!confirm(`A profile named "${name}" already exists. Overwrite it?`)) return
      profiles[existing].vendor = { ...S.vendor }
      profiles[existing].createdAt = new Date().toISOString()
    } else {
      profiles.push({ id: crypto.randomUUID(), name, createdAt: new Date().toISOString(), vendor: { ...S.vendor } })
    }
    setProfiles(profiles)
    document.getElementById('profile-name-input').value = ''
    renderProfilesList()
    toast('Profile saved', 'success')
  }

  function loadProfile(i) {
    const profiles = getProfiles()
    const p = profiles[i]
    if (!p) return
    Object.assign(S.vendor, p.vendor)
    closeProfiles()
    render(S.step)
    toast(`Loaded: ${p.name}`, 'success')
  }

  function deleteProfile(i) {
    const profiles = getProfiles()
    const p = profiles[i]
    if (!p) return
    if (!confirm(`Delete profile "${p.name}"?`)) return
    profiles.splice(i, 1)
    setProfiles(profiles)
    renderProfilesList()
    toast('Profile deleted', 'success')
  }

  async function exportProfiles() {
    const profiles = getProfiles()
    if (!profiles.length) { toast('No profiles to export', 'warn'); return }
    if (window.api) {
      await window.api.exportData({ content: JSON.stringify(profiles, null, 2), filename: 'solquoter-profiles', ext: 'json' })
    }
  }

  let _importBatch = null

  async function importProfiles() {
    if (!window.api) return
    const text = await window.api.openJsonFile()
    if (!text) return
    let imported
    try { imported = JSON.parse(text) } catch { toast('Invalid JSON file', 'error'); return }
    if (!Array.isArray(imported)) { toast('Invalid profile file format', 'error'); return }

    const existing = getProfiles()
    const existingNames = new Set(existing.map(p => p.name))
    const conflicts = imported.filter(p => existingNames.has(p.name))
    const clean = imported.filter(p => !existingNames.has(p.name))

    if (!conflicts.length) {
      setProfiles([...existing, ...clean])
      renderProfilesList()
      toast(`Imported ${clean.length} profile${clean.length !== 1 ? 's' : ''}`, 'success')
      return
    }

    // Stage batch in memory — nothing written until Apply
    _importBatch = { clean, conflicts, resolutions: {} }
    renderImportConflicts()
  }

  function renderImportConflicts() {
    const { conflicts, resolutions } = _importBatch
    const container = document.getElementById('import-conflicts')
    container.classList.remove('hidden')
    container.innerHTML = `
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--muted);margin-bottom:8px">Resolve Conflicts</div>
      ${conflicts.map((p, i) => `
        <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">
          <div style="flex:1;font-size:12px">${esc(p.name)} — already exists</div>
          <button class="btn btn-sm ${resolutions[i]==='overwrite'?'btn-primary':'btn-ghost'}" onclick="resolveConflict(${i},'overwrite')">Overwrite</button>
          <button class="btn btn-sm ${resolutions[i]==='skip'||resolutions[i]==null?'btn-primary':'btn-ghost'}" onclick="resolveConflict(${i},'skip')">Skip</button>
        </div>`).join('')}
      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="btn btn-primary btn-sm" onclick="applyImport()">Apply Import</button>
        <button class="btn btn-ghost btn-sm" onclick="cancelImport()">Cancel All</button>
      </div>`
  }

  function resolveConflict(i, choice) {
    _importBatch.resolutions[i] = choice
    renderImportConflicts()
  }

  function applyImport() {
    const { clean, conflicts, resolutions } = _importBatch
    const existing = getProfiles()
    let overwritten = 0
    conflicts.forEach((p, i) => {
      if (resolutions[i] === 'overwrite') {
        const idx = existing.findIndex(e => e.name === p.name)
        if (idx >= 0) { existing[idx] = p; overwritten++ }
      }
    })
    setProfiles([...existing, ...clean])
    _importBatch = null
    document.getElementById('import-conflicts').classList.add('hidden')
    renderProfilesList()
    toast(`Import complete: ${clean.length} added, ${overwritten} overwritten`, 'success')
  }

  function cancelImport() {
    _importBatch = null
    document.getElementById('import-conflicts').classList.add('hidden')
    toast('Import cancelled', 'warn')
  }
  ```

- [ ] **Step 2: Verify full profiles flow manually**

  Run `npm start`. Go to Step 3. Click "Profiles":
  - Modal opens with empty list
  - Type "Test Co" in the name input, click Save → toast "Profile saved", row appears in list
  - Click Load on "Test Co" → modal closes, toast "Loaded: Test Co", vendor fields reflect the saved values
  - Reopen Profiles → click Delete on "Test Co" → confirm → row removed
  - Click Export All when a profile exists → native save dialog opens, saving a `.json` file
  - Click Import → pick the exported `.json` → profile reappears in list (no conflicts)
  - Import the same file again → conflict UI appears with "Test Co — already exists" and Overwrite/Skip buttons (Skip is pre-selected as the safe default)
  - Click Overwrite → Apply Import → toast shows "0 added, 1 overwritten"
  - Click Cancel All → no changes applied

- [ ] **Step 3: Commit**

  ```bash
  git add electron/index.html
  git commit -m "feat: add vendor profile manager with save, load, delete, import/export"
  ```

---

## Chunk 3: Security Hardening

### Task 5: Fix temp file cleanup in server.py

**Files:**
- Modify: `python/server.py:517–536`

- [ ] **Step 1: Replace the parse route's temp file handling**

  Current code (lines 517–536):
  ```python
  @app.route("/parse", methods=["POST","OPTIONS"])
  def parse_route():
      if request.method=="OPTIONS": return jsonify({}),200
      try:
          if "file" not in request.files:
              return jsonify({"error":"No file uploaded"}),400
          file=request.files["file"]; api_key=request.form.get("api_key","")
          suffix=Path(file.filename).suffix
          with tempfile.NamedTemporaryFile(delete=False,suffix=suffix) as tmp:
              file.save(tmp.name); tmp_path=tmp.name
          try:
              text=parse_document(tmp_path)
              if not text.strip():
                  return jsonify({"error":"Could not extract text from document."}),400
              data=extract_data(text,api_key)
              return jsonify({"success":True,"data":data})
          finally:
              os.unlink(tmp_path)
      except Exception as e:
          traceback.print_exc(); return jsonify({"error":str(e)}),500
  ```

  Replace with:
  ```python
  @app.route("/parse", methods=["POST","OPTIONS"])
  def parse_route():
      if request.method=="OPTIONS": return jsonify({}),200
      tmp_path = None
      try:
          if "file" not in request.files:
              return jsonify({"error":"No file uploaded"}),400
          file=request.files["file"]; api_key=request.form.get("api_key","")
          suffix=Path(file.filename).suffix
          with tempfile.NamedTemporaryFile(delete=False,suffix=suffix) as tmp:
              tmp_path=tmp.name
              file.save(tmp_path)
          text=parse_document(tmp_path)
          if not text.strip():
              return jsonify({"error":"Could not extract text from document."}),400
          data=extract_data(text,api_key)
          return jsonify({"success":True,"data":data})
      except Exception as e:
          traceback.print_exc(); return jsonify({"error":str(e)}),500
      finally:
          if tmp_path and os.path.exists(tmp_path):
              try:
                  os.unlink(tmp_path)
              except Exception:
                  pass
  ```

  Key changes: `tmp_path` initialized to `None` before the try, moved to outer `finally` with existence check, inner `try/except` on `os.unlink` prevents cleanup errors masking parse errors.

- [ ] **Step 2: Verify the fix manually**

  Run `python python/server.py` in one terminal. In another:
  ```bash
  curl -s -X POST http://127.0.0.1:5199/parse -F "file=@testdata/W911S225U1431.pdf" | python -m json.tool | head -5
  ```
  Should return `"success": true`. Check your system temp dir — no leftover files from the parse. (On Windows: `%TEMP%`, on Mac: `/tmp`)

  Also test error path — submit a corrupt/empty file and confirm the server returns a 400/500 without leaving temp files.

- [ ] **Step 3: Commit**

  ```bash
  git add python/server.py
  git commit -m "fix: harden temp file cleanup in parse route with finally guard"
  ```

### Task 6: Add safeStorage IPC handlers

**Files:**
- Modify: `electron/main.js`
- Modify: `electron/preload.js`

- [ ] **Step 1: Add safeStorage handlers to `electron/main.js`**

  At the top of `main.js`, `path` and `fs` are already imported. Add `safeStorage` to the existing electron `require` at line 1. The actual current line is:
  ```javascript
  const { app, BrowserWindow, ipcMain, dialog, shell, Menu, MenuItem } = require('electron')
  ```
  Replace with:
  ```javascript
  const { app, BrowserWindow, ipcMain, dialog, shell, Menu, MenuItem, safeStorage } = require('electron')
  ```

  Then add the key path constant near the top (after `app` is available — place it inside the `app.whenReady()` block or as a lazy getter, since `app.getPath()` requires app to be ready). The safest placement is as a function:

  ```javascript
  function keyPath() {
    return require('path').join(app.getPath('userData'), 'apikey.bin')
  }
  ```

  Add the three IPC handlers after the existing handlers:
  ```javascript
  ipcMain.handle('store-api-key', (_, key) => {
    if (!safeStorage.isEncryptionAvailable()) {
      fs.writeFileSync(keyPath() + '.plain', key, 'utf8')
      return { encrypted: false }
    }
    fs.writeFileSync(keyPath(), safeStorage.encryptString(key))
    return { encrypted: true }
  })

  ipcMain.handle('load-api-key', () => {
    if (!safeStorage.isEncryptionAvailable()) {
      const plain = keyPath() + '.plain'
      return fs.existsSync(plain) ? fs.readFileSync(plain, 'utf8') : ''
    }
    if (!fs.existsSync(keyPath())) return ''
    try { return safeStorage.decryptString(fs.readFileSync(keyPath())) }
    catch { return '' }
  })

  ipcMain.handle('clear-api-key', () => {
    if (fs.existsSync(keyPath())) fs.unlinkSync(keyPath())
    if (fs.existsSync(keyPath() + '.plain')) fs.unlinkSync(keyPath() + '.plain')
  })
  ```

- [ ] **Step 2: Expose the three new methods in `electron/preload.js`**

  Add to the contextBridge object:
  ```javascript
  storeApiKey: (key) => ipcRenderer.invoke('store-api-key', key),
  loadApiKey:  ()    => ipcRenderer.invoke('load-api-key'),
  clearApiKey: ()    => ipcRenderer.invoke('clear-api-key'),
  ```

- [ ] **Step 3: Verify IPC manually in DevTools**

  Run `npm start`. In DevTools console:
  ```javascript
  // Store a key
  await window.api.storeApiKey('test-key-123')
  // Load it back
  const k = await window.api.loadApiKey(); console.log(k) // → 'test-key-123'
  // Clear it
  await window.api.clearApiKey()
  const k2 = await window.api.loadApiKey(); console.log(k2) // → ''
  ```

- [ ] **Step 4: Commit**

  ```bash
  git add electron/main.js electron/preload.js
  git commit -m "feat: add safeStorage IPC handlers for encrypted API key storage"
  ```

### Task 7: Migrate renderer to use safeStorage

**Files:**
- Modify: `electron/index.html` — multiple locations

- [ ] **Step 1: Update `init()` — replace localStorage apiKey read with safeStorage + migration**

  Find `init()` at line 753. Replace:
  ```javascript
  S.apiKey = localStorage.getItem('apiKey') || ''
  ```
  With:
  ```javascript
  if (window.api) {
    S.apiKey = await window.api.loadApiKey() || ''
    if (!S.apiKey) {
      const legacy = localStorage.getItem('apiKey') || localStorage.getItem('sq-apikey') || ''
      if (legacy) {
        S.apiKey = legacy
        const result = await window.api.storeApiKey(legacy)
        localStorage.removeItem('apiKey')
        localStorage.removeItem('sq-apikey')
        if (!result.encrypted) {
          toast('API key stored. Note: OS-level encryption unavailable on this platform.', 'warn')
        }
      }
    }
  } else {
    S.apiKey = localStorage.getItem('apiKey') || ''
  }
  ```

  Note: `init()` is already `async` (it uses `await window.api.getPort()`), so no signature change needed.

- [ ] **Step 2: Update `saveAiKey()` — replace localStorage write with safeStorage**

  Find `saveAiKey()` at line 1635. Replace:
  ```javascript
  try { localStorage.setItem('apiKey', S.apiKey) } catch(e) {}
  ```
  With:
  ```javascript
  if (window.api) {
    const result = await window.api.storeApiKey(S.apiKey)
    if (!result.encrypted) toast('Key saved. OS-level encryption unavailable on this platform.', 'warn')
  }
  ```
  Make `saveAiKey` async: change `function saveAiKey()` to `async function saveAiKey()`.

- [ ] **Step 3: Update `saveSettings()` — replace localStorage apiKey write with safeStorage**

  Find `saveSettings()` at line 1599. Replace:
  ```javascript
  localStorage.setItem('apiKey',S.apiKey)
  ```
  With:
  ```javascript
  if (window.api) await window.api.storeApiKey(S.apiKey)
  ```
  Make `saveSettings` async: change `function saveSettings()` to `async function saveSettings()`.

- [ ] **Step 4: Strip `apiKey` from session blob in `goTo()`**

  Find `goTo()` at line 772. Replace the full `try` block (lines 773–776):
  ```javascript
  try {
      const sess = {step:n, done:[...S.done], extracted:S.extracted, vendor:S.vendor, items:S.items, apiKey:S.apiKey}
      localStorage.setItem('session', JSON.stringify(sess))
    } catch(e) {}
  ```
  With:
  ```javascript
  try {
      const sess = {step:n, done:[...S.done], extracted:S.extracted, vendor:S.vendor, items:S.items}
      localStorage.setItem('session', JSON.stringify(sess))
    } catch(e) {}
  ```

  Note: The `apiKey` field is intentionally removed (allowlist approach — only named fields are persisted). The `try/catch` wrapper must be preserved.

- [ ] **Step 5: Remove apiKey read from `resumeSession()`**

  Find `resumeSession()` at line 1741. Remove line 1745:
  ```javascript
  if(sess.apiKey) S.apiKey=sess.apiKey
  ```
  The API key is now loaded exclusively via `loadApiKey()` in `init()`.

  Note: `clearApiKey` is wired in the IPC layer but the AI modal has no "clear key" button. This is intentional — no current user need. The handler exists for future use.

- [ ] **Step 6: Add no-retention notice to Settings modal**

  Find the `<div class="modal-footer">` inside the settings overlay (around line 534). Insert immediately before it:
  ```html
  <p style="font-size:10px;color:var(--muted);margin-top:14px;line-height:1.5">SolQuoter does not retain copies of your documents. Files are deleted from memory immediately after parsing.</p>
  ```

- [ ] **Step 7: Verify full security flow manually**

  Run `npm start`. In DevTools console, confirm `localStorage.getItem('apiKey')` returns `null`.

  Open Settings → enter an API key → Save. Close and reopen the app. Open Settings → API key field is populated. Confirm `localStorage.getItem('apiKey')` still returns `null` (key is NOT in localStorage).

  Check the Settings modal footer — no-retention notice is visible.

  Navigate to Step 1 → Step 2 (trigger a `goTo()`). In DevTools: `JSON.parse(localStorage.getItem('session'))` — confirm no `apiKey` field in the object.

- [ ] **Step 8: Commit**

  ```bash
  git add electron/index.html
  git commit -m "feat: migrate API key to safeStorage, strip from session blob"
  ```

---

## Chunk 4: Distribution Scripts

### Task 8: Create build scripts

**Files:**
- Create: `scripts/build-mac.sh`
- Create: `scripts/build-win.bat`
- Create: `scripts/README-BUILD.md`

- [ ] **Step 1: Create `scripts/build-mac.sh`**

  ```bash
  #!/bin/bash
  set -e

  echo "→ Installing PyInstaller..."
  pip install pyinstaller

  echo "→ Building Python backend..."
  pyinstaller --onefile --name solicitationquoter-backend --noconsole python/server.py
  rm -rf dist-backend
  mv dist dist-backend

  echo "→ Building Electron app..."
  npm run build:mac

  echo "✓ Mac build complete. Installer: dist/"
  ```

- [ ] **Step 2: Create `scripts/build-win.bat`**

  ```bat
  @echo off
  setlocal

  echo Installing PyInstaller...
  pip install pyinstaller
  if %errorlevel% neq 0 exit /b %errorlevel%

  echo Building Python backend...
  pyinstaller --onefile --name solicitationquoter-backend --noconsole python/server.py
  if %errorlevel% neq 0 exit /b %errorlevel%

  if exist dist-backend rmdir /s /q dist-backend
  rename dist dist-backend
  if %errorlevel% neq 0 exit /b %errorlevel%

  echo Building Electron app...
  npm run build:win
  if %errorlevel% neq 0 exit /b %errorlevel%

  echo Build complete. Installer: dist/
  ```

- [ ] **Step 3: Create `scripts/README-BUILD.md`**

  ```markdown
  # Build Prerequisites

  These steps are for the **developer building the installer**, not end users.

  ## One-time setup

  1. **Python 3.9+** — [python.org](https://python.org). Confirm: `python --version`
  2. **Node 18+** — [nodejs.org](https://nodejs.org). Confirm: `node --version`
  3. **Install npm dependencies** (once per clone): `npm install`
  4. **Install Python dependencies**: `pip install flask pdfplumber pypdf python-docx anthropic`

  ## Build

  **Mac** (must be run on a Mac):
  ```bash
  bash scripts/build-mac.sh
  ```

  **Windows** (must be run on Windows):
  ```bat
  scripts\build-win.bat
  ```

  Output is in `dist/`.

  ## Distribute

  Share the file from `dist/` via Google Drive, Dropbox, or direct transfer.

  - Mac: `.dmg` file. See "Mac install instructions" below.
  - Windows: `.exe` installer. Standard Next → Install → Finish.

  ## Mac Install Instructions (for recipient)

  1. Open the `.dmg` file
  2. Double-click "Install Helper"
  3. If macOS asks "Are you sure you want to open this?", click Open
  4. Launch SolQuoter from Applications

  ## Executable bit (first-time Mac setup)

  Two scripts require executable bits. Run once on a Mac after cloning:
  ```bash
  chmod +x scripts/build-mac.sh "scripts/Install Helper.command"
  git update-index --chmod=+x scripts/build-mac.sh "scripts/Install Helper.command"
  git commit -m "chore: set executable bits on build-mac.sh and Install Helper"
  ```
  ```

- [ ] **Step 4: Make build-mac.sh executable (run on Mac/WSL only)**

  ```bash
  chmod +x scripts/build-mac.sh
  git update-index --chmod=+x scripts/build-mac.sh
  ```
  On Windows, skip this step — do it when you first run the Mac build.

- [ ] **Step 5: Commit scripts**

  ```bash
  git add scripts/
  git commit -m "feat: add one-command build scripts for Mac and Windows"
  ```

### Task 9: Create Mac Install Helper and update electron-builder config

**Files:**
- Create: `scripts/Install Helper.command`
- Modify: `electron-builder.json`

- [ ] **Step 1: Create `scripts/Install Helper.command`**

  ```bash
  #!/bin/bash
  SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
  APP_NAME="SolQuoter.app"
  APP_PATH="$SCRIPT_DIR/$APP_NAME"

  if [ ! -d "$APP_PATH" ]; then
    osascript -e 'display dialog "Could not find SolQuoter.app in this folder. Make sure you opened the .dmg file." buttons {"OK"} default button "OK" with icon stop'
    exit 1
  fi

  xattr -rd com.apple.quarantine "$APP_PATH" 2>/dev/null || true
  cp -R "$APP_PATH" "/Applications/$APP_NAME"

  osascript -e 'display dialog "SolQuoter installed successfully. You can now launch it from your Applications folder." buttons {"OK"} default button "OK"'
  ```

- [ ] **Step 2: Set executable bit**

  This must be run on macOS or in WSL (Linux filesystem). On Windows NTFS, git cannot set the executable bit. Run these two commands on the Mac you use for building before pushing:
  ```bash
  chmod +x "scripts/Install Helper.command"
  git update-index --chmod=+x "scripts/Install Helper.command"
  ```
  The `chmod` sets the bit on the actual filesystem (required for electron-builder to read it as executable when packaging). The `git update-index` records it in the git index so the bit survives future checkouts on Mac.

- [ ] **Step 3: Add `dmg` section to `electron-builder.json`**

  Current `electron-builder.json` has `mac`, `win`, `nsis` keys. Add a `dmg` key as a sibling:
  ```json
  {
    "appId": "com.yourcompany.solicitationquoter",
    "productName": "Solicitation Quoter",
    "directories": { "output": "dist", "buildResources": "resources" },
    "files": ["electron/**/*", "package.json"],
    "win": {
      "target": [{ "target": "nsis", "arch": ["x64"] }],
      "extraResources": [{ "from": "dist-backend/solicitationquoter-backend.exe", "to": "solicitationquoter-backend.exe" }]
    },
    "mac": {
      "target": [{ "target": "dmg", "arch": ["arm64", "x64"] }],
      "extraResources": [{ "from": "dist-backend/solicitationquoter-backend", "to": "solicitationquoter-backend" }],
      "entitlements": "resources/entitlements.mac.plist",
      "hardenedRuntime": true
    },
    "dmg": {
      "contents": [
        { "x": 130, "y": 220, "type": "file" },
        { "x": 410, "y": 220, "type": "link", "path": "/Applications" },
        { "x": 270, "y": 380, "type": "file", "path": "scripts/Install Helper.command" }
      ]
    },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true,
      "createDesktopShortcut": true
    }
  }
  ```

- [ ] **Step 4: Verify build (Mac only — skip on Windows dev machine)**

  On a Mac with prerequisites installed:
  ```bash
  bash scripts/build-mac.sh
  ```
  Expected: `dist/` contains a `.dmg` file. Mount the DMG. Confirm it contains `SolQuoter.app`, an Applications symlink, and `Install Helper.command`. Double-click Install Helper → dialog appears, app copies to `/Applications`.

- [ ] **Step 5: Commit**

  ```bash
  git add "scripts/Install Helper.command" electron-builder.json
  git commit -m "feat: add Mac DMG Install Helper and dmg.contents config"
  ```

---

## Final Verification Checklist

- [ ] `npm start` — app launches cleanly on developer machine
- [ ] Step 3 shows "Profiles" button in Company Information card header
- [ ] Profiles modal: save / load / delete / export / import all work
- [ ] Import with conflicts shows resolution UI; Cancel All leaves localStorage unchanged
- [ ] API key is stored via safeStorage — not visible in `localStorage` (check DevTools)
- [ ] Session blob (DevTools: `JSON.parse(localStorage.getItem('session'))`) has no `apiKey` field
- [ ] Settings modal shows no-retention notice at bottom
- [ ] Theme modal shows "Legacy / Fun Themes" toggle label
- [ ] `scripts/build-mac.sh` and `scripts/build-win.bat` exist and are documented
