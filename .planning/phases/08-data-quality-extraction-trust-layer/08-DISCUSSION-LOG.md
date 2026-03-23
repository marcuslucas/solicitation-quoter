# Phase 8: Data Quality & Extraction Trust Layer — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-23
**Phase:** 08 — Data Quality & Extraction Trust Layer

---

## Areas Selected

All four gray areas selected for discussion (user selected all).

---

## Area 1: PDF Zoom-to-Region

**Question:** DATA-04d requires clicking a flagged field to scroll to its location in the source PDF — but step 2 has no PDF viewer yet. Do we embed one? Degrade gracefully? How prominent?

**Options presented:**
- Embed PDF.js viewer in step 2 (new UI surface required)
- Show a page number only, no embedded viewer
- Skip the zoom-to-region feature, flag as deferred
- Degrade gracefully without a viewer (just highlight the field)

**Selected:** Embed PDF.js as a collapsible panel, initially collapsed

**Decision captured:**
- PDF.js viewer embedded in step 2 as a collapsible panel, initially collapsed (not full-width, secondary to field review UI)
- Click flagged field with boundingBox → panel expands and scrolls to coordinates using PDF.js page coordinates from pdfplumber
- Graceful degradation: no boundingBox → click does nothing, no error shown
- Panel not rendered at all for non-PDF uploads (TXT, DOCX sources)
- PDF.js loaded from local app bundle (not CDN — Electron is offline + security concern)

---

## Area 2: Confidence Score Display

**Question:** Where does the accuracy score live in step 2? Inline badge per field vs. summary panel at top vs. collapsible audit section?

**Options presented:**
- Prominent badge at top of step 2 + inline flagged field indicators
- Separate collapsible audit section (click to expand)
- Inline only — no top-level badge, each field shows its own confidence
- Modal/overlay when review is needed

**Selected:** Prominent badge at top + inline flagged field indicators (no separate section)

**Decision captured:**
- Overall accuracy score as prominent badge at top of step 2 review panel (e.g., "92% Confidence")
- Flagged fields shown inline with confidence % and issue text adjacent to the field (no extra clicks required)
- No separate audit panel or section
- Use Phase 4/5 CSS token system throughout — no new hardcoded colors
- Badge color: success token (≥95), warning token (70–94), error token (<70)

---

## Area 3: Scope Truncation UX

**Question:** Where does the truncation warning appear, and how does "view full text" work?

**Options presented:**
- Inline banner above textarea in step 2, expand-in-place below
- Toast/snackbar notification after parse completes
- Modal dialog with full text
- Callout in step 1 success area before user reaches step 2

**Selected:** Inline banner above textarea, expand-in-place below (no modal)

**Decision captured:**
- Warning banner directly above the scope_of_work textarea: "Scope truncated at 2000 characters"
- "View full text" expands in-place below the textarea — not a modal (modal adds unnecessary interaction cost for read-only reference)
- Expansion shows full un-truncated text in a styled read-only block; collapsible after reading
- Backend must include `scope_truncated: true` in `/parse` response to trigger the warning

---

## Area 4: CSV Header Validation

**Question:** Should we validate exact column headers, show a column-mapping UI, or just improve error messages?

**Options presented:**
- Validate exact expected headers with specific error messages
- Show a column-mapping UI (drag columns to match)
- Validate column count only, no header matching
- Keep current behavior (position-based, silent on mismatch)

**Selected:** Validate exact expected headers with specific error messages; no column-mapping UI

**Decision captured:**
- Validate against exact expected headers: Description, Size/Type, UOM, Qty, Unit Price (case-insensitive)
- On mismatch: specific error naming the bad or missing column (e.g., "Column 3 should be 'UOM' but got 'Unit'")
- No column-mapping UI — scope creep for Phase 8
- Error message actionable: "Expected columns: Description, Size/Type, UOM, Qty, Unit Price — found: [actual headers]" with specific mismatch highlighted
- If no header row detected, still validate column count (5 columns); error if row count wrong

---

## Summary

All four areas resolved without scope creep. Key architectural commitment: PDF.js embedded locally in the Electron bundle. Biggest new surface: `python/validator.py` (new module) + PDF.js viewer panel in step 2.
