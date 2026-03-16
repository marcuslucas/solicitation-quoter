# SolQuoter Improvements Design
**Date:** 2026-03-16
**Scope:** Four improvement areas — theme label, vendor profiles, security hardening, distribution

---

## 1. Theme Label Update

### Problem
The app's Specter dark theme is polarizing for business demos. The default is already Prism (light), and the legacy section already collapses when inactive — no behavior changes needed.

### Change
One line in `electron/index.html`:

- **Current (line 728):** `<span>Legacy Themes</span>`
- **New:** `<span>Legacy / Fun Themes</span>`

This signals to new users that legacy themes are non-professional options without hiding them.

**Affected files:** `electron/index.html` — 1 line

---

## 2. Vendor Profiles

### Problem
Company info must be re-entered from scratch on every new quote. Teams with multiple entities or teammates on different machines have no way to share this data.

### Data Model
Key: `vendorProfiles` in `localStorage`
Value: JSON array of profile objects

```json
[
  {
    "id": "crypto.randomUUID()",
    "name": "Acme Corp — Prime",
    "createdAt": "2026-03-16T00:00:00Z",
    "vendor": {
      "company": "", "address": "", "cage": "", "duns": "",
      "sam_expiry": "", "poc_name": "", "poc_title": "",
      "poc_phone": "", "poc_email": "", "delivery_days": "",
      "option_years_enabled": false, "option_years": [],
      "logo_b64": "", "logo_ext": "", "logo_name": ""
    }
  }
]
```

Note: `crypto.randomUUID()` is available natively in Chromium 92+ (Electron 28 uses Chromium 120+). No uuid package needed.

### UI — Profile Manager Modal
Triggered by a "Profiles" button in the Step 3 vendor card header.

**Save Current section:**
- Text input for profile name + "Save" button
- Saves all current Step 3 form values as a new profile
- If a profile with the same name exists: prompt "A profile named '[name]' already exists. Overwrite it?" → Overwrite / Cancel

**Saved Profiles section:**
- Table: profile name, created date, Load button, Delete button
- Load: fills all Step 3 vendor fields from the profile and closes the modal
- Delete: prompts "Delete profile '[name]'?" → Delete / Cancel

**Import / Export section:**
- **Export All**: calls `window.api.exportData({ content: JSON.stringify(profiles, null, 2), filename: 'solquoter-profiles', ext: 'json' })`. The 2 MB per-logo cap in `pick-logo` naturally bounds export file size.
- **Import**: calls `window.api.openJsonFile()` (new IPC, see below). Returns full JSON text from main process. Renderer parses it and resolves collisions before writing.

### Import Collision Handling
The entire import batch is held in memory. No profiles are written to `localStorage` until all collisions are resolved.

Resolution flow:
1. Parse the imported JSON array
2. For each profile whose `name` matches an existing profile in localStorage, add it to a "conflicts" list
3. Non-conflicting profiles are staged but not yet written
4. Display a resolution UI listing each conflict: "[name] — already exists. [Overwrite] [Skip]"
5. User resolves every conflict
6. A "Apply Import" button commits the full resolved batch atomically; "Cancel All" discards everything with no writes

### New IPC: `open-json-file`
`window.api.openFile()` is filtered to PDF/DOCX/TXT and unsuitable for JSON. A dedicated handler reads the file in the main process and returns content as a string — not as a path, since `fetch('file:///')` is blocked by the renderer's CSP in Electron with `contextIsolation: true`.

**`electron/main.js`:**
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

**`electron/preload.js`:**
```javascript
openJsonFile: () => ipcRenderer.invoke('open-json-file'),
```

**Renderer usage:**
```javascript
const text = await window.api.openJsonFile()
if (!text) return
const imported = JSON.parse(text)
```

### Loading a Profile
Fills all Step 3 vendor form fields and updates `S.vendor` in memory. Does not write to `localStorage` — session is only written on `goTo()` as today.

**Affected files:** `electron/index.html`, `electron/preload.js`, `electron/main.js`

---

## 3. Security Hardening

### 3a. Temp File Cleanup (Concrete Code Change)
The current `/parse` route in `server.py` uses `NamedTemporaryFile(delete=False)` with a `finally` block that calls bare `os.unlink(tmp_path)` without existence check or inner error handling. This is a code change, not just an audit. The target pattern:

```python
tmp_path = None
try:
    with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as f:
        tmp_path = f.name
        f.write(file.read())
    result = parse_and_extract(tmp_path, api_key)
    return jsonify({"success": True, "data": result})
except Exception as e:
    return jsonify({"success": False, "error": str(e)}), 500
finally:
    if tmp_path and os.path.exists(tmp_path):
        try:
            os.unlink(tmp_path)
        except Exception:
            pass
```

The inner `try/except` on `os.unlink` prevents a cleanup failure from masking the original error. The existence check prevents a double-unlink error on success paths where the file was already removed.

### 3b. API Key Storage — OS-Level Encryption
Replace `localStorage` API key storage with Electron `safeStorage` (built-in, no new dependencies).

**`electron/main.js` additions:**
```javascript
const { safeStorage, app } = require('electron')
const keyPath = path.join(app.getPath('userData'), 'apikey.bin')

ipcMain.handle('store-api-key', (_, key) => {
  if (!safeStorage.isEncryptionAvailable()) {
    fs.writeFileSync(keyPath + '.plain', key, 'utf8')
    return { encrypted: false }
  }
  fs.writeFileSync(keyPath, safeStorage.encryptString(key))
  return { encrypted: true }
})

ipcMain.handle('load-api-key', () => {
  if (!safeStorage.isEncryptionAvailable()) {
    const plain = keyPath + '.plain'
    return fs.existsSync(plain) ? fs.readFileSync(plain, 'utf8') : ''
  }
  if (!fs.existsSync(keyPath)) return ''
  try { return safeStorage.decryptString(fs.readFileSync(keyPath)) }
  catch { return '' }
})

ipcMain.handle('clear-api-key', () => {
  if (fs.existsSync(keyPath)) fs.unlinkSync(keyPath)
  if (fs.existsSync(keyPath + '.plain')) fs.unlinkSync(keyPath + '.plain')
})
```

**`electron/preload.js` additions:**
```javascript
storeApiKey: (key) => ipcRenderer.invoke('store-api-key', key),
loadApiKey:  ()    => ipcRenderer.invoke('load-api-key'),
clearApiKey: ()    => ipcRenderer.invoke('clear-api-key'),
```

**`electron/index.html` renderer changes:**

*init():*
```javascript
// Load API key from secure storage
if (window.api) {
  S.apiKey = await window.api.loadApiKey() || ''

  // One-time migration: move legacy localStorage key to secure storage
  if (!S.apiKey) {
    const legacy = localStorage.getItem('apiKey') || localStorage.getItem('sq-apikey') || ''
    if (legacy) {
      S.apiKey = legacy
      const result = await window.api.storeApiKey(legacy)
      localStorage.removeItem('apiKey')
      localStorage.removeItem('sq-apikey')
      if (!result.encrypted) {
        // Show one-time notice in the AI modal or as a toast
        toast('API key stored without OS encryption on this platform.', 'warn')
      }
    }
  }
}
```

*AI modal save:*
- Replace `localStorage.setItem('apiKey', key)` with `await window.api.storeApiKey(key)`
- If result is `{ encrypted: false }`, show a warning toast: "Key saved. Note: OS-level encryption is unavailable on this platform."

*AI modal clear:*
- Replace `localStorage.removeItem('apiKey')` with `await window.api.clearApiKey()`

*Session blob in goTo():*
- Strip `apiKey` before writing:
```javascript
const sessionToSave = { ...S }
delete sessionToSave.apiKey
localStorage.setItem('session', JSON.stringify(sessionToSave))
```

*resumeSession() — line 1745:*
- Remove the line `if(sess.apiKey) S.apiKey=sess.apiKey`
- The API key is now loaded exclusively via `loadApiKey()` in `init()`

*saveSettings() in index.html:*
- This function also writes the API key to localStorage via `localStorage.setItem('apiKey', S.apiKey)`
- Replace with `await window.api.storeApiKey(S.apiKey)` and make `saveSettings` async

### 3c. No-Retention Notice
Add to the Settings modal footer:

> "SolQuoter does not retain copies of your documents. Files are deleted from memory immediately after parsing."

Styling: `color: var(--muted)`, `font-size: 10px`, positioned below the history/clear section.

**Affected files:** `python/server.py`, `electron/main.js`, `electron/preload.js`, `electron/index.html`

---

## 4. Distribution & Installation

### Problem
Non-technical teammates cannot install the app. Mac Gatekeeper blocks unsigned apps with no obvious workaround for non-developers. No reliable build pipeline exists.

### Approach
Build scripts + Mac DMG with an Install Helper script. No Apple Developer account required.

### Build Scripts

**`scripts/build-mac.sh`:**
```bash
#!/bin/bash
set -e
echo "→ Building Python backend..."
pip install pyinstaller
pyinstaller --onefile --name solicitationquoter-backend --noconsole python/server.py
mv dist dist-backend

echo "→ Building Electron app..."
npm run build:mac

echo "✓ Mac build complete. Output: dist/"
```

**`scripts/build-win.bat`:**
```bat
@echo off
echo Building Python backend...
pip install pyinstaller
pyinstaller --onefile --name solicitationquoter-backend --noconsole python/server.py
rename dist dist-backend

echo Building Electron app...
npm run build:win
echo Build complete. Output: dist/
```

### Mac DMG — Install Helper

A `scripts/Install Helper.command` script is included in the DMG alongside the app.

**`scripts/Install Helper.command`:**
```bash
#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_NAME="SolQuoter.app"
APP_PATH="$SCRIPT_DIR/$APP_NAME"

xattr -rd com.apple.quarantine "$APP_PATH" 2>/dev/null || true
cp -R "$APP_PATH" "/Applications/$APP_NAME"

osascript -e 'display dialog "SolQuoter installed. Launch it from your Applications folder." buttons {"OK"} default button "OK"'
```

**Executable bit:**
The `Install Helper.command` file must have its executable bit set via:
```
git update-index --chmod=+x "scripts/Install Helper.command"
```
This must be run on macOS or WSL (Linux filesystem) before pushing. On a Windows NTFS filesystem, the executable bit cannot be set via git. Since Mac builds must be produced on a Mac anyway (electron-builder requirement), this git command is run once on the Mac before building.

**`electron-builder.json` — add `dmg` section:**
```json
"dmg": {
  "contents": [
    { "x": 130, "y": 220, "type": "file" },
    { "x": 410, "y": 220, "type": "link", "path": "/Applications" },
    { "x": 270, "y": 380, "type": "file", "path": "scripts/Install Helper.command" }
  ]
}
```

Add this as a sibling to the existing `"mac"` key in `electron-builder.json` (not in `package.json`, which has no `build` section).

**Teammate instructions (non-technical):**
1. Open the `.dmg` file
2. Double-click "Install Helper"
3. If macOS asks "Are you sure you want to open this?", click Open
4. Launch SolQuoter from Applications

### Windows
The NSIS installer produced by electron-builder already provides a standard installer flow. `build-win.bat` ensures a reproducible build.

### Prerequisites Doc
`scripts/README-BUILD.md` covers one-time developer setup: Python 3.9+, Node 18+, `npm install`. End users never see this.

**New files:** `scripts/build-mac.sh`, `scripts/build-win.bat`, `scripts/Install Helper.command`, `scripts/README-BUILD.md`
**Modified files:** `electron-builder.json` (add `dmg.contents`), `electron/main.js`, `electron/preload.js`

---

## Implementation Order

1. **Theme label** — 1-line change, zero risk, immediate demo improvement
2. **Vendor profiles** — highest daily value, self-contained localStorage + UI work
3. **Security hardening** — Python + Electron changes; must follow step 2 since `goTo()` session blob is modified in both steps (coordinate the `apiKey` removal with the vendor profile session stabilization)
4. **Distribution scripts** — scripting work, tested last since it requires a full build run on both platforms

## Out of Scope (deferred)

- `.docx` quote redesign — deferred pending reference templates
- AI extraction improvements — not utilized by current team
- GitHub Actions CI — deferred until distribution to larger audience
- Apple code signing / notarization — not required for current 1-machine Mac rollout
