# Requirements

## v1 — All Complete

### Security
- [x] SEC-01: API key never sent from frontend; backend reads from encrypted storage
- [x] SEC-02: Uploads validated (MIME + magic bytes)
- [x] SEC-03: 50MB upload limit enforced server-side
- [x] SEC-04: Temp files cleaned on crash/exception/shutdown
- [x] SEC-05: Visible warning when safeStorage encryption unavailable

### Architecture
- [x] ARCH-01: JS extracted into per-step modules
- [x] ARCH-02: Shared utilities in dedicated module
- [x] ARCH-03: No inline event handlers
- [x] ARCH-04: server.py routes are thin controllers
- [x] ARCH-05: Constants defined once, imported everywhere

### UI/UX
- [x] UI-01 through UI-06: Token system, typography, spacing, interactive states, theming, button variants

### Error States
- [x] ERR-01 through ERR-05: Specific errors, retry paths, SAM fallback, startup detection, inline validation

### Loading
- [x] LOAD-01 through LOAD-04: Progress indicators, spinners, button disable guards

### Data Quality
- [x] DATA-01 through DATA-05: Truncation warnings, SAM mapping, CSV validation, confidence scoring, NAICS/PSC validation

### Reliability
- [x] REL-01 through REL-04: Configurable port, zombie prevention, timeout, production app ID

## v2 — Backlog

- [ ] TEST-01: Unit tests for extraction regex patterns
- [ ] TEST-02: Integration tests for /parse and /generate_quote
- [ ] TEST-03: E2E smoke test
- [ ] UX-01: Multi-page scope in generated quote
- [ ] UX-02: Quote preview pane
- [ ] UX-03: Keyboard navigation
- [ ] UX-04: Undo/redo for line items
- [ ] PARSE-01: Multi-format parser (SAM-export + agency form + formal RFQ + generic fallback)
- [ ] PARSE-02: Format auto-detection before extraction
- [ ] PARSE-03: Confidence scoring tied to extraction strategy (format-specific vs fallback)
