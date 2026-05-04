# Phase 8 — AI-Assisted Extraction: Diagnostic Report & Implementation Plan

**Date:** 2026-05-04
**Scope:** Phase 8 of sol-quoter-roadmap-phases-6-10.md
**Status:** Planning — no code written
**Prerequisite:** Phases 6 and 7 confirmed complete (see below)

---

## Phase 6 & 7 Completion Confirmation

### Confirmation 1 — `extraction_warnings` in `parse_solicitation_bundle()`

**Confirmed.** `python/extractor.py`, lines 1373–1383:

```python
    # ── assemble extraction_warnings ──────────────────────────────────────────────
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
    if warnings:
        print(f"[parse_solicitation_bundle] warnings={warnings}")
```

### Confirmation 2 — `confidence` dict in `parse_solicitation_bundle()`

**Confirmed.** `python/extractor.py`, line 1387:

```python
    data["confidence"] = compute_confidence(data)
    return data
```

`compute_confidence()` is defined at lines 1208–1299 and returns a dict with keys `overall`, `format_detection`, `required_fields`, `line_items`, `warnings`, and `reasons`.

### Confirmation 3 — `window.S.parseConfidence` in `step1.js`

**Confirmed.** `electron/js/modules/step1.js`, lines 201–204:

```javascript
    window.S.extracted = data.data;
    window.S.parseConfidence = (data.data && data.data.confidence)
      ? data.data.confidence
      : null
```

The exact assignment is at line 202–204. It reads `data.data.confidence` (the Phase 7 parse-quality dict) and stores it as `window.S.parseConfidence`. If absent, stores `null`.

All three prerequisites confirmed. Proceeding to Phase 8 planning.

---

## Files Read

- `python/server.py` — full (382 lines)
- `python/extractor.py` — full (1389 lines)
- `electron/js/modules/step1.js` — full (469 lines)
- `electron/js/modules/step2.js` — full (276 lines)
- `electron/js/state.js` — full (28 lines)
- `electron/preload.js` — full (21 lines)
- `docs/plans/phase-7-planning-output.md` — full
- `docs/plans/sol-quoter-roadmap-phases-6-10.md` — Phase 8 section

---

## Part 1 — Diagnostic Questions

### Q1 — `/parse` route: complete `jsonify()` call + `os.environ` usage

**Exact `jsonify()` call — `server.py` lines 264–271:**

```python
        return jsonify({
            "success": True,
            "data": data,
            "overallConfidence": confidence["overallConfidence"],
            "fields": confidence["fields"],
            "flags": confidence["flags"],
            "_session_files": _session_files
        })
```

**Full response shape:**

| Key | Type | Source | Notes |
|-----|------|--------|-------|
| `success` | bool | hardcoded `True` | Parse succeeded |
| `data` | dict | `parse_solicitation_bundle()` | Full extraction result including `_format`, `_method`, `extraction_warnings`, all extracted fields, `line_items`, and `confidence` (Phase 7 dict) |
| `overallConfidence` | int (0–100) | `validate_fields()` in `validator.py` | Field-value quality scoring — distinct from Phase 7 parse-quality confidence |
| `fields` | list of dicts | `validate_fields()` | Per-field confidence entries with `name`, `confidence`, `status`, `issue`, optional `boundingBox` |
| `flags` | list | `validate_fields()` | Fields below `CONFIDENCE_THRESHOLD` (95) |
| `_session_files` | dict | session manifest build | `{"main": filename_or_None, "sow": filename_or_None, "pricing": filename_or_None}` |

**Does server.py call `load_dotenv()` or read from `os.environ`?**

`load_dotenv()` is **absent** from `server.py`. There is no `from dotenv import` or `load_dotenv()` call.

`os.environ` reads do exist:
- Line 26: `_PORT = int(os.environ.get("PORT", PORT))` — reads PORT
- Line 377 (inside `if __name__ == "__main__"`): `ppid = int(os.environ.get("PARENT_PID", "0"))` — reads PARENT_PID
- Line 380: `port = int(os.environ.get("PORT", PORT))` — reads PORT again

**`ANTHROPIC_API_KEY` is not read anywhere in `server.py`.** It is read in `extractor.py:ai_extract()` at line 630: `api_key = os.environ.get('ANTHROPIC_API_KEY', '')`. This function is only called from `extract_data()` (line 675) when either `api_key` param or `_env_key` is truthy. The Phase 8 endpoint in `server.py` will need to read and use the key, so `load_dotenv()` must be added to `server.py` for the `.env` path to work.

---

### Q2 — How extracted fields are rendered in `step2.js`

Fields are rendered as **editable `<input>` elements**. They are not read-only.

From `step2.js`, the fields list is defined at lines 86–95 (15 fields total). They are rendered via `items = fields.map(...)` at lines 107–119:

```javascript
  const items = fields.map(([k, lbl, wide]) => {
    const flagged = flaggedFields[k]
    const invalidClass = flagged ? ' invalid' : ''
    const flagHtml = flagged
      ? `<div class="field-confidence">...</div>`
      : ''
    return `
      <div class="data-item${wide ? ' s2' : ''}">
        <div class="data-label">${lbl}</div>
        <input data-field="${k}" class="${invalidClass}" value="${esc(String(d[k] || ''))}" placeholder="Not found"${...} />
        ${flagHtml}
      </div>`
  }).join('')
```

**Representative sample of 4 fields:**

| Field key | HTML `data-field` | Label | `name`/`id` | Value source |
|-----------|-------------------|-------|-------------|--------------|
| `solicitation_number` | `data-field="solicitation_number"` | Solicitation # | no `id`, no `name` | `esc(String(d.solicitation_number \|\| ''))` |
| `project_title` | `data-field="project_title"` | Project Title | no `id`, no `name` | `esc(String(d.project_title \|\| ''))` |
| `issuing_agency` | `data-field="issuing_agency"` | Issuing Agency | no `id`, no `name` | `esc(String(d.issuing_agency \|\| ''))` |
| `due_date` | `data-field="due_date"` | Response Due Date | no `id`, no `name` | `esc(String(d.due_date \|\| ''))` |

No `name` or `id` attributes — fields are identified purely by `data-field`. Selectors use `c.querySelectorAll('input[data-field]')` (line 169) or `c.querySelector('input[data-field="naics_code"]')` (line 231).

The scope of work is a separate `<textarea id="scope-ta">` element (not in the fields array), rendered at lines 153–158 with `value="${esc(d.scope_of_work || '')}"` via `rows="6"`.

---

### Q3 — Does `step2.js` make direct `fetch()` calls?

**No.** `step2.js` contains **zero** `fetch()` calls. It reads exclusively from `window.S`:

- Line 15: `const d = window.S.extracted` — main extraction dict
- Line 26: `const conf = window.S.confidence || {}` — field-level confidence
- Line 29: `const pc = window.S.parseConfidence` — Phase 7 parse-quality confidence
- Line 134: `window.S.sourceType === 'pdf'` — for PDF viewer visibility

The entire render is synchronous from `window.S` state. All `/parse` data was fetched and stored into `window.S` by `step1.js:doParse()` before `goTo(2)` was called.

**Where `window.S.extracted` is read in the render function:**

- Line 15 (top of `step2(c)`): `const d = window.S.extracted` — assigned to local `d`
- All field values are read via `d[k]` (e.g., `d.solicitation_number`)
- `d._method` (line 16) controls method badge
- `d.scope_of_work`, `d.scope_truncated`, `d.scope_full` (lines 141–143) control scope section
- `d.quantities` (line 121) controls quantities panel

---

### Q4 — `preload.js` contextBridge methods

**All 18 currently exposed methods — `electron/preload.js` lines 2–21:**

```javascript
contextBridge.exposeInMainWorld('api', {
  getPort:              ()           => ipcRenderer.invoke('get-port'),
  openFile:             ()           => ipcRenderer.invoke('open-file'),
  saveQuote:            (opts)       => ipcRenderer.invoke('save-quote', opts),
  openUrl:              (url)        => ipcRenderer.invoke('open-url', url),
  openPath:             (fp)         => ipcRenderer.invoke('open-path', fp),
  pickLogo:             ()           => ipcRenderer.invoke('pick-logo'),
  generatePdf:          (opts)       => ipcRenderer.invoke('generate-pdf', opts),
  savePdf:              (opts)       => ipcRenderer.invoke('save-pdf', opts),
  exportData:           (opts)       => ipcRenderer.invoke('export-data', opts),
  openJsonFile:         ()           => ipcRenderer.invoke('open-json-file'),
  storeApiKey:          (key)        => ipcRenderer.invoke('store-api-key', key),
  loadApiKey:           ()           => ipcRenderer.invoke('load-api-key'),
  clearApiKey:          ()           => ipcRenderer.invoke('clear-api-key'),
  restartBackend:       ()           => ipcRenderer.invoke('restart-backend'),
  getSessionFilePath:   (filename)   => ipcRenderer.invoke('get-session-file-path', filename),
  openPdfViewer:        (fp, pg, st) => ipcRenderer.invoke('open-pdf-viewer', fp, pg, st),
  readFileAsArrayBuffer:(filePath)   => ipcRenderer.invoke('read-file-as-array-buffer', filePath),
  clearSession:         (port)       => fetch(`http://127.0.0.1:${port}/api/sol-quoter/session/clear`, { method: 'POST' }),
})
```

**Classification:**

| Method | Type | Notes |
|--------|------|-------|
| `getPort` | IPC — `get-port` | Returns the Flask port |
| `openFile` | IPC — `open-file` | Native file dialog |
| `saveQuote` | IPC — `save-quote` | Save .docx via Electron dialog |
| `openUrl` | IPC — `open-url` | External browser open |
| `openPath` | IPC — `open-path` | Open file in system default app |
| `pickLogo` | IPC — `pick-logo` | Logo image picker |
| `generatePdf` | IPC — `generate-pdf` | PDF generation |
| `savePdf` | IPC — `save-pdf` | PDF save dialog |
| `exportData` | IPC — `export-data` | Export quote data |
| `openJsonFile` | IPC — `open-json-file` | Open JSON import dialog |
| `storeApiKey` | IPC — `store-api-key` | Persists API key in Electron keychain |
| `loadApiKey` | IPC — `load-api-key` | Retrieves stored API key |
| `clearApiKey` | IPC — `clear-api-key` | Deletes stored API key |
| `restartBackend` | IPC — `restart-backend` | Restarts Python process |
| `getSessionFilePath` | IPC — `get-session-file-path` | Resolves filename → full session path |
| `openPdfViewer` | IPC — `open-pdf-viewer` | Opens PDF viewer window |
| `readFileAsArrayBuffer` | IPC — `read-file-as-array-buffer` | Reads local file for PDF.js |
| `clearSession` | **Fetch wrapper** | Direct `fetch()` to `/api/sol-quoter/session/clear` |

**`clearSession` is the only fetch wrapper.** All others are IPC wrappers. The Phase 8 `/extract-ai` and `/ai-status` calls will be plain `fetch()` calls in `step2.js` (not routed through `window.api`), consistent with how `step1.js` calls `/parse` directly.

No `window.api` method needs to be added for Phase 8 — `fetch()` is available in the renderer context without IPC bridging.

---

### Q5 — `.env` file contents

**`.env` exists at the project root but is empty.** No keys are defined. `cat .env` produces no output.

- `ANTHROPIC_API_KEY`: **blank/absent** (file is empty)
- `AI_MAX_CALLS`: not set (will use hardcoded default)
- `AI_HEADER_MODEL`: not set
- `AI_LINE_ITEM_MODEL`: not set

Phase 8 requires the user to add `ANTHROPIC_API_KEY` to this file, or configure it via the existing Electron key storage (`window.api.storeApiKey`). Both paths must work.

---

### Q6 — Complete `window.S` schema from `state.js`

**`electron/js/state.js`, lines 5–22 — complete default object:**

```javascript
const S = {
  step: 1, done: new Set(), port: null,
  apiKey: '', validity: '30 days',
  samKey: '', samNoticeId: '',
  file: null, filePath: null,
  extracted: {},
  vendor: {
    company_name:'', address:'', city_state_zip:'', phone:'', email:'',
    website:'', prepared_by:'', title:'', quote_number:'', sam_uei:'',
    validity_period:'30 days', freight:'', tax_rate:'', notes:'',
    terms:'Net 30. FOB Destination. Vendor certifies SAM.gov registration and compliance with all applicable solicitation requirements.',
    logo_b64:'', logo_ext:'', logo_name:'',
    delivery_days:'',
    option_years_enabled: false,
    option_years: []
  },
  items: []
}
```

**Specific confirmations requested:**

- **`aiUsage` key:** Absent from default state. Not present anywhere in the default `S` object. Must be added for Phase 8.
- **`parseConfidence` key:** Absent from default state. Added dynamically by `step1.js:doParse()` at line 202: `window.S.parseConfidence = (data.data && data.data.confidence) ? data.data.confidence : null`. Not initialized to any value before first parse.
- **Key holding parsed solicitation data:** `window.S.extracted` (initialized as `{}`). Set at `step1.js` line 201: `window.S.extracted = data.data`.
- **Key holding confidence dict (Phase 7):** `window.S.parseConfidence` — set in step1.js at lines 202–204, reads from `data.data.confidence`. Separately, `window.S.confidence` (lines 207–211) holds field-level confidence (`overallConfidence`, `fields`, `flags`) from `validator.py`.

Note: `window.S.files` (plural) and `window.S.sessionFiles` are added dynamically by step1.js but not in the default state object.

---

### Q7 — How field edits are persisted in `step2.js`

**Field edits are persisted immediately on `input` event (every keystroke).**

`step2.js`, lines 168–176:

```javascript
  // Wire all data-field inputs (text fields)
  c.querySelectorAll('input[data-field]').forEach(el => {
    el.addEventListener('input', e => {
      window.S.extracted[e.target.dataset.field] = e.target.value
    })
    el.addEventListener('change', e => {
      window.S.extracted[e.target.dataset.field] = e.target.value
    })
  })
```

Both `input` (fires on every character) and `change` (fires on blur/submit) are wired. `window.S.extracted[fieldKey]` is updated in real time — there is no "collect all values on Next" pattern. The moment the user types a character, `window.S.extracted` reflects it.

The scope textarea is wired separately at lines 179–185:

```javascript
  if (scopeTa) {
    scopeTa.addEventListener('input', e => {
      window.S.extracted.scope_of_work = e.target.value
      if (scopeCount) scopeCount.textContent = e.target.value.length + ' / ' + SCOPE_MAX_DISPLAY
    })
  }
```

**Implication for Phase 8 `mergeAiResult()`:** When "Accept Selected" applies AI changes, it writes directly to `window.S.extracted[field]`. This mirrors the exact same mechanism that user edits use. After applying, `render(2)` must be called to repaint the input elements with the updated values (since the DOM inputs are not live-bound — they are rendered once in `c.innerHTML`).

---

## Part 2 — Implementation Plan

### A. `.env` and Server-Side Setup

#### Keys already in `.env` vs. keys to add

Current `.env`: empty (zero keys).

Keys to add for Phase 8:

```
ANTHROPIC_API_KEY=sk-ant-...   # user must fill in; blank = AI disabled
AI_MAX_CALLS=10                 # sessions call budget; default 10
AI_HEADER_MODEL=claude-haiku-4-5-20251001
AI_LINE_ITEM_MODEL=claude-sonnet-4-6
```

Note on models: The roadmap specifies "claude-haiku-3-5" and "claude-sonnet-4-6". Current model IDs (as of May 2026): Haiku 4.5 is `claude-haiku-4-5-20251001`, Sonnet 4.6 is `claude-sonnet-4-6`. Use `claude-haiku-4-5-20251001` for headers (fast + cheap for structured field extraction) and `claude-sonnet-4-6` for line items (accuracy-critical).

#### `load_dotenv()` placement in `server.py`

Add at the top of `server.py`, after the stdlib imports block and before line 26 (`_PORT = int(os.environ.get(...))`):

```python
# ── ENVIRONMENT ───────────────────────────────────────────────────────────────
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass  # python-dotenv not installed — env vars must be set by the caller
```

The `try/except ImportError` guards against environments where python-dotenv is not installed (e.g. a developer running without it). If the key is set by the Electron main process via spawn env, it works without python-dotenv. The `.env` path is for local development.

This placement ensures `load_dotenv()` fires before any `os.environ.get()` reads, including `_PORT` at line 26.

#### Four module-level constants

Add immediately after `load_dotenv()`, before `_PORT`:

```python
_AI_API_KEY        = os.environ.get('ANTHROPIC_API_KEY', '').strip()
_AI_MAX_CALLS      = int(os.environ.get('AI_MAX_CALLS', '10'))
_AI_HEADER_MODEL   = os.environ.get('AI_HEADER_MODEL', 'claude-haiku-4-5-20251001')
_AI_LINE_ITEM_MODEL = os.environ.get('AI_LINE_ITEM_MODEL', 'claude-sonnet-4-6')
```

These are evaluated once at import time. If the user updates `.env` and restarts the backend via `window.api.restartBackend()`, the new values take effect.

#### In-memory call counter

Add immediately after the four constants:

```python
_ai_call_count = 0  # resets on process restart — intentional, matches session scope
```

This is module-level. The `/extract-ai` route increments it with `global _ai_call_count`. Because Python's GIL serializes module-global writes, no lock is needed for a single-threaded Flask development server. In production (with Gunicorn workers), each worker would have its own counter, but this app runs single-threaded Flask so this is safe.

#### Where `/ai-status` lives in `server.py`

Add immediately after the `/api/sol-quoter/session/clear` route (currently lines 146–154) and before the `# ── ROUTES ──` comment (line 156). Both new routes belong in the `api/sol-quoter` namespace.

---

### B. Session Manifest and Text Chunking

#### Actual manifest.json structure (Phase 2)

Written in `server.py` at lines 254–261:

```python
manifest = {
    "timestamp": datetime.datetime.utcnow().isoformat(),
    "solicitation_number": data.get("solicitation_number", ""),
    "files": _session_files
}
```

Where `_session_files = {"main": None, "sow": None, "pricing": None}` is populated by classifying each uploaded file.

**Full manifest.json example:**

```json
{
  "timestamp": "2026-05-04T14:23:11.432187",
  "solicitation_number": "70B06C26Q00000080",
  "files": {
    "main": "70B06C26Q00000080.pdf",
    "sow": "70B06C26Q00000080+Attachment+1+-+LLSM+SOW.pdf",
    "pricing": "70B06C26Q00000080+Attachment+2-Pricing+Sheeet.xlsx"
  }
}
```

Any key in `files` may be `null` if no file of that role was uploaded.

**Reading manifest in `/extract-ai`:**

```python
session_dir = get_session_dir()  # returns Path to ~/.sol-quoter/session/current
manifest_path = session_dir / "manifest.json"
if not manifest_path.exists():
    return jsonify({"error": "No active session — upload a document first", "code": "no_session"}), 400
manifest = json.loads(manifest_path.read_text())
```

#### For headers: reading main doc first 4000 chars

```python
main_filename = manifest.get("files", {}).get("main")
if not main_filename:
    return jsonify({"error": "No main document in session", "code": "no_main_doc"}), 400
main_path = session_dir / main_filename
main_text = parse_document(str(main_path))[:4000]
```

`parse_document()` is imported from `extractor.py` — it handles PDF, DOCX, TXT formats and returns the full text string. Slicing to `[:4000]` is done after the full parse so the correct first characters are used (not raw bytes).

#### For line items: SOW file chunking

```python
sow_filename = manifest.get("files", {}).get("sow")
if sow_filename:
    sow_path = session_dir / sow_filename
    sow_text = parse_document(str(sow_path))
else:
    sow_text = parse_document(str(main_path))  # fall back to main doc
```

Then chunk:

```python
def chunk_text(text: str, chunk_size: int = 6000, overlap: int = 500) -> list[str]:
    """
    Split text into chunks of at most chunk_size characters with overlap.
    If text fits in one chunk, returns a single-element list.
    Returns list[str].
    """
    if len(text) <= chunk_size:
        return [text]
    chunks = []
    start = 0
    while start < len(text):
        end = start + chunk_size
        chunks.append(text[start:end])
        if end >= len(text):
            break
        start = end - overlap
    return chunks
```

**Signature:** `chunk_text(text: str, chunk_size: int = 6000, overlap: int = 500) -> list[str]`

**Return type:** `list[str]` — each element is a text chunk, ordered sequentially. For a 12,000-char SOW, this produces: `[text[0:6000], text[5500:11500], text[11000:12000]]` (3 chunks).

**No SOW fallback:** When `sow_filename` is `None`, the main doc text is used. The fallback path typically only applies when the user uploaded a single document that contains both header fields and line item specs. The first 4000 chars are still sent for headers; the full text is chunked for line items. This avoids a 400 error on single-file uploads.

`chunk_text()` is defined in `server.py` (not `extractor.py`) since it is route-specific logic. Place it just above the `/extract-ai` route handler.

---

### C. `POST /api/sol-quoter/extract-ai` Endpoint

#### Full route and request body shape

```
POST /api/sol-quoter/extract-ai
Content-Type: application/json
Body: {
  "target": "headers" | "line_items",
  "api_key": "sk-ant-..."    // optional — overrides ANTHROPIC_API_KEY env var
}
```

`target` is required. `api_key` is optional — if absent, the endpoint falls back to `_AI_API_KEY` (from env). This allows the user's stored Electron key (`window.S.apiKey`) to be passed per-request without requiring the `.env` approach.

#### System prompt for `target="headers"` (full text)

```
You are extracting structured data from a government solicitation document.
Return ONLY a JSON object. No markdown, no explanation, no preamble.

Extract these fields. If a field cannot be found, use null (not an empty string):
  solicitation_number, project_title, due_date, contact_name, contact_email,
  contact_phone, naics_code, psc_code, set_aside, place_of_performance,
  period_of_performance, issuing_agency, solicitation_type, estimated_value

Rules:
- Dates: return exactly as they appear in the document (do not reformat)
- solicitation_number: the official contract/solicitation identifier (e.g. "70B06C26Q00000080")
- naics_code: 5 or 6 digit number only (e.g. "336992")
- set_aside: the full set-aside type name (e.g. "Total Small Business Set-Aside")
- If a field appears multiple times with different values, prefer the most specific or prominent one
```

This is stored as a module-level constant `_HEADER_SYSTEM_PROMPT` in `server.py`.

#### System prompt for `target="line_items"` (full text including few-shot example)

```
You are extracting line items from a government solicitation document.
Return ONLY a JSON array of objects. No markdown, no explanation, no preamble.

Each object must have exactly these fields:
  description (string) — the item or service description
  unit (string)        — unit of measure, e.g. "EA", "LOT", "HR", "YR", "CS"
  qty (number or null) — quantity if stated; null if not stated
  unit_price (number or null) — unit price if stated; null if not stated

Rules:
- Include every distinct deliverable, supply item, or service line
- If a CLIN number is visible, include it at the start of description (e.g. "CLIN 0001 - Widget")
- Do not include subtotals, totals, or header rows as line items
- If quantities are stated per period (Base, Option 1, etc.), use the Base period quantity for qty

Example input:
  4.1.1 Protective Mask
  The contractor shall provide respirator masks equal to or better than the Avon PC50. Unit: each.
  4.1.2 Replacement Filters (6-pack)
  Provide 6-pack filter kits. Estimated quantity: 200.

Example output:
[
  {"description": "Protective Mask", "unit": "EA", "qty": null, "unit_price": null},
  {"description": "Replacement Filters (6-pack)", "unit": "CS", "qty": 200, "unit_price": null}
]
```

This is stored as `_LINE_ITEM_SYSTEM_PROMPT` in `server.py`.

#### How the user message is constructed from text chunks

For headers (single chunk — first 4000 chars):

```python
user_message = main_text  # already sliced to [:4000]
```

For line items (potentially multiple chunks):

```python
chunks = chunk_text(sow_text)
# Send first chunk synchronously; additional chunks only if needed
# For Phase 8 implementation: send all chunks, merge results client-side
```

Actually: send each chunk as a separate API call, accumulate results, merge at the end. The merge deduplicates by description field using a dict keyed on lowercased description.

#### The Anthropic API call: client construction, model, timeout

```python
import anthropic as _anthropic

client = _anthropic.Anthropic(api_key=effective_key, timeout=30.0)
response = client.messages.create(
    model=model,  # _AI_HEADER_MODEL or _AI_LINE_ITEM_MODEL
    max_tokens=1024 if target == "headers" else 2048,
    system=system_prompt,
    messages=[{"role": "user", "content": user_message}]
)
```

`timeout=30.0` is passed to the `Anthropic()` constructor, not to `messages.create()`. This sets the request-level timeout for all calls made by this client instance. The anthropic SDK raises `anthropic.APITimeoutError` on timeout.

`max_tokens=1024` is sufficient for the header dict (14 fields, mostly short strings). `max_tokens=2048` allows for larger line item arrays.

#### JSON response parsing: strip markdown fences, validate keys

```python
raw = response.content[0].text.strip()
raw = re.sub(r'^```(?:json)?\s*\n?', '', raw)
raw = re.sub(r'\n?```\s*$', '', raw)
result = json.loads(raw)
```

**Validation for headers:** Check that `result` is a dict. Verify at least one expected key is present:

```python
if not isinstance(result, dict):
    raise ValueError(f"Expected dict, got {type(result).__name__}")
expected_keys = {"solicitation_number", "due_date", "naics_code", "contact_email"}
if not any(k in result for k in expected_keys):
    raise ValueError("Response dict contains none of the expected header keys")
```

**Validation for line items:** Check that `result` is a list of dicts, each with a `description` key:

```python
if not isinstance(result, list):
    raise ValueError(f"Expected list, got {type(result).__name__}")
for item in result[:5]:  # sample first 5
    if not isinstance(item, dict) or "description" not in item:
        raise ValueError("Line item missing required 'description' key")
```

#### Error responses: exact shapes for each case

**503 — No API key:**
```json
{"error": "AI extraction is not available — configure ANTHROPIC_API_KEY in .env or in the app settings", "code": "no_api_key"}
```
HTTP status: 503

**429 — Call limit reached:**
```json
{"error": "AI extraction call limit reached (10 calls this session). Restart the app to reset.", "code": "call_limit_reached", "calls_used": 10, "limit": 10}
```
HTTP status: 429

**422 — Bad JSON from AI:**
```json
{"error": "AI returned a response that could not be parsed as JSON. Try again.", "code": "invalid_json", "raw": "...first 200 chars of raw response..."}
```
HTTP status: 422

**408 — Timeout:**
```json
{"error": "AI extraction timed out after 30 seconds. The document may be too long.", "code": "timeout"}
```
HTTP status: 408

**500 — Anthropic API error (non-timeout):**
```json
{"error": "Anthropic API error: <message from exception>", "code": "api_error"}
```
HTTP status: 500

**400 — No session / no main doc:**
```json
{"error": "No active session — upload a document first", "code": "no_session"}
```
HTTP status: 400

#### How `_ai_call_count` is incremented and checked

```python
@app.route("/api/sol-quoter/extract-ai", methods=["POST", "OPTIONS"])
def extract_ai_route():
    global _ai_call_count
    if request.method == "OPTIONS":
        return jsonify({}), 200

    # Check API key
    body = request.get_json() or {}
    req_key = body.get("api_key", "").strip()
    effective_key = req_key or _AI_API_KEY
    if not effective_key:
        return jsonify({"error": "...", "code": "no_api_key"}), 503

    # Check call limit BEFORE making the API call
    if _ai_call_count >= _AI_MAX_CALLS:
        return jsonify({
            "error": f"AI extraction call limit reached ({_AI_MAX_CALLS} calls this session). Restart the app to reset.",
            "code": "call_limit_reached",
            "calls_used": _ai_call_count,
            "limit": _AI_MAX_CALLS
        }), 429

    # ... (read session, build prompt, make API call) ...

    # Increment AFTER successful API call (not before, so failed calls don't count)
    _ai_call_count += 1

    return jsonify({...})
```

The increment happens after a successful API call. Failed calls (timeout, malformed JSON, API error) do not increment the counter. This is intentional — if the call fails, the user didn't get useful data, so they shouldn't lose quota.

#### Response shape on success

```json
{
  "result": {
    "solicitation_number": "70B06C26Q00000080",
    "due_date": "09/15/2026 2:00PM ET",
    "naics_code": "336992",
    "contact_email": "john.smith@cbp.dhs.gov"
  },
  "tokens_used": 847,
  "model": "claude-haiku-4-5-20251001",
  "target": "headers"
}
```

For line items:
```json
{
  "result": [
    {"description": "Protective Mask", "unit": "EA", "qty": null, "unit_price": null},
    {"description": "Replacement Filter Kit", "unit": "CS", "qty": 200, "unit_price": null}
  ],
  "tokens_used": 1543,
  "model": "claude-sonnet-4-6",
  "target": "line_items"
}
```

`tokens_used` is computed from `response.usage.input_tokens + response.usage.output_tokens`.

#### For line items with multiple chunks: merge strategy

When `sow_text` is longer than 6000 chars, `chunk_text()` produces 2+ chunks. Each chunk is sent as a separate `messages.create()` call. The results are merged:

```python
all_items = []
seen_descriptions = set()
for chunk in chunks:
    chunk_result = call_anthropic(chunk, _LINE_ITEM_SYSTEM_PROMPT, _AI_LINE_ITEM_MODEL, effective_key)
    for item in chunk_result:
        key = item.get("description", "").strip().lower()
        if key and key not in seen_descriptions:
            seen_descriptions.add(key)
            all_items.append(item)
```

Deduplication is by lowercased `description`. If the same item description appears in two overlapping chunks (due to the 500-char overlap), only the first occurrence is kept. This preserves order and avoids duplicates caused by the overlap window.

Each chunk call increments `_ai_call_count`. So a 3-chunk SOW uses 3 calls. This is by design — the call limit is per-call, and the user is informed of how many calls the operation requires before confirmation (shown in the UI panel).

---

### D. Step 2 UI — AI Panel

#### Exact insertion point in `step2.js`

The AI panel is inserted into `c.innerHTML` immediately after `${confBannerHtml}` and before `<div class="card">` for extracted fields.

**Current template structure at lines 146–166:**

```javascript
  c.innerHTML = `
  ${badge}
  ${confBannerHtml}
  <div class="card">
    <div class="card-title"><span class="dot"></span>Extracted Fields ...
```

**New template structure:**

```javascript
  c.innerHTML = `
  ${badge}
  ${confBannerHtml}
  ${aiPanelHtml}
  <div class="card">
    <div class="card-title"><span class="dot"></span>Extracted Fields ...
```

`aiPanelHtml` is computed before the `c.innerHTML` assignment. The initial value is an empty string `''` when AI is not available (key absent). When available, it renders one of the panel states described below.

#### The `/ai-status` fetch on Step 2 load

The fetch fires **after** `c.innerHTML` is assigned, at the end of `step2(c)`. This avoids blocking the synchronous render.

Two approaches are viable:

**Option A (recommended) — Two-pass render:**
1. Render step2 with `aiPanelHtml = ''` (no panel yet)
2. Immediately after `c.innerHTML` assignment, fire async `checkAiStatus()`
3. `checkAiStatus()` fetches `/api/sol-quoter/ai-status?api_key=${encodeURIComponent(window.S.apiKey || '')}`
4. On response: store result in `window.S.aiAvailable`, then call `renderAiPanel()` which inserts/updates the panel DOM node

**Why not single-pass:** The `step2(c)` function is synchronous. If we await the ai-status fetch inside it, the function must become async, which changes how `goTo()` wires step rendering. Two-pass avoids this.

`checkAiStatus()` is defined in `step2.js`:

```javascript
async function checkAiStatus() {
  try {
    const key = encodeURIComponent(window.S.apiKey || '')
    const r = await fetch(`http://127.0.0.1:${window.S.port}/api/sol-quoter/ai-status?api_key=${key}`)
    if (!r.ok) { window.S.aiAvailable = false; window.S.aiCallsRemaining = 0; return }
    const data = await r.json()
    window.S.aiAvailable = data.available
    window.S.aiCallsRemaining = data.calls_remaining
  } catch (e) {
    window.S.aiAvailable = false
    window.S.aiCallsRemaining = 0
  }
  renderAiPanel()
}
```

`renderAiPanel()` builds and injects the panel HTML into the container that `step2(c)` leaves for it:

```javascript
function renderAiPanel() {
  const container = document.getElementById('ai-panel-container')
  if (!container) return
  // render panel based on window.S.aiAvailable, window.S.aiCallsRemaining, window.S.parseConfidence
}
```

The `#ai-panel-container` is a `<div id="ai-panel-container"></div>` placeholder in the `c.innerHTML` template — placed between `${confBannerHtml}` and the first `<div class="card">`.

**Cached result:** `window.S.aiAvailable` persists across re-renders. If the user navigates back to Step 1 and returns to Step 2, `checkAiStatus()` fires again (it is called unconditionally on step2 render). This is intentional — the user may have added a key during the session.

#### When to auto-expand the panel

The panel starts **expanded** (not collapsed) when `window.S.parseConfidence.overall < 0.6`. This is checked inside `renderAiPanel()`:

```javascript
const autoExpand = window.S.parseConfidence && window.S.parseConfidence.overall < 0.6
```

If `autoExpand` is true, the panel body is visible on initial render. The toggle checkbox is unchecked regardless of expansion state (the user must opt in to send data).

#### Full panel HTML for all states

**State 0 — AI not available (`window.S.aiAvailable === false`):**

```html
<!-- nothing — aiPanelHtml = '' -->
```

No panel renders when key is absent. This is the "privacy mode" guarantee from the roadmap.

---

**State 1 — Collapsed (available, overall >= 0.6):**

```html
<div id="ai-panel-container">
  <div class="card ai-panel" id="ai-panel">
    <div class="ai-panel-header" id="ai-panel-toggle" style="cursor:pointer;display:flex;align-items:center;justify-content:space-between">
      <div class="card-title" style="margin-bottom:0"><span class="dot"></span>AI-Assisted Extraction</div>
      <span class="ai-panel-chevron" style="color:var(--color-text-muted);font-size:12px">&#x25BC;</span>
    </div>
    <div class="ai-panel-body" id="ai-panel-body" style="display:none"></div>
  </div>
</div>
```

The body is `display:none`. Clicking the header toggles it.

---

**State 2 — Expanded, toggle off:**

```html
<div id="ai-panel-container">
  <div class="card ai-panel" id="ai-panel">
    <div class="ai-panel-header" id="ai-panel-toggle" style="...">
      <div class="card-title" style="margin-bottom:0"><span class="dot"></span>AI-Assisted Extraction</div>
      <span class="ai-panel-chevron">&#x25B2;</span>
    </div>
    <div class="ai-panel-body" id="ai-panel-body">
      <div style="margin-bottom:var(--space-md)">
        <label style="display:flex;align-items:center;gap:var(--space-sm);cursor:pointer">
          <input type="checkbox" id="ai-toggle-cb" />
          <span>Enable AI extraction</span>
        </label>
      </div>
      <div style="font-size:var(--text-sm);color:var(--color-text-muted)" id="ai-usage-display"></div>
    </div>
  </div>
</div>
```

---

**State 3 — Expanded, toggle on (shows disclosure + buttons):**

```html
<div class="ai-panel-body" id="ai-panel-body">
  <div style="margin-bottom:var(--space-md)">
    <label style="display:flex;align-items:center;gap:var(--space-sm);cursor:pointer">
      <input type="checkbox" id="ai-toggle-cb" checked />
      <span>Enable AI extraction</span>
    </label>
  </div>
  <div class="alert alert-warn" style="font-size:var(--text-sm);margin-bottom:var(--space-md)" id="ai-disclosure">
    Your document text will be sent to Anthropic's API to improve extraction accuracy.
    No data is stored beyond the current request. <strong>5 calls remaining.</strong>
  </div>
  <div style="display:flex;gap:var(--space-sm);flex-wrap:wrap">
    <button class="btn btn-sm btn-ghost" id="ai-extract-headers-btn">Extract Headers with AI</button>
    <button class="btn btn-sm btn-ghost" id="ai-extract-items-btn">Extract Line Items with AI</button>
  </div>
  <div style="font-size:var(--text-sm);color:var(--color-text-muted);margin-top:var(--space-sm)" id="ai-usage-display"></div>
</div>
```

The "calls remaining" count in the disclosure text is read from `window.S.aiCallsRemaining`.

---

**State 4 — Loading (buttons disabled, spinner text):**

After a button is clicked, both buttons are replaced with:

```html
<div style="display:flex;gap:var(--space-sm);flex-wrap:wrap">
  <button class="btn btn-sm btn-ghost" id="ai-extract-headers-btn" disabled>
    <span class="spin" style="width:10px;height:10px;border-width:2px"></span>
    <span style="margin-left:var(--space-xs)">Extracting…</span>
  </button>
  <button class="btn btn-sm btn-ghost" id="ai-extract-items-btn" disabled></button>
</div>
```

The non-clicked button is hidden/disabled but kept in DOM to avoid layout shift when re-enabling.

---

**State 5 — Diff view (after extraction returns):**

```html
<div id="ai-diff" style="margin-top:var(--space-md)">
  <div style="font-weight:600;margin-bottom:var(--space-sm)">AI found these changes:</div>
  <table style="width:100%;border-collapse:collapse;font-size:var(--text-sm)">
    <thead>
      <tr style="border-bottom:1px solid var(--color-border)">
        <th style="width:24px;padding:4px"></th>
        <th style="text-align:left;padding:4px">Field</th>
        <th style="text-align:left;padding:4px;color:var(--color-error)">Before</th>
        <th style="text-align:left;padding:4px;color:var(--color-primary)">After</th>
      </tr>
    </thead>
    <tbody id="ai-diff-tbody">
      <!-- rows injected by JS: one <tr> per change -->
      <!-- <tr>
             <td><input type="checkbox" data-change-idx="0" checked /></td>
             <td>Solicitation #</td>
             <td style="color:var(--color-error)">W911S225U1431</td>
             <td style="color:var(--color-primary)">W911S225U14310001</td>
           </tr> -->
    </tbody>
  </table>
  <div style="display:flex;gap:var(--space-sm);margin-top:var(--space-md)">
    <button class="btn btn-sm btn-primary" id="ai-accept-btn">Accept Selected</button>
    <button class="btn btn-sm btn-ghost" id="ai-discard-btn">Discard All</button>
  </div>
</div>
```

When no changes are found (AI agreed with regex): render `"AI found no improvements — all fields match."` text instead of the table.

---

**State 6 — Error state (API call failed):**

```html
<div class="alert alert-error" id="ai-error" style="margin-top:var(--space-md)">
  Extraction failed: [error message from response.error]. 
  <button class="btn btn-sm btn-ghost" id="ai-retry-btn" style="margin-left:var(--space-md)">Retry</button>
</div>
```

The retry button re-triggers the same call. Error clears when a new call succeeds.

---

#### CSS classes to use (existing vs. new)

**Existing classes used (no changes to CSS needed):**
- `.card` — panel container
- `.card-title` — header label
- `.dot` — dot decoration
- `.btn`, `.btn-sm`, `.btn-ghost`, `.btn-primary` — all buttons
- `.spin` — spinner animation
- `.alert`, `.alert-warn`, `.alert-error` — disclosure + error states

**New CSS classes required (must be added to `index.html`):**

Only one structural class needs a CSS definition; the rest use inline styles to minimize CSS footprint:

```css
/* AI Panel — Phase 8 */
.ai-panel .ai-panel-header { cursor: pointer }
.ai-panel .ai-panel-header:hover .card-title { color: var(--color-primary) }
```

These two rules are the only new CSS lines needed. Everything else in the panel uses inline styles on existing structural elements. This is consistent with the pattern used by other step2 elements (e.g., the `pdfPanelHtml` at line 135 uses inline styles throughout).

---

### E. `mergeAiResult()` in `step2.js`

#### Exact function signature and implementation

```javascript
function mergeAiResult(current, aiResult) {
  const merged = { ...current }
  const changes = []
  for (const [key, value] of Object.entries(aiResult)) {
    if (value === null || value === undefined) continue  // skip null — AI did not find this field
    const currentVal = current[key]
    // Normalize both to strings for comparison (handles number vs string "100" vs 100)
    const currentStr = currentVal === null || currentVal === undefined ? '' : String(currentVal).trim()
    const newStr = String(value).trim()
    if (newStr !== currentStr && newStr !== '') {
      changes.push({ field: key, before: currentVal, after: value })
      merged[key] = value
    }
  }
  return { merged, changes }
}
```

**Input:**
- `current`: `window.S.extracted` — the current extraction dict (all string values, potentially some empty)
- `aiResult`: the `result` object from the `/extract-ai` response — same field names as `current`

**Output:** `{ merged: {...}, changes: [{field, before, after}, ...] }`

**Null handling:** `if (value === null || value === undefined) continue` — AI fields with null value are skipped. This means "AI couldn't find this field" does not overwrite an existing regex value. Only non-null AI findings are candidates for changes.

**Type coercion:** `String(currentVal).trim()` vs `String(value).trim()` — comparing as strings prevents false positives from `100 !== "100"`. The comparison uses trimmed strings so whitespace differences are ignored.

**Empty string from AI:** `newStr !== ''` — if the AI returns an empty string for a field (should not happen with the null instruction in the prompt, but defensive), it is not applied.

**Field label lookup for the diff table:** Use a `FIELD_LABELS` dict matching the `fields` array in `step2.js`:

```javascript
const FIELD_LABELS = {
  solicitation_number: 'Solicitation #',
  project_title: 'Project Title',
  solicitation_type: 'Type',
  issuing_agency: 'Issuing Agency',
  due_date: 'Response Due Date',
  posting_date: 'Posting Date',
  contact_name: 'Contact Name',
  contact_email: 'Contact Email',
  contact_phone: 'Contact Phone',
  naics_code: 'NAICS Code',
  psc_code: 'PSC Code',
  set_aside: 'Set-Aside',
  place_of_performance: 'Place of Performance',
  period_of_performance: 'Period of Performance',
  estimated_value: 'Est. Value',
}
```

Any key not in `FIELD_LABELS` is shown with the raw key name (defensive).

#### "Accept Selected" behavior

After "Accept Selected" is clicked:

1. Read all checked checkboxes in `#ai-diff-tbody`: `c.querySelectorAll('#ai-diff-tbody input[type="checkbox"]:checked')`
2. For each checked checkbox: read `data-change-idx`, look up the corresponding change in `window.S._pendingAiChanges[idx]`
3. Apply: `window.S.extracted[change.field] = change.after`
4. Update the corresponding input in the DOM directly (find `input[data-field="${change.field}"]` and set `.value`)
   OR call `render(2)` to full-rerender (simpler, correct, slightly more expensive)
5. Remove the `#ai-diff` element from DOM
6. Re-enable the Extract buttons

**Recommendation: use `render(2)` (full rerender).** Direct DOM manipulation on specific inputs is fragile — it requires tracking which inputs need updating and could get out of sync with `window.S.extracted`. `render(2)` is already the canonical rerender path used everywhere in the app. One extra render is imperceptible to the user.

`window.S._pendingAiChanges` is a transient array holding the `changes` array from the last `mergeAiResult()` call. It is set on the `window.S` object (not in state.js default) when diff is shown, and cleared after accept/discard.

#### "Discard All" behavior

1. Remove the `#ai-diff` element from DOM: `document.getElementById('ai-diff')?.remove()`
2. Clear `window.S._pendingAiChanges`
3. Re-enable the Extract buttons
4. **No state changes to `window.S.extracted`** — the values are unchanged

The usage counter (`window.S.aiUsage`) is NOT rolled back on discard. The API call happened and consumed tokens regardless of whether the user accepted the result.

---

### F. Token Usage Tracking

#### The `aiUsage` default object to add to `state.js`

Add to the `S` object in `electron/js/state.js`, at the end before `items: []`:

```javascript
  aiUsage: { calls: 0, tokens: 0 },
  items: []
```

The shape is `{ calls: number, tokens: number }`. Both start at zero. No sub-breakdown by target (headers vs line_items) — aggregate only.

#### Where `window.S.aiUsage` is updated in `step2.js`

After a successful `/extract-ai` response is received (inside the fetch `.then()` handler):

```javascript
window.S.aiUsage.calls += 1
window.S.aiUsage.tokens += (data.tokens_used || 0)
// If multiple chunks for line items, tokens_used is the sum of all chunks
updateAiUsageDisplay()
```

`updateAiUsageDisplay()` is a helper that writes to `#ai-usage-display`:

```javascript
function updateAiUsageDisplay() {
  const el = document.getElementById('ai-usage-display')
  if (!el || !window.S.aiUsage.calls) return
  const { calls, tokens } = window.S.aiUsage
  el.textContent = `${calls} call${calls !== 1 ? 's' : ''} · ${tokens.toLocaleString()} token${tokens !== 1 ? 's' : ''}`
}
```

#### Display format

`"3 calls · 4,210 tokens"` — shown inside the AI panel body below the action buttons, in the `#ai-usage-display` element.

Uses `Number.toLocaleString()` for comma formatting. For a single call: `"1 call · 847 tokens"`.

#### Persistence across sessions

`aiUsage` does **not** persist across app restarts. `window.S.aiUsage` is in-memory (initialized from `state.js` defaults on each app load). `localStorage` is not used for it.

The server-side `_ai_call_count` also resets on process restart (module-level variable, not written to disk).

Both counters reset together when the user restarts the app. This matches the session scope described in the roadmap. The user is informed of the reset implicitly by the "N calls remaining" count shown in the disclosure text resetting to `AI_MAX_CALLS`.

---

### G. Manual Acceptance Test Sequence

#### Test 1 — Full happy path (low confidence → AI panel expanded → extract headers → diff → accept)

Prerequisites: `ANTHROPIC_API_KEY` set in `.env` or app settings. Backend restarted.

Steps:
1. Create a minimal text file that produces low-confidence parse (e.g., a file with content `"this is a test document"`). Or use any solicitation where `parseConfidence.overall < 0.6`.
2. Upload it in Step 1 and click "Extract Solicitation Data".
3. Navigate to Step 2.
4. **Verify:** The AI panel (`#ai-panel-container`) is visible. The panel body is **expanded** (not collapsed) because `parseConfidence.overall < 0.6`.
5. **Verify in DevTools console:** `window.S.parseConfidence.overall < 0.6` is true. `window.S.aiAvailable === true`.
6. **Verify:** Toggle checkbox (`#ai-toggle-cb`) is present and **unchecked**.
7. Click the toggle checkbox to enable.
8. **Verify:** Disclosure text appears with "Your document text will be sent..." and calls-remaining count.
9. **Verify:** "Extract Headers with AI" and "Extract Line Items with AI" buttons are visible.
10. Click "Extract Headers with AI".
11. **Verify:** Both buttons become disabled with spinner text.
12. **Verify in DevTools Network tab:** A POST request to `/api/sol-quoter/extract-ai` was made with body `{"target":"headers","api_key":"..."}`.
13. Wait for response.
14. **Verify:** `#ai-diff` table appears with before/after values.
15. **Verify in DevTools console:** `window.S._pendingAiChanges` is an array with at least one entry.
16. Check at least one checkbox in the diff table (some may be unchecked if user wants to skip).
17. Click "Accept Selected".
18. **Verify:** The Step 2 fields grid re-renders. The accepted fields show the AI values.
19. **Verify in DevTools console:** `window.S.extracted` reflects the accepted values. `window.S.aiUsage.calls === 1`.
20. **Verify:** `#ai-diff` element is gone from DOM. Extract buttons are re-enabled.
21. **Verify:** `#ai-usage-display` shows `"1 call · N tokens"`.

---

#### Test 2 — No-key path (AI panel hidden)

Prerequisites: `ANTHROPIC_API_KEY` is absent from `.env`. API key not configured in app settings. Backend restarted.

Steps:
1. Upload any document and navigate to Step 2.
2. **Verify:** No `#ai-panel-container` or `#ai-panel` element in the DOM. Inspect with DevTools Elements tab.
3. **Verify in DevTools console:** After the checkAiStatus fetch completes: `window.S.aiAvailable === false`.
4. **Verify in DevTools Network tab:** GET `/api/sol-quoter/ai-status` returns `{"available": false, "calls_remaining": 10}`.
5. Check that the confidence banner (`.confidence-bar`) renders normally — it is separate from the AI panel and should be unaffected.
6. Navigate to Step 3. No AI-related errors in console.

---

#### Test 3 — Call limit (set limit to 1, make 2 calls)

Prerequisites: ANTHROPIC_API_KEY configured. Backend running.

Setup: Temporarily set `AI_MAX_CALLS=1` in `.env`. Restart backend (`window.api.restartBackend()` or kill/restart process).

Steps:
1. Upload a solicitation with `parseConfidence.overall < 0.6`. Navigate to Step 2.
2. Enable toggle. Click "Extract Headers with AI".
3. **Verify:** First call succeeds. Diff view appears. `window.S.aiUsage.calls === 1`.
4. Discard the diff (or accept it). Extract buttons re-enable.
5. Click "Extract Headers with AI" again.
6. **Verify in DevTools Network tab:** POST `/extract-ai` returns HTTP 429.
7. **Verify:** Error alert appears in the panel: "AI extraction call limit reached (1 calls this session). Restart the app to reset."
8. **Verify:** `window.S.aiUsage.calls === 1` (did not increment on the failed call).

Cleanup: Restore `AI_MAX_CALLS=10` in `.env`.

---

#### Test 4 — Discard path (extract → discard → no changes)

Prerequisites: ANTHROPIC_API_KEY configured.

Steps:
1. Upload solicitation. Note the current value of `solicitation_number` in DevTools: `window.S.extracted.solicitation_number` — record this value.
2. Navigate to Step 2. Enable AI toggle. Click "Extract Headers with AI".
3. Wait for diff view to appear.
4. Without accepting anything, click "Discard All".
5. **Verify:** `#ai-diff` element is removed from DOM.
6. **Verify in DevTools console:** `window.S.extracted.solicitation_number` equals the value recorded in step 1 — unchanged.
7. **Verify:** `window.S.aiUsage.calls === 1` (the call happened; discard does not roll back the counter).
8. **Verify in DevTools console:** `window.S._pendingAiChanges` is `undefined` or `null` or empty.
9. Click "Extract Headers with AI" again (if calls_remaining > 0).
10. **Verify:** A new diff view appears (confirming the UI can be re-used after discard).

---

#### DevTools console checks for each test

For all tests, run these in DevTools console after Step 2 renders:

```javascript
// Check Phase 7 confidence
console.log('parseConfidence:', window.S.parseConfidence)
console.log('overall:', window.S.parseConfidence?.overall)

// Check AI availability
console.log('aiAvailable:', window.S.aiAvailable)
console.log('aiCallsRemaining:', window.S.aiCallsRemaining)

// Check usage counter
console.log('aiUsage:', window.S.aiUsage)

// After accepting changes
console.log('extracted.solicitation_number:', window.S.extracted.solicitation_number)
console.log('extracted.naics_code:', window.S.extracted.naics_code)
```

For Network tab: watch for:
- GET `/api/sol-quoter/ai-status` — fires on step 2 render
- POST `/api/sol-quoter/extract-ai` — fires on button click
- Expected latency for headers call: 2–8 seconds (Haiku is fast)
- Expected latency for line items call: 5–20 seconds (Sonnet, may have multiple chunks)

---

## Part 3 — File Change Inventory

All Phase 8 changes touch exactly four files:

| File | Change type | What changes |
|------|-------------|--------------|
| `python/server.py` | Additive | `load_dotenv()`, 4 constants, `_ai_call_count`, `chunk_text()`, `/ai-status` route, `/extract-ai` route |
| `electron/js/modules/step2.js` | Additive + modification | `checkAiStatus()`, `renderAiPanel()`, `mergeAiResult()`, `updateAiUsageDisplay()`, AI panel HTML placeholder in `c.innerHTML`, event handlers for toggle/buttons/accept/discard |
| `electron/js/state.js` | Additive | `aiUsage: { calls: 0, tokens: 0 }` key in default `S` object |
| `electron/index.html` | Additive | 2 CSS lines for `.ai-panel .ai-panel-header` hover rule |
| `.env` | New content | `ANTHROPIC_API_KEY`, `AI_MAX_CALLS`, `AI_HEADER_MODEL`, `AI_LINE_ITEM_MODEL` |

**`extractor.py` is NOT modified.** The existing `ai_extract()` and `extract_data()` functions in `extractor.py` are kept as-is. The new `/extract-ai` endpoint in `server.py` implements AI extraction inline (using the anthropic SDK directly), rather than routing through the existing `ai_extract()` helper. This avoids modifying a tested module and gives Phase 8 full control over prompt design, chunking, and response shape.

**`preload.js` is NOT modified.** No new IPC channels are needed — the fetch calls go directly to Flask, same pattern as `step1.js:doParse()`.

**`validator.py` is NOT modified.** The field-level confidence system (`overallConfidence`, `fields`, `flags`) is untouched.

---

## Part 4 — Regression Risk Table

| Change | Risk | What could break | Mitigation |
|--------|------|-----------------|------------|
| `load_dotenv()` in server.py | **Very Low** | Nothing — `try/except ImportError` guards against missing python-dotenv. `_PORT` is read after, not before. | Confirm `python-dotenv` is in requirements.txt or install it. |
| `_AI_API_KEY` at module level | **None** | Nothing — additive constant, not used anywhere yet. | |
| `_ai_call_count = 0` at module level | **None** | Nothing — additive. | |
| `/ai-status` route | **None** | Nothing — new route, no conflicts with existing routes. | |
| `/extract-ai` route | **None** | Nothing — new route. Existing `/parse` and `/sam_lookup` unchanged. | |
| `aiUsage` added to state.js | **None** | Nothing — additive key, all existing code reads specific known keys. | |
| AI panel in step2.js c.innerHTML | **Low** | If `#ai-panel-container` placeholder breaks existing layout. | Keep placeholder as `<div id="ai-panel-container"></div>` — zero height, zero visual impact on initial render. |
| `checkAiStatus()` fetch in step2 | **Low** | If Flask is slow to respond, the panel renders late. | Use `.catch()` to handle network errors silently. The panel simply won't appear if the fetch fails. |
| 2 CSS lines in index.html | **None** | Nothing — scoped to `.ai-panel .ai-panel-header`. | |

**Known gotcha — Electron API key path:**

`window.S.apiKey` is the key stored in Electron's keychain (via `storeApiKey`/`loadApiKey`). It is not automatically set when the app starts — the user must configure it via the app's AI settings modal. If `window.S.apiKey` is empty but `ANTHROPIC_API_KEY` is set in `.env`, the `/ai-status` query string will be empty but the server will fall back to `_AI_API_KEY` from env. This means:
- `.env` path: works silently (no user action needed)
- Electron keychain path: `window.S.apiKey` must be non-empty for the query-string fallback to work

The `/extract-ai` request body has the same dual-key logic: `req_key = body.get("api_key", "").strip(); effective_key = req_key or _AI_API_KEY`. If both are empty, returns 503.

**Summary:** Phase 8 is purely additive at the server level. At the frontend level, the only modification to existing code is adding `aiUsage` to `state.js` and adding a `<div id="ai-panel-container"></div>` placeholder to the `step2()` template. All new logic is in new functions. Risk is low.

---

## Part 5 — Acceptance Criteria Cross-Check (from Roadmap)

| Roadmap check | How it passes |
|---------------|---------------|
| No API key configured — AI panel hidden, no button, no error | `/ai-status` returns `{"available": false, ...}` → `renderAiPanel()` renders nothing → `#ai-panel-container` stays empty |
| Low confidence parse triggers AI offer | `parseConfidence.overall < 0.6` → panel auto-expands in `renderAiPanel()` |
| User triggers AI extraction — diff view shows, user confirms | Toggle checked → buttons visible → button click fires `/extract-ai` → diff rendered → "Accept Selected" applies changes |
| AI result merges correctly — only changed fields updated | `mergeAiResult()` compares stringified values; only non-null, non-matching fields are in `changes`; only checked changes are applied on accept |
| AI extraction improves W911S225U14310001 | Headers call sends first 4000 chars of the document → Haiku extracts correct `solicitation_number`, `naics_code`, etc. → diff shows improvements |
| Token usage visible — shown in AI panel after extraction | `window.S.aiUsage` updated after each call; `#ai-usage-display` shows `"N calls · N tokens"` |
| Privacy: no key, no call — zero network calls to Anthropic when key absent | `/ai-status` returns `available: false` → panel not rendered → no buttons → no calls possible |

---

*End of Phase 8 diagnostic report and implementation plan.*
*Generated: 2026-05-04. No code was modified during this analysis.*
