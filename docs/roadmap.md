# Roadmap

## Completed (v1.0)

| Phase                      | Summary                                                                                         | Date       |
| -------------------------- | ----------------------------------------------------------------------------------------------- | ---------- |
| 1. Security Hardening      | API key server-side only, magic-byte upload validation, temp file cleanup, safeStorage warnings | 2026-03-18 |
| 2. Frontend Modularization | Split 2100-line index.html into per-step JS modules, zero inline handlers                       | 2026-03-18 |
| 3. Backend Structure       | Extracted extractor.py, generator.py, constants.py from server.py                               | 2026-03-18 |
| 4. CSS Design Tokens       | Semantic token system, all themes tokenized, no hardcoded values                                | 2026-03-22 |
| 5. Interactive States      | hover/focus-visible/active states, button variants (absorbed into Phase 4)                      | 2026-03-22 |
| 6. Error States            | Specific parse/generation errors, SAM.gov fallback, inline form validation                      | 2026-03-23 |
| 7. Loading & Progress      | Multi-stage spinners, button disable guards during async ops                                    | 2026-03-23 |
| 8. Data Quality            | Confidence scoring, scope truncation banners, PDF.js viewer, NAICS/PSC validation               | 2026-03-24 |
| 9. Reliability & Config    | Configurable port, zombie-process fix, parse timeout, production app ID                         | 2026-03-29 |

All 32 v1 requirements verified complete.

## Completed — Phase 10: Multi-Format Parser

**Problem**: Extractor only handles SAM-export format. VA agency forms and formal RFQ documents fail to parse.
**Constraint**: No AI dependency for parsing — all extraction must work with regex/rules for privacy.

### Tasks

1. **Format detection** — classify document before extraction (see docs/field-mapping.md)
2. **Agency form parser** — handle ALL-CAPS-with-asterisk form headers (36C24225Q0696 pattern)
3. **Formal RFQ parser** — handle cover page + lettered sections (69056725Q000044 pattern)
4. **Generic fallback layer** — universal patterns for fields missed by format-specific parsers
5. **Confidence scoring integration** — format-specific extraction gets higher confidence than fallback
6. **Test against all 4 sample documents** — W911S2, N50054, 36C242, 690567

### UI Fixes (bundle with Phase 10)

7. **Scope truncation expand-in-place** — single element with state toggle, not second element
8. **PDF viewer as separate window** — button → window.open() with blob URL, remove inline viewer

## Backlog (v2)

| Item    | Description                                                            |
| ------- | ---------------------------------------------------------------------- |
| TEST-01 | Unit tests for extraction logic (regex patterns against known formats) |
| TEST-02 | Integration tests for /parse and /generate_quote routes                |
| TEST-03 | E2E smoke test for full wizard flow                                    |
| UX-01   | Multi-page scope of work in generated quote                            |
| UX-02   | Preview pane for generated quote before download                       |
| UX-03   | Keyboard navigation throughout wizard                                  |
| UX-04   | Undo/redo for line items table                                         |

## Unresolved Concerns

- Logo size limits not enforced server-side (2MB limit is renderer-only)
- No audit log for quote generation history
- No batch processing (one document at a time)
- No caching of extraction results (same doc re-parsed from scratch)
