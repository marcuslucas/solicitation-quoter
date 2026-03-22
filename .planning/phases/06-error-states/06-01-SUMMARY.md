---
phase: 06-error-states
plan: 01
subsystem: ui
tags: [error-handling, ux, css-tokens, electron]

# Dependency graph
requires:
  - phase: 02-frontend-modularization
    provides: step1.js and step4.js module structure that this plan modifies
  - phase: 04-css-design-tokens
    provides: CSS token system that error.html now mirrors
provides:
  - Per-scenario parse error messages distinguishing network failure, timeout, and missing file
  - r.ok HTTP status check before JSON parsing in doParse()
  - Try Again retry buttons in doGenerate and doGeneratePdf catch blocks
  - Tokenized error.html with full :root CSS custom property block
affects: [06-02, 06-03]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-scenario catch block: check e.message for specific substrings to map to user-friendly messages"
    - "r.ok guard before r.json() — prevents confusing JSON parse errors when server returns non-200"
    - "Retry button pattern: inject btn-danger btn-sm button into alert div, wire addEventListener inline"
    - "CSS token mirroring: error.html :root block uses same token names as main app :root"

key-files:
  created: []
  modified:
    - electron/js/modules/step1.js
    - electron/js/modules/step4.js
    - electron/error.html

key-decisions:
  - "err.classList.add('hidden') added at start of doGenerate/doGeneratePdf — clears previous error before retry attempt"
  - "Try Again button uses btn-danger btn-sm classes — visually distinct from primary actions, matches D-21"
  - "color:#000 retained on error.html button text — no contrast token in minimal error.html token set; intentional per plan template"

patterns-established:
  - "Retry pattern: error div contains both message span (flex:1) and retry button side-by-side in flex row"
  - "HTTP status check: always check r.ok before r.json() to avoid cryptic parse errors on 4xx/5xx responses"

requirements-completed: [ERR-01, ERR-02, ERR-04]

# Metrics
duration: 2min
completed: 2026-03-22
---

# Phase 06 Plan 01: Error States — Parse Specificity, Retry, and Token System Summary

**Specific parse error messages for network/timeout/missing-file scenarios, Try Again retry buttons on generation failure, and CSS-tokenized error.html replacing all hardcoded hex values**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-03-22T19:41:09Z
- **Completed:** 2026-03-22T19:43:10Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- step1.js doParse: added `r.ok` guard before `r.json()` to surface HTTP error status cleanly; catch block now maps "Failed to fetch", "timed out", and "No file selected" substrings to specific user-facing messages
- step4.js doGenerate and doGeneratePdf: catch blocks inject error reason plus "Try Again" button (btn-danger btn-sm) inside gen-err div; retry buttons re-call the generate function without restarting the wizard; previous error cleared at start of each call
- error.html: replaced all hardcoded hex values in element styles with CSS custom properties; added :root block with 12 named tokens matching the main app's token names; added button :hover/:active states; replaced emoji with HTML entities

## Task Commits

Each task was committed atomically:

1. **Task 1: Parse error specificity and quote generation retry** - `ef9d914` (feat)
2. **Task 2: Tokenize error.html with CSS custom properties** - `6a838d9` (feat)

## Files Created/Modified
- `electron/js/modules/step1.js` - Added r.ok check, per-scenario catch messages for ERR-01
- `electron/js/modules/step4.js` - Try Again retry buttons in doGenerate and doGeneratePdf catch blocks for ERR-02
- `electron/error.html` - Full CSS token system replacing hardcoded hex for ERR-04

## Decisions Made
- `err.classList.add('hidden')` added at the top of both generate functions so a previous error is cleared before the retry attempt starts — prevents stale error persisting while new request runs
- Try Again button uses `btn-danger btn-sm` as specified in D-21 — visually distinct from primary actions
- `color:#000` retained on error.html button (text color on gold background) — no semantic contrast token exists in the minimal error.html token set; the plan template itself includes this value

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- ERR-01, ERR-02, ERR-04 complete; parse and generation errors now surface actionable messages with retry paths
- ERR-03 (scope truncation warnings) and ERR-05+ remain for plans 06-02 and 06-03
- error.html token system is now consistent with the main app token naming convention

## Self-Check: PASSED

- `electron/js/modules/step1.js` - FOUND
- `electron/js/modules/step4.js` - FOUND
- `electron/error.html` - FOUND
- `.planning/phases/06-error-states/06-01-SUMMARY.md` - FOUND
- Commit `ef9d914` (Task 1) - FOUND
- Commit `6a838d9` (Task 2) - FOUND

---
*Phase: 06-error-states*
*Completed: 2026-03-22*
