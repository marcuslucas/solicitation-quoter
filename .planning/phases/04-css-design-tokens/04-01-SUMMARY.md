---
phase: 04-css-design-tokens
plan: "01"
subsystem: ui
tags: [css, design-tokens, typography, spacing, color]

# Dependency graph
requires: []
provides:
  - "Extended :root token block with --space-2xl, --space-3xl, and 11 semantic typography tokens"
  - "Zero raw hex colors in base CSS (lines 68-268)"
  - "Zero raw spacing px values in base CSS (except justified exceptions)"
  - "--color-contrast-dark and --color-contrast-light tokens for absolute contrast colors"
affects:
  - "04-02 (theme override tokenization uses these same tokens)"
  - "04-03 (interactive states build on these spacing/typography tokens)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Semantic typography role tokens (--text-heading-*, --text-subheading-*, --text-body-*, --text-label-*) reference scale tokens as values"
    - "Contrast tokens (--color-contrast-dark/light) for absolute black/white on colored backgrounds"
    - "Spacing exceptions: micro-adjustments (1-3px), structural constants (sidebar width, heights), letter-spacing values, shadow offsets, tight cell padding"

key-files:
  created: []
  modified:
    - "electron/index.html"

key-decisions:
  - "Used individual property tokens (--text-heading-size, --text-heading-weight, --text-heading-lh) instead of CSS font shorthand — shorthand resets unset sub-properties which would break theme font-family overrides"
  - "Added --color-contrast-dark/#000 and --color-contrast-light/#fff tokens so btn-primary/btn-success/step-num colors use var() rather than raw hex"
  - "Kept rgba() transparent color patterns (alert backgrounds, badge tints, table hovers) as acceptable exceptions — CSS custom properties cannot do alpha manipulation without color-mix() which has limited Electron/Chromium support"
  - "Kept px values for letter-spacing, scrollbar dimensions, border-radius on step-num (5px), font-size 9px/12px between scale steps, box-shadow offsets — these are non-semantic structural or visual values"

patterns-established:
  - "Semantic role pattern: card-title, label, data-label all use --text-label-size/weight; topbar-title and dz-title use --text-heading-size/weight; modal h2 uses --text-subheading-size"
  - "Base CSS is now the single source of truth for token application; theme overrides only modify token values via :root overrides, not re-specify hex colors in rule blocks"

requirements-completed: [UI-01, UI-02, UI-03]

# Metrics
duration: 4min
completed: 2026-03-22
---

# Phase 04 Plan 01: CSS Token Extension and Base CSS Tokenization Summary

**Semantic typography tokens (heading/subheading/body/label roles) added to :root, all hardcoded hex colors and raw spacing px values in base CSS replaced with --color-* and --space-* token references**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-22T16:57:23Z
- **Completed:** 2026-03-22T16:58:10Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments

- Added 13 new tokens to `:root`: --space-2xl, --space-3xl, 8 semantic typography tokens, and --color-contrast-dark/light
- Reduced raw hex colors in base CSS (lines 68-268) to zero — all replaced with var(--color-*) tokens
- Replaced all raw spacing px values in base CSS margin/padding/gap contexts with --space-* tokens
- Applied semantic typography roles to 6 element classes: topbar-title, dz-title, card-title, label, data-label, modal h2

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend :root token block** - `1fa78aa` (feat)
2. **Task 2: Replace all hardcoded values in base CSS** - `62762cc` (feat)

## Files Created/Modified

- `electron/index.html` - Extended :root and tokenized all base CSS spacing, color, and typography values

## Decisions Made

- Individual property tokens chosen over CSS `font:` shorthand — shorthand resets unspecified sub-properties (font-family) causing theme font overrides to break
- `--color-contrast-dark` and `--color-contrast-light` added to give btn-primary, btn-success, and step-num active/done states token references for their intentional absolute black/white colors
- `rgba()` transparent tints kept as-is in alert, badge, and table hover rules — `color-mix()` for alpha manipulation is not reliably supported in Electron's Chromium build

## Deviations from Plan

None - plan executed exactly as written. The --color-contrast-dark/light tokens were described in the plan action and added as specified.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 02 can now tokenize theme override blocks — the :root tokens are established and any [data-theme="X"] block can safely reference var(--color-*) tokens
- Plan 03 can verify interactive states build correctly on the tokenized spacing and color system
- Justified exceptions (rgba tints, letter-spacing values, structural constants) are documented in key-decisions above for Plan 02/03 reference

---
*Phase: 04-css-design-tokens*
*Completed: 2026-03-22*
