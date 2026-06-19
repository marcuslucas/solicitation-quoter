# Sol-Quoter — Phase Prompts 6–10
## Planning + Implementation

Workflow per phase:
1. Run PLANNING prompt in Claude Code — no code written
2. Review output with senior engineer before proceeding
3. Run IMPLEMENTATION prompt in Claude Code
4. Validate against acceptance criteria
5. Proceed to next phase

Do not run the implementation prompt without reviewing the planning output first.
Do not skip phases. Phase 8 requires Phase 6 and 7 to be complete.

---

# PHASE 6 — Extractor Hardening

---

## PLANNING PROMPT — Phase 6

```
Read the following files in full before responding. Do not write any code.

  - python/extractor.py
  - python/document_loader.py
  - testdata/run.py
  - docs/plans/sol-quoter-roadmap-phases-6-10.md (Phase 6 section)

This phase has four goals:
  1. Diagnose and fix the W911S225U14310001 solicitation number truncation bug
  2. Improve detect_format() scoring for SAM export variants
  3. Add extraction_warnings list to every parse result
  4. Write _expected_output.json for the 3 unvalidated fixtures

Before planning anything, run the extractor against these two fixtures and
report what it actually produces:

  testdata/test_solicitations/W911S225U14310001_CSS_08062025/
  testdata/test_solicitations/N5005426Q0114_CSS_03312026/

For EACH fixture, answer:
  1. What does detect_format() return? Show the full scores dict.
  2. Which extract_* function is called as a result?
  3. What is the full returned dict? Show every key-value pair.
  4. How many line items are extracted? Which code path produced them —
     extract_sow_line_items(), _extract_clin_items(), or the single-row fallback?
  5. Which fields are empty strings?
  6. What is the solicitation_number value returned?

For W911S225U14310001 specifically:
  - The extractor returns "W911S225U1431" (missing the last 4 characters "0001")
  - Find the exact regex pattern responsible for this truncation
  - Show the pattern, explain why it truncates, and propose the corrected pattern
  - Do not apply the fix yet

For N5005426Q0114 specifically:
  - Show the full score dict from detect_format()
  - If it does not return sam_export, identify which fingerprint patterns are
    failing to match and why

Then answer these structural questions:

  7. In detect_format(), what is the current minimum score threshold to return
     a format name rather than 'unknown'? Show the exact line.
  8. What sam_export fingerprint patterns currently exist? Are any of them
     fragile to SAM.gov export format variation (e.g. labeling differences)?
  9. In parse_solicitation_bundle(), where is extraction_warnings currently
     populated? If it does not exist yet, confirm it is absent.
  10. What is the exact return statement of parse_solicitation_bundle()?
      Show the 10 lines before it.

Then produce an implementation plan covering:
  A. The corrected regex for the W911 solicitation number truncation
  B. The specific detect_format() scoring additions needed for SAM export
     (based on what failed in the diagnostic above — not guesses)
  C. The exact shape and population logic for extraction_warnings
  D. Where in parse_solicitation_bundle() extraction_warnings gets assembled
     and attached to the result dict
  E. The conditions that trigger each warning code:
       - "missing_field" — which fields, checked how
       - "unknown_format" — when format == 'unknown'
       - "no_line_items" — when both SOW and CLIN paths returned zero items
  F. The v2 _expected_output.json schema and what values to write for each
     of the three unvalidated fixtures after the fixes are applied
  G. The exact order changes must be applied to avoid intermediate breakage
  H. Regression risk: which existing passing tests could be affected by each change?

Plan only. No code changes.
```

---

## IMPLEMENTATION PROMPT — Phase 6

```
Read the following files in full before making any changes:
  - python/extractor.py
  - python/document_loader.py
  - testdata/run.py
  - All existing _expected_output.json files in testdata/test_solicitations/
  - The planning output you just produced for Phase 6

Implement exactly what the plan specifies. Make changes in this order:

CHANGE 1 — Fix solicitation number truncation (W911S225U14310001)
Apply the corrected regex pattern identified in planning.
Change only the specific pattern — do not refactor surrounding code.
Show the before and after pattern.

CHANGE 2 — Improve detect_format() for SAM export variants
Add the fingerprint patterns identified in the planning diagnostic.
Do not change the minimum score threshold.
Do not touch agency_form, formal_rfq, or sf1449 scoring.
Show only the added lines.

CHANGE 3 — Add extraction_warnings to parse_solicitation_bundle()
Add an extraction_warnings list assembled at the end of parse_solicitation_bundle(),
before the return statement.

Warning codes and conditions:
  {"code": "missing_field", "field": "<name>"} — for each of these fields if empty:
    solicitation_number, due_date, contact_email, naics_code
  {"code": "unknown_format"} — if detect_format() returned 'unknown'
  {"code": "no_line_items", "source": "fallback_single_row"} — if line_items has
    exactly 1 item with description == solicitation_number or project_title
    (i.e. the single-row fallback in extract_line_items() was used)

Attach to result: result["extraction_warnings"] = warnings

This list must always be present in the returned dict, even if empty.

CHANGE 4 — Write _expected_output.json for 3 unvalidated fixtures
After applying Changes 1–3, run the extractor against these fixtures:
  testdata/test_solicitations/W911S225U14310001_CSS_08062025/
  testdata/test_solicitations/N5005426Q0114_CSS_03312026/
  testdata/test_solicitations/18Q0042/

For each, create _expected_output.json with this exact schema:
  {
    "_schema_version": 2,
    "solicitation_number": "<extracted value>",
    "format": "<extracted format>",
    "line_item_count": <integer>,
    "required_fields": ["solicitation_number", "due_date", "contact_email", "naics_code"],
    "line_items_sample": [],
    "notes": "<note any field that looks wrong or incomplete>"
  }

Populate from actual extractor output — these are regression baselines.
If a field looks incorrect, note it in "notes" but still use the extracted value.
Do not fabricate expected values.

VALIDATION — run all of these and report full output before finishing:

Test 1 — Solicitation number fix:
  python3 -c "
  import sys; sys.path.insert(0, 'python')
  from extractor import parse_solicitation_bundle
  import glob, os
  pdf = glob.glob('testdata/test_solicitations/W911S225U14310001_CSS_08062025/*.pdf')[0]
  result = parse_solicitation_bundle([{'path': pdf, 'filename': os.path.basename(pdf)}])
  print('solicitation_number:', result.get('solicitation_number'))
  print('Expected: W911S225U14310001')
  print('PASS' if result.get('solicitation_number') == 'W911S225U14310001' else 'FAIL')
  "

Test 2 — SAM export detection:
  python3 -c "
  import sys; sys.path.insert(0, 'python')
  from extractor import parse_document, detect_format
  import glob
  for fixture in ['W911S225U14310001_CSS_08062025', 'N5005426Q0114_CSS_03312026']:
    pdf = glob.glob(f'testdata/test_solicitations/{fixture}/*.pdf')[0]
    text = parse_document(pdf)
    fmt = detect_format(text)
    print(f'{fixture}: {fmt}')
  "

Test 3 — extraction_warnings present:
  python3 -c "
  import sys, json; sys.path.insert(0, 'python')
  from extractor import parse_solicitation_bundle
  import glob, os
  pdf = glob.glob('testdata/test_solicitations/70B06C26Q00000080/*.pdf')[0]
  result = parse_solicitation_bundle([{'path': pdf, 'filename': os.path.basename(pdf)}])
  warnings = result.get('extraction_warnings')
  print('extraction_warnings present:', warnings is not None)
  print('type:', type(warnings))
  print('value:', warnings)
  print('PASS' if isinstance(warnings, list) else 'FAIL')
  "

Test 4 — Full regression suite:
  python testdata/run.py

Expected:
  - Test 1: PASS — full W911S225U14310001 returned
  - Test 2: both fixtures return sam_export
  - Test 3: extraction_warnings is a list (empty [] for clean 70B parse)
  - Test 4: all 6 fixtures validated, 0 skipped, exit 0

Report the complete output of all four tests before finishing.
Do not mark the phase complete unless Test 4 shows exit 0.
```

---

---

# PHASE 7 — Confidence Scoring

---

## PLANNING PROMPT — Phase 7

```
Read the following files in full before responding. Do not write any code.

  - python/extractor.py
  - python/server.py
  - electron/js/modules/step2.js
  - electron/js/modules/state.js
  - docs/plans/sol-quoter-roadmap-phases-6-10.md (Phase 7 section)

Phase 6 must be complete before this phase. Confirm extraction_warnings is
present in parse_solicitation_bundle()'s return value before proceeding.

Before planning, answer these questions:

  1. In parse_solicitation_bundle(), is extraction_warnings now present in the
     return dict? Show the exact lines where it is assembled and attached.

  2. In server.py, what does the /api/sol-quoter/parse route return?
     Show the exact jsonify() call and the full shape of the response object.
     Is confidence currently a key in the response?

  3. In step2.js, where is the parsed solicitation data first received?
     Show the function or event handler that receives the /parse response
     and stores it into window.S.

  4. In step2.js, where is the Step 2 screen rendered? Show the function
     signature and the first 20 lines of the render function.

  5. Does step2.js currently render any kind of status banner or alert at
     the top of the screen? If yes, show it. If no, confirm it is absent.

  6. In index.html or the shared CSS, is there a banner/alert component
     already defined? Show the relevant CSS classes and their styles.

  7. What is the current shape of window.S.sol? List all top-level keys.
     Specifically: does it currently have a 'confidence' key?

Then produce an implementation plan covering:

  A. The confidence dict schema — exact keys and value ranges:
       overall (float 0.0–1.0, weighted average)
       format_detection (1.0 known / 0.5 low-score / 0.0 unknown)
       required_fields (fraction of 4 required fields that are non-empty)
       line_items (1.0 SOW+XLSX / 0.7 SOW-only / 0.4 CLIN / 0.1 single-row)
       warnings (copy of extraction_warnings list from Phase 6)

  B. The compute_confidence(result) function:
       - Where in extractor.py it lives
       - Where it is called (end of parse_solicitation_bundle, before return)
       - The named weight constants and their values
       - How it determines the line_items score (which field or combination
         of fields to inspect to determine SOW+XLSX vs SOW-only vs CLIN vs fallback)
       - How format_detection score maps from detect_format() output

  C. How confidence flows into the /parse response:
       - Does server.py need to change, or does it pass through automatically?
       - What is the exact JSON key path the frontend reads it from?

  D. The Step 2 confidence UI:
       - Where in step2.js to insert the banner (before or after the existing
         field list — and why)
       - The exact HTML structure for the three states:
           green (overall >= 0.8): subtle indicator, no interruption
           amber (0.5–0.79): visible banner with warning list
           red (< 0.5): prominent banner with message about AI extraction
       - How warnings are rendered (list each warning code with human-readable text)
       - The CSS needed (use only existing CSS variables — no new colors)

  E. Exact validation steps to confirm the feature works end to end

Plan only. No code.
```

---

## IMPLEMENTATION PROMPT — Phase 7

```
Read the following files in full before making any changes:
  - python/extractor.py
  - python/server.py
  - electron/js/modules/step2.js
  - electron/index.html (CSS section only — look for banner/alert classes)
  - The planning output you just produced for Phase 7

Implement exactly what the plan specifies. Make changes in this order:

CHANGE 1 — Add compute_confidence() to extractor.py

Add this function above parse_solicitation_bundle():

  # Confidence weight constants — adjustable
  _CONF_WEIGHT_FORMAT = 0.3
  _CONF_WEIGHT_FIELDS = 0.4
  _CONF_WEIGHT_ITEMS  = 0.3

  def compute_confidence(result: dict) -> dict:
      """
      Compute a structured confidence score for an extraction result.
      Called at end of parse_solicitation_bundle() before return.
      """

Rules for each sub-score:
  format_detection:
    1.0 if result["format"] in ("sf1449","sam_export","agency_form","formal_rfq")
    0.5 if result["format"] == "unknown" but score was >= 1 (partial match)
    0.0 if result["format"] == "unknown" and score was 0
    Use the extraction_warnings list to determine: if any warning has
    code == "unknown_format", use 0.0, else 1.0

  required_fields:
    Count non-empty values for: solicitation_number, due_date, contact_email, naics_code
    Score = count / 4

  line_items:
    Inspect result.get("line_items", []):
    - If any item has _source == "SOW+XLSX": 1.0
    - Elif any item has _source in ("SOW", "XLSX"): 0.7
    - Elif any item has _source == "CLIN": 0.4
    - Elif len(line_items) == 1 and item description == solicitation_number: 0.1
    - Elif len(line_items) == 0: 0.0
    - Else: 0.5 (items present but source unclear)

  overall:
    (_CONF_WEIGHT_FORMAT * format_detection +
     _CONF_WEIGHT_FIELDS * required_fields +
     _CONF_WEIGHT_ITEMS  * line_items)
    Round to 2 decimal places.

  warnings:
    Copy of result.get("extraction_warnings", [])

Return dict:
  {
    "overall": <float>,
    "format_detection": <float>,
    "required_fields": <float>,
    "line_items": <float>,
    "warnings": [...]
  }

CHANGE 2 — Call compute_confidence() in parse_solicitation_bundle()

At the end of parse_solicitation_bundle(), immediately before the return statement:
  data["confidence"] = compute_confidence(data)
  return data

CHANGE 3 — Verify server.py passes confidence through

Check the /api/sol-quoter/parse route's jsonify() call.
If it passes the full result dict (e.g. jsonify(result)), no change needed.
If it selectively picks keys, add "confidence" to the list.
Report what you found and what (if anything) you changed.

CHANGE 4 — Add confidence banner to step2.js

Find the step2 render function. At the very top of the rendered HTML content,
before the field list, insert a confidence banner.

The banner reads window.S.sol.confidence and renders:

Green state (overall >= 0.8):
  <div class="confidence-bar confidence-bar--green">
    <span class="confidence-label">Extraction confidence: high</span>
    <span class="confidence-score">${(overall * 100).toFixed(0)}%</span>
  </div>

Amber state (0.5 <= overall < 0.8):
  <div class="confidence-bar confidence-bar--amber">
    <span class="confidence-label">Extraction confidence: moderate — review fields below</span>
    <span class="confidence-score">${(overall * 100).toFixed(0)}%</span>
    ${warningListHtml}
  </div>

Red state (overall < 0.5):
  <div class="confidence-bar confidence-bar--red">
    <span class="confidence-label">Extraction confidence: low — review all fields carefully</span>
    <span class="confidence-score">${(overall * 100).toFixed(0)}%</span>
    ${warningListHtml}
    <div class="confidence-hint">AI-assisted extraction will be available in a future update.</div>
  </div>

If window.S.sol.confidence is absent (old session data): render nothing.

warningListHtml renders each warning with human-readable text:
  code "missing_field"   → "Field not found: <field>"
  code "unknown_format"  → "Document format not recognized"
  code "no_line_items"   → "No line items extracted — single placeholder row used"

CHANGE 5 — Add CSS for confidence bar to index.html

Add to the <style> block in index.html:
  .confidence-bar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    border-radius: 6px;
    margin-bottom: 16px;
    font-size: 13px;
    flex-wrap: wrap;
  }
  .confidence-bar--green { background: color-mix(in srgb, var(--color-success) 12%, transparent); border: 1px solid color-mix(in srgb, var(--color-success) 30%, transparent); }
  .confidence-bar--amber { background: color-mix(in srgb, var(--color-warning) 12%, transparent); border: 1px solid color-mix(in srgb, var(--color-warning) 30%, transparent); }
  .confidence-bar--red   { background: color-mix(in srgb, var(--color-error)   12%, transparent); border: 1px solid color-mix(in srgb, var(--color-error)   30%, transparent); }
  .confidence-score { margin-left: auto; font-weight: 600; font-size: 14px; }
  .confidence-hint  { width: 100%; font-size: 12px; color: var(--color-text-muted); margin-top: 4px; }
  .confidence-warnings { width: 100%; margin-top: 4px; padding-left: 14px; color: var(--color-text-muted); font-size: 12px; }

If --color-success, --color-warning, or --color-error are not defined in the
existing CSS variables, report that and use safe fallbacks (green/amber/red hex
values that match the existing theme).

VALIDATION — run all of these and report full output before finishing:

Test 1 — compute_confidence() unit check:
  python3 -c "
  import sys; sys.path.insert(0, 'python')
  from extractor import parse_solicitation_bundle
  import glob, os, json

  # 70B bundle — expect high confidence
  files = [
    {'path': p, 'filename': os.path.basename(p)}
    for p in glob.glob('testdata/test_solicitations/70B06C26Q00000080/*')
    if not p.endswith('.json')
  ]
  result = parse_solicitation_bundle(files)
  c = result.get('confidence', {})
  print('70B confidence:', json.dumps(c, indent=2))
  print('overall >= 0.8:', c.get('overall', 0) >= 0.8)
  "

Test 2 — Low confidence fixture:
  python3 -c "
  import sys; sys.path.insert(0, 'python')
  from extractor import parse_solicitation_bundle
  import glob, os, json
  # Use whichever SAM fixture has the most missing fields
  pdf = glob.glob('testdata/test_solicitations/18Q0042/*.pdf')[0]
  result = parse_solicitation_bundle([{'path': pdf, 'filename': os.path.basename(pdf)}])
  c = result.get('confidence', {})
  print('18Q0042 confidence:', json.dumps(c, indent=2))
  "

Test 3 — Full regression suite:
  python testdata/run.py

Expected:
  - Test 1: 70B overall >= 0.8
  - Test 2: confidence dict present with expected sub-scores
  - Test 3: all fixtures pass, exit 0

Report full output of all three tests.
Do not mark the phase complete unless Test 3 shows exit 0.
```

---

---

# PHASE 8 — AI-Assisted Extraction

---

## PLANNING PROMPT — Phase 8

```
Read the following files in full before responding. Do not write any code.

  - python/server.py
  - python/extractor.py
  - electron/js/modules/step2.js
  - electron/js/modules/state.js
  - electron/preload.js
  - docs/plans/sol-quoter-roadmap-phases-6-10.md (Phase 8 section)

Phases 6 and 7 must be complete. Confirm before proceeding:
  - extraction_warnings is present in parse results
  - confidence dict is present in parse results and in window.S.sol
  - Confidence banner is rendering in Step 2

The architecture decisions in the roadmap Phase 8 section are locked.
Do not propose alternatives to them. Your job is to plan implementation
within those constraints.

Before planning, answer these questions:

  1. In server.py, show the /api/sol-quoter/parse route's jsonify() call
     and the full shape of what it returns. Does it currently read from .env?
     Show how other environment variables are loaded if any exist.

  2. In step2.js, show how the extracted fields are currently rendered.
     Are they editable <input> elements or read-only <div>/<span> elements?
     Show a representative sample of 3–4 field renders.

  3. In step2.js, show the existing fetch() call pattern — where step2
     currently makes a POST to the Flask server and handles the response.
     If step2 does not make direct fetch calls (relies on step1 result in
     window.S), confirm that and show where window.S.sol is set in step1.js.

  4. In preload.js, list all currently exposed contextBridge methods.
     Which ones are fetch wrappers vs IPC wrappers?

  5. Does a .env file exist at the project root? If yes, list all keys.
     If no, confirm its absence.

  6. What is the current full schema of window.S.sol (all top-level keys)?
     Does it currently have an 'aiUsage' key?

  7. In step2.js, show where window.S.sol fields are written back after
     the user edits them in Step 2. Are edits persisted to window.S.sol
     immediately on input, or only on "Next" click?

Then produce a complete implementation plan covering:

  A. .env setup:
       - Keys needed: ANTHROPIC_API_KEY, AI_MAX_CALLS_PER_SESSION (default 10),
         AI_HEADER_MODEL (default claude-haiku-4-5), AI_LINE_ITEM_MODEL (default claude-sonnet-4-6)
       - How server.py loads them (python-dotenv or os.environ)
       - The /api/sol-quoter/ai-status endpoint (GET) that returns
         {available: bool, calls_remaining: int} — used by frontend on Step 2 load
         to decide whether to show the AI panel

  B. Text chunking:
       - For headers: exactly how to extract the first 4000 chars of the main doc
         from the session manifest (which file is "main", how to read it)
       - For line items: how to chunk the SOW text into 6000-char segments with
         500-char overlap; what to do when there is no dedicated SOW file
       - Show the session manifest.json structure (from Phase 2) so the
         chunking code knows which file to read

  C. /api/sol-quoter/extract-ai endpoint:
       - Full route signature
       - Request body shape: {target: "headers"|"line_items"}
       - The exact system prompt strings for both targets (show full text)
       - The user message construction
       - How the response JSON is parsed and validated against the schema
       - Error handling: malformed JSON, API timeout (set 30s), rate limit (429),
         missing API key
       - Response shape: {result: {...}, tokens_used: int, model: str, target: str}
       - Call counter: how calls_remaining is tracked (in-memory on server is fine;
         resets on app restart — document this limitation)

  D. Step 2 UI changes:
       - Where the AI panel is inserted in the rendered HTML
       - The panel is only shown if /ai-status returns available: true
       - Panel states: collapsed (default), expanded (user clicked)
       - When confidence.overall < 0.6: panel starts expanded with banner
       - Toggle "Use AI Extraction" — off by default, must be explicitly enabled
       - When enabled: disclosure text shown ("Your document text will be sent
         to Anthropic's API...")
       - Two buttons: "Extract Headers with AI" / "Extract Line Items with AI"
       - Loading state during extraction (disable buttons, show spinner text)
       - Diff view after extraction (show before/after for each changed field)
       - Accept All / Discard buttons + per-field accept checkboxes
       - Error display if extraction fails

  E. mergeAiResult() function in step2.js:
       - Exact implementation
       - What "accepting" a change does to window.S.sol
       - What "discarding" does

  F. Token usage tracking:
       - window.S.aiUsage schema: {calls: int, tokens: int, model: str, lastTarget: str}
       - Where it is initialized in state.js
       - Where it is updated after each AI call
       - Where it is displayed in the UI (small text in the AI panel)

  G. Exact manual acceptance test sequence for the full flow

Plan only. No code. Be specific about line-level insertion points.
```

---

## IMPLEMENTATION PROMPT — Phase 8

```
Read the following files in full before making any changes:
  - python/server.py
  - python/extractor.py
  - electron/js/modules/step2.js
  - electron/js/modules/state.js
  - electron/preload.js
  - electron/main.js
  - The planning output you just produced for Phase 8

Implement exactly what the plan specifies. Make changes in this order:

CHANGE 1 — .env and server-side API key loading

If .env does not exist, create it at the project root:
  ANTHROPIC_API_KEY=
  AI_MAX_CALLS_PER_SESSION=10
  AI_HEADER_MODEL=claude-haiku-4-5
  AI_LINE_ITEM_MODEL=claude-sonnet-4-6

Add to .gitignore if not already present: .env

In server.py, add at the top (after existing imports):
  from dotenv import load_dotenv
  load_dotenv()

  _AI_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "").strip()
  _AI_MAX_CALLS = int(os.environ.get("AI_MAX_CALLS_PER_SESSION", "10"))
  _AI_HEADER_MODEL = os.environ.get("AI_HEADER_MODEL", "claude-haiku-4-5")
  _AI_LINE_ITEM_MODEL = os.environ.get("AI_LINE_ITEM_MODEL", "claude-sonnet-4-6")
  _ai_call_count = 0  # resets on app restart

If python-dotenv is not in requirements.txt, add it.

CHANGE 2 — GET /api/sol-quoter/ai-status endpoint

Add to server.py:
  @app.route("/api/sol-quoter/ai-status", methods=["GET"])
  def ai_status_route():
      available = bool(_AI_API_KEY)
      calls_remaining = max(0, _AI_MAX_CALLS - _ai_call_count)
      return jsonify({"available": available, "calls_remaining": calls_remaining})

CHANGE 3 — POST /api/sol-quoter/extract-ai endpoint

Add to server.py. The endpoint must:

  1. Check _AI_API_KEY — return 503 {"error": "AI extraction not configured"} if absent
  2. Check call counter — return 429 {"error": "AI call limit reached for this session"}
     if _ai_call_count >= _AI_MAX_CALLS
  3. Parse request body: {"target": "headers"|"line_items"}
  4. Read session manifest from get_session_dir() / manifest.json
     to find the main doc path (for headers) or SOW doc path (for line items)
  5. Read the file text (use parse_document() from extractor.py)
  6. Chunk the text:
     - headers: first 4000 characters of main doc text
     - line_items: SOW text in 6000-char chunks with 500-char overlap;
       if no SOW in manifest, use main doc text
  7. Call Anthropic API with 30-second timeout using the anthropic Python library:
       import anthropic
       client = anthropic.Anthropic(api_key=_AI_API_KEY)
  8. Increment _ai_call_count
  9. Parse response as JSON — if malformed, return 422 {"error": "AI returned invalid JSON"}
  10. Return {"result": parsed_dict, "tokens_used": int, "model": str, "target": str}

System prompt for target="headers":
  "You are extracting structured data from a government solicitation document.
  Return ONLY a valid JSON object. No markdown fences, no explanation, no preamble.
  If a field is not found in the text, use null — never an empty string.
  Extract exactly these fields:
  solicitation_number, project_title, due_date, contact_name, contact_email,
  contact_phone, naics_code, set_aside, place_of_performance,
  period_of_performance, issuing_agency, solicitation_type
  Return dates exactly as they appear in the document."

System prompt for target="line_items":
  "You are extracting line items from a government Statement of Work document.
  Return ONLY a valid JSON array. No markdown fences, no explanation, no preamble.
  Each element must have exactly these fields:
    sow_section (string, e.g. '4.1.1'), description (string), unit (string, e.g. 'EA'),
    qty (number or null), spec_text (string, first 500 chars of item description)
  Example output:
  [
    {\"sow_section\": \"4.1.1\", \"description\": \"Smoke Canister M201A1\",
     \"unit\": \"EA\", \"qty\": null, \"spec_text\": \"The contractor shall provide...\"}
  ]
  Extract every numbered line item. If qty is not specified, use null."

For line_items with multiple chunks: call the API once per chunk, merge results
(deduplicate by sow_section). Return combined array.

CHANGE 4 — Add aiUsage to state.js

In state.js, add to the default S object:
  aiUsage: { calls: 0, tokens: 0, model: null, lastTarget: null }

CHANGE 5 — Step 2 UI: AI panel

In step2.js, add the following logic:

On Step 2 render:
  1. Fetch GET /api/sol-quoter/ai-status
  2. Store result in a module-level variable: let aiStatus = {available: false, calls_remaining: 0}
  3. If available: render the AI panel HTML above the field list
  4. If not available: render nothing (no panel, no error)

AI panel HTML structure (render only when available):
  <div class="ai-panel" id="ai-panel">
    <div class="ai-panel-header" id="ai-panel-toggle">
      <span>AI-Assisted Extraction</span>
      <span class="ai-calls-remaining">${calls_remaining} calls remaining</span>
      <span class="ai-chevron">▸</span>
    </div>
    <div class="ai-panel-body hidden" id="ai-panel-body">
      <label class="ai-toggle-row">
        <input type="checkbox" id="ai-enable-toggle" />
        <span>Enable AI extraction for this session</span>
      </label>
      <div class="ai-disclosure hidden" id="ai-disclosure">
        Your document text will be sent to Anthropic's API to improve extraction
        accuracy. Text sent is limited to the first 4,000 characters for header
        fields, or the Statement of Work text for line items. No data is stored
        by Anthropic after processing.
      </div>
      <div class="ai-buttons hidden" id="ai-buttons">
        <button class="btn btn-ghost btn-sm" id="ai-extract-headers-btn">
          Extract Headers with AI
        </button>
        <button class="btn btn-ghost btn-sm" id="ai-extract-items-btn">
          Extract Line Items with AI
        </button>
        <span class="ai-usage-display" id="ai-usage-display"></span>
      </div>
      <div class="ai-diff hidden" id="ai-diff"></div>
    </div>
  </div>

Panel behavior:
  - Clicking ai-panel-toggle expands/collapses ai-panel-body
  - If confidence.overall < 0.6: panel starts expanded
  - Checking ai-enable-toggle shows ai-disclosure and ai-buttons
  - Unchecking hides them

AI extraction flow (wire these event handlers after render):

  async function doAiExtract(target) {
    const btn = document.getElementById(
      target === 'headers' ? 'ai-extract-headers-btn' : 'ai-extract-items-btn'
    )
    btn.disabled = true
    btn.textContent = 'Extracting...'

    try {
      const resp = await fetch('/api/sol-quoter/extract-ai', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({target})
      })
      if (!resp.ok) {
        const err = await resp.json()
        window.toast(err.error || 'AI extraction failed', 'error')
        return
      }
      const data = await resp.json()
      // Update usage tracking
      window.S.aiUsage.calls++
      window.S.aiUsage.tokens += data.tokens_used || 0
      window.S.aiUsage.model = data.model
      window.S.aiUsage.lastTarget = target
      // Show diff
      showAiDiff(data.result, target)
    } catch (e) {
      window.toast('AI extraction failed: ' + e.message, 'error')
    } finally {
      btn.disabled = false
      btn.textContent = target === 'headers' ? 'Extract Headers with AI' : 'Extract Line Items with AI'
      updateAiUsageDisplay()
    }
  }

mergeAiResult() — implement exactly as specified in Phase 8 roadmap:
  function mergeAiResult(current, aiResult) {
    const merged = { ...current }
    const changes = []
    for (const [key, value] of Object.entries(aiResult)) {
      if (value !== null && value !== current[key]) {
        changes.push({ field: key, before: current[key], after: value })
        merged[key] = value
      }
    }
    return { merged, changes }
  }

showAiDiff(aiResult, target):
  - Call mergeAiResult(window.S.sol, aiResult)
  - If no changes: show "AI found no improvements to the current extraction."
  - If changes: render a table showing field / before / after for each change
  - Each row has a checkbox (checked by default) for selective acceptance
  - "Accept Selected" button: applies only checked changes to window.S.sol, re-renders step2
  - "Discard All" button: closes diff view, no changes applied
  - Show diff in #ai-diff div (remove hidden class)

updateAiUsageDisplay():
  const el = document.getElementById('ai-usage-display')
  if (el && window.S.aiUsage.calls > 0) {
    el.textContent = `${window.S.aiUsage.calls} AI call${window.S.aiUsage.calls !== 1 ? 's' : ''} · ${window.S.aiUsage.tokens.toLocaleString()} tokens used`
  }

CHANGE 6 — Add CSS for AI panel to index.html

Add to <style> block:
  .ai-panel { border: 1px solid var(--color-border); border-radius: 6px; margin-bottom: 16px; overflow: hidden; }
  .ai-panel-header { display: flex; align-items: center; gap: 10px; padding: 10px 14px; cursor: pointer; font-size: 13px; font-weight: 500; background: var(--color-surface-raised); user-select: none; }
  .ai-panel-header:hover { background: var(--color-surface-hover, var(--color-surface-raised)); }
  .ai-calls-remaining { margin-left: auto; font-size: 12px; color: var(--color-text-muted); font-weight: 400; }
  .ai-chevron { font-size: 11px; color: var(--color-text-muted); transition: transform 0.15s; }
  .ai-panel.open .ai-chevron { transform: rotate(90deg); }
  .ai-panel-body { padding: 14px; display: flex; flex-direction: column; gap: 12px; }
  .ai-toggle-row { display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer; }
  .ai-toggle-row input { width: auto; margin: 0; }
  .ai-disclosure { font-size: 12px; color: var(--color-text-muted); line-height: 1.5; padding: 8px 10px; background: var(--color-surface); border-radius: 4px; }
  .ai-buttons { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .ai-usage-display { font-size: 11px; color: var(--color-text-muted); margin-left: auto; }
  .ai-diff table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .ai-diff th { text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--color-border); color: var(--color-text-muted); }
  .ai-diff td { padding: 4px 8px; border-bottom: 1px solid var(--color-border); vertical-align: top; }
  .ai-diff .diff-before { color: var(--color-text-muted); text-decoration: line-through; }
  .ai-diff .diff-after  { color: var(--color-success, #22c55e); }
  .ai-diff-actions { display: flex; gap: 8px; margin-top: 10px; }

VALIDATION — perform these tests manually and report results:

Test 1 — No API key:
  1. Remove ANTHROPIC_API_KEY from .env (or leave blank)
  2. Restart server, parse any fixture, go to Step 2
  3. Expected: no AI panel visible anywhere in Step 2

Test 2 — API key present, high confidence:
  1. Add valid ANTHROPIC_API_KEY to .env
  2. Parse 70B bundle (high confidence), go to Step 2
  3. Expected: AI panel visible but collapsed; confidence bar is green

Test 3 — AI header extraction:
  1. Parse W911 fixture (low confidence — red bar), go to Step 2
  2. AI panel should be expanded automatically
  3. Enable AI toggle — disclosure text appears
  4. Click "Extract Headers with AI"
  5. Expected: loading state shown, then diff view appears
  6. Verify diff shows field changes vs regex output
  7. Accept all — fields update in Step 2 form
  8. Usage counter shows "1 AI call · N tokens used"

Test 4 — Discard:
  1. Repeat extraction
  2. Click "Discard All" — no fields change, diff closes

Test 5 — Call limit:
  1. Set AI_MAX_CALLS_PER_SESSION=1 in .env, restart server
  2. Make 1 AI call — succeeds
  3. Make 2nd AI call — expect error toast "AI call limit reached for this session"

Test 6 — run.py regression:
  python testdata/run.py
  Expected: all fixtures pass, exit 0

Report results of all 6 tests before finishing.
```

---

---

# PHASE 9 — BBox Wiring + Test Coverage Closure

---

## PLANNING PROMPT — Phase 9

```
Read the following files in full before responding. Do not write any code.

  - electron/main.js
  - electron/preload.js
  - electron/pdfviewer.html
  - electron/js/modules/step2.js
  - testdata/run.py
  - docs/plans/sol-quoter-roadmap-phases-6-10.md (Phase 9 section)

This phase has two independent parts:
  Part A — Wire scrollPdfToBoundingBox (the no-op stub in step2.js)
  Part B — Close test coverage gaps (v2 schema + fixture validation)

PART A — BBox Wiring

Before planning, answer these questions:

  1. In main.js, show the exact open-pdf-viewer IPC handler. How does it
     currently open the viewer window? Does it store a reference to the
     BrowserWindow? Show the exact code including any viewerWin variable.

  2. In main.js, is there currently any mechanism to check if the viewer
     window is already open (i.e. not destroyed)? If yes, show it.
     If no, confirm it is absent and note where you would add it.

  3. In pdfviewer.html, how does the viewer currently receive its initial
     parameters (filePath, page, searchText)? Show the exact parsing code.

  4. In pdfviewer.html, is there a function that renders a specific page
     without reloading the whole viewer? Show its signature and body.

  5. In pdfviewer.html, what IPC channels does preload.js expose to it?
     Can pdfviewer.html currently receive IPC messages from main.js
     (i.e. is ipcRenderer.on() available in pdfviewer.html's context)?

  6. In step2.js, show the exact no-op stub at line ~10 and the click
     handler at lines ~215-225 that calls it. Show the data-bbox attribute
     format — what does the stored JSON look like?

  7. In step2.js, when a flagged field is clicked, what other data is
     available on the element besides data-bbox? (e.g. data-file, data-page,
     data-field — show all data attributes set on flagged field inputs)

PART B — Test Coverage

  8. For each of the three existing _expected_output.json files
     (36C24225Q0696, 70B06C26Q00000080, request-for-quotation),
     show all keys currently present. Which keys are missing from the v2 schema?
     v2 schema keys: _schema_version, solicitation_number, format,
     line_item_count, required_fields, line_items_sample, notes

  9. Run testdata/run.py and show the full output. Confirm all 6 fixtures
     pass (including the 3 added in Phase 6).

Then produce implementation plans for BOTH parts:

PLAN A — BBox Wiring:
  - The exact IPC architecture:
      step2.js → preload IPC call → main.js → (new window OR navigate existing)
      → pdfviewer.html receives via (hash params for new window / ipcRenderer for existing)
  - How main.js tracks the viewerWin reference safely (destroyed-check pattern)
  - How pdfviewer.html handles the "navigate-to-bbox" IPC message on an already-rendered page
  - How the bbox overlay is rendered: coordinate system conversion from PDF points
    to canvas pixels (accounting for current zoom/scale)
  - The visual spec for the bbox overlay: blue, semi-transparent, dashed border,
    positioned with absolute CSS over the canvas
  - Scroll behavior: after rendering the overlay, scroll it into view

PLAN B — Test Coverage:
  - The exact keys to add to each existing _expected_output.json (no value changes)
  - Confirm the 3 Phase 6 fixtures already have v2 schema (they should)
  - Confirm run.py handles _schema_version field correctly

Plans only. No code.
```

---

## IMPLEMENTATION PROMPT — Phase 9

```
Read the following files in full before making any changes:
  - electron/main.js
  - electron/preload.js
  - electron/pdfviewer.html
  - electron/js/modules/step2.js
  - testdata/run.py
  - All _expected_output.json files
  - The planning output you just produced for Phase 9

Implement PART A and PART B in order.

═══ PART A — BBox Wiring ═══

CHANGE 1 — main.js: track viewer window reference and handle navigation

At module scope in main.js, add:
  let viewerWin = null

Modify the open-pdf-viewer IPC handler:
  - Before opening a new window, check: if (viewerWin && !viewerWin.isDestroyed())
  - If viewer is alive: send IPC message to it instead of opening new window:
      viewerWin.webContents.send('navigate-to-bbox', { filePath, page, searchText, bbox })
      viewerWin.focus()
      return
  - If viewer is not alive (null or destroyed): create it as before, store reference:
      viewerWin = new BrowserWindow({...})
      viewerWin.on('closed', () => { viewerWin = null })

Update the open-pdf-viewer handler signature to accept bbox as 4th param:
  ipcMain.handle('open-pdf-viewer', (event, filePath, page, searchText, bbox) => {...})

CHANGE 2 — preload.js: update openPdfViewer to accept bbox

Update the contextBridge exposure:
  openPdfViewer: (filePath, page, searchText, bbox) =>
    ipcRenderer.invoke('open-pdf-viewer', filePath, page, searchText, bbox)

Also add ipcRenderer.on exposure for pdfviewer.html to receive navigation:
  onNavigateToBbox: (callback) =>
    ipcRenderer.on('navigate-to-bbox', (event, params) => callback(params))

CHANGE 3 — step2.js: replace the no-op stub

Replace:
  window.scrollPdfToBoundingBox = function() {}

With:
  window.scrollPdfToBoundingBox = async function(fieldEl) {
    const bboxRaw = fieldEl.dataset.bbox
    const fileRaw = fieldEl.dataset.file
    const pageRaw = parseInt(fieldEl.dataset.page) || 1
    const searchRaw = fieldEl.dataset.search || ''

    if (!bboxRaw || !fileRaw) return

    let bbox = null
    try { bbox = JSON.parse(bboxRaw) } catch (e) { return }

    const filePath = await window.api.getSessionFilePath(fileRaw)
    if (!filePath) {
      window.toast('Source file not available. Re-parse the solicitation.', 'error')
      return
    }

    await window.api.openPdfViewer(filePath, pageRaw, searchRaw, bbox)
  }

Verify the existing click handler (step2.js:~215-225) passes the element to
scrollPdfToBoundingBox. If it passes no argument or a different argument,
update the call to pass the fieldEl reference.

CHANGE 4 — pdfviewer.html: handle navigate-to-bbox IPC + bbox overlay

Add at initialization (after hash params are parsed):
  if (window.api.onNavigateToBbox) {
    window.api.onNavigateToBbox(async ({ filePath, page, searchText, bbox }) => {
      currentPage = page
      currentSearch = searchText
      currentBbox = bbox
      await renderPage(page)
    })
  }

Add currentBbox as a module-level variable (initialized to null).

After renderPage() completes and the canvas is drawn, call renderBboxOverlay().

renderBboxOverlay():
  - If currentBbox is null: remove any existing overlay and return
  - Get the canvas element and its current rendered dimensions
  - The PDF page has a natural size in points (page.getViewport({scale:1}).width/height)
  - The canvas is rendered at a scale factor — compute:
      const scaleX = canvas.width  / viewport.width   // where viewport is at scale 1
      const scaleY = canvas.height / viewport.height
  - PDF coordinate system has origin at bottom-left; canvas has origin at top-left
  - Convert bbox (x0, y0, x1, y1 in PDF points) to canvas pixels:
      const left   = currentBbox.x0 * scaleX
      const top    = (viewport.height - currentBbox.y1) * scaleY
      const width  = (currentBbox.x1 - currentBbox.x0) * scaleX
      const height = (currentBbox.y1 - currentBbox.y0) * scaleY
  - Create or reuse a div#bbox-overlay:
      position: absolute, pointer-events: none
      left/top/width/height as computed
      background: rgba(59, 130, 246, 0.15)
      border: 2px dashed rgba(59, 130, 246, 0.8)
      border-radius: 2px
  - Position it over the canvas (the canvas container must be position:relative)
  - Scroll the overlay into view: overlay.scrollIntoView({behavior:'smooth', block:'center'})

CHANGE 5 — pdfviewer.html: pass bbox through hash params for initial load

When pdfviewer.html first loads via hash, parse bbox if present:
  const params = JSON.parse(decodeURIComponent(window.location.hash.slice(1)))
  currentBbox = params.bbox || null

Update main.js's open-pdf-viewer to include bbox in the hash params:
  const encoded = encodeURIComponent(JSON.stringify({ filePath, page, searchText, bbox }))

═══ PART B — Test Coverage ═══

CHANGE 6 — Upgrade 3 existing _expected_output.json files to v2 schema

For each of these files, add only the missing keys — do not change existing values:
  testdata/test_solicitations/36C24225Q0696/36C24225Q0696_expected_output.json
  testdata/test_solicitations/70B06C26Q00000080/70B06C26Q00000080_expected_output.json
  testdata/test_solicitations/request-for-quotation/request-for-quotation_expected_output.json

Keys to add where missing:
  "_schema_version": 2
  "format": "<run extractor to confirm current detected format>"
  "required_fields": ["solicitation_number", "due_date", "contact_email", "naics_code"]
  "line_items_sample": []   (use [] if line_item_count is 0; otherwise add 1-3 sample items)
  "notes": ""

Do not change solicitation_number, line_item_count, or any field already present.

CHANGE 7 — Confirm run.py handles _schema_version

In run.py, confirm validation logic does not error on _schema_version key
(it should ignore unknown keys). If it does error, add a check to skip
unknown keys gracefully.

VALIDATION — run all of these and report full output before finishing:

Test 1 — Overlay coordinate sanity check (manual):
  1. Parse 70B bundle, go to Step 2
  2. Find a flagged field that has a data-bbox attribute — show its value in console
  3. Click the field
  4. Expected: PDF viewer opens to the correct page
  5. Expected: blue dashed rectangle visible over the field region
  6. Expected: page scrolls to bring the rectangle into view

Test 2 — Single viewer window (manual):
  1. Click flagged field A — viewer opens
  2. Click flagged field B — viewer navigates (does NOT open second window)
  3. Verify: only one viewer window exists in taskbar/dock

Test 3 — Viewer closed, then click (manual):
  1. Open viewer, close it manually
  2. Click a flagged field — new viewer opens
  3. No crash, correct page shown

Test 4 — Schema validation:
  python3 -c "
  import json, os, glob
  files = glob.glob('testdata/test_solicitations/**/*_expected_output.json', recursive=True)
  required_keys = {'_schema_version','solicitation_number','format',
                   'line_item_count','required_fields','line_items_sample','notes'}
  for f in files:
    data = json.load(open(f))
    missing = required_keys - set(data.keys())
    status = 'OK' if not missing else f'MISSING: {missing}'
    print(f'{os.path.basename(f)}: {status}')
  "

Test 5 — Full regression suite:
  python testdata/run.py
  Expected: all fixtures validated, exit 0

Report all test results before finishing.
```

---

---

# PHASE 10 — .docx Output Overhaul + Column Resize

---

## PLANNING PROMPT — Phase 10

```
Read the following files in full before responding. Do not write any code.

  - python/generator.py
  - electron/js/modules/step3.js
  - electron/js/modules/state.js
  - electron/index.html
  - docs/plans/sol-quoter-roadmap-phases-6-10.md (Phase 10 section)

This phase has two independent parts:
  Part A — Resizable column widths in the line items table (step3.js)
  Part B — .docx output fixes (generator.py + step3.js + state.js)

Do them in order: A first, B second.

PART A — Column Resize

Before planning, answer:

  1. In step3.js, is the line items table re-rendered from scratch on every
     render(3) call, or is it incrementally patched? Show the render mechanism.

  2. What are the current column definitions in the table? Show all <th>
     elements and their current style/width attributes.

  3. Are <th> elements given IDs or stable data attributes? If not, what
     is the most reliable way to identify them for width restoration after re-render?

  4. After the table is rendered, what is the last line that executes in
     the step3() function before it returns? (This is where initResizableColumns()
     would be called.)

  5. Does index.html currently define any CSS for table column resizing
     (col-resize cursor, resize handle styling)? If yes, show it.

  6. Is there a pattern elsewhere in the codebase for persisting UI state
     to localStorage? Show it (likely in saveVendor() or theme.js).

PART B — .docx Fixes

Before planning, answer:

  7. In generator.py, find the line items table build. Show:
       a. The add_table() call — how many columns, what widths
       b. The exact column width for the # (item number) column in EMUs or inches
       c. The header row construction — show all column labels

  8. In generator.py, where are these sections rendered? Show the function
     name or line number range and the conditional check (if any) that
     currently controls each:
       a. Option years section
       b. Signature block
       c. Notes / Terms & Conditions section

  9. In state.js, show the complete current default S.vendor object.
     Confirm which of these keys are currently absent:
       line_item_schema, include_signature, include_notes

  10. In step3.js, show the Quote Details card HTML (the grid of inputs
      for prepared_by, title, quote_number, etc.). This is where the
      line_item_schema dropdown will be inserted.

  11. Is there a collapsible card pattern in index.html CSS?
      Show the classes and their styles. If absent, confirm.

Then produce plans for BOTH parts:

PLAN A — Column Resize:
  - Whether to use CSS <col> elements or direct th/td style widths
    (note: <col> widths are unreliable in some table layouts — recommend approach)
  - The drag handle HTML and CSS
  - The mousedown/mousemove/mouseup event handler logic (no library)
  - How widths are saved: localStorage key structure
    ("sol-quoter:col-widths" → {description: 320, size: 85, ...})
  - How widths are restored after re-render: where and when to call restore
  - Min/max width constraints

PLAN B — .docx Fixes:
  A. The corrected # column width (current value → corrected value, show units)
  B. line_item_schema: the three column layouts for standard/apparel/services,
     mapping to the generator.py table construction
  C. The dropdown placement in step3.js Quote Details card
  D. How generator.py reads line_item_schema from the quote input JSON
  E. Section toggles: include_signature, include_notes — default values,
     UI placement, generator.py conditional logic

Plans only. No code.
```

---

## IMPLEMENTATION PROMPT — Phase 10

```
Read the following files in full before making any changes:
  - python/generator.py
  - electron/js/modules/step3.js
  - electron/js/modules/state.js
  - electron/index.html
  - The planning output you just produced for Phase 10

Implement PART A first, then PART B. Do not interleave.

═══ PART A — Column Resize ═══

CHANGE 1 — Add initResizableColumns() to step3.js

Add this function to step3.js (above the step3() render function):

  const COL_RESIZE_STORAGE_KEY = 'sol-quoter:col-widths'
  const COL_MIN_WIDTH = 48

  const RESIZABLE_COLS = [
    { key: 'description', defaultWidth: 300 },
    { key: 'size',        defaultWidth: 85  },
    { key: 'uom',         defaultWidth: 60  },
    { key: 'qty',         defaultWidth: 75  },
    { key: 'unit_price',  defaultWidth: 110 },
    { key: 'total',       defaultWidth: 110 },
  ]

  function saveColWidths(widths) {
    try { localStorage.setItem(COL_RESIZE_STORAGE_KEY, JSON.stringify(widths)) } catch(e) {}
  }

  function loadColWidths() {
    try {
      const raw = localStorage.getItem(COL_RESIZE_STORAGE_KEY)
      return raw ? JSON.parse(raw) : {}
    } catch(e) { return {} }
  }

  function applyColWidths(widths) {
    RESIZABLE_COLS.forEach(({ key, defaultWidth }) => {
      const th = document.querySelector(`th[data-col="${key}"]`)
      if (th) th.style.width = (widths[key] || defaultWidth) + 'px'
    })
  }

  function initResizableColumns() {
    const savedWidths = loadColWidths()
    applyColWidths(savedWidths)

    document.querySelectorAll('th[data-col]').forEach(th => {
      // Create handle
      const handle = document.createElement('div')
      handle.className = 'col-resize-handle'
      th.style.position = 'relative'
      th.appendChild(handle)

      let startX = 0
      let startWidth = 0
      const colKey = th.dataset.col

      handle.addEventListener('mousedown', e => {
        e.preventDefault()
        startX = e.clientX
        startWidth = th.offsetWidth

        const onMove = e => {
          const delta = e.clientX - startX
          const newWidth = Math.max(COL_MIN_WIDTH, startWidth + delta)
          th.style.width = newWidth + 'px'
        }

        const onUp = () => {
          const widths = loadColWidths()
          widths[colKey] = th.offsetWidth
          saveColWidths(widths)
          document.removeEventListener('mousemove', onMove)
          document.removeEventListener('mouseup', onUp)
        }

        document.addEventListener('mousemove', onMove)
        document.addEventListener('mouseup', onUp)
      })
    })
  }

CHANGE 2 — Add data-col attributes to <th> elements in step3.js

In the table <thead> HTML inside step3(), add data-col to each resizable <th>:
  <th data-col="description">Description</th>
  <th data-col="size" style="width:85px">Size/Type</th>
  <th data-col="uom" style="width:60px">UOM</th>
  <th data-col="qty" style="width:75px">Qty</th>
  <th data-col="unit_price" style="width:110px">Unit Price</th>
  <th data-col="total" style="width:110px;text-align:right">Total</th>

Leave the expand btn and actions <th> elements without data-col (not resizable).

CHANGE 3 — Call initResizableColumns() after render in step3()

At the very end of the step3() function body, after updTotals() call:
  initResizableColumns()

CHANGE 4 — Add resize handle CSS to index.html

Add to <style> block:
  .col-resize-handle {
    position: absolute;
    right: 0;
    top: 0;
    bottom: 0;
    width: 4px;
    cursor: col-resize;
    z-index: 1;
  }
  .col-resize-handle:hover {
    background: var(--color-border);
  }
  th[data-col] {
    position: relative;
    overflow: visible;
  }

═══ PART B — .docx Fixes ═══

CHANGE 5 — Fix # column overflow in generator.py

Find the line items table construction in generator.py.
Identify the column width for the item number column (#).
Increase it to accommodate 3-digit numbers without overflow.
Show before and after values with units (EMU or inches).
The corrected width must be verified to not cause other column overflow —
show your calculation.

CHANGE 6 — Add line_item_schema to state.js

In state.js, add to the default S.vendor object:
  line_item_schema: 'standard',
  include_signature: true,
  include_notes: true

CHANGE 7 — Add line_item_schema dropdown to step3.js Quote Details card

In the Quote Details card grid in step3(), after the "Quote Valid For" field,
add:
  <div class="field">
    <label>Line Item Format</label>
    <select data-vendor-field="line_item_schema">
      <option value="standard"${v.line_item_schema === 'standard' ? ' selected' : ''}>Standard</option>
      <option value="apparel"${v.line_item_schema === 'apparel' ? ' selected' : ''}>Apparel (Color + Size columns)</option>
      <option value="services"${v.line_item_schema === 'services' ? ' selected' : ''}>Services (Period column)</option>
    </select>
  </div>

The existing data-vendor-field delegation in vendorForm input handler handles
<select> elements via the 'change' event. Confirm this is wired — if not, add:
  vendorForm.addEventListener('change', e => {
    const field = e.target.dataset.vendorField
    if (!field) return
    window.S.vendor[field] = e.target.value
  })
(It may already exist — check before adding.)

CHANGE 8 — Add Output Settings card to step3.js

Add a new card after the Option Years card:

  <div class="card">
    <div class="card-title"><span class="dot"></span>Output Settings</div>
    <div style="display:flex;flex-direction:column;gap:10px">
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:400;text-transform:none">
        <input type="checkbox" id="include-signature-cb" ${v.include_signature !== false ? 'checked' : ''} style="width:auto;margin:0" />
        Include signature block in quote document
      </label>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:400;text-transform:none">
        <input type="checkbox" id="include-notes-cb" ${v.include_notes !== false ? 'checked' : ''} style="width:auto;margin:0" />
        Include notes &amp; terms section in quote document
      </label>
    </div>
  </div>

Wire these checkboxes after the card is in the DOM:
  document.getElementById('include-signature-cb')?.addEventListener('change', e => {
    window.S.vendor.include_signature = e.target.checked
  })
  document.getElementById('include-notes-cb')?.addEventListener('change', e => {
    window.S.vendor.include_notes = e.target.checked
  })

Note: the option years checkbox (oy-on) stays in the Option Years card.
Do not move it. The Output Settings card is additive.

CHANGE 9 — Implement column schemas in generator.py

Read how the current standard schema builds the table header and data rows.
Implement three column schema paths keyed on quote_data.get('line_item_schema', 'standard'):

Standard schema (current behavior — do not break existing output):
  # | Description | Size/Type | UOM | Qty | Unit Price | Total

Apparel schema:
  # | Description | Color | Size | UOM | Qty | Unit Price | Total
  Data mapping: color → item.get('color',''), size → item.get('size','')

Services schema:
  # | Description | Period | UOM | Qty | Unit Price | Total
  Data mapping: period → item.get('period', item.get('size', ''))

Each schema must produce correct column widths that sum to the usable page width.
Show your width calculations. Do not hardcode widths that sum to more than the
page width (standard Letter page width minus margins).

CHANGE 10 — Wire include_signature and include_notes in generator.py

Find the signature block and notes/T&C section in generator.py.
Wrap each with a conditional:

  if quote_data.get('include_signature', True):
      # ... existing signature block code ...

  if quote_data.get('include_notes', True):
      # ... existing notes/T&C code ...

Show the before and after for each. Do not change the content of either section.

VALIDATION — run all of these and report full output before finishing:

Test 1 — Column resize (manual):
  1. Go to Step 3 with any parsed fixture
  2. Drag the Description column wider
  3. Trigger a re-render (add a row)
  4. Expected: Description column retains the wider width
  5. Close and reopen the app
  6. Go to Step 3 — Expected: width persists

Test 2 — # column overflow (manual):
  1. Load a fixture with 100+ line items (70B has 118)
  2. Go to Step 4, generate the .docx
  3. Open the .docx — Expected: item #100, #110, #118 are single-line, no overflow

Test 3 — Apparel schema (manual):
  1. In Step 3, select "Apparel" in Line Item Format
  2. Generate .docx
  3. Open .docx — Expected: Color and Size columns present, no Size/Type column

Test 4 — Signature block toggle (manual):
  1. Uncheck "Include signature block"
  2. Generate .docx
  3. Open .docx — Expected: no signature block

Test 5 — run.py regression:
  python testdata/run.py
  Expected: all fixtures pass, exit 0

Report all test results before finishing.
```

---

*End of prompt library — Phases 6–10, 10 prompts total*

Workflow reminder:
  Phase 6 planning → review → Phase 6 implementation → review
  Phase 7 planning → review → Phase 7 implementation → review
  Phase 8 planning → review → Phase 8 implementation → review  ← requires 6+7 complete
  Phase 9 planning → review → Phase 9 implementation → review  ← independent
  Phase 10 planning → review → Phase 10 implementation → review ← independent
