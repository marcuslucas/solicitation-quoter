---
phase: 08-data-quality-extraction-trust-layer
plan: "03"
subsystem: api
tags: [flask, pdfplumber, confidence-scoring, extraction, validator]

requires:
  - phase: 08-01
    provides: validator.py confidence scoring module with validate_fields() function

provides:
  - /parse response includes overallConfidence, fields array, and flags array
  - scope_truncated boolean and scope_full string when scope exceeds SCOPE_MAX
  - SAM.gov null guard — or "" pattern on all 9 field mappings
  - Bounding box coordinates for PDF source fields via pdfplumber
  - SCOPE_MAX = 3000 constant exported from extractor.py

affects:
  - 08-04 (UI confidence indicators consume overallConfidence/fields/flags)
  - 08-05 (scope truncation banner reads scope_truncated from parse response)

tech-stack:
  added: []
  patterns:
    - "validate_fields() called after extract_data() in parse_route; result merged into response top-level"
    - "Bounding boxes extracted best-effort via pdfplumber; exceptions swallowed (D-26)"
    - "SAM.gov null guard: or '' pattern on every opp.get() call to prevent None string literals"
    - "SCOPE_MAX constant exported from extractor.py; imported into server.py for consistent truncation"

key-files:
  created: []
  modified:
    - python/extractor.py
    - python/server.py

key-decisions:
  - "SCOPE_MAX imported from extractor.py into server.py — single source of truth for scope length limit; avoids duplicate hardcoded 3000"
  - "Bounding box extraction is best-effort — exceptions swallowed to avoid breaking /parse for non-PDF or malformed PDFs (D-26)"
  - "scope_truncated=False passes through extract() return filter because False is not in ('', [], None)"
  - "or '' null guard applied to all 9 SAM.gov opp.get() field assignments — prevents None string literals even when SAM API returns explicit null JSON values"

requirements-completed: [DATA-01, DATA-02, DATA-04b]

duration: 10min
completed: 2026-03-24
---

# Phase 8 Plan 3: Validator Wire-up and SAM Null Guard Summary

**Validator wired into /parse route returning overallConfidence/fields/flags, scope truncation signaled via scope_truncated+scope_full, and SAM.gov null guards applied to all 9 field mappings**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-03-24T02:30:00Z
- **Completed:** 2026-03-24T02:40:42Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Added `SCOPE_MAX = 3000` constant to extractor.py and replaced hardcoded `[:3000]` slices with the three-layer scope truncation pattern (raw_scope, scope_of_work truncated, scope_truncated boolean, scope_full when truncated)
- Wired `validate_fields()` from validator.py into `parse_route()` in server.py — /parse now returns `overallConfidence`, `fields`, and `flags` alongside existing `data` key
- Added best-effort PDF bounding box extraction via pdfplumber; coordinates merged into confidence field entries when found
- Applied `or ""` null guard to all 9 SAM.gov `opp.get()` field assignments, preventing `None` string literals when SAM API returns explicit JSON null values
- Added scope_truncated + scope_full signaling in the sam_lookup route for consistency with file-upload path

## Task Commits

1. **Task 1: Add scope truncation signal to extractor.py** - `63098a3` (feat)
2. **Task 2: Wire validator into /parse, add SAM null guard, add bounding boxes** - `a4c1d1a` (feat)

## Files Created/Modified

- `python/extractor.py` - Added SCOPE_MAX constant; replaced [:3000] with three-layer truncation pattern adding scope_truncated and scope_full fields
- `python/server.py` - Imported validate_fields and SCOPE_MAX; added source_type detection, bounding box extraction, confidence validation, updated parse_route return; applied or "" null guards to 9 SAM.gov fields; added scope_truncated signaling to sam_lookup

## Decisions Made

- SCOPE_MAX exported from extractor.py and imported into server.py — single constant for both parse paths (file upload and SAM.gov lookup)
- Bounding box extraction is best-effort with a bare `except Exception: pass` — consistent with D-26 (non-critical enhancement, must not block /parse)
- `or ""` guard applied to all SAM.gov field mappings (not just the originally listed ones) to prevent future null leaks as SAM API evolves

## Deviations from Plan

None — plan executed exactly as written. All acceptance criteria met verbatim.

## Issues Encountered

- Pre-existing test failure in `tests/test_sec01.py::test_ai_extract_reads_env` (looks for `server.ai_extract` but `ai_extract` lives in `extractor.py`) — confirmed pre-existing by stash check; out of scope for this plan.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- /parse response now includes `overallConfidence`, `fields`, and `flags` — Plan 04 (confidence indicator UI) can read these directly
- `scope_truncated` boolean in parse response — Plan 05 (scope truncation banner) can read without backend changes
- SAM.gov null literal risk eliminated — no field will ever show "null" or "None" in the UI from SAM data
- All 10 `test_data08.py` tests pass

## Self-Check: PASSED

- `python/extractor.py` — exists and contains `SCOPE_MAX`, `scope_truncated`, `scope_full`
- `python/server.py` — exists and contains `from validator import validate_fields`, `confidence = validate_fields`, `overallConfidence`, `scope_truncated`, 9x `or ""`
- Commit `63098a3` — verified via git log
- Commit `a4c1d1a` — verified via git log
- `tests/test_data08.py` — 10/10 tests pass

---
*Phase: 08-data-quality-extraction-trust-layer*
*Completed: 2026-03-24*
