# Requirements: Solicitation Quoter

**Defined:** 2026-03-17
**Core Value:** Upload a solicitation, get a professional quote back — fast and accurately, with minimal manual editing.

## v1 Requirements

### Security

- [x] **SEC-01**: API key never transmitted from frontend; backend reads from encrypted storage only
- [x] **SEC-02**: Uploaded files validated against MIME type and magic bytes before parsing
- [x] **SEC-03**: Max upload file size enforced server-side (50MB limit)
- [x] **SEC-04**: Temp files guaranteed to be cleaned up on crash, exception, and app shutdown
- [x] **SEC-05**: User sees a visible warning when API key encryption is unavailable (safeStorage fallback)

### Code Architecture

- [x] **ARCH-01**: JavaScript extracted from index.html into separate .js modules (one per wizard step)
- [x] **ARCH-02**: Shared utilities (API calls, formatting helpers) in a dedicated module
- [x] **ARCH-03**: No inline event handlers — all JS wired via addEventListener in modules
- [x] **ARCH-04**: Python server.py routes separated from extraction/generation logic (thin controllers)
- [x] **ARCH-05**: Constants (port, max sizes, field names) defined once, imported where needed

### UI/UX Design System

- [x] **UI-01**: Consistent CSS custom property tokens for colors, spacing, and typography (no hardcoded values)
- [x] **UI-02**: Typography hierarchy: heading/subheading/body/label sizes defined and applied consistently
- [x] **UI-03**: Spacing scale applied uniformly — no random pixel values throughout CSS
- [x] **UI-04**: All interactive elements have consistent hover, focus, and active states
- [x] **UI-05**: Dark/light theme tokens properly scoped — no theme-breaking overrides
- [x] **UI-06**: Button variants (primary/secondary/danger) consistent across all wizard steps

### Error States & Feedback

- [ ] **ERR-01**: Parse errors shown with specific, actionable message (not generic "error occurred")
- [ ] **ERR-02**: Quote generation failure surfaces reason and provides retry path
- [ ] **ERR-03**: SAM.gov lookup failure shown clearly with fallback to manual entry
- [ ] **ERR-04**: Network/backend unavailable state detected and shown on startup
- [ ] **ERR-05**: Form validation inline — required fields flagged before user can proceed to next step

### Loading States

- [ ] **LOAD-01**: Parsing step shows progress indicator with current operation label
- [ ] **LOAD-02**: Quote generation shows progress indicator
- [ ] **LOAD-03**: SAM.gov lookup shows spinner while in-flight
- [ ] **LOAD-04**: Buttons disabled during async operations (no double-submit)

### Data Quality

- [ ] **DATA-01**: Scope of work truncation visible to user — warning shown when text was cut, with option to view full
- [ ] **DATA-02**: SAM.gov field mapping fixed — all returned fields correctly mapped to solicitation model
- [ ] **DATA-03**: CSV import validates column headers and data types; shows specific error on mismatch
- [ ] **DATA-04a**: Backend extraction validation layer computes a global accuracy score (0–100%) and per-field confidence score (0–100%) after parsing; validation logic checks for missing values, malformed data, format mismatches (dates, codes, numbers), and inconsistencies between related fields; logic is separated from parsing into its own module
- [ ] **DATA-04b**: `/parse` response includes structured confidence output: `{ "overallConfidence": 92, "fields": [{ "name": "...", "value": "...", "confidence": 78, "status": "flagged|ok", "issue": "..." }], "flags": [{ "type": "...", "field": "...", "message": "..." }] }`; bounding box coordinates included for PDF fields where pdfplumber can provide them
- [ ] **DATA-04c**: Auto-approval threshold defined at ≥95% overall confidence — fields above threshold pass silently; fields below threshold are flagged as "needs review"; threshold is configurable, not hardcoded
- [ ] **DATA-04d**: Review step UI displays overall accuracy score prominently, lists all flagged fields with their confidence percentage and issue description, and allows clicking a flagged field to scroll/zoom to its location in the source PDF where bounding box data is available
- [ ] **DATA-05**: NAICS and PSC codes validated against known format (5-6 digits) before accepting

### Reliability

- [ ] **REL-01**: Port configurable via environment variable throughout stack (no hardcoded 5199 in 3 places)
- [ ] **REL-02**: Backend zombie process prevented on Windows crash (process group + uncaughtException handler)
- [ ] **REL-03**: File upload wrapped in timeout — backend returns error if parsing takes >30s
- [ ] **REL-04**: App ID set to production value (remove `com.yourcompany` placeholder)

## v2 Requirements

### Testing

- **TEST-01**: Unit tests for extraction logic (regex patterns against known solicitation formats)
- **TEST-02**: Integration tests for /parse and /generate_quote routes
- **TEST-03**: E2E smoke test for full wizard flow

### Advanced UX

- **UX-01**: Multi-page scope of work support in generated quote
- **UX-02**: Preview pane for generated quote before download
- **UX-03**: Keyboard navigation support throughout wizard
- **UX-04**: Undo/redo for line items table edits

## Out of Scope

| Feature | Reason |
|---------|--------|
| Cloud sync | Single-user desktop tool, no infrastructure needed |
| User accounts/login | Not required for personal use |
| Web deployment | Electron desktop only |
| Real-time collaboration | Out of scope for personal tool |
| OAuth integration | No web auth needed |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| SEC-01 | Phase 1 | Complete |
| SEC-02 | Phase 1 | Complete |
| SEC-03 | Phase 1 | Complete |
| SEC-04 | Phase 1 | Complete |
| SEC-05 | Phase 1 | Complete |
| ARCH-01 | Phase 2 | Complete |
| ARCH-02 | Phase 2 | Complete |
| ARCH-03 | Phase 2 | Complete |
| ARCH-04 | Phase 3 | Pending |
| ARCH-05 | Phase 3 | Pending |
| UI-01 | Phase 4 | Complete |
| UI-02 | Phase 4 | Complete |
| UI-03 | Phase 4 | Complete |
| UI-04 | Phase 4 | Complete |
| UI-05 | Phase 4 | Complete |
| UI-06 | Phase 4 | Complete |
| ERR-01 | Phase 6 | Pending |
| ERR-02 | Phase 6 | Pending |
| ERR-03 | Phase 6 | Pending |
| ERR-04 | Phase 6 | Pending |
| ERR-05 | Phase 6 | Pending |
| LOAD-01 | Phase 7 | Pending |
| LOAD-02 | Phase 7 | Pending |
| LOAD-03 | Phase 7 | Pending |
| LOAD-04 | Phase 7 | Pending |
| DATA-01 | Phase 8 | Pending |
| DATA-02 | Phase 8 | Pending |
| DATA-03 | Phase 8 | Pending |
| DATA-04a | Phase 8 | Pending |
| DATA-04b | Phase 8 | Pending |
| DATA-04c | Phase 8 | Pending |
| DATA-04d | Phase 8 | Pending |
| DATA-05 | Phase 8 | Pending |
| REL-01 | Phase 9 | Pending |
| REL-02 | Phase 9 | Pending |
| REL-03 | Phase 9 | Pending |
| REL-04 | Phase 9 | Pending |

**Coverage:**
- v1 requirements: 32 total
- Mapped to phases: 32
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-17*
*Last updated: 2026-03-22 — UI-04/05/06 phase mapping corrected from Phase 5 to Phase 4; step4.js DOCX-preview colors documented as UI-01 exception*
