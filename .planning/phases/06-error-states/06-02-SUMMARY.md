---
phase: 06-error-states
plan: 02
subsystem: ui
tags: [electron, sam-gov, error-handling, fetch, window-globals]

requires:
  - phase: 02-frontend-modularization
    provides: index.js module structure with wireStaticHandlers() and window globals pattern

provides:
  - window.doSamLookup function wired to /sam_lookup backend route
  - SAM.gov lookup success path: populates S.extracted and navigates to step 2
  - SAM.gov lookup failure path: closes modal, shows specific error in step 2, auto-focuses first input

affects: [06-error-states, step2 rendering]

tech-stack:
  added: []
  patterns:
    - "Error-to-step pattern: on async failure, close modal and render target step with prepended error div"
    - "window.esc() used for all user-visible error message rendering to prevent XSS"

key-files:
  created: []
  modified:
    - electron/js/modules/index.js

key-decisions:
  - "doSamLookup placed after closeSamModal() in index.js and exposed via window before bootstrap() so wireStaticHandlers() finds it on startup"
  - "On failure: navigate to step 2 (not dismiss and stay on step 1) so manual entry fields are immediately visible as recovery path"

patterns-established:
  - "async fetch with try/catch: show progress, disable button, handle HTTP errors and JSON errors uniformly"
  - "Failed to fetch detection: surface backend-unreachable as a user-friendly message"

requirements-completed: [ERR-03]

duration: 4min
completed: 2026-03-22
---

# Phase 06 Plan 02: SAM.gov Lookup Error Handling Summary

**`window.doSamLookup` implemented in index.js — wires SAM modal Fetch button to /sam_lookup with validated inputs, success path to step 2, and failure path that closes modal, shows specific error above step 2 fields, and auto-focuses first manual entry field**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-03-22T23:00:00Z
- **Completed:** 2026-03-22T23:02:07Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- Implemented `async function doSamLookup()` with input validation for both notice_id and api_key
- Success path: saves samKey to localStorage, sets S.extracted = data.data, populates line items if returned, calls closeSamModal() + goTo(2) + toast
- Failure path: closes modal, sets S.step = 2, calls window.render(2), prepends alert-error div to #content, auto-focuses first input[data-field]
- Exposed as `window.doSamLookup` before bootstrap() call so wireStaticHandlers() (line 483) successfully wires it to the sam-btn click event

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement doSamLookup with error handling (ERR-03)** - `feb7e8c` (feat)

## Files Created/Modified

- `electron/js/modules/index.js` - Added doSamLookup() function (93 lines) after closeSamModal() and window.doSamLookup exposure in globals block

## Decisions Made

- Function placed at line 174 (after closeSamModal at line 170), window exposure at line 573, bootstrap() at line 578 — guarantees correct wiring order
- Failure navigates to step 2 rather than staying on step 1 so the user immediately sees manual entry fields as recovery path (per D-09)
- "Failed to fetch" special-cased to user-friendly backend-unreachable message (since raw browser error text is not helpful)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- ERR-03 resolved: SAM.gov Fetch button is now functional end-to-end
- Both the success and failure paths are implemented with proper UX recovery
- Ready to proceed to plan 06-03

---
*Phase: 06-error-states*
*Completed: 2026-03-22*
