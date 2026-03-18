---
phase: 01-security-hardening
plan: 05
subsystem: auth
tags: [electron, safeStorage, ipc, api-key, encryption]

# Dependency graph
requires:
  - phase: 01-security-hardening
    provides: "Prior SEC plans (01-02, 01-04) established safeStorage scaffolding"
provides:
  - "store-api-key IPC returns { blocked: true } and writes nothing when safeStorage unavailable"
  - "restart-backend IPC handler kills backend, decrypts stored key, respawns with ANTHROPIC_API_KEY env injection"
  - "restartBackend exposed in preload.js contextBridge"
  - "saveAiKey() and saveSettings() both await window.api.restartBackend() on successful encrypted save"
affects: [python/server.py, SEC-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "safeStorage blocked path returns { blocked: true } with zero disk writes"
    - "API key injected into backend via process env at spawn time, not HTTP transport"

key-files:
  created: []
  modified:
    - electron/main.js
    - electron/preload.js
    - electron/index.html

key-decisions:
  - "When encryption unavailable, return { blocked: true } and write nothing — plaintext file eliminated entirely"
  - "Backend restart reads encrypted key from disk and injects via ANTHROPIC_API_KEY env var at spawn time"
  - "restartBackend IPC called only on the successful encrypted path, never on the blocked path"

patterns-established:
  - "IPC env injection pattern: kill() + startBackend(apiKey) + waitForBackend() for hot key reload"

requirements-completed: [SEC-05]

# Metrics
duration: 2min
completed: 2026-03-18
---

# Phase 01 Plan 05: Security Hardening — API Key IPC Contract Fix Summary

**Eliminated plaintext API key writes and wired backend restart with ANTHROPIC_API_KEY env injection via safeStorage + IPC**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-18T00:31:48Z
- **Completed:** 2026-03-18T00:33:07Z
- **Tasks:** 2 (+ checkpoint awaiting human verify)
- **Files modified:** 3

## Accomplishments
- Fixed store-api-key IPC handler: unavailable branch now returns `{ blocked: true }` and writes zero bytes to disk
- Added restart-backend IPC handler: kills Python backend, decrypts stored key, respawns with ANTHROPIC_API_KEY in env, polls /ping
- Updated startBackend() to accept optional apiKey param and spread it into spawn env
- Exposed restartBackend in preload.js contextBridge
- Both saveAiKey() and saveSettings() await window.api.restartBackend() after a successful encrypted save

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix store-api-key handler and add restart-backend IPC** - `adad513` (fix)
2. **Task 2: Expose restartBackend in preload and wire calls in index.html** - `f52690c` (feat)

## Files Created/Modified
- `electron/main.js` - Fixed store-api-key blocked path; added restart-backend handler; startBackend(apiKey) signature + ANTHROPIC_API_KEY env spread
- `electron/preload.js` - Added restartBackend to contextBridge exposeInMainWorld
- `electron/index.html` - Added await window.api.restartBackend() in saveAiKey() and saveSettings() (success path only)

## Decisions Made
- Eliminated the .plain file write entirely from store-api-key — when safeStorage is unavailable, the key lives in memory only (S.apiKey) for the session, matching the blocked: true contract
- Backend restart reads the encrypted key from disk inside the restart-backend handler rather than receiving it as a parameter, keeping the key out of IPC payload on restart
- restartBackend is guarded with `if (window.api && window.api.restartBackend)` for forward-compatibility

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- SEC-05 fully verified: human checkpoint approved (both Test A and Test B passed)
- Backend receives ANTHROPIC_API_KEY via env after user saves key in UI
- Plaintext key write path is fully eliminated

---
*Phase: 01-security-hardening*
*Completed: 2026-03-18*
