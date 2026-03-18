# Roadmap: Solicitation Quoter

## Overview

This roadmap elevates an existing, working Electron + Python desktop app to production quality. The app already delivers its core value (upload solicitation → get quote). These nine phases address active security vulnerabilities first, then restructure the code for maintainability, then build a consistent design system, then layer in user feedback (error and loading states), fix data quality bugs, and finally harden the runtime configuration. Each phase leaves the app in a fully working state — no regressions, no broken windows.

## Phases

- [ ] **Phase 1: Security Hardening** - Eliminate API key exposure, validate uploads, guarantee temp file cleanup, and surface encryption warnings
- [ ] **Phase 2: Frontend Modularization** - Break the 2100-line index.html into per-step JS modules with no inline event handlers
- [ ] **Phase 3: Backend Structure** - Separate Flask route controllers from extraction/generation logic; centralize constants
- [ ] **Phase 4: CSS Design Tokens** - Establish color, spacing, and typography token system with consistent application throughout
- [ ] **Phase 5: Interactive States & Theming** - Consistent hover/focus/active states, button variants, and scoped theme tokens
- [ ] **Phase 6: Error States** - Actionable error messages for parse failures, quote generation, SAM.gov lookups, startup, and form validation
- [ ] **Phase 7: Loading & Progress Feedback** - Progress indicators and disabled-button guards for all async operations
- [ ] **Phase 8: Data Quality & Extraction Trust Layer** - Scope truncation warnings, SAM.gov field mapping, CSV validation, full extraction confidence scoring system (global + per-field scores, structured flag output, zoom-to-region UI), and NAICS/PSC format validation
- [ ] **Phase 9: Reliability & Config** - Configurable port, zombie-process prevention, upload timeout, and production app ID

## Phase Details

### Phase 1: Security Hardening
**Goal**: The app never exposes the API key from the frontend, validates all uploads, cleans up sensitive temp files reliably, and warns the user when encryption is unavailable
**Depends on**: Nothing (first phase)
**Requirements**: SEC-01, SEC-02, SEC-03, SEC-04, SEC-05
**Success Criteria** (what must be TRUE):
  1. Opening DevTools and inspecting the `/parse` network request shows no API key in the form data — the key is read server-side only
  2. Uploading a renamed `.exe` or oversized file produces a specific rejection error, not a crash
  3. Killing the backend process mid-parse leaves no orphaned temp files on disk after app restarts
  4. On a system where safeStorage encryption is unavailable, a visible warning appears before the key can be saved
**Plans**: 4 plans

Plans:
- [ ] 01-01-PLAN.md — pytest test scaffold (RED tests for SEC-01 through SEC-04)
- [ ] 01-02-PLAN.md — Python backend: remove api_key from form, magic byte validation, 50MB limit, temp file tracking
- [ ] 01-03-PLAN.md — Electron main: env-inject API key at spawn, remove plaintext fallback, backend restart on key change
- [ ] 01-04-PLAN.md — Renderer: remove api_key from /parse, encryption warning banner, reconnect UX + human verification

### Phase 2: Frontend Modularization
**Goal**: The JavaScript in index.html is replaced by separate per-step modules loaded as script files, with all event wiring done via addEventListener — no inline handlers
**Depends on**: Phase 1
**Requirements**: ARCH-01, ARCH-02, ARCH-03
**Success Criteria** (what must be TRUE):
  1. The file `electron/index.html` contains no `<script>` block with wizard logic — JS lives in separate .js files
  2. A grep for `onclick=` or `onchange=` inline attributes in HTML returns zero results
  3. Shared utilities (API calls, formatting helpers) exist in one dedicated module imported by the step modules
  4. The full 5-step wizard workflow completes without regression after the split
**Plans**: 5 plans

Plans:
- [ ] 02-01-PLAN.md — test scaffold (RED) + state.js + shared/utils.js + shared/theme.js
- [ ] 02-02-PLAN.md — step1.js (upload/parse) + step2.js (review extracted data)
- [ ] 02-03-PLAN.md — step3.js (vendor info + line items, event delegation)
- [ ] 02-04-PLAN.md — step4.js (generate/export) + index.js bootstrapper + index.html rewire
- [ ] 02-05-PLAN.md — human verification checkpoint (full wizard smoke test)

### Phase 3: Backend Structure
**Goal**: Flask route handlers in server.py are thin controllers — extraction and generation logic lives in separate modules; constants are defined once and imported throughout
**Depends on**: Phase 2
**Requirements**: ARCH-04, ARCH-05
**Success Criteria** (what must be TRUE):
  1. `python/server.py` route functions contain no extraction regex or document-generation code — they delegate to imported modules
  2. Port number, max file size, and field name constants appear in exactly one source file and are imported everywhere else
  3. Running the app after the refactor produces identical extraction and quote output to pre-refactor (no behavioral regression)
**Plans**: TBD

### Phase 4: CSS Design Tokens
**Goal**: All colors, spacing values, and type sizes in the stylesheet are defined as CSS custom properties — no hardcoded pixel values or color literals scattered through the CSS
**Depends on**: Phase 3
**Requirements**: UI-01, UI-02, UI-03
**Success Criteria** (what must be TRUE):
  1. A grep for hardcoded hex colors or rgb() literals in index.html CSS returns zero results outside of the `:root` token block
  2. A defined spacing scale (e.g., --space-xs through --space-xl) is applied throughout — no arbitrary pixel values like `margin: 13px`
  3. Heading, subheading, body, and label text sizes use named typography tokens consistently across all five wizard steps
**Plans**: TBD

### Phase 5: Interactive States & Theming
**Goal**: Every interactive element has consistent hover, focus, and active states; button variants are uniform across all wizard steps; dark/light theme tokens are fully scoped with no overrides
**Depends on**: Phase 4
**Requirements**: UI-04, UI-05, UI-06
**Success Criteria** (what must be TRUE):
  1. Tabbing through the wizard with keyboard shows a visible focus ring on every interactive element (button, input, select, link)
  2. Primary, secondary, and danger buttons look identical in each of the five wizard steps — no step has a one-off button style
  3. Switching between dark and light themes shows no elements with hardcoded colors that override the theme (no "theme leak" where a field stays white in dark mode)
**Plans**: TBD

### Phase 6: Error States
**Goal**: Every failure path in the wizard surfaces a specific, actionable message that tells the user what went wrong and what to do next
**Depends on**: Phase 5
**Requirements**: ERR-01, ERR-02, ERR-03, ERR-04, ERR-05
**Success Criteria** (what must be TRUE):
  1. Uploading a corrupted PDF shows a message naming the failure (e.g., "Could not extract text from PDF") rather than a generic "error occurred"
  2. Quote generation failure shows the reason and a "Try again" button — the user does not need to restart the wizard
  3. A SAM.gov lookup that fails shows a clear message and automatically activates the manual entry fields
  4. Launching the app when the Python backend fails to start shows an error page explaining the issue — not a blank screen
  5. Clicking "Next" on a wizard step with unfilled required fields highlights those fields inline — the user does not advance to the next step
**Plans**: TBD

### Phase 7: Loading & Progress Feedback
**Goal**: Every async operation in the wizard shows a progress indicator with a current-operation label, and interactive controls are disabled while the operation is in flight
**Depends on**: Phase 6
**Requirements**: LOAD-01, LOAD-02, LOAD-03, LOAD-04
**Success Criteria** (what must be TRUE):
  1. Uploading a document shows a spinner with a label (e.g., "Extracting solicitation data...") that is visible for the duration of the parse request
  2. Clicking "Generate Quote" shows a progress indicator for the full duration of document generation
  3. Triggering a SAM.gov lookup shows a spinner adjacent to the lookup button while the request is in flight
  4. All action buttons (parse, generate, lookup) are visually disabled and non-clickable while their respective operations are running — a second click does nothing
**Plans**: TBD

### Phase 8: Data Quality & Extraction Trust Layer
**Goal**: Scope truncation is surfaced; SAM.gov mapping is fixed; CSV import validates headers; a modular extraction validation system computes a global accuracy score (0–100%) and per-field confidence scores with structured flag output, auto-approval thresholds, and a UI that shows overall accuracy and lets the operator click a flagged field to zoom to its location in the source PDF; NAICS/PSC codes are format-validated
**Depends on**: Phase 7
**Requirements**: DATA-01, DATA-02, DATA-03, DATA-04a, DATA-04b, DATA-04c, DATA-04d, DATA-05
**Success Criteria** (what must be TRUE):
  1. Uploading a solicitation with a scope of work longer than 2000 characters shows a visible warning ("Scope truncated") with a button to view the full text
  2. A SAM.gov lookup that returns `responseDeadLine` and other API-native field names populates the correct fields in the review step — no "null" values for fields that exist in the response
  3. Importing a CSV file with missing or mismatched column headers shows a specific error naming the bad column — not a silent partial import
  4. The `/parse` response includes `overallConfidence` (0–100 integer) and a `fields` array where each entry has `name`, `value`, `confidence`, `status` ("ok" or "flagged"), `issue` (string or null), and `boundingBox` (coordinates or null for non-PDF sources); a `flags` array lists all fields below threshold with type and message
  5. The review step displays the overall accuracy score (e.g., "92% confidence") at the top; flagged fields are visually distinguished with their confidence percentage and issue; clicking a flagged field scrolls the embedded PDF view to that field's bounding box region where coordinates are available
  6. A parse that returns `overallConfidence ≥ 95` advances without any review prompts; a parse below threshold highlights the review panel automatically
  7. Typing a 3-digit value in the NAICS or PSC code field shows an inline format error before the user can proceed
**Plans**: TBD

### Phase 9: Reliability & Config
**Goal**: Port is configurable via environment variable throughout the stack, the Windows zombie-process bug is closed, uploads time out cleanly, and the app ID is set to its production value
**Depends on**: Phase 8
**Requirements**: REL-01, REL-02, REL-03, REL-04
**Success Criteria** (what must be TRUE):
  1. Starting the app with `PORT=5200 npm start` binds the backend to 5200 and the renderer connects successfully — no hardcoded 5199 references remain in the active code paths
  2. Force-killing Electron on Windows (via Task Manager) does not leave a Python process running on the port, verified by attempting to relaunch the app immediately
  3. Uploading a document where parsing takes more than 30 seconds returns a timeout error to the UI — the request does not hang indefinitely
  4. The packaged app's About dialog and installer metadata show a production app ID — the string "yourcompany" appears nowhere in the built artifact
**Plans**: TBD

## Progress

**Execution Order:** 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Security Hardening | 0/TBD | Not started | - |
| 2. Frontend Modularization | 3/5 | In Progress|  |
| 3. Backend Structure | 0/TBD | Not started | - |
| 4. CSS Design Tokens | 0/TBD | Not started | - |
| 5. Interactive States & Theming | 0/TBD | Not started | - |
| 6. Error States | 0/TBD | Not started | - |
| 7. Loading & Progress Feedback | 0/TBD | Not started | - |
| 8. Data Quality | 0/TBD | Not started | - |
| 9. Reliability & Config | 0/TBD | Not started | - |
