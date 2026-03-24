---
phase: 08-data-quality-extraction-trust-layer
plan: 02
subsystem: ui
tags: [csv, validation, step3, line-items, electron]

# Dependency graph
requires:
  - phase: 06-error-states
    provides: alert/alert-error CSS pattern and field-error inline display conventions used for CSV error messages
provides:
  - CSV header validation in doImportCsv() with specific column-naming error messages
  - validateCsvHeaders() function reporting exact mismatched column per D-08/D-09/D-11
  - Column-count check for headerless CSVs per D-12
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "validateCsvHeaders() validates against EXPECTED_HEADERS constant; returns array of {col, expected, actual} mismatches"
    - "Strict header check only runs when hasHeader heuristic passes; headerless path falls back to column-count check"

key-files:
  created: []
  modified:
    - electron/js/modules/step3.js

key-decisions:
  - "EXPECTED_HEADERS defined as module-level constant (not inline) — easy to update if columns change"
  - "errEl.classList.add('hidden') added at top of doImportCsv() to clear previous errors before re-validation"
  - "Headerless CSV path uses sampleCols.length check rather than reusing validateCsvHeaders — correct behavior: no expected column names to compare against when there's no header row"

patterns-established:
  - "CSV validation: detect-header first, then strict-validate if header found; count-check if no header"

requirements-completed: [DATA-03]

# Metrics
duration: 2min
completed: 2026-03-24
---

# Phase 08 Plan 02: CSV Header Validation Summary

**Strict CSV column header validation in doImportCsv() with specific per-column error messages naming the exact mismatched column per D-08 through D-12**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-24T00:32:45Z
- **Completed:** 2026-03-24T00:34:30Z
- **Tasks:** 1 of 1
- **Files modified:** 1

## Accomplishments
- Added `EXPECTED_HEADERS` constant and `validateCsvHeaders()` function to step3.js
- Updated `doImportCsv()` to validate headers strictly when a header row is detected, producing column-specific error messages (e.g., "Check column 3: expected 'uom', got 'unit'")
- Added column-count check for headerless CSVs — rejects data with other than 5 columns
- Added `errEl.classList.add('hidden')` at start of `doImportCsv()` to clear previous errors before new validation attempt

## Task Commits

Each task was committed atomically:

1. **Task 1: Add validateCsvHeaders() and update doImportCsv()** - `30960f3` (feat)

## Files Created/Modified
- `electron/js/modules/step3.js` - Added EXPECTED_HEADERS constant, validateCsvHeaders() function, strict header validation block, and headerless column-count check inside doImportCsv()

## Decisions Made
- `EXPECTED_HEADERS` is a module-level const (not inline) for easy future updates
- `errEl.classList.add('hidden')` added at function entry to ensure stale errors from previous attempts are cleared on retry
- Headerless CSV path uses a column-count check (not validateCsvHeaders) because there are no header names to compare against when no header row is present

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- DATA-03 (CSV header validation) complete
- DATA-01 (scope truncation), DATA-02 (SAM.gov field mapping), DATA-04 (confidence scoring), DATA-05 (NAICS/PSC validation) remain for plans 08-01, 08-03, 08-04, 08-05, 08-06

---
*Phase: 08-data-quality-extraction-trust-layer*
*Completed: 2026-03-24*
