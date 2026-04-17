# Phase 2 — Session File Persistence

**Status:** Planning  
**Scope:** Persist uploaded source files to `~/.sol-quoter/session/current/` after parse so that Phase 4 (PDF viewer) and "resume session" have file access across requests and restarts.  
**Files changed:** `python/server.py`, `electron/main.js`, `electron/preload.js`, `electron/js/modules/step1.js`  
**Effort:** ~3 hours  
**Risk:** Medium — touches server file handling, IPC, and Step 1 state flow

---

## Diagnostic Answers

### D1 — Current temp file and cleanup pattern in `/parse`

`tmp_paths = []` is declared before the `try` block at line 135. For each uploaded file, `tempfile.NamedTemporaryFile(delete=False, suffix=suffix, prefix=TMP_PREFIX)` is called (line 148); the resulting path is appended to both `tmp_paths` and the module-level `_active_tmp_files` set. The **`finally` block at lines 227–234** iterates `tmp_paths` and calls `os.unlink(tmp_path)` on each, then `_active_tmp_files.discard(tmp_path)`. Every uploaded file is deleted before any downstream caller can access it. The `atexit` handler (`_cleanup_active_tmp_files`) provides a second sweep on crash/SIGTERM for any paths that survived the finally block.

```python
# Lines 227–234 — current finally block
finally:
    for tmp_path in tmp_paths:
        if os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except Exception:
                pass
        _active_tmp_files.discard(tmp_path)
```

**What changes:** Remove this finally block entirely. Session files stay. The `_active_tmp_files` set and `atexit` handler are no longer needed for session files (they should not be registered there). The `_startup_sweep` already handles stale `sqt_*` temp files from prior crashes — it remains unchanged since we will no longer create `sqt_*` files for session files.

---

### D2 — Does `validate_upload()` accept `.xlsx`?

**Yes — already implemented.** Lines 63–65 of `server.py`:

```python
elif fname.endswith(('.xlsx', '.xls')):
    if header[:2] != b'PK':
        return "Unsupported file type — only PDF, DOCX, TXT, and XLSX are accepted", 400
```

Accepts XLSX/XLS by checking for PK magic bytes (ZIP container). No change needed.

---

### D3 — Current `/parse` return shape

Lines 215–221:

```python
return jsonify({
    "success": True,
    "data": data,
    "overallConfidence": confidence["overallConfidence"],
    "fields": confidence["fields"],
    "flags": confidence["flags"]
})
```

`_session_files` will be added at the end of this dict in Phase 2.

---

### D4 — IPC handlers in `main.js`

14 handlers, all via `ipcMain.handle()`:

| Channel | Purpose |
|---|---|
| `get-port` | Return Flask port |
| `open-file` | Native file picker dialog |
| `save-quote` | Save dialog + write .docx |
| `open-url` | shell.openExternal |
| `open-path` | shell.openPath |
| `generate-pdf` | Render HTML to PDF |
| `save-pdf` | Save dialog + write .pdf |
| `pick-logo` | Native image picker + base64 read |
| `export-data` | Save dialog + write JSON/CSV |
| `open-json-file` | Open dialog + read JSON |
| `store-api-key` | Encrypt + write API key |
| `load-api-key` | Read + decrypt API key |
| `clear-api-key` | Delete API key file |
| `restart-backend` | Kill + restart Flask process |

**New handlers added in this phase:** `get-session-file-path`, `clear-session-dir`

---

### D5 — `contextBridge` exposures in `preload.js`

14 keys, all under `window.api`:

`getPort`, `openFile`, `saveQuote`, `openUrl`, `openPath`, `pickLogo`, `generatePdf`, `savePdf`, `exportData`, `openJsonFile`, `storeApiKey`, `loadApiKey`, `clearApiKey`, `restartBackend`

**New keys added in this phase:** `getSessionFilePath`, `clearSession`

Note: `clearSession` calls the Flask `/api/sol-quoter/session/clear` route via `fetch`, not IPC — it does not need a main.js handler. Only `getSessionFilePath` requires a new IPC handler.

---

### D6 — Parse response handler in `step1.js`

Inside `doParse()`, lines 138–176:

```javascript
const data = await r.json()
if (!data.success) throw new Error(data.error || 'Extraction failed')
// ...
window.S.extracted = data.data
window.S.confidence = {
  overallConfidence: data.overallConfidence || null,
  fields: data.fields || [],
  flags: data.flags || []
}
// ... sourceType, sourceFile, items population ...
window.S.done.add(1)
setTimeout(() => goTo(2), 500)
```

**What changes:** After populating `window.S.confidence`, add:
```javascript
window.S.sessionFiles = data._session_files || {}
```

---

### D7 — Toast / notification system

`window.toast(msg)` exists, exported from `utils.js`. The module comment at line 3 of `step1.js` lists it explicitly: `window.esc/fmt/toast/goTo/next/render (utils.js)`. Step 1 uses inline `err.innerHTML` for parse-flow errors rather than toast (toast is used from other steps). Phase 4 will call `window.toast()` for the "file not available" case; the function already exists.

---

### D8 — Resume session / localStorage restore

In `step1.js` lines 230–238, `step1(c)` reads `window.S._pendingSession` to conditionally render a resume banner with "Resume" and "Dismiss" buttons. These wire to `window.resumeSession?.()` and `window.dismissSession?.()` (lines 307–308), which are defined in `index.js`. The `_pendingSession` is populated before `step1()` is first called — presumably during the localStorage restore logic in `index.js` or `state.js` that runs at startup.

**Impact on Phase 2:** The resume banner currently restores wizard state from `S` (fields, line items, step progress). After Phase 2, session files are on disk, so a resumed session can also access source documents. No change to the resume flow itself — `S.sessionFiles` will be persisted in localStorage alongside the other state fields (this is automatic if `state.js` persists the whole `S` object).

---

## Implementation Plan

### Change 1 — `python/server.py`: session directory helpers

Add at the top of the file, after existing imports:

```python
import shutil, datetime

SESSION_DIR = Path.home() / ".sol-quoter" / "session" / "current"


def _get_session_dir() -> Path:
    """Return the session directory, creating it if necessary."""
    SESSION_DIR.mkdir(parents=True, exist_ok=True)
    return SESSION_DIR


def _clear_session_dir() -> None:
    """Wipe and recreate the session directory."""
    if SESSION_DIR.exists():
        shutil.rmtree(SESSION_DIR)
    SESSION_DIR.mkdir(parents=True, exist_ok=True)
```

`Path` is already available via `from pathlib import Path` (already imported in `parse_document`'s caller logic but not at module level — verify and add if needed).

---

### Change 2 — `python/server.py`: new `/api/sol-quoter/session/clear` route

```python
@app.route("/api/sol-quoter/session/clear", methods=["POST", "OPTIONS"])
def session_clear_route():
    if request.method == "OPTIONS":
        return jsonify({}), 200
    try:
        _clear_session_dir()
        return jsonify({"status": "cleared"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
```

Route prefix `/api/sol-quoter/` distinguishes this from document routes and avoids collisions with any future Flask routes.

---

### Change 3 — `python/server.py`: replace temp-file pattern in `/parse`

**Replace the entire try/finally body** of `parse_route()`. The new pattern:

1. Call `_clear_session_dir()` — wipes previous session, creates fresh dir
2. Save each uploaded file to `SESSION_DIR / original_filename` (not a tempfile)
3. Build `bundle` with session paths instead of temp paths
4. Run `parse_solicitation_bundle(bundle)` as before (no change)
5. Write `manifest.json` to `SESSION_DIR`
6. Build `_session_files` map and add to response
7. **No finally cleanup** — files stay

Key structural change:

```python
# BEFORE — temp file pattern
with tempfile.NamedTemporaryFile(delete=False, suffix=suffix, prefix=TMP_PREFIX) as tmp:
    tmp_path = tmp.name
file.save(tmp_path)
tmp_paths.append(tmp_path)
_active_tmp_files.add(tmp_path)
bundle.append({"path": tmp_path, "filename": file.filename})

# AFTER — session file pattern
session_dir = _get_session_dir()   # already cleared at route start
session_path = session_dir / safe_filename(file.filename)
file.save(str(session_path))
bundle.append({"path": str(session_path), "filename": file.filename})
```

`safe_filename()` strips path separators from the original name to prevent directory traversal. Use `pathlib.Path(file.filename).name` which discards any directory component.

The `_session_files` dict built after classification:

```python
session_file_map = {}
for doc_entry in classified_docs:
    role = doc_entry["role"]   # "main", "sow", or "pricing"
    if role not in session_file_map:
        session_file_map[role] = str(session_dir / Path(doc_entry["filename"]).name)
# Roles not present in upload are absent from the map (not null-padded)
```

Since `classify_document()` is called inside `parse_solicitation_bundle()`, the route needs to replicate the classification just to know which role each file got — or `parse_solicitation_bundle()` can return the classified roles. **Simpler approach:** classify each file in the route using the same `classify_document()` call before passing to bundle, so the role is known at route level without changing `parse_solicitation_bundle()`.

**Manifest write:**

```python
manifest = {
    "timestamp": datetime.datetime.now().isoformat(),
    "solicitation_number": data.get("solicitation_number", ""),
    "files": session_file_map
}
with open(session_dir / "manifest.json", "w") as f:
    json.dump(manifest, f, indent=2)
```

**Updated return:**

```python
return jsonify({
    "success": True,
    "data": data,
    "overallConfidence": confidence["overallConfidence"],
    "fields": confidence["fields"],
    "flags": confidence["flags"],
    "_session_files": session_file_map
})
```

**Remove the finally block.** The `_active_tmp_files` set and `atexit` handler remain for any other temp files the app might create, but session files are never added to them.

---

### Change 4 — `python/server.py`: write-failure fallback

If the session directory write fails (disk full, permissions), the parse should still succeed using the uploaded data already in memory — but return `_session_files: {}` and log a warning. Wrap the session write in a try/except:

```python
session_file_map = {}
try:
    session_dir = _get_session_dir()
    _clear_session_dir()
    # ... save files, build bundle from session paths ...
except Exception as e:
    print(f"[session] Write failed, falling back to temp files: {e}", flush=True)
    # Fall back to original temp file pattern for this request
    # _session_files will be empty in response
```

This ensures parse never breaks due to session directory issues.

---

### Change 5 — `electron/main.js`: `get-session-file-path` IPC handler

Add after existing IPC handlers:

```javascript
const os = require('os')

ipcMain.handle('get-session-file-path', (event, filename) => {
  // Sanitize: strip any directory component from the filename
  const safeName = path.basename(filename)
  const sessionDir = path.join(os.homedir(), '.sol-quoter', 'session', 'current')
  const filePath = path.join(sessionDir, safeName)
  return fs.existsSync(filePath) ? filePath : null
})
```

`path.basename()` ensures a filename like `../../etc/passwd` cannot escape the session directory.

Note: `os` is already available as a Node built-in; add `const os = require('os')` at the top of `main.js` alongside existing `require` calls.

---

### Change 6 — `electron/preload.js`: expose new APIs

Add two keys to the `contextBridge.exposeInMainWorld('api', {...})` object:

```javascript
getSessionFilePath: (filename) => ipcRenderer.invoke('get-session-file-path', filename),
clearSession: () => fetch(`http://127.0.0.1:${window.S?.port || 5199}/api/sol-quoter/session/clear`, { method: 'POST' }),
```

`clearSession` calls Flask directly via fetch — this keeps it consistent with how all other backend interactions work in this app. No IPC round-trip needed.

**Problem:** `preload.js` runs in a context that may not have `window.S` available. Use a hard-coded default port fallback or pass the port at call time.

**Better approach:** Make `clearSession` accept a port parameter:

```javascript
clearSession: (port) => fetch(`http://127.0.0.1:${port}/api/sol-quoter/session/clear`, { method: 'POST' }),
```

Call from step1.js as: `window.api.clearSession(window.S.port)`

---

### Change 7 — `electron/js/modules/step1.js`: store `_session_files` + clear on new upload

**A. Store session files in parse response handler** (inside `doParse()`, after `window.S.confidence = {...}`):

```javascript
window.S.sessionFiles = data._session_files || {}
```

**B. Clear session before new upload** — at the top of `doParse()`, before the `p(15, 'Uploading document...')` call:

```javascript
try {
  await window.api.clearSession(window.S.port)
} catch (e) {
  console.warn('[step1] Session clear failed (non-fatal):', e.message)
}
```

Wrap in try/catch — session clear failure must not block the upload.

---

### Change 8 — "Clear & Reparse" button

Add to Step 2 review UI. **Location:** This button belongs in `step2.js`, not `step1.js`, since it is shown on the review screen. It should appear near the top of the Step 2 card, styled as a secondary/ghost button so it doesn't compete with the "Continue" CTA.

**Behavior:**
1. Call `window.api.clearSession(window.S.port)` — wipes session files
2. Reset `window.S.sessionFiles = {}`
3. Call `goTo(1)` — returns to upload screen

```javascript
// In step2.js, near the top of the rendered card:
<button class="btn btn-ghost btn-sm" id="clear-reparse-btn" style="margin-left:auto">
  ↺ Clear &amp; Reparse
</button>

// Wire:
document.getElementById('clear-reparse-btn')?.addEventListener('click', async () => {
  try { await window.api.clearSession(window.S.port) } catch(e) {}
  window.S.sessionFiles = {}
  goTo(1)
})
```

This is a developer convenience feature. For v1 it can be styled minimally.

---

## Exact `manifest.json` Structure

```json
{
  "timestamp": "2026-04-16T15:30:00.123456",
  "solicitation_number": "70B06C26Q00000080",
  "files": {
    "main": "70B06C26Q00000080.pdf",
    "sow": "70B06C26Q00000080+Attachment+1+-+LLSM+SOW.pdf",
    "pricing": "70B06C26Q00000080+Attachment+2-Pricing+Sheeet.xlsx"
  }
}
```

- `timestamp`: Python `datetime.datetime.now().isoformat()` — no timezone suffix for simplicity
- `solicitation_number`: from `data.get("solicitation_number", "")` — empty string if not extracted
- `files`: keyed by role (`main`, `sow`, `pricing`); value is original filename only, not full path. Roles absent from the upload are simply absent from the dict (not present as `null`).

---

## Exact `_session_files` Shape in Parse Response

```json
{
  "_session_files": {
    "main":    "/Users/name/.sol-quoter/session/current/70B06C26Q00000080.pdf",
    "sow":     "/Users/name/.sol-quoter/session/current/70B06C26Q00000080+Attachment+1+-+LLSM+SOW.pdf",
    "pricing": "/Users/name/.sol-quoter/session/current/70B06C26Q00000080+Attachment+2-Pricing+Sheeet.xlsx"
  }
}
```

- Values are **absolute paths** (not filenames) — the PDF viewer needs to open them directly
- On Windows these will use backslashes from `str(Path(...))` — `shell.openPath` handles this correctly, and `path.resolve()` normalizes for comparisons
- Roles absent from the upload are absent from the dict
- If session write failed, this key is `{}` (empty dict, not absent)
- `S.sessionFiles` stores this dict verbatim

---

## Edge Cases

### E1 — Session directory already has files

`_clear_session_dir()` is called at the start of every `/parse` invocation, before writing new files. Previous session is always wiped. No stale files accumulate.

### E2 — Write fails (disk full, permissions)

Wrapped in try/except in the route. Falls back to temp file behavior for the current request. `_session_files` returns `{}`. The parse still succeeds; Phase 4 PDF viewer will show "file not available" message. Non-blocking.

### E3 — Windows path separators

Python `pathlib.Path.home()` returns the correct home directory on Windows (`C:\Users\name`). `Path(...) / "sub"` uses the OS-native separator. `str(Path(...))` produces backslash paths on Windows. 

In `main.js`, `os.homedir()` and `path.join()` use backslashes on Windows automatically.

In the security check (`path.basename(filename)`), this works correctly on both platforms since `path.basename` is platform-aware in Node.

One Windows-specific concern: the `+` characters in filenames like `70B06C26Q00000080+Attachment+1+-+LLSM+SOW.pdf`. These are valid Windows filenames — no issue.

### E4 — Filename collision (two uploaded files with the same name)

`Path(file.filename).name` strips directory components but keeps the base name. If two files have the same name, the second will overwrite the first in the session directory. In practice this cannot happen with the current multi-file upload UI — all files come from different paths and have different names. Guard: if collision detected, append a counter suffix `_2`, `_3`, etc. This is low priority for v1.

### E5 — Session dir grows unbounded across app sessions

Each new parse wipes and recreates the session dir. No rotation needed. The session dir is bounded to ~3 files at a time. On uninstall, the `~/.sol-quoter/` directory is not auto-cleaned (it's in the user's home, not the app bundle). Document in README: manual deletion is safe.

### E6 — Resume session loses file access after OS temp dir cleanup

With the old pattern, a "resumed" session had no file access since temp files were already deleted. With this plan, session files in `~/.sol-quoter/` survive across app restarts unless explicitly cleared. `S.sessionFiles` (persisted in localStorage) contains absolute paths; `getSessionFilePath` verifies existence before returning the path. If the user manually deleted the session dir, `getSessionFilePath` returns `null` and Phase 4 shows "file not available" gracefully.

### E7 — `_active_tmp_files` and `atexit` handler

These are no longer needed for the main upload flow. They are kept in place (no code deleted) in case other parts of the code create temp files in future. Session files must never be added to `_active_tmp_files`.

---

## Implementation Order

```
Change 1  — Python helpers (_get_session_dir, _clear_session_dir)
Change 2  — New /api/sol-quoter/session/clear route
Change 3  — /parse route: replace temp-file pattern
Change 4  — /parse route: write-failure fallback
Change 5  — main.js: get-session-file-path IPC handler
Change 6  — preload.js: expose getSessionFilePath, clearSession
Change 7  — step1.js: store S.sessionFiles, clear before upload
Change 8  — step2.js: "Clear & Reparse" button
```

Changes 1–4 are backend-only and can be validated independently before touching the frontend.

---

## Validation Checklist

| Step | Check | Expected |
|---|---|---|
| 1 | Upload 70B bundle (3 files), parse | No errors |
| 2 | `~/.sol-quoter/session/current/` exists | 3 uploaded files + `manifest.json` present |
| 3 | `manifest.json` content | Contains `solicitation_number`, `timestamp`, `files` dict with 3 entries |
| 4 | `S.sessionFiles` in browser console | Object with `main`, `sow`, `pricing` absolute paths |
| 5 | `window.api.getSessionFilePath("70B06C26Q00000080+Attachment+1+-+LLSM+SOW.pdf")` | Returns absolute path string |
| 6 | Start new upload (drop new file) | Previous session dir cleared before upload begins |
| 7 | After new parse, session dir | Contains only the new upload's files |
| 8 | Click "Clear & Reparse" on Step 2 | Wizard resets to Step 1, session dir empty |
| 9 | Resume session after restart | `S.sessionFiles` still populated from localStorage, files still on disk |
| 10 | Session write fails (chmod 000 the dir) | Parse still returns data, `_session_files: {}`, no crash |

---

## Files Changed Summary

| File | Change |
|---|---|
| `python/server.py` | Add `_get_session_dir()`, `_clear_session_dir()`, `session_clear_route()`. Rewrite `/parse` file handling. Remove finally cleanup. Add `_session_files` to response. |
| `electron/main.js` | Add `get-session-file-path` handler. Add `require('os')`. |
| `electron/preload.js` | Expose `getSessionFilePath`, `clearSession`. |
| `electron/js/modules/step1.js` | Store `S.sessionFiles` after parse. Call `clearSession` before upload. |
| `electron/js/modules/step2.js` | Add "Clear & Reparse" button and handler. |

---

*Plan version 1.0 — Phase 2 of line-item-confidence-plan.md*
