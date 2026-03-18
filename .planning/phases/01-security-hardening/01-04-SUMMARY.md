---
phase: 01-security-hardening
plan: "04"
subsystem: ui
tags: [electron, renderer, security, api-key, encryption, file-upload, cors, validation]

# Dependency graph
requires:
  - phase: 01-security-hardening
    provides: "01-01 Electron main safeStorage key store + backend restart; 01-02 Python magic byte validation + size limits; 01-03 temp file cleanup"
provides:
  - "api_key removed from /parse FormData — key never sent over the network"
  - "showEncryptionWarning() banner displayed in AI key modal when safeStorage is blocked"
  - "Both saveAiKey() and saveSettings() handle result.blocked and show reconnect toast"
  - "validateDroppedFile() client-side file type gate in all drag-and-drop handlers"
  - "CORS null-origin fix allowing Electron file:// renderer to receive Python error responses"
affects: [all future renderer changes to index.html, all future CORS changes to server.py]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "IPC storeApiKey() result checked for blocked flag before proceeding"
    - "Inline DOM-injected warning banner for encryption unavailability"
    - "Toast used for reconnect indicator instead of new DOM elements"
    - "Client-side file extension validation before accepting drag-and-drop files"
    - "CORS reflect-null pattern for Electron file:// renderer origin"
    - "Belt-and-suspenders: validate file type at renderer (drop handler + doParse) and server"

key-files:
  created: []
  modified:
    - electron/index.html
    - python/server.py
    - tests/test_sec02.py

key-decisions:
  - "Removed api_key from /parse FormData — backend now reads key from ANTHROPIC_API_KEY env var set by Electron main"
  - "Warning banner injected into m-apikey input's parentElement so it is always visible in the AI modal when triggered"
  - "saveSettings() opens AI modal after blocked response so user sees the warning without confusion"
  - "Reconnect toast shown only on successful save (not on blocked path) to avoid false indication of backend restart"
  - "Client-side validateDroppedFile() is the primary UX gate; Python validation is security defense-in-depth"
  - "CORS reflects null origin for Electron file:// renderer so Python 400 error bodies reach the renderer JS"

patterns-established:
  - "Pattern: Always await storeApiKey() and inspect result.blocked before closing modal"
  - "Pattern: showFileError() as centralized error display for file-selection — clears state, hides file-info, disables parse-btn"
  - "Pattern: CORS reflect-null — null origin gets Access-Control-Allow-Origin: null; unknown origins get restrictive fallback"

requirements-completed: [SEC-01, SEC-05]

# Metrics
duration: 50min
completed: 2026-03-17
---

# Phase 1 Plan 04: Renderer Security Fixes Summary

**api_key removed from /parse FormData, client-side file type validation added to all drop handlers, and CORS null-origin fix ensures Python 400 errors reach the Electron renderer**

## Performance

- **Duration:** ~50 min (Task 1 ~10 min + continuation fix ~40 min)
- **Started:** 2026-03-17T21:49:00Z
- **Completed:** 2026-03-17
- **Tasks:** 2 (Task 1 + continuation fix for SEC-02/SEC-03)
- **Files modified:** 3

## Accomplishments
- SEC-01 frontend complete: `fd.append('api_key', S.apiKey || '')` removed from `doParse()` — api_key never transmitted in /parse requests
- SEC-05 UI complete: `showEncryptionWarning()` function added; both `saveAiKey()` and `saveSettings()` check `result.blocked` and show the encryption warning or the reconnect toast accordingly
- SEC-02/SEC-03 renderer fix: `validateDroppedFile()` added to both drop handlers; rejects PNG, ZIP, folders, and any non-PDF/DOCX/TXT extension with immediate user-visible error before parse button can be clicked
- CORS null-origin fix: `server.py` now reflects `null` origin for Electron file:// renderer pages so Python error responses (400, 413) actually reach the renderer instead of being silently CORS-blocked
- All 13 pytest tests pass including 3 new tests for PNG, ZIP, and PNG-renamed-to-PDF rejection

## Task Commits

Each task was committed atomically:

1. **Task 1: Remove api_key from /parse FormData + encryption warning + reconnect UX** - `b5a5105` (feat)
2. **Fix: SEC-02/SEC-03 upload rejection not triggering in renderer** - `a40d11d` (fix)

**Plan metadata:** (added after completion)

## Files Created/Modified
- `electron/index.html` - Removed api_key from FormData; added showEncryptionWarning(), validateDroppedFile(), showFileError(); updated both drop handlers and doParse()
- `python/server.py` - Fixed CORS after_request handler to reflect null origin for Electron file:// renderer
- `tests/test_sec02.py` - Added 3 new tests: PNG rejected, ZIP rejected, PNG-as-PDF rejected

## Decisions Made
- The warning banner is inserted into `m-apikey.parentElement` (the AI modal's `.field` div) so it appears immediately above the input field — visible and persistent
- `saveSettings()` calls `closeSettings()` then `openAiModal()` on blocked path so the user sees the warning in the correct UI context
- Reconnect toast uses the existing `toast()` utility (no new DOM elements per CONTEXT.md guidance)
- Client-side validation is the primary UX gate because Python validation was unreachable: Chromium's CORS enforcement silently dropped 400 responses when the renderer page's `Origin: null` didn't match the server's `Access-Control-Allow-Origin: http://127.0.0.1:5199`
- Only null and http://127.0.0.1:5199 origins are reflected; any other origin still gets the restrictive 127.0.0.1:5199 header (Chromium blocks the response)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] CORS configuration blocked Python validation errors from reaching renderer**
- **Found during:** Task 2 continuation (investigating why upload rejection didn't trigger)
- **Issue:** Python `cors()` after_request set `Access-Control-Allow-Origin: http://127.0.0.1:5199` unconditionally. Electron renderer pages loaded from `file://` send `Origin: null`. Chromium blocked the response, so the 400 error JSON never reached renderer JS.
- **Fix:** Updated `cors()` to reflect the incoming origin when it is `null`, `http://127.0.0.1:5199`, or starts with `file://`; all other origins get the restrictive fallback.
- **Files modified:** `python/server.py`
- **Verification:** Python test client confirms `Origin: null` receives `Access-Control-Allow-Origin: null`; evil.com still blocked
- **Committed in:** a40d11d

**2. [Rule 2 - Missing Critical] Client-side file type validation absent from all drop handlers**
- **Found during:** Task 2 continuation
- **Issue:** Both `onDrop()` and the whole-app drop handler accepted any `File` object without extension check. Users saw the file "accepted" (green card) before clicking Parse, with no indication the type was invalid.
- **Fix:** Added `validateDroppedFile()` with extension regex, `showFileError()` for display; updated both handlers; added belt-and-suspenders check at top of `doParse()`.
- **Files modified:** `electron/index.html`
- **Verification:** Node string assertions pass; 3 new tests pass for PNG, ZIP, PNG-as-PDF
- **Committed in:** a40d11d

---

**Total deviations:** 2 auto-fixed (1 bug - CORS, 1 missing critical - client-side validation)
**Impact on plan:** Both fixes essential for security control to work end-to-end. No scope creep.

## Issues Encountered

pdfplumber/pypdf DLL incompatibility in the test environment causes Windows fatal exception stderr during test runs. All 13 tests complete and pass — this is a pre-existing environment issue unrelated to plan changes.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

All Phase 1 security requirements are complete:
- SEC-01: api_key absent from all network requests (renderer + Python backend)
- SEC-02/SEC-03: Magic byte validation + 50MB limit (Python) + extension check (renderer drop handlers + doParse)
- SEC-04: Temp file tracking + atexit cleanup + startup sweep
- SEC-05: No plaintext key storage; warning banner when safeStorage unavailable; legacy .plain cleanup

Upload validation is enforced at three layers: Electron file picker (extension filter), renderer drop handler (validateDroppedFile), and Python server (validate_upload magic bytes + extension).

---
*Phase: 01-security-hardening*
*Completed: 2026-03-17*
