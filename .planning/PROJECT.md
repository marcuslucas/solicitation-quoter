# Solicitation Quoter

## What This Is

A desktop application (Electron + Python Flask) that automates quote generation from government solicitation documents. Users upload a PDF/DOCX/TXT solicitation, the app extracts key fields (agency, due date, NAICS code, scope of work, etc.) using regex rules and optional Claude AI, then generates a formatted `.docx` quote document. Built for personal/internal use by contractors responding to government RFQs.

## Core Value

Upload a solicitation, get a professional quote back — fast and accurately, with minimal manual editing.

## Requirements

### Validated

- ✓ Document parsing (PDF, DOCX, TXT) via pdfplumber/pypdf/python-docx — existing
- ✓ Rule-based field extraction (solicitation number, agency, due date, NAICS, PSC, etc.) — existing
- ✓ Optional AI-enhanced extraction via Claude API — existing
- ✓ SAM.gov solicitation lookup by number — existing
- ✓ 5-step wizard UI (upload → review → vendor → line items → generate) — existing
- ✓ Line items table with CSV import — existing
- ✓ .docx quote generation via python-docx — existing
- ✓ Vendor profile save/load — existing
- ✓ API key encrypted storage (Electron safeStorage) — existing
- ✓ Cross-platform packaging (Windows NSIS + macOS DMG) — existing

### Active

- [ ] Security hardening (API key exposure via form data, file upload validation, temp file cleanup)
- [ ] Code quality overhaul (2100-line monolithic index.html → modular structure)
- [ ] UI/UX polish (consistent design system, spacing, typography, loading/error states)
- [ ] Reliability fixes (scope truncation warnings, CSV import validation, SAM.gov field mapping)
- [ ] Backend robustness (extraction confidence scores, timeout handling, error recovery)
- [ ] Professional polish (loading states, error boundaries, input validation feedback)

### Out of Scope

- Cloud sync or multi-user features — personal/internal tool, no backend infrastructure
- Authentication/login — single-user desktop app
- Real-time collaboration — not needed for use case
- Web deployment — Electron desktop only

## Context

- Single monolithic UI file (`electron/index.html`, ~2100 lines) mixes HTML, CSS, and JS — primary maintainability concern
- Python backend (`python/server.py`, ~637 lines) is a single file handling parsing, extraction, and generation — reasonable for current scale
- No tests exist (confirmed by codebase map)
- Several active security concerns: API key transmitted in form data, unvalidated file uploads, silent encryption fallback
- Several data quality bugs: scope truncation silent at 3 different points, SAM.gov field mapping inconsistencies
- App ID still set to `com.yourcompany.solicitationquoter` — needs to be finalized before any wider distribution

## Constraints

- **Tech stack**: Electron + Python Flask — restructuring allowed but must remain Electron desktop + Python backend
- **Reliability**: All changes must be seamless — no regressions, no new crashes introduced
- **No new dependencies without justification**: Keep the footprint manageable
- **Cross-platform**: Must continue to work on both Windows and macOS

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Split index.html into modules | 2100-line monolith is unmaintainable; Electron supports local file loading | — Pending |
| Move API key to server-side only | Sending key in form data is a security anti-pattern even on localhost | — Pending |
| Add extraction confidence scoring | Regex extraction has variable quality; user needs signal when to review manually | — Pending |

---
*Last updated: 2026-03-17 after initialization*
