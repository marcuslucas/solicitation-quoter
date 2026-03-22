# Phase 6: Error States - Context

**Gathered:** 2026-03-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Every failure path in the wizard surfaces a specific, actionable message that tells the user what went wrong and what to do next. This covers: parse failures (ERR-01), quote generation failures (ERR-02), SAM.gov lookup failures (ERR-03), backend startup failure (ERR-04), and form validation before step transitions (ERR-05).

ERR-04 is substantially met by the existing `electron/error.html` (loads on startup failure, has message + retry button). Phase 6 may update its styling to use the token system but does not need to build it from scratch.

Requirements in scope: ERR-01, ERR-02, ERR-03, ERR-04, ERR-05

</domain>

<decisions>
## Implementation Decisions

### Parse Error Specificity (ERR-01)
- **D-01:** Distinct error messages per failure scenario — no single generic "Extraction failed" handler
- **D-02:** Three specific cases at minimum:
  - Corrupted PDF → message names the failure specifically (e.g., "Could not read PDF — file may be corrupted or password-protected")
  - Empty document → "Document appears empty — no text could be extracted"
  - Backend timeout → "Extraction timed out — try a smaller file or check your connection"
- **D-03:** Errors are displayed inline in the `parse-err` div using `alert-error` class (existing pattern — keep it)
- **D-04:** Backend already returns specific error strings via `data.error`; frontend must surface them without truncation or wrapping in generic messages

### Quote Generation Retry (ERR-02)
- **D-05:** On generation failure, show an explicit **"Try Again"** button alongside the specific failure message — re-enabling the generate button silently is not sufficient
- **D-06:** The error state shows: (a) the specific failure reason from the backend, (b) a "Try Again" button using the danger/secondary variant that re-triggers generation
- **D-07:** Failure message is shown in the `gen-err` div (existing pattern — keep it), with "Try Again" button appended inside the error element

### SAM.gov Failure & doSamLookup Implementation (ERR-03)
- **D-08:** `window.doSamLookup` is currently **not defined** anywhere — this is a bug. Phase 6 must implement this function (wire it to the `/sam_lookup` backend route)
- **D-09:** When lookup **fails**: close the SAM modal, show the error message above the manual entry fields in step 2, and auto-focus the first manual entry field — manual entry is the recovery path, not a retry loop in the modal
- **D-10:** When lookup **succeeds**: close the modal, populate the step 2 fields with the returned data (same behavior as the existing modal structure suggests)
- **D-11:** The backend already returns specific SAM.gov error messages per scenario (invalid key → 400, timeout → 504, unreachable → 503, unexpected response → 502) — surface these messages verbatim in the step 2 error area

### Form Validation Gates (ERR-05)
- **D-12:** Fields marked required (label contains `*`) block the **Next** button until filled — no silent advancement
- **D-13:** Validation highlights the specific empty/invalid field inline — **not** a generic "please fill required fields" banner at the top
- **D-14:** Inline highlight pattern: add a `field-error` state to the specific input (red border using `--color-error` token) + a small error message directly below that input
- **D-15:** At minimum, Company Name (step 3, marked `*`) is required before advancing to step 4
- **D-16:** At least **one line item** (with description populated) is required before advancing to step 5 (generate)
- **D-17:** Step 2 (solicitation data review) — no required fields enforced; all fields are extracted and optional edits. Advancing from step 2 is always allowed.

### ERR-04 — Backend Startup Error (already implemented)
- **D-18:** `electron/error.html` already loads on backend startup failure with a message and "Retry" button — this satisfies the ERR-04 success criterion
- **D-19:** Update error.html to use the CSS token system (currently uses hardcoded hex `#0F1923`, `#E74C3C`, etc.) — minor cleanup only, no behavioral change

### Error UI Standards (all errors)
- **D-20:** All error display uses the Phase 4 token system: `alert-error` class, `--color-error`, `--color-danger` tokens
- **D-21:** "Try Again" / action buttons in error states use the `btn-danger` or `btn-secondary` variant — no unstyled buttons
- **D-22:** Error messages are escaped via `window.esc()` before insertion into innerHTML (existing security pattern — maintain it)

### Claude's Discretion
- Which step 2 fields (if any) gain optional validation hints (non-blocking warnings vs. nothing)
- Whether the SAM.gov error shown in step 2 uses a toast or an inline alert above the solicitation fields
- Exact positioning of inline field-error messages (below input vs. inside input container)
- Whether "Try Again" in quote generation also clears the previous error before re-running

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing error infrastructure
- `electron/js/modules/step1.js` — `parse-err` div, `showFileError()`, existing catch block pattern
- `electron/js/modules/step4.js` — `gen-err` div, generation catch block, button disable/enable pattern
- `electron/js/modules/index.js` — SAM modal wiring (`sam-btn` → `window.doSamLookup`), `openSamModal()`, `closeSamModal()`
- `electron/index.html` lines 567–585 — SAM modal HTML (`sam-prog`, `sam-err`, `sam-ok`, `sam-btn`)
- `electron/js/modules/shared/utils.js` — `toast()`, `next()`, `goTo()` — `next()` currently has no validation
- `electron/error.html` — existing backend startup error page (needs token system update only)

### Backend error messages
- `python/server.py` lines 160–235 — `/sam_lookup` route with specific error strings per scenario
- `python/server.py` `/parse` route — `data.error` field returned on extraction failures

### Token system & UI patterns
- `electron/index.html` `:root` block — `--color-error`, `--color-danger` tokens
- `.planning/REQUIREMENTS.md` §Error States — ERR-01 through ERR-05 acceptance criteria

No external specs — requirements fully captured in decisions above and REQUIREMENTS.md.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `alert alert-error` class: Already styled with `--color-error` token — use for all inline error display
- `toast(msg, type, duration)`: Available globally via `window.toast` — use for transient notifications only; persistent errors go in dedicated error divs
- `window.esc(str)`: XSS-safe HTML escaping — required for all user-facing error content
- `parse-err` / `gen-err` divs: Already exist in step 1 and step 4 render output — extend this pattern to new error states

### Established Patterns
- Error divs start hidden (`class="hidden"`), shown on failure — keep this pattern
- Button disable during async ops: `btn.disabled = true` on start, re-enable in finally/catch — already used in step1 and step4
- Event delegation: all new event listeners via `addEventListener`, no inline `onclick`

### Integration Points
- `next()` in utils.js: Currently calls `goTo(S.step + 1)` with no validation — ERR-05 requires validation to be added here or in a per-step validation hook before `next()` calls
- SAM modal: `openSamModal()` / `closeSamModal()` in index.js — `doSamLookup` must be defined and exposed as `window.doSamLookup` before `wireStaticHandlers()` runs
- Step 3 render: Company Name input has `*` in label at line ~361 — validation targets this field

### Bug to Fix
- `window.doSamLookup` referenced in `wireStaticHandlers()` (index.js:392) but never defined — SAM modal "Fetch" button currently does nothing

</code_context>

<specifics>
## Specific Ideas

- "Try Again" button for quote generation should appear inside the `gen-err` div alongside the failure message — user should not need to scroll up to find the generate button
- SAM.gov error recovery: after closing modal on failure, show the specific backend error message (e.g., "Invalid or expired SAM.gov API key") as an inline alert above the step 2 manual fields, then auto-focus the solicitation number input
- Inline field validation: add `.field-error` CSS class that adds `border-color: var(--color-error)` and shows a `<span class="field-error-msg">` below the input — mirrors common form patterns, fits existing token system

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 06-error-states*
*Context gathered: 2026-03-22*
