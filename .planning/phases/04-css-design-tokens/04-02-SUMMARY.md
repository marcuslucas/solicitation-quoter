---
phase: 04-css-design-tokens
plan: 02
subsystem: ui/theming
tags: [css, design-tokens, theming, tokenization]
dependency_graph:
  requires: [04-01]
  provides: [fully-tokenized-theme-overrides, color-info-token]
  affects: [electron/index.html, electron/js/modules/shared/theme.js, electron/js/modules/index.js, electron/js/modules/step1.js]
tech_stack:
  added: []
  patterns: [css-custom-properties, class-based-alert-styling]
key_files:
  created: []
  modified:
    - electron/index.html
    - electron/js/modules/shared/theme.js
    - electron/js/modules/index.js
    - electron/js/modules/step1.js
decisions:
  - key: Add --color-info token rather than keep hardcoded blues
    rationale: "#0050A0 (iron), #7a6040 (voss), #64ACFF (prism-dark) are theme-specific info/alert colors not representable by any existing token — adding --color-info is cleaner than leaving raw hex in theme overrides"
  - key: Use alert/alert-warn class for encryption banner instead of inline styles
    rationale: "Class-based approach gets theming for free; inline styles with hardcoded hex bypass the token system entirely"
metrics:
  duration: 5 min
  completed_date: "2026-03-22"
  tasks_completed: 2
  files_modified: 4
---

# Phase 04 Plan 02: Theme Override Tokenization Summary

All hardcoded hex color values in theme override CSS blocks replaced with `var(--color-*)` token references. JS inline styles fixed to use CSS classes or token variables. Zero raw hex values remain in the theme override section of `electron/index.html`.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Replace hardcoded hex colors in theme override blocks | 41f0c51 | electron/index.html, electron/js/modules/shared/theme.js |
| 2 | Replace hardcoded colors in JS inline styles | 83446ad | electron/js/modules/index.js, electron/js/modules/step1.js |

## What Was Built

**Task 1 — Theme override tokenization:**
- Added `--color-info: #00FF41` to `:root` in index.html
- Added `'--color-info'` to all 9 theme objects in theme.js with theme-appropriate values:
  - specter: `#00FF41`, phantom: `#00D4FF`, sector: `#C8AB32`, forge: `#E85A1A`, wraith: `#5B8AB8`
  - iron: `#0050A0`, voss: `#7a6040`, prism: `#0050A0`, prism-dark: `#64ACFF`
- Iron block: `#fff` -> `var(--color-contrast-light)` (btn-primary, btn-success, btn-danger, nav-item.done .step-num); `#0050A0` -> `var(--color-info)`
- Voss block: `#faf8f4` -> `var(--color-background)` (step-num color); `#1a1916` -> `var(--color-text)` (btn-primary bg); `#7a6040` -> `var(--color-info)`
- Prism block: `#FFFFFF` -> `var(--color-surface)`, `#C6C6C8` -> `var(--color-border)`, `#E5E5EA` -> `var(--color-header)`, `#F2F2F7` -> `var(--color-background)`, `#fff` -> `var(--color-contrast-light)`, `#0050A0` -> `var(--color-info)`
- Prism-dark block: `#1C1C1E` -> `var(--color-surface)`, `#2C2C2E` -> `var(--color-surface-raised)`, `#3A3A3C` -> `var(--color-border)`, `#fff` -> `var(--color-contrast-light)`, `#64ACFF` -> `var(--color-info)`

**Task 2 — JS inline style cleanup:**
- `electron/js/modules/index.js`: encryption-warning banner replaced `background:#fff3cd;color:#856404;border:1px solid #ffc107` inline style with `banner.className = 'alert alert-warn'` class assignment
- `electron/js/modules/step1.js`: `var(--green)` (legacy token) replaced with `var(--color-success)`

## Decisions Made

**1. Add --color-info token system-wide**
The `.alert-info` color value differs per theme (iron blue, voss warm brown, prism-dark bright blue) and doesn't map to any existing token. Rather than keeping raw hex values in the override blocks, a `--color-info` token was added to `:root` and all 9 themes. Each theme's info color matches the thematic aesthetic while keeping the CSS blocks hex-free.

**2. alert-warn class over inline styles for encryption banner**
The encryption warning banner previously used `background:#fff3cd;color:#856404;border:1px solid #ffc107` inline styles — bootstrap-style yellow that doesn't respond to theme tokens. Switching to `class="alert alert-warn"` lets the existing alert-warn CSS handle colors via `var(--color-success)` / rgba tint, giving the banner proper theming across all 9 themes for free.

## Deviations from Plan

None — plan executed exactly as written.

## Verification Results

```
Remaining raw hex in theme overrides: 0
PASS

No hardcoded banner colors: PASS
alert-warn class present: line 78
No --green refs: PASS
color-success in step1: line 198
```

## Self-Check: PASSED

- electron/index.html: modified (confirmed via verification script)
- electron/js/modules/shared/theme.js: modified (9 --color-info entries confirmed)
- electron/js/modules/index.js: modified (alert-warn class confirmed)
- electron/js/modules/step1.js: modified (var(--color-success) confirmed)
- Commit 41f0c51: exists
- Commit 83446ad: exists
