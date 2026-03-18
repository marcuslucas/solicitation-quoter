---
phase: quick
plan: 1
subsystem: python-backend
tags: [refactor, python, flask, extraction, generation]
dependency_graph:
  requires: []
  provides: [python/constants.py, python/extractor.py, python/generator.py, python/server.py]
  affects: [python/server.py]
tech_stack:
  added: []
  patterns: [module-per-concern, thin-controller]
key_files:
  created:
    - python/constants.py
    - python/extractor.py
    - python/generator.py
  modified:
    - python/server.py
decisions:
  - "Verbatim extraction — no logic changes, no reformatting beyond import adjustments"
  - "validate_upload and _startup_sweep kept in server.py — they are request/lifecycle concerns, not domain logic"
  - "PORT constant used via os.environ.get('PORT', PORT) in __main__ to preserve env-override behavior"
metrics:
  duration: 3 min
  completed_date: "2026-03-18"
  tasks_completed: 2
  files_changed: 4
---

# Phase quick Plan 1: Refactor python/server.py into Thin Flask Controllers — Summary

**One-liner:** Split 743-line Flask monolith into constants.py + extractor.py + generator.py + thin server.py with zero behavior change, verified by /ping smoke test and AST structural check.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create constants.py, extractor.py, generator.py | cf748c1 | python/constants.py, python/extractor.py, python/generator.py |
| 2 | Rewrite server.py as thin Flask controllers | a0da29b | python/server.py |

## What Was Built

**python/constants.py** — shared constants extracted from the monolith:
- `MAX_UPLOAD_BYTES = 50 * 1024 * 1024`
- `PORT = 5199`
- `ALLOWED_EXTENSIONS = {'.pdf', '.docx', '.doc', '.txt'}`
- `TMP_PREFIX = 'sqt_'`

**python/extractor.py** — all text parsing and field extraction functions:
- `parse_pdf`, `parse_docx`, `parse_document` — file-to-text parsers
- `extract` — rule-based regex field extraction
- `ai_extract` — Claude API extraction
- `extract_data` — merge rules + AI results
- `extract_line_items` — derive CLIN/size-qty line items

**python/generator.py** — DOCX quote generation:
- `generate_quote` — full python-docx document builder (verbatim copy)

**python/server.py** — rewritten as thin Flask controller (~240 lines vs 743):
- Flask app setup, CORS handler, 413 error handler
- `validate_upload`, `_startup_sweep` (lifecycle concerns)
- `_active_tmp_files`, `_cleanup_active_tmp_files`, `atexit`
- Four routes: `/ping`, `/parse`, `/generate_quote`, `/sam_lookup` — delegate only, no inline logic

## Verification Results

- **Import check:** `import constants, extractor, generator` — PASS
- **/ping smoke test:** Server started, `/ping` returned `{"status":"ok"}` — PASS
- **AST structural check:** server.py defines only `['_cleanup_active_tmp_files', 'validate_upload', '_startup_sweep', 'handle_request_entity_too_large', 'cors', 'ping', 'parse_route', 'gen_route', 'sam_lookup']` — PASS (no banned functions)

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- python/constants.py — FOUND
- python/extractor.py — FOUND
- python/generator.py — FOUND
- python/server.py — FOUND
- Commit cf748c1 — FOUND
- Commit a0da29b — FOUND
