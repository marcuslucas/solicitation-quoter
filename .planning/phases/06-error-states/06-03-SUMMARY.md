---
phase: 06-error-states
plan: "03"
subsystem: frontend-validation
tags: [validation, ux, error-states, wizard]
dependency_graph:
  requires: [06-01, 06-02]
  provides: [step-validation-gate, field-error-display]
  affects: [electron/js/modules/shared/utils.js, electron/js/modules/step3.js, electron/index.html]
tech_stack:
  added: []
  patterns: [validation-hook-pattern, field-error-msg-pattern, window-validateStepN-convention]
key_files:
  created: []
  modified:
    - electron/index.html
    - electron/js/modules/shared/utils.js
    - electron/js/modules/step3.js
decisions:
  - "window.validateStepN convention: next() looks up window['validateStep' + S.step] dynamically — each step module self-registers its validator, zero coupling to utils.js"
  - "field-error-msg span appended to input.parentElement — matches .field div structure so message always appears directly below its input"
  - "Line items validation fires on change (not input) to match existing delegation pattern in wireLineItemDelegation()"
metrics:
  duration_minutes: 2
  completed_date: "2026-03-22"
  tasks_completed: 2
  files_changed: 3
requirements_satisfied: [ERR-05]
---

# Phase 6 Plan 3: Step Validation Gates Summary

Inline form validation gates prevent advancing past step 3 with unfilled required fields. Company Name and at least one described line item are enforced before the wizard can proceed to step 4. Step 2 advances freely per D-17.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add field-error CSS class to index.html | 49cf370 | electron/index.html |
| 2 | Add validation hook in next() and implement step 3 validation | 42d958b | electron/js/modules/shared/utils.js, electron/js/modules/step3.js |

## What Was Built

**CSS (index.html):**
- `.field-error-msg` — `display:block` span for inline error text below invalid inputs, styled with `--color-error`
- `@keyframes field-shake` — 300ms horizontal shake animation for tactile feedback
- `.field-shake` — applies the shake animation to invalid inputs

**utils.js — next() validation hook:**
- `next()` now looks up `window['validateStep' + S.step]` before advancing
- If a validator function is registered for the current step and returns `false`, navigation is blocked
- Steps without validators (steps 1, 2, 4) advance freely

**step3.js — validateStep3:**
- `clearFieldErrors()` — removes all `.invalid` + `.field-shake` classes and `.field-error-msg` spans
- `markFieldError(input, message)` — adds `invalid` + `field-shake` classes, creates and appends error `span.field-error-msg` below the input, removes shake class after animation ends
- `validateStep3()` — validates company_name (required) and items array (at least one non-empty description); focuses + scrolls to first invalid field on failure
- Vendor form `input` handler extended to clear error state when user types in a flagged field
- Line items `change` handler extended to clear error state when user edits a flagged description input
- `window.validateStep3 = validateStep3` registered globally for hook discovery by `next()`

## Verification

- `grep -c "field-error-msg" electron/index.html` → 1
- `grep -c "field-shake" electron/index.html` → 2
- `grep -c "validateStep" electron/js/modules/shared/utils.js` → 2 (function next + lookup)
- `grep -c "validateStep3" electron/js/modules/step3.js` → 2 (definition + window export)
- `grep -c "window.validateStep3" electron/js/modules/step3.js` → 1

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None.

## Self-Check: PASSED

All files modified confirmed present. Commits 49cf370 and 42d958b verified in git log.
