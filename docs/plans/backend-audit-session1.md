# Sol-Quoter — Backend Audit Report (Session 1 of 2)

## Date: June 12, 2026
## Git HEAD: a074e37

Scope: Python backend only (`python/server.py`, `extractor.py`, `generator.py`,
`validator.py`, `document_loader.py`, `constants.py`, `testdata/run.py`).
Session 2 will cover the Electron frontend.

---

## Executive Summary

| Severity | Count |
|----------|-------|
| Critical | 1 |
| High     | 5 |
| Medium   | 13 |
| Low      | 16 |

**Test suite status:** All 6 fixtures PASS, exit code 0 (full output in Test Suite
Output section).

**Blockers for client delivery:**

1. **CRITICAL — Silent automatic AI extraction (C-1).** If the client sets
   `ANTHROPIC_API_KEY` in `.env` (which they must do to use the Phase 8 AI panel),
   `extract_data()` silently sends every parsed document's text to the Anthropic
   API on every parse — violating the locked Phase 8 design decision
   ("user-triggered only — no silent AI usage"), the project privacy guarantee
   ("documents stay local"), and bypassing the `_ai_call_count` limit entirely.
2. **HIGH — `psutil` missing from requirements.txt (H-1).** The parent-process
   watchdog dies silently on a clean install, which is the most plausible root
   cause of the documented "zombie python process" failure mode.
3. **HIGH — Phase 6 verification FAILS (H-4).** `extraction_warnings` is assembled
   only in `parse_solicitation_bundle()`, not in `extract_data()` as the phase
   completion criteria require.
4. **HIGH — No `.env.example` (H-2).** The client has no documentation of the
   required environment variables.

The codebase is otherwise in good shape for a desktop app: server binds to
127.0.0.1 only, debug mode is off, upload size limits are enforced at the WSGI
layer, no `eval()`, no bare `except:`, no hardcoded secrets, `.env` is gitignored
and not tracked in git. The Critical and High items above should be fixed before
delivery; most Medium items are robustness/maintainability and can be triaged.

---

## Critical Findings

### C-1. `extract_data()` silently sends document text to Anthropic when an env key is present

- **File:** `python/extractor.py`, lines 674–688 (also `ai_extract()`, lines 629–650)
- **Severity:** Critical

```python
_env_key = os.environ.get('ANTHROPIC_API_KEY', '')
if api_key or _env_key:
    try:
        ai = ai_extract(text)
        ...
```

`extract_data()` is called by `parse_solicitation_bundle()` on **every** `/parse`
request. If `ANTHROPIC_API_KEY` is set in `.env` — which is exactly what the
client is instructed to do to enable the Phase 8 AI panel — then every document
upload silently transmits up to 14,000 characters of the solicitation text to the
Anthropic API. Why this matters:

1. **Consent violation.** Directly contradicts the Phase 8 locked decision
   "User-triggered only — no silent AI usage" and the CLAUDE.md privacy
   requirement "all extraction must work with regex/rules only for privacy
   (documents stay local)."
2. **Bypasses the call limit.** These calls never increment `_ai_call_count`
   in server.py, so the `AI_MAX_CALLS` budget is meaningless — unmetered spend
   on the client's API key.
3. **Latency/timeout risk.** `ai_extract()` has no timeout configured on the
   Anthropic client; the parse worker has a 30-second budget (server.py:414).
   A slow AI call can push every parse into the timeout path.
4. **Field overwrite.** AI values silently overwrite rule-extracted values
   (`merged[k] = v`), changing behavior between keyless and keyed installs.
5. **Test contamination.** `testdata/run.py` imports `server`, which runs
   `load_dotenv()` — so running the test suite on a machine with a configured
   `.env` would make billable API calls per fixture and produce non-deterministic
   results. Current tests pass only because the dev machine's key is blank.

**Recommendation:** Remove the implicit env-key branch from `extract_data()` (or
gate it behind an explicit opt-in parameter that the server never passes). The
user-triggered `/api/sol-quoter/extract-ai` endpoint is the only path that should
ever call the API.

---

## High Findings

### H-1. `psutil` is used but missing from `python/requirements.txt`

- **File:** `python/server.py`, line 125; `python/requirements.txt` (absent)
- **Severity:** High

`_watch_parent()` does `import psutil` at the top of the thread function.
`requirements.txt` lists flask, pdfplumber, pypdf, python-docx, anthropic,
openpyxl, python-dotenv — **no psutil**. On a clean client install, the watchdog
thread raises `ImportError` immediately and dies silently (thread exceptions are
not surfaced). The backend then never detects Electron's exit and lives on as an
orphan — this is almost certainly the root cause of the documented "zombie
process" failure mode in CLAUDE.md ("always run taskkill on old python
processes"). Add `psutil` to requirements.txt and verify it is bundled by
PyInstaller.

### H-2. No `.env.example` documenting required environment variables

- **File:** project root (absent)
- **Severity:** High (per audit instruction)

`.env` exists locally and is correctly gitignored, but there is no `.env.example`
checked in. The client has no in-repo documentation of `ANTHROPIC_API_KEY`,
`AI_MAX_CALLS`, `AI_HEADER_MODEL`, `AI_LINE_ITEM_MODEL`, `PORT`, or `PARENT_PID`.
The keys are documented only inside `docs/plans/SOL-QUOTER-HANDOFF.md` §11.
There is also no root README covering installation/first-run (noted here;
frontend/packaging docs are Session 2 scope).

### H-3. The 30-second parse timeout does not actually return early

- **File:** `python/server.py`, lines 411–418
- **Severity:** High

```python
with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
    fut = ex.submit(_do_parse, bundle)
    try:
        data = fut.result(timeout=30)
    except concurrent.futures.TimeoutError:
        return jsonify({...}), 408
```

`fut.result(timeout=30)` raises `TimeoutError` after 30 s, but the `return` then
exits the `with` block, and `ThreadPoolExecutor.__exit__` calls
`shutdown(wait=True)` — which **blocks until the running parse finishes anyway**.
A hung 5-minute parse means the client waits 5 minutes for the "timed out after
30 seconds" response. The worker thread is also never cancelled, so it continues
consuming CPU. The key decision log entry says this construct "prevents partial
results," but as written the timeout provides no user-facing benefit. Fix:
`ex.shutdown(wait=False)` before returning (Python 3.9+: `cancel_futures=True`),
or keep a module-level executor instead of a per-request `with` block.

### H-4. Phase 6 verification FAIL — `extraction_warnings` not assembled in `extract_data()`

- **File:** `python/extractor.py`, lines 655–689 (`extract_data`, no warnings code);
  lines 1373–1383 (`parse_solicitation_bundle`, warnings present)
- **Severity:** High (explicit phase completion criterion)

The Phase 6 completion criterion requires warning assembly at **both** call
sites. It exists only in `parse_solicitation_bundle()`. Consequence: any caller
of `extract_data()` directly — which includes `run.py`'s single-file fixture
path (5 of 6 fixtures) and the `--solicitation` generation mode — gets a result
with no `extraction_warnings` and no `confidence` block. See Phase Completion
Verification section for full evidence.

### H-5. Test harness does not exercise the production parse path for 5 of 6 fixtures

- **File:** `testdata/run.py`, lines 85–96 (`run_extraction`)
- **Severity:** High

When a fixture directory contains a single non-XLSX file, `run_extraction()` calls
`parse_document()` + `extract_data()` directly. Production (`/parse` in
server.py:408–418) **always** goes through `parse_solicitation_bundle()`. That
means for 18Q0042, 36C24225Q0696, N5005426Q0114, request-for-quotation, and
W911S225U14310001, the test suite never exercises: `classify_document()`, the
CLIN fallback (`_extract_clin_items`), warning assembly, `compute_confidence()`,
or the SOW-on-main-doc fallback. Only the 70B bundle fixture covers the real
pipeline. A green test run therefore does not guarantee the production path
works for single-file uploads. Fix: route all fixtures through
`parse_solicitation_bundle()` (it handles single-file bundles fine).

---

## Medium Findings

### M-1. `extract-ai` route has unguarded failure points that return HTML 500s instead of JSON

- **File:** `python/server.py`, lines 277 (`json.loads(manifest_path.read_text())`),
  286 and 295–296 (`parse_document(...)` which can raise `ValueError`, extractor.py:53)
- **Severity:** Medium

These statements sit **outside** the route's try/except (which begins at line
305). A corrupted `manifest.json` or an unreadable session document raises an
uncaught exception, so Flask returns its generic HTML 500 page — the frontend
expects JSON error bodies with `code` fields. Same pattern: `request.get_json()`
at line 265 will raise (415) under newer Flask if the content type is not JSON.

### M-2. Dead temp-file subsystem with misleading comments

- **File:** `python/server.py`, lines 48–65 (`_active_tmp_files` + atexit handler),
  105–120 (`_startup_sweep`), line 7 (`TMP_PREFIX` import);
  `python/constants.py`, lines 8, 10
- **Severity:** Medium

The comment at lines 48–50 says `_active_tmp_files` is "Populated per-request in
parse_route(); cleared in the finally block" — **nothing ever adds to this set**,
there is no finally block, and the atexit handler is a no-op. Files now go to
`~/.sol-quoter/session/current/`, not the OS temp dir, so `_startup_sweep()`
sweeps for `sqt_*` files that are no longer created. `TMP_PREFIX` is imported but
never used (and the sweep duplicates `'sqt_'` as string literals instead).
`ALLOWED_EXTENSIONS` in constants.py is never imported by any module, and it
contradicts reality: it omits `.xlsx`/`.xls`, which `validate_upload()` accepts.
This whole subsystem is a vestige of the pre-session-directory architecture and
should be removed or rewired; the misleading comment is a trap for future
maintainers.

### M-3. CORS reflects `null`/`file://` origins, and `/parse` is CSRF-able via multipart simple requests

- **File:** `python/server.py`, lines 141–152 (CORS), 385–406 (`/parse`)
- **Severity:** Medium

The `after_request` handler reflects `Origin: null` and any `file://` origin.
`Origin: null` is also sent by sandboxed iframes on **any** website, so a
malicious page embedding a sandboxed iframe gets full read access to every
endpoint on 127.0.0.1:5199. Independently, `/parse` consumes `multipart/form-data`
— a "simple request" that browsers send **without** a CORS preflight — so any
webpage the user visits can silently POST to `/parse`, which calls
`clear_session_dir()` (wiping the user's current session) and writes
attacker-chosen files into the session directory. The JSON endpoints
(`/generate_quote`, `/extract-ai`, `/sam_lookup`) are protected by preflight.
There is also no `Host` header validation (DNS-rebinding hardening). Severity is
tempered by the localhost-only bind and the desktop context, but for client
delivery: tighten the null-origin reflection and consider a simple shared-secret
header between Electron and Flask.

### M-4. Empty, scanned (image-only), and password-protected PDFs produce a silent empty result, not an actionable error

- **File:** `python/server.py`, lines 420–421; `python/extractor.py`,
  lines 1302–1336; `python/document_loader.py`, line 126
- **Severity:** Medium

For an encrypted or image-only PDF, `_load_pdf()` returns
`DocumentResult(text="", error="PDF extraction failed...")`. But
`parse_solicitation_bundle()` ignores `result.error`, classifies the empty text,
and `extract_data("")` returns a dict that always contains `_format`/`_method`
keys — so the `if not data:` guard at server.py:420 **never fires** in the bundle
path, and the "Could not extract text from document" message is unreachable. The
user gets a 200 response with every field empty and a red confidence banner,
rather than "this PDF is password-protected" or "this PDF contains no extractable
text (scanned image?)". There is no specific handling of encrypted PDFs anywhere
(no `is_encrypted` check); the pdfplumber/pypdf exceptions are swallowed with a
`print()`. Graceful in the "does not crash" sense, but not in the "user knows
what went wrong" sense.

### M-5. Dead/confusing expression in `extract_sf1449()` period-of-performance block

- **File:** `python/extractor.py`, line 559
- **Severity:** Medium

```python
d.update(_scope_block.__func__(raw_pop) if hasattr(_scope_block, '__func__') else {})
```

`_scope_block` is a plain module-level function; it has no `__func__` attribute,
so this expression always evaluates to `d.update({})` — a no-op. It looks like a
leftover from a refactor where `_scope_block` was a method. Either the intent was
to apply scope-block truncation metadata to the period text (in which case this
is a latent bug), or the line should be deleted. Line 560 caps the value at 500
chars regardless.

### M-6. Non-deterministic output: `attachments` ordering from `list(set(...))`

- **File:** `python/extractor.py`, line 240
- **Severity:** Medium

`d["attachments"] = list(set(atts))` — set iteration order depends on string
hashing, which is randomized per process (`PYTHONHASHSEED`). Parsing the same
file in two app sessions can produce differently-ordered attachment lists. This
is the only true determinism violation found; everything else (regex extraction,
dict ordering, sorted line items) is deterministic. Fix: `sorted(set(atts))`.

### M-7. `/generate_quote` performs no request body validation; numeric vendor fields can 500 with leaked internals

- **File:** `python/server.py`, lines 505–516; `python/generator.py`, lines 242–243
- **Severity:** Medium

`gen_route` passes `body.get("vendor", {})` straight into `generate_quote()`,
where `float(vendor.get("freight",0) or 0)` and `float(vendor.get("tax_rate",0)
or 0)` raise `ValueError` on non-numeric strings (e.g. `"$50"` typed into the
freight field). The catch-all returns `{"error": str(e)}` — raw Python exception
text — as the user-facing message. The same `str(e)` leak applies to the
`/parse` catch-all (line 503). `body` may also be `None` if the client sends an
empty JSON body (`body.get` → `AttributeError` → 500). Validate/coerce numeric
fields and return field-specific messages.

### M-8. Substantial business logic lives in server.py route handlers

- **File:** `python/server.py` — lines 183–380 (AI prompts, chunking, API calls,
  response parsing, dedup/merge in `extract_ai_route`), 429–457 (inline
  pdfplumber bounding-box extraction in `parse_route`), 518–599 (SAM.gov field
  mapping in `sam_lookup`)
- **Severity:** Medium

The stated convention is "Flask routes are thin: validate input, call
extractor/generator, return JSON." `extract_ai_route` is ~143 lines of extraction
logic that belongs in an `ai_extractor.py` module; the bounding-box loop in
`parse_route` is field-extraction logic that belongs in extractor.py or
validator.py; `sam_lookup`'s response-mapping belongs in its own module. Beyond
convention, this makes the logic untestable without a Flask request context —
none of it is covered by run.py.

### M-9. Bounding boxes and `source_type` are derived from the *first uploaded file*, not the classified main document

- **File:** `python/server.py`, lines 424–432
- **Severity:** Medium

`main_file = uploaded_files[0]` and `main_tmp = bundle[0]["path"]` assume the
first file in the upload list is the main solicitation. `parse_solicitation_bundle`
classifies documents and may pick a different file as `main` (e.g. user selects
the SOW first in the file dialog). In that case bounding boxes are searched in
the wrong PDF (silently producing none), and `source_type` passed to
`validate_fields` may be wrong (e.g. `xlsx`). Use the classified main document
(returned in `_session_files["main"]`) instead of index 0.

### M-10. `ai_extract()` hardcodes its model and duplicates fence-stripping logic

- **File:** `python/extractor.py`, lines 646 (`model="claude-sonnet-4-6"`),
  648–649; `python/server.py`, lines 321–322 and 342–343
- **Severity:** Medium

The legacy `ai_extract()` ignores the `AI_HEADER_MODEL`/`AI_LINE_ITEM_MODEL`
configuration that the Phase 8 endpoint honors, and has no timeout (cf. C-1).
The markdown-code-fence stripping regex pair is implemented three times (twice in
`extract_ai_route`, once in `ai_extract`) with slightly different patterns —
should be one shared helper.

### M-11. Test harness imports backend functions through the Flask server module

- **File:** `testdata/run.py`, line 25
- **Severity:** Medium

`from server import parse_document, extract_data, generate_quote, ...` re-imports
functions that actually live in extractor.py/generator.py. Importing `server`
drags in Flask, registers routes, runs `load_dotenv()` (see C-1 test
contamination), and defines the atexit handler — all side effects a test harness
should not trigger. Import directly from `extractor` and `generator`. (No
reverse coupling found: extractor.py does **not** import from server.py, which
is correct.)

### M-12. XLSX parsing: merged cells silently drop rows; only the first/active sheet is read

- **File:** `python/extractor.py`, lines 878–930 (`_iter_xlsx_rows`),
  955–963 (`extract_pricing_spreadsheet`)
- **Severity:** Medium

With openpyxl `read_only=True`, merged-cell regions return values only in the
anchor cell; continuation cells are `None`. `extract_pricing_spreadsheet`
requires column A to be a string matching `^\d+\.\d+\.\d+$`, so a pricing sheet
where the SOW-section column is merged across rows silently loses every
non-anchor row — no crash, no warning, just missing line items. Additionally,
openpyxl reads only `wb.active` and the stdlib fallback hardcodes
`xl/worksheets/sheet1.xml`; a workbook whose pricing data is on a second sheet
yields zero items. Both behaviors are "graceful" only in the no-crash sense.

### M-13. Functions over 150 lines

- **Severity:** Medium

| Function | File | Lines | Length |
|----------|------|-------|--------|
| `generate_quote()` | generator.py | 8–304 | ~297 lines |
| `extract_sf1449()` | extractor.py | 429–584 | ~156 lines |

Note: the audit brief states extractor.py "is known to have several" functions
over 150 lines — measured against HEAD a074e37, only `extract_sf1449` exceeds
the threshold in extractor.py. Near-misses worth tracking:
`extract_ai_route` (server.py:238–380, ~143), `extract_sow_line_items`
(extractor.py:752–875, ~124), `parse_route` (server.py:385–503, ~119),
`extract_formal_rfq` (extractor.py:328–426, ~99). `generate_quote` is the
strongest decomposition candidate (header table / info table / line-item table /
options / signature are natural seams).

---

## Low Findings

### L-1. Inconsistent extraction-helper patterns across format extractors

- **File:** `python/extractor.py`
- `extract_sam_export` (line 159) and `extract_sf1449` (line 440) each define a
  local `find(patterns)` helper (with different flags: sf1449 adds DOTALL);
  `extract_agency_form` defines `same_line()` (line 254); `extract_formal_rfq`
  defines `labeled()` (line 334); all four also mix in direct `re.search()`
  calls. The email regex `[\w.%+\-]+@[\w.\-]+\.\w{2,}` is duplicated 7+ times
  across extractor.py and apply_generic_fallback. A shared helpers section would
  reduce drift.

### L-2. Dead code: `parse_pdf()` and `parse_docx()` in extractor.py

- **File:** `python/extractor.py`, lines 10–27, 30–39
- Defined but never called anywhere in the project (verified by grep across
  *.py/*.js). They duplicate `document_loader._load_pdf()`/`_load_docx()`. The
  `extract()` alias (line 693) is live — used by `sam_lookup` — but its comment
  ("Keep the old name as an alias") suggests reviewing whether sam_lookup should
  call `extract_sam_export` explicitly.

### L-3. Leftover refactor comment / commented-out pattern

- **File:** `python/extractor.py`, line 705: `# <-- was: (?:\.(?=\n))` —
  dead pattern history embedded in the regex definition.
- **File:** `python/generator.py`, line 84: `# Header table` comment is
  mis-indented at column 0 inside the function body.
- No other commented-out code blocks found.

### L-4. TODO/FIXME comments

- **None found.** (The only grep hit for "XXX" is a phone-format example in a
  comment at extractor.py:364, not a marker.)

### L-5. Bare `except:` clauses

- **None found.** However, four broad `except Exception: pass` silent-swallow
  sites exist, all intentional best-effort paths: server.py:61–62 (atexit
  cleanup), 117–118 (startup sweep), 132–133 (psutil poll), 456–457 (bounding
  boxes). Each has a comment; acceptable, but the bounding-box one hides real
  regressions (a pdfplumber API change would silently disable the feature).

### L-6. `validate_upload()` accepts `.doc` by extension but checks for PK magic bytes

- **File:** `python/server.py`, lines 88–90
- Legacy `.doc` files are OLE2 (`D0 CF 11 E0`), not ZIP — so every real `.doc`
  is rejected with "Unsupported file type". Either drop `.doc` from the accepted
  list or state clearly that only `.docx` is supported. The error message string
  is duplicated five times in the function (named-constant candidate).

### L-7. `datetime.datetime.utcnow()` is deprecated

- **File:** `python/server.py`, line 483 — deprecated since Python 3.12; use
  `datetime.datetime.now(datetime.timezone.utc)`.

### L-8. `_ai_call_count` increment is not thread-safe

- **File:** `python/server.py`, line 373 — `app.run()` serves threaded by
  default in modern Flask; `+=` on a global is a read-modify-write race. With a
  single desktop user the risk is negligible, but a lock (or
  `itertools.count`) would make it correct. Module-level mutable state
  inventory requested by the brief: `_ai_call_count` (int, rebound),
  `_active_tmp_files` (set — dead, see M-2), and `app` (Flask instance).
  All `_AI_*` config values are immutable strings/ints.

### L-9. Werkzeug development server used in production

- **File:** `python/server.py`, line 608 — `app.run(...)` is the dev server;
  it prints a "this is a development server" warning at startup. For a
  localhost-only desktop sidecar this is a common and acceptable choice, but
  `waitress` is a two-line swap if the client is sensitive to the warning text
  appearing in logs.

### L-10. PSC format rule conflicts with what the extractors produce

- **File:** `python/validator.py`, line 49 (`^[A-Z0-9]{4}$`) vs
  `python/extractor.py`, line 270 (agency form allows 3–4 chars) and line 382
  (formal RFQ allows `[A-Z]\d{3,4}` = up to 5 chars). A legitimately extracted
  3- or 5-character PSC gets flagged "Expected 4-character alphanumeric PSC
  code". Also validator.py's docstring (line 82) says status is `"ok" | "flagged"`
  but the code also emits `"absent"` (line 113) — doc drift.

### L-11. SAM.gov API key transmitted as a URL query parameter

- **File:** `python/server.py`, lines 531–534 — `api_key` goes into the query
  string. This is SAM.gov's own API design (their documented auth method), and
  the request is HTTPS, but query strings can land in proxy/server logs. Noted
  for awareness; not actionable without SAM.gov supporting header auth.

### L-12. Magic numbers that should be named constants

- server.py: `512` (magic-byte read, line 80), `3600` (sweep cutoff, 108),
  `30` (parse timeout, 414), `30.0` (Anthropic timeout, 307), `15` (SAM timeout,
  536), `4000`/`6000`/`500` (AI text windows, 289/222–223), `1024`/`2048`
  (max_tokens, 292/300), `365` (SAM lookback days, 530), `40`/`20`
  (bbox search lengths, 443/446).
- extractor.py: `14000`/`7000` (AI truncation, 635–636), `2000` (spec_text cap,
  867/1190), `500` (period cap, 560), `120` (desc caps, 1120/1175).
- run.py: tolerance `3`/`5` (line 154), `20` boundary.
- Several are fine inline; the AI text-window sizes and timeouts are the ones a
  client-side tuner would want in constants.py or .env.

### L-13. `clear_session_dir()` has no error handling for locked files

- **File:** `python/server.py`, lines 33–37, called at line 394 — on Windows,
  if any session file is held open (e.g. by the PDF viewer or an AV scan),
  `shutil.rmtree` raises and the entire `/parse` request 500s with a raw
  `WinError` message. A retry-or-warn wrapper would be more robust.

### L-14. `extract_sam_export` size-quantity regex is prone to false positives

- **File:** `python/extractor.py`, line 233 —
  `\b(SM|S|M|L|XL|XXL|2XL|3XL)[:\s]*(\d+)` with IGNORECASE matches any
  standalone "S 5" / "M 100" token sequence in prose (e.g. "Appendix M 3"),
  which then fabricates `quantities` and downstream line items in
  `extract_line_items()`. Consider requiring a colon or a size-context anchor.

### L-15. `extract_ai_route` line-item items assumed to be dicts

- **File:** `python/server.py`, line 348 — `item.get("description", ...)`
  raises `AttributeError` if the model returns a JSON array of strings; it is
  caught by the generic handler but surfaces as a misleading "Anthropic API
  error: 'str' object has no attribute 'get'". Validate item shape after
  `json.loads`.

### L-16. requirements.txt uses unpinned `>=` ranges

- **File:** `python/requirements.txt` — all seven packages are `>=` floors.
  No packages with known security vulnerabilities at these floors were
  identified (flask≥3.0, pdfplumber≥0.10, pypdf≥4.0 — post-CVE-2023-36464,
  python-docx≥1.1, anthropic≥0.25, openpyxl≥3.0, python-dotenv≥1.0). For a
  client delivery, pin exact versions (`==`) so the PyInstaller build is
  reproducible, and add the missing `psutil` (H-1). `anthropic>=0.25.0` is
  significantly older than current SDK conventions; the code's usage
  (`client.messages.create`) is compatible with current versions, so pinning
  a recent release is safe.

---

## Category-by-Category Summary

**1. Security — Backend**
- File paths from user input: filenames are sanitized via `Path(file.filename).name`
  (server.py:403) — directory components are stripped; adequate. Manifest-derived
  paths in `extract_ai_route` (lines 285, 295) are joined unchecked, but the
  manifest is server-written; local-tamper only (noted in L-grade).
- Hardcoded secrets: **None found.** `.env` is gitignored and not tracked in git.
- Path traversal in file read handlers: **None found** (backend reads only
  session-dir files it wrote).
- CORS/localhost: binds `127.0.0.1` (server.py:608) — correct; CORS null-origin
  reflection + `/parse` CSRF → M-3.
- Data to external services without consent: **C-1** (Anthropic, automatic);
  SAM.gov lookup is user-initiated.
- `eval()` calls: **None found.**
- Large-payload protection: `MAX_CONTENT_LENGTH` set globally (server.py:46)
  enforced at the WSGI layer for **all** routes, plus per-request size check and
  413 handler. Adequate.
- Debug mode: `debug=False` (server.py:608). Correct.

**2. Error Handling — Backend** — M-1, M-4, M-7, L-5, L-13, L-15. Module-level
mutable state: `_ai_call_count`, `_active_tmp_files`, `app` (L-8/M-2). Empty and
password-protected PDFs: no crash, but no actionable message (M-4).

**3. Code Quality — Backend** — M-5, M-10, M-13, L-1, L-2, L-3, L-12.
TODO/FIXME: none (L-4).

**4. Architecture — Backend** — M-2 (cleanup logic), M-8 (fat controllers),
M-11 (test import coupling). Session cleanup answer: session files are cleared
only at the *start of the next parse* (server.py:394) — files from a failed
parse persist until then, which matches the documented session-resume design;
the crash-cleanup mechanism that was supposed to back this up is a no-op (M-2).
AI counter: in-memory only, resets on any restart/crash — matches the documented
intentional design (server.py:24); it does not persist and there is no reset
inconsistency.

**5. Python Backend Specific** — Word/LibreOffice compatibility: generator uses
the built-in "Table Grid" style (present in the default python-docx template),
explicit `RGBColor` values, Calibri set per-run, and sets both column widths and
per-cell widths on the line-item table — the known python-docx pitfalls are
handled; the solicitation-info and header tables set only `columns[].width`
(LibreOffice honors it; older Word builds can ignore column-only widths — minor).
The `w:cantSplit`/`w:tblHeader` and `w:shd` injections use correct namespacing.
No compatibility blocker found. XLSX merged cells: M-12. No-line-items: handled
without crashing at every layer (placeholder row / 0-row table render correctly).
Max-size before parse: yes (WSGI layer). Determinism: M-6 (attachments ordering)
is the only violation found.

**6. Phase Completion Verification** — see dedicated section below.

**7. Testing** — see Test Suite Output + answers below.

**8. Production Readiness** — print() inventory below; H-1 (psutil), H-2
(.env.example), L-9, L-16. Server binds 127.0.0.1 only: **confirmed**
(server.py:608). Startup banner says `http://localhost:{port}` (cosmetic).

---

## Phase Completion Verification — Backend

| # | Check | Verdict |
|---|-------|---------|
| 1 | Phase 6: warnings in extract_data() AND parse_solicitation_bundle() | **FAIL** |
| 2 | Phase 6: W911 amendment concatenation | **PASS** |
| 3 | Phase 7: compute_confidence() call site and ordering | **PASS** |
| 4 | Phase 8: _ai_call_count increments after success | **PASS** |
| 5 | Phase 8: multi-chunk counts as one call | **PASS** |
| 6 | Phase 10: add_table cols=len(hdrs) | **PASS** |
| 7 | Phase 10: include_signature wraps only signature content | **PASS** |

### 1. Phase 6 — extraction_warnings in both call sites: **FAIL**

`parse_solicitation_bundle()` assembles warnings at extractor.py:1373–1383:

```python
    # ── assemble extraction_warnings ─────────────────────────────────────────
    warnings = []
    for _field in ["solicitation_number", "due_date", "contact_email", "naics_code"]:
        _val = data.get(_field)
        if not _val or str(_val).strip() == "":
            warnings.append({"code": "missing_field", "field": _field})
    if data.get("_format") == "unknown":
        warnings.append({"code": "unknown_format"})
    if not data.get("line_items"):
        warnings.append({"code": "no_line_items", "source": "fallback_single_row"})
    data["extraction_warnings"] = warnings
```

`extract_data()` (extractor.py:655–689) contains **no** `extraction_warnings`
assembly — the string does not appear anywhere in the function. The second
required call site is missing. Practical impact: results obtained via
`extract_data()` directly (run.py single-file mode, generation mode) carry no
warnings, and `compute_confidence()` reading `result.get("extraction_warnings",
[])` on such a dict sees none. Production `/parse` is unaffected because it
always routes through the bundle function.

### 2. Phase 6 — W911S225U14310001 amendment concatenation: **PASS**

extractor.py:174–184:

```python
    _update_m = re.search(
        r"^[A-Z0-9\-]+:\s+Combined\s+Synopsis/Solicitation\b.*?\bUpdate:\s*(\d+)\b",
        text, re.MULTILINE | re.DOTALL | re.IGNORECASE
    )
    if _update_m and d.get("solicitation_number"):
        suffix = _update_m.group(1)
        if not d["solicitation_number"].endswith(suffix):
            d["solicitation_number"] = d["solicitation_number"] + suffix
```

Confirmed working by the live test run: the W911S225U14310001 fixture extracts
the full concatenated number and passes with 7/7 exact field matches.

### 3. Phase 7 — compute_confidence() exists and fires after warnings: **PASS**

`compute_confidence()` is defined at extractor.py:1208. Call site is the
second-to-last statement of `parse_solicitation_bundle()`:

```python
1383    data["extraction_warnings"] = warnings
1384    if warnings:
1385        print(f"[parse_solicitation_bundle] warnings={warnings}")
1386
1387    data["confidence"] = compute_confidence(data)
1388    return data
```

Line 1387 executes after line 1383 — ordering is correct, so the confidence
block's `warnings` copy (extractor.py:1297) sees the assembled list.

### 4. Phase 8 — _ai_call_count increments after success, outside try: **PASS**

server.py:371–373:

```python
    # Increment ONCE after all chunks complete successfully.
    # Failed calls (caught above) do not consume quota.
    _ai_call_count += 1
```

The increment is lexically **after** the entire `try/except` construct
(try begins line 305; the last except handler at lines 365–369 `return`s).
Every exception path returns before reaching line 373, so the counter is only
reached on success. Confirmed not inside the try block.

### 5. Phase 8 — multi-chunk extraction counts as ONE call: **PASS**

The chunk loop is at server.py:332–351 (`for chunk in chunks:` inside the try
block). There is no increment inside the loop; the single `_ai_call_count += 1`
at line 373 executes once after the loop and the try/except complete. Confirmed.

### 6. Phase 10 — add_table uses cols=len(hdrs): **PASS**

generator.py:189:

```python
    lt=doc.add_table(rows=1+len(line_items)+1,cols=len(hdrs)); lt.style="Table Grid"; lt.autofit=False
```

Not hardcoded to 7 — correctly 8 for apparel, 7 for services/standard.

### 7. Phase 10 — include_signature wraps only the signature table: **PASS**

generator.py:284–302:

```python
    # Signature
    if inc_signature:                                  # 4-space indent
        heading("AUTHORIZED SIGNATURE", sb=18)         # 8-space (inside if)
        ...
        sigline(rsc,"Email",...); sigline(rsc,"SAM UEI",...)   # 8-space (last line of if)
    doc.add_paragraph()                                # 4-space — OUTSIDE the if
    fp=doc.add_paragraph(); fp.alignment=WD_ALIGN_PARAGRAPH.CENTER   # 4-space — OUTSIDE
    run(fp,f"Quote valid for {vendor.get('validity_period','30 days')} from {today}.", ...)  # OUTSIDE
```

The three lines after the if block (the trailing blank paragraph at line 299 and
the validity footer at lines 300–302) are at function-body indentation (4
spaces), not inside the conditional. The footer renders regardless of the
signature toggle, as specified.

---

## Test Suite Output

`python testdata/run.py` — exit code **0**. Full verbatim output:

```
----------------------------------------------------
FIXTURE: 18Q0042
[detect_format] scores={'sam_export': 0, 'agency_form': 0, 'formal_rfq': 2, 'sf1449': 3} -> sf1449
Detected format: sf1449
  Extracted (single)
  Format          : sf1449
  Solicitation #  : N0016418Q0042
  Line items      : 0
  Format detected : sf1449 (expected: sf1449)  OK
  Line items      : 0 extracted, expected 0  OK
  Required fields : solicitation_number OK,  due_date OK,  contact_email OK,  naics_code OK
  Fields          : 6 exact, 0 partial, 0 mismatch / 6 compared
  Result          : PASS
----------------------------------------------------
FIXTURE: 36C24225Q0696
[detect_format] scores={'sam_export': 0, 'agency_form': 6, 'formal_rfq': 0, 'sf1449': 0} -> agency_form
Detected format: agency_form
  Extracted (single)
  Format          : agency_form
  Solicitation #  : 36C24225Q0696
  Line items      : 0
  Format detected : agency_form (expected: agency_form)  OK
  Line items      : 0 extracted, expected 0  OK
  Required fields : solicitation_number OK,  due_date OK,  contact_email OK,  naics_code OK,  contact_name OK
  Fields          : 10 exact, 0 partial, 1 mismatch / 11 compared
    WARN  place_of_performance         got "Buffalo VA Medical Center, Batavia VA Medical Center, 3"
                                       exp "Buffalo VA Medical Center, 3495 Bailey Avenue, Buffalo "
  Result          : PASS (with 1 field warning(s))
----------------------------------------------------
FIXTURE: 70B06C26Q00000080
[parse_solicitation_bundle] 70B06C26Q00000080+Attachment+1+-+LLSM+SOW.pdf -> role=sow, chars=72905
[parse_solicitation_bundle] 70B06C26Q00000080+Attachment+2-Pricing+Sheeet.xlsx -> role=pricing, chars=0
[detect_format] scores={'sam_export': 0, 'agency_form': 0, 'formal_rfq': 0, 'sf1449': 11} -> sf1449
[parse_solicitation_bundle] 70B06C26Q00000080.pdf -> role=main, chars=174674
[detect_format] scores={'sam_export': 0, 'agency_form': 0, 'formal_rfq': 0, 'sf1449': 11} -> sf1449
Detected format: sf1449
[parse_solicitation_bundle] line_items=118 (sow=118, pricing=118)
  Extracted (bundle)
  Format          : sf1449
  Solicitation #  : 70B06C26Q00000080
  Line items      : 118
  Format detected : sf1449 (expected: sf1449)  OK
  Line items      : 118 extracted, expected 118  OK
  Required fields : solicitation_number OK,  due_date OK,  contact_email OK,  naics_code OK,  set_aside OK
  Fields          : 11 exact, 2 partial, 0 mismatch / 13 compared
    PART  period_of_performance        (substring match)
    PART  scope_of_work                (substring match)
  Sample items    : all 3 found OK
  Result          : PASS
----------------------------------------------------
FIXTURE: N5005426Q0114_CSS_03312026
[detect_format] scores={'sam_export': 10, 'agency_form': 0, 'formal_rfq': 0, 'sf1449': 0} -> sam_export
Detected format: sam_export
  Extracted (single)
  Format          : sam_export
  Solicitation #  : N5005426Q0114
  Line items      : 0
  Format detected : sam_export (expected: sam_export)  OK
  Line items      : 0 extracted, expected 0  OK
  Required fields : solicitation_number OK,  due_date OK,  contact_email OK,  naics_code OK
  Fields          : 7 exact, 0 partial, 0 mismatch / 7 compared
  Result          : PASS
----------------------------------------------------
FIXTURE: request-for-quotation
[detect_format] scores={'sam_export': 0, 'agency_form': 0, 'formal_rfq': 6, 'sf1449': 0} -> formal_rfq
Detected format: formal_rfq
  Extracted (single)
  Format          : formal_rfq
  Solicitation #  : 69056725Q000044
  Line items      : 0
  Format detected : formal_rfq (expected: formal_rfq)  OK
  Line items      : 0 extracted, expected 0  OK
  Required fields : solicitation_number OK,  due_date OK,  contact_email OK,  naics_code OK
  Fields          : 14 exact, 0 partial, 0 mismatch / 14 compared
  Result          : PASS
----------------------------------------------------
FIXTURE: W911S225U14310001_CSS_08062025
[detect_format] scores={'sam_export': 10, 'agency_form': 0, 'formal_rfq': 0, 'sf1449': 0} -> sam_export
Detected format: sam_export
  Extracted (single)
  Format          : sam_export
  Solicitation #  : W911S225U14310001
  Line items      : 0
  Format detected : sam_export (expected: sam_export)  OK
  Line items      : 0 extracted, expected 0  OK
  Required fields : solicitation_number OK,  due_date OK,  contact_email OK,  naics_code OK
  Fields          : 7 exact, 0 partial, 0 mismatch / 7 compared
  Result          : PASS
====================================================
SUMMARY: 6 fixture(s) validated, 0 skipped (no expected output)
  PASS : 6
```

(The known 36C24225Q0696 `place_of_performance` WARN appears as documented and
is not counted as a finding.)

### Testing — answers to the brief's specific questions

**Extraction functions with no fixture coverage:**
- `ai_extract()` — never exercised (no API key; also see C-1)
- `extract()` alias / SAM.gov path of `extract_line_items()` — only reachable
  via `/sam_lookup`, untested
- `_extract_clin_items()` — the CLIN fallback never fires for any fixture
  (the only bundle fixture has SOW items; single fixtures never reach the
  fallback because run.py bypasses the bundle path — see H-5)
- `extract_pricing_spreadsheet()` stdlib (non-openpyxl) fallback branch
- `apply_generic_fallback()` — incidental partial coverage only; no fixture has
  `_format == "unknown"`
- `compute_confidence()` and the warnings assembly — exercised only by the one
  bundle fixture; its output values are never asserted against expected results
- `classify_document()` content-based branches ("Statement of Work" in text,
  `4.x.x` heuristic) — only filename-based branches are hit by fixtures
- document_loader: `_load_zip_bundle()` SAM-zip branch, `_load_docx()`,
  `_load_text()` — all fixtures are real PDFs + one XLSX
- `parse_pdf()`/`parse_docx()` — dead code (L-2)

**Does run.py test generator.py output?** Only in `--solicitation` generation
mode, which is manual and not part of the default fixture run. Fixture mode
(the mode gating phase completion) never calls `generate_quote()`, and even
generation mode only writes the .docx to disk — nothing inspects the document
content.

**End-to-end parse→generate test?** **None.** There is no automated path that
parses a fixture and feeds the result through `generate_quote()` with
assertions. The closest is manual: `run.py --solicitation <pdf>` + opening the
output in Word.

**Corrupted PDF behavior:** In bundle mode, `load_document()` returns an error
`DocumentResult` and the run degrades gracefully (empty fields). In single-file
mode — 5 of 6 fixtures — `run_extraction()` calls `parse_document()`, which
**raises ValueError** (extractor.py:53) on total extraction failure. Nothing in
`run_fixture_mode()` catches it, so the harness dies with an unhandled traceback
instead of reporting a per-fixture ERROR and continuing. Not graceful.

---

## Production Readiness — print() Inventory

The project uses `print()` for logging by convention. Classification:

| File:Line | Statement | Classification |
|-----------|-----------|----------------|
| server.py:120 | `[startup] Removed N stale temp file(s)` | Operational (but the sweep is vestigial — M-2) |
| server.py:130 | `[SolicitationQuoter] Parent exited — shutting down` | Operational |
| server.py:489 | `[session] Manifest write failed (non-fatal)` | Operational |
| server.py:607 | `[SolicitationQuoter] Running on http://localhost:{port}` | Operational |
| extractor.py:18, 26 | `pdfplumber/pypdf failed: {e}` | Operational (in dead functions — L-2) |
| extractor.py:130, 133 | `[detect_format] scores={...}` | **Debug-leaning** — per-parse internal scoring dump; fine for a log file, but it prints on every parse including test runs. Keep or demote consciously. |
| extractor.py:657 | `Detected format: {name}` | Operational (redundant with the line above — one of the two could go) |
| extractor.py:687 | `AI failed, using rules: {e}` | Operational (in the C-1 code path) |
| extractor.py:1324, 1363, 1371, 1385 | `[parse_solicitation_bundle] ...` | Operational |
| document_loader.py:106, 124 | `pdfplumber/pypdf failed` | Operational |
| document_loader.py:166 | `Missing page text ... (skipping)` | Operational |
| generator.py:105 | `Logo insert failed: {_e}` | Operational |

No clearly-removable debug prints; the `detect_format` scores dump is the only
borderline case.

**Other production-readiness answers:**
- `requirements.txt`: exists at `python/requirements.txt` (7 packages, listed in
  L-16). **`psutil` is missing — H-1.** No known-vulnerable floors identified.
- `.env.example`: **absent — H-2 (High).**
- Flask binding: `app.run(host="127.0.0.1", ...)` — **127.0.0.1 only, correct.**
- Debug mode: `debug=False` — **correct.**

---

## Recommended Fix Order — Backend

1. **C-1** — Remove the silent env-key AI branch from `extract_data()`
   (extractor.py:674–688). One-line gate change; highest privacy/cost risk.
   Verify `/parse` never contacts Anthropic even with a key configured.
2. **H-1** — Add `psutil` to `python/requirements.txt` and confirm it is in the
   PyInstaller bundle. Likely eliminates the zombie-process failure mode.
3. **H-2** — Create `.env.example` documenting `ANTHROPIC_API_KEY`,
   `AI_MAX_CALLS`, `AI_HEADER_MODEL`, `AI_LINE_ITEM_MODEL`, `PORT`,
   `PARENT_PID` (and a root README/install note if Session 2 confirms none
   exists for the frontend either).
4. **H-3** — Make the parse timeout real: shut the executor down without
   waiting (`cancel_futures`/`wait=False`) so the 408 returns at 30 s.
5. **H-4** — Either add warning assembly to `extract_data()` (extract the
   warnings block into a `_assemble_warnings(data)` helper called from both
   sites), or formally amend the Phase 6 criteria — the current state fails the
   stated completion check.
6. **H-5** — Route all run.py fixtures through `parse_solicitation_bundle()`
   so tests exercise the production path; add a per-fixture try/except so a
   corrupted fixture reports ERROR instead of killing the harness.
7. **M-1 / M-7** — Wrap the unguarded statements in `extract_ai_route` and
   validate `/generate_quote` numeric vendor fields; stop returning raw
   `str(e)` to the UI.
8. **M-4** — Surface `DocumentResult.error` from the bundle path so encrypted/
   scanned PDFs get a specific user-facing message.
9. **M-3** — Stop reflecting `Origin: null`; consider a shared-secret header
   from Electron.
10. **M-2** — Delete the dead temp-file subsystem (`_active_tmp_files`, the
    atexit handler, `_startup_sweep`, `TMP_PREFIX`) and fix/remove
    `ALLOWED_EXTENSIONS`.
11. **M-6** — `sorted(set(atts))` for deterministic attachments.
12. **M-5** — Delete or fix the `_scope_block.__func__` no-op line.
13. Remaining Mediums (M-8 through M-13) and Lows: triage post-delivery;
    document any deferred items for the client (especially M-12 XLSX
    merged-cell/multi-sheet limits, L-6 `.doc` rejection).

---

*End of backend audit — Session 1 of 2. Session 2 covers the Electron frontend.*
