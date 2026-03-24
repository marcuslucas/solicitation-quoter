---
phase: 08-data-quality-extraction-trust-layer
plan: "04"
subsystem: ui
tags: [electron, step2, confidence-scoring, naics, psc, scope-truncation]

requires:
  - phase: 08-03
    provides: /parse response with overallConfidence, fields, flags, scope_truncated, scope_full

provides:
  - Confidence badge at top of step 2 with color-coded percentage (green/yellow/red tiers)
  - Flagged field inline display: red border + confidence % + issue text below each flagged input
  - Scope truncation banner with View full text / Collapse full text toggle
  - NAICS code blur validation (5-6 digits) with inline error
  - PSC code blur validation (4 alphanumeric chars) with inline error
  - window.S.confidence, window.S.sourceType, window.S.sourceFile set after parse for Plan 05

affects:
  - 08-05 (PDF viewer panel reads window.S.sourceType; scrollPdfToBoundingBox hook ready)

tech-stack:
  added: []
  patterns:
    - "confidence badge uses existing .mbadge.ai / .mbadge.rules CSS with inline override for <70% (red)"
    - "flaggedFields lookup built from conf.fields array filtered to status=flagged"
    - "data-bbox attribute on flagged inputs; scrollPdfToBoundingBox graceful no-op for Plan 05"
    - "addBlurValidation() helper: removes previous error, re-validates on blur, skips empty fields"
    - "SCOPE_MAX_DISPLAY constant defined at module top; char-count updated via event listener"

key-files:
  created: []
  modified:
    - electron/index.html
    - electron/js/modules/step1.js
    - electron/js/modules/step2.js

key-decisions:
  - "Source file name derived from window.S.file.name or window.S.filePath in step1.js — no local file variable available in doParse() scope"
  - "Blur validation re-removes previous .field-error-msg before re-checking — handles multiple blur events cleanly"
  - "confBadgeHtml not rendered when overallConfidence is null/undefined — graceful no-op if backend returns no confidence data"
  - "SCOPE_MAX_DISPLAY = '3,000' (string with comma) used for display; matches the Python SCOPE_MAX = 3000 value"

requirements-completed: [DATA-01, DATA-04d, DATA-05]

duration: 8min
completed: 2026-03-24
---

# Phase 8 Plan 4: Step 2 Confidence UI Summary

**Confidence badge, flagged field inline display, scope truncation banner with expand/collapse, and NAICS/PSC blur validation added to step 2 using token-based CSS and existing mbadge/alert patterns**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-03-24T03:00:00Z
- **Completed:** 2026-03-24T03:08:00Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments

- Added five new CSS classes to index.html: `.confidence-badge`, `.scope-full-text`, `.field-confidence`, `.conf-pct`, `.conf-issue` — all using existing CSS token variables, no new hex values
- Added `window.S.confidence` (overallConfidence, fields, flags), `window.S.sourceType` (pdf/docx/txt), and `window.S.sourceFile` to step1.js after the `/parse` response is processed
- Rewrote step2.js to render: confidence badge with three color tiers (>=95 AI green, 70-94 rules yellow-green, <70 error red inline style); flagged field indicators with `.invalid` class and `.field-confidence` block below each flagged input; scope truncation banner with View full text / Collapse full text toggle; `data-bbox` attribute on flagged inputs for Plan 05 PDF viewer; `addBlurValidation()` helper wired to NAICS and PSC inputs; graceful `scrollPdfToBoundingBox` no-op hook for Plan 05
- Removed `maxlength="2000"` from scope textarea per RESEARCH Pattern 2 (frontend should not re-truncate)

## Task Commits

1. **Task 1: Add CSS classes for confidence UI to index.html** - `23b6ca2` (feat)
2. **Task 2: Store confidence data on window.S after parse** - `1b5f84a` (feat)
3. **Task 3: Render confidence badge, flagged fields, scope banner, NAICS/PSC validation in step2.js** - `dd39374` (feat)

## Files Created/Modified

- `electron/index.html` — Added 5 new CSS classes after `.field-error-msg` block (lines 269-280 area)
- `electron/js/modules/step1.js` — Added window.S.confidence, window.S.sourceType, window.S.sourceFile assignments after line 122 (window.S.extracted = data.data)
- `electron/js/modules/step2.js` — Added SCOPE_MAX_DISPLAY constant; confidence badge with tiers; flaggedFields lookup; updated items map with invalidClass and flagHtml; scopeBanner and scopeFullBlock; removed maxlength; scope expand/collapse event wiring; addBlurValidation() for NAICS and PSC; data-bbox click handler for Plan 05

## Decisions Made

- Source type derived from window.S.file.name or window.S.filePath — the doParse() function has no local `file` variable; window.S state is the correct access point
- Blur validation clears previous `.field-error-msg` before re-adding — avoids error message duplication on repeated blur events
- Confidence badge not rendered (empty string) when overallConfidence is null/undefined — matches the "no confidence data" empty state per UI-SPEC Copywriting Contract
- `SCOPE_MAX_DISPLAY = '3,000'` (with comma) used throughout for user-facing char count display

## Deviations from Plan

None — plan executed exactly as written. All acceptance criteria met verbatim.

## Known Stubs

None — all confidence UI reads live data from window.S.confidence which is populated from the /parse backend response. No hardcoded or mock data flows to the rendered output.

## Self-Check: PASSED

- `electron/index.html` — exists, contains `.confidence-badge{display:flex`, `.scope-full-text{background:var(--color-surface-raised)`, `.field-confidence{display:flex`, `.conf-pct{color:var(--color-error)`, `.conf-issue{color:var(--color-text-muted)`
- `electron/js/modules/step1.js` — exists, contains `window.S.confidence`, `window.S.sourceType`, `window.S.sourceFile`, `overallConfidence`
- `electron/js/modules/step2.js` — exists, contains `confBadgeHtml`, `flaggedFields`, `scope-trunc-banner`, `addBlurValidation`, `scrollPdfToBoundingBox`, no `maxlength="2000"`
- Commit `23b6ca2` — verified via git log
- Commit `1b5f84a` — verified via git log
- Commit `dd39374` — verified via git log

---
*Phase: 08-data-quality-extraction-trust-layer*
*Completed: 2026-03-24*
