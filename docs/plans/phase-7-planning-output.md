# Phase 7 — Confidence Scoring: Diagnostic Report & Implementation Plan

**Date:** 2026-05-03  
**Scope:** Phase 7 of sol-quoter-roadmap-phases-6-10.md  
**Status:** Planning — no code written  
**Prerequisite:** Phase 6 confirmed complete (see below)

---

## Phase 6 Completion Confirmation

**`extraction_warnings` is present in `parse_solicitation_bundle()`'s return value.**

Exact lines from `python/extractor.py`, lines 1271–1285:

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

    return data
```

`data["extraction_warnings"]` is assembled after the CLIN fallback block and before `return data`. Phase 6 is complete. Proceeding to Phase 7 planning.

---

## Files Read

- `python/extractor.py` — full (1286 lines)
- `python/server.py` — full (382 lines)
- `electron/js/modules/step1.js` — full (466 lines)
- `electron/js/modules/step2.js` — full (234 lines)
- `electron/js/state.js` — full (28 lines)
- `electron/index.html` — full CSS section (lines 1–499+)
- `docs/plans/phase-6-planning-output.md` — full
- `docs/plans/sol-quoter-roadmap-phases-6-10.md` — Phase 7 section

---

## Part 1 — Diagnostic Questions

### Q1. Is `extraction_warnings` present in `parse_solicitation_bundle()`'s return dict?

**Yes. Confirmed.** See Phase 6 confirmation block above. `data["extraction_warnings"]` is attached to the result dict at lines 1271–1284 of `python/extractor.py`, assembled from three possible conditions (missing required fields, unknown format, no line items), then `return data` at line 1285 returns the complete dict including this key.

---

### Q2. What does the `/parse` route return in `server.py`?

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
| `data` | dict | `parse_solicitation_bundle()` result | Full extraction dict including `_format`, `_method`, `extraction_warnings`, all extracted fields, `line_items` if present |
| `overallConfidence` | int (0–100) | `validate_fields(data, source_type)` in `python/validator.py` | **Field-level confidence** — per-field scoring of extraction value quality |
| `fields` | list of dicts | `validate_fields()` | Per-field entries with `name`, `confidence`, `status`, `issue`, optional `boundingBox` |
| `flags` | list | `validate_fields()` | Fields below confidence threshold |
| `_session_files` | dict | session manifest | `{"main": filename, "sow": filename, "pricing": filename}` |

**Is `confidence` currently a key in the response?**  
No. The confidence data is spread across three top-level keys: `overallConfidence` (int 0–100), `fields` (list), and `flags` (list). There is no key named `"confidence"` at the top level of the response.

**Important distinction:** The existing `overallConfidence` in the response is produced by `validator.py:validate_fields()`, which scores individual field values (e.g., is the NAICS code well-formed, does the email pass regex). This is **field-level confidence** and is unrelated to the Phase 7 **parse quality confidence** (format detection reliability + required field completeness + line item source quality).

---

### Q3. Where in `step2.js` is the `/parse` response first received? Where is `window.S` populated?

**The `/parse` response is NOT received in `step2.js`**. It is received in `step1.js:doParse()`.

**`electron/js/modules/step1.js`, lines 198–226 (exact):**

```javascript
const data = await r.json();
if (!data.success) throw new Error(data.error || "Extraction failed");
p(100, "Done!");
window.S.extracted = data.data;
window.S.sessionFiles = data._session_files || {};
// Store confidence data for step 2 rendering (Phase 8)
window.S.confidence = {
    overallConfidence: data.overallConfidence || null,
    fields: data.fields || [],
    flags: data.flags || [],
};
// Store source file type for PDF viewer visibility check (use primary file)
const _primaryFile =
    window.S.files && window.S.files.length > 0
        ? window.S.files[0]
        : window.S.file;
const _srcName = _primaryFile
    ? _primaryFile.name
    : window.S.filePath
    ? window.S.filePath.split(/[/\\]/).pop()
    : "";
window.S.sourceType = _srcName.toLowerCase().endsWith(".pdf")
    ? "pdf"
    : _srcName.toLowerCase().endsWith(".docx") || ...
    ? "docx"
    : "txt";
```

Then at line 274: `setTimeout(() => goTo(2), 500)` — navigates to Step 2.

`step2.js` reads from `window.S.extracted` (set to `data.data`) and `window.S.confidence` (assembled from the top-level response keys). By the time `step2(c)` is called, both are already populated.

**The Phase 7 confidence dict** (to be stored in `data.data.confidence` after the change) will automatically be present in `window.S.extracted.confidence` since `window.S.extracted = data.data`.

---

### Q4. Where is Step 2 rendered? Function signature and first 20 lines.

**`electron/js/modules/step2.js`, lines 14–42:**

```javascript
function step2(c) {
  const d = window.S.extracted
  const m = d._method||'rules'
  const badge = m === 'demo'
    ? '<span class="mbadge rules">Demo Data — edit any field below</span>'
    : m.includes('ai')
      ? '<span class="mbadge ai">AI + Rule-Based Extraction</span>'
      : m === 'sam_gov'
        ? '<span class="mbadge ai">SAM.gov Lookup</span>'
        : '<span class="mbadge rules">Rule-Based Extraction</span>'

  // Confidence badge per D-19, D-23
  const conf = window.S.confidence || {}
  const oc = conf.overallConfidence
  let confBadgeHtml = ''
  if (oc !== null && oc !== undefined) {
    let badgeClass, badgeLabel
    if (oc >= 95) {
      badgeClass = 'mbadge ai'
      badgeLabel = `${oc}% Confidence`
    } else if (oc >= 70) {
      badgeClass = 'mbadge rules'
      badgeLabel = `${oc}% Confidence &mdash; review flagged fields`
    } else {
      badgeClass = 'mbadge'
      badgeLabel = `${oc}% Confidence &mdash; low accuracy, review all fields`
    }
    confBadgeHtml = `<div class="confidence-badge"><span class="${badgeClass}"${oc < 70 ? ' style="background:var(--color-error);color:var(--color-contrast-dark)"' : ''}>${badgeLabel}</span></div>`
  }
```

`step2(c)` is called with `c` = the content container DOM element. It reads `window.S.extracted` as `d` (the extraction result dict) and `window.S.confidence` as `conf` (field-level confidence from validator.py).

---

### Q5. Does `step2.js` currently render any status banner or alert at the top?

**No alert or banner is present.** There is a `confBadgeHtml` (lines 26–42) which renders a compact `.mbadge` inline label inside a `.confidence-badge` div. This is a single-line badge ("92% Confidence" or "65% Confidence — review flagged fields"), not an alert-style banner with warning list.

The render template at lines 104–106 shows the ordering:

```javascript
c.innerHTML = `
${badge}
${confBadgeHtml}
<div class="card">
  <div class="card-title">...Extracted Fields...</div>
  ...
```

Method badge → confidence percentage badge → card. No `<div class="alert ...">` element is present at this level.

---

### Q6. Banner/alert component in index.html CSS

**Yes. Four alert variants exist.** `electron/index.html`, lines 180–184:

```css
.alert{
  padding: var(--space-md) var(--space-lg);
  border-radius: 0;
  display: flex;
  align-items: flex-start;
  gap: var(--space-md);
  margin-bottom: var(--space-lg);
  font-size: var(--text-md)
}
.alert-success { background:rgba(170,255,0,.08); border:1px solid rgba(170,255,0,.3); color:var(--color-success) }
.alert-error   { background:rgba(255,68,68,.08);  border:1px solid rgba(255,68,68,.3);  color:var(--color-error)   }
.alert-info    { background:rgba(0,255,65,.08);   border:1px solid rgba(0,255,65,.2);   color:var(--color-primary) }
.alert-warn    { background:rgba(170,255,0,.08);  border:1px solid rgba(170,255,0,.3);  color:var(--color-success) }
```

**Confidence-specific CSS already present** (lines 305–314):

```css
/* Phase 8: Confidence UI */
.confidence-badge { display:flex; align-items:center; gap:var(--space-sm); margin-bottom:var(--space-lg) }
.field-confidence { display:flex; align-items:center; gap:var(--space-xs); margin-top:3px; font-size:var(--text-sm) }
.field-confidence .conf-pct   { color:var(--color-error); font-weight:600 }
.field-confidence .conf-issue { color:var(--color-text-muted) }
```

**Semantic color variables available:**

| Variable | Default value | Semantic role |
|----------|--------------|---------------|
| `--color-success` | `#AAFF00` | Positive, green state |
| `--color-warning` | `#AAFF00` | Warning (same as success in default theme) |
| `--color-error` | `#FF4444` | Error, red state |
| `--color-primary` | `#00FF41` | Info, primary brand |
| `--color-text-muted` | `#2a5e2a` | Subdued text |

**Note on amber:** In the default theme, `--color-warning` and `--color-success` are identical (`#AAFF00`). The `.alert-warn` class uses `--color-success` as its text/border color. "Amber" in the Phase 7 banner maps to `.alert-warn` (yellow-green, visually distinct from `.alert-error` red and `.alert-success` which is the same hue but may need contextual differentiation via label text).

---

### Q7. Current shape of `window.S` — default object from `state.js`. Does it have a `confidence` key? Where is `S.extracted` first set?

**`electron/js/state.js`, lines 5–26 — complete default object:**

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

**`window.S.sol` does not exist.** The solicitation extraction result is stored at `window.S.extracted`, initialized as `{}`.

**`confidence` is NOT a key in the default `S` object.** It is dynamically added to `window.S` in `step1.js:doParse()` (lines 204–208):

```javascript
window.S.confidence = {
    overallConfidence: data.overallConfidence || null,
    fields: data.fields || [],
    flags: data.flags || [],
};
```

This assignment happens after the `/parse` response is received and before `goTo(2)` is called.

**`window.S.extracted` is first set at `step1.js` line 201:**

```javascript
window.S.extracted = data.data;
```

This sets `extracted` to the full extraction result dict from `parse_solicitation_bundle()`, including `_format`, `_method`, `extraction_warnings`, and all extracted fields. After Phase 7, this dict will also include a `confidence` key at `window.S.extracted.confidence`.

**There is no `confidence` key inside `S.extracted` today** — the Phase 7 `compute_confidence()` result dict must be added by the implementation.

---

## Part 2 — Implementation Plan

### A. The confidence dict schema

The Phase 7 confidence dict is stored at `result["confidence"]` in the `parse_solicitation_bundle()` return value (and therefore at `window.S.extracted.confidence` on the frontend). It is entirely distinct from the existing `overallConfidence` (int 0–100) from `validator.py`, which measures field-value quality.

**Complete schema:**

```python
result["confidence"] = {
    "overall":          0.73,   # float 0.0–1.0 — weighted average of the three sub-scores
    "format_detection": 1.0,    # 1.0 = known format with score >= 5
                                # 0.5 = known format with score == 3 or 4 (barely passed)
                                # 0.0 = "unknown"
    "required_fields":  1.0,    # fraction of 4 required fields that are non-empty
                                # 4/4 = 1.0, 3/4 = 0.75, 2/4 = 0.5, 1/4 = 0.25, 0/4 = 0.0
    "line_items":       0.1,    # 1.0 = SOW+XLSX merge (any item _source == "SOW+XLSX")
                                # 0.7 = SOW-only (items present, _source == "SOW", no XLSX)
                                # 0.4 = CLIN fallback (all items _source == "CLIN")
                                # 0.1 = no line_items key in result (single-row path not triggered)
    "warnings":         []      # direct copy of result["extraction_warnings"] from Phase 6
}
```

**Weight constants (named, in `extractor.py`):**

```python
_W_FORMAT = 0.3
_W_FIELDS = 0.4
_W_ITEMS  = 0.3
```

`overall = _W_FORMAT * format_detection + _W_FIELDS * required_fields + _W_ITEMS * line_items`

These weights are declared at module level in `extractor.py`, named so they appear in grep output and can be tuned without hunting through the function body.

**Example calculations for known fixtures:**

| Fixture | format | req_fields | line_items | overall |
|---------|--------|-----------|------------|---------|
| 70B bundle | 1.0 (sf1449, score 11) | 1.0 (4/4) | 1.0 (SOW+XLSX) | **1.00** → green |
| W911S225U14310001 | 1.0 (sam_export, score 10) | 1.0 (4/4) | 0.1 (no items) | **0.73** → amber |
| 36C24225Q0696 | 1.0 (agency_form, score 6) | 1.0 (4/4) | 0.1 (no items) | **0.73** → amber |
| Unknown-format doc | 0.0 (unknown) | 0.0 (0/4) | 0.1 (fallback) | **0.03** → red |
| request-for-quotation | 1.0 (formal_rfq, score 6) | 1.0 (4/4) | 0.1 (no items) | **0.73** → amber |

---

### B. The `compute_confidence(result)` function

#### Location in extractor.py

New function placed in `extractor.py` in the `# ── ENTRY POINT ──` section, immediately **before** `extract_data()` (currently at line 655). This keeps all parse-pipeline logic together.

#### Prerequisite: expose `_format_score` from `detect_format()`

`compute_confidence()` needs the numeric detection score (not just the format name) to distinguish "barely detected" (score == 3, threshold minimum) from "high confidence detection" (score >= 5). Two changes are required:

**1. `detect_format()` returns a tuple instead of a string:**

```python
# Current (line 129-133):
best = max(scores, key=scores.get)
if scores[best] >= 3:
    print(f"[detect_format] scores={scores} -> {best}")
    return best
print(f"[detect_format] scores={scores} -> unknown")
return "unknown"

# After Phase 7:
best = max(scores, key=scores.get)
if scores[best] >= 3:
    print(f"[detect_format] scores={scores} -> {best}")
    return best, scores[best]
print(f"[detect_format] scores={scores} -> unknown")
return "unknown", 0
```

**2. `extract_data()` unpacks the tuple and stores `_format_score`:**

```python
# Current (line 656):
format_name = detect_format(text)

# After Phase 7:
format_name, format_score = detect_format(text)
...
d["_format"] = format_name
d["_format_score"] = format_score   # new line
```

`classify_document()` also calls `detect_format()` (line 1148: `fmt = detect_format(text)`). It must be updated to unpack the tuple and discard the score: `fmt, _ = detect_format(text)`.

#### `compute_confidence()` function signature and logic

```python
def compute_confidence(result):
    """
    Compute structured parse quality confidence from an extraction result dict.

    Reads: _format, _format_score, extraction_warnings, line_items
    Returns a confidence dict with overall (0.0-1.0), sub-scores, and warnings.
    Called at end of parse_solicitation_bundle() before return.
    """
    _REQUIRED = ["solicitation_number", "due_date", "contact_email", "naics_code"]

    # ── format_detection sub-score ────────────────────────────────────────────
    fmt = result.get("_format", "unknown")
    score = result.get("_format_score", 0)
    if fmt == "unknown" or score == 0:
        format_detection = 0.0
    elif score <= 4:
        format_detection = 0.5   # passed threshold but weak signal
    else:
        format_detection = 1.0   # strong detection (score >= 5)

    # ── required_fields sub-score ─────────────────────────────────────────────
    present = sum(
        1 for f in _REQUIRED
        if result.get(f) and str(result[f]).strip() != ""
    )
    required_fields = present / len(_REQUIRED)   # 0.0–1.0 in 0.25 steps

    # ── line_items sub-score ──────────────────────────────────────────────────
    items = result.get("line_items", [])
    if not items:
        line_items = 0.1   # no structured line items (single-row fallback path)
    elif all(i.get("_source") == "CLIN" for i in items):
        line_items = 0.4   # CLIN fallback only
    elif any(i.get("_source") == "SOW+XLSX" for i in items):
        line_items = 1.0   # best quality: SOW spec + XLSX quantities merged
    elif any(i.get("_source") in ("SOW", "SOW+XLSX") for i in items):
        line_items = 0.7   # SOW spec only, no pricing quantities
    else:
        line_items = 0.4   # unknown source items (defensive default)

    # ── weighted overall ──────────────────────────────────────────────────────
    overall = round(
        _W_FORMAT * format_detection +
        _W_FIELDS * required_fields  +
        _W_ITEMS  * line_items,
        3
    )

    return {
        "overall":          overall,
        "format_detection": format_detection,
        "required_fields":  required_fields,
        "line_items":       line_items,
        "warnings":         list(result.get("extraction_warnings", [])),
    }
```

#### Where it is called

In `parse_solicitation_bundle()`, immediately before `return data` (current line 1285), after `extraction_warnings` has been assembled:

```python
    data["extraction_warnings"] = warnings
    if warnings:
        print(f"[parse_solicitation_bundle] warnings={warnings}")

    # Phase 7: compute and attach parse quality confidence
    data["confidence"] = compute_confidence(data)

    return data
```

This placement ensures `compute_confidence()` sees the final state of `data` — after `apply_generic_fallback()`, after line item extraction, and after `extraction_warnings` is assembled.

#### Named weight constants and their values

Declared at module scope in `extractor.py`, near the top of the `# ── ENTRY POINT ──` section:

```python
_W_FORMAT = 0.3   # weight: format detection reliability
_W_FIELDS = 0.4   # weight: required fields presence (highest — most user-visible signal)
_W_ITEMS  = 0.3   # weight: line item source quality
```

---

### C. How confidence flows into the `/parse` response

#### Does `server.py` need to change?

**No. Server.py requires no changes.**

The mechanism: `parse_solicitation_bundle()` sets `data["confidence"]` before returning. `server.py` wraps the full `data` dict as the `"data"` key in the response:

```python
return jsonify({
    "success": True,
    "data": data,          # includes data["confidence"] transparently
    ...
})
```

On the frontend, `step1.js` sets `window.S.extracted = data.data`. The Phase 7 confidence dict is therefore immediately available at `window.S.extracted.confidence`.

#### What is the exact JSON key path the frontend reads?

The `/parse` response JSON path: `response.data.confidence`

In JavaScript after `const data = await r.json()`:
- `data.data.confidence` → Phase 7 parse quality dict (new)
- `data.overallConfidence` → existing field-level integer 0–100 (unchanged)

#### How `step1.js` stores it

The existing `window.S.confidence` assignment (step1.js lines 204–208) must be extended to include the Phase 7 confidence dict:

```javascript
window.S.confidence = {
    overallConfidence: data.overallConfidence || null,   // existing — validator.py field scoring
    fields: data.fields || [],
    flags: data.flags || [],
    parsed: data.data?.confidence || null,               // Phase 7 — parse quality confidence
};
```

Adding `parsed` to the existing object avoids changing how existing code reads `overallConfidence`, `fields`, and `flags`. In `step2.js`, the Phase 7 banner reads from `window.S.confidence.parsed`.

**Summary of keys in `window.S.confidence` after Phase 7:**

| Key | Source | Type | Scale | Purpose |
|-----|--------|------|-------|---------|
| `overallConfidence` | `validator.py` | int | 0–100 | Field-value quality (existing badge) |
| `fields` | `validator.py` | list | — | Per-field confidence entries (existing flagged-field UI) |
| `flags` | `validator.py` | list | — | Below-threshold fields (existing) |
| `parsed` | `extractor.py` (Phase 7) | dict | 0.0–1.0 | Parse quality — new confidence banner |

---

### D. The Step 2 Confidence UI

#### Where to insert the banner

**Immediately after the method badge and existing confBadgeHtml, before the first `<div class="card">` block.**

Current `step2.js` template order (lines 104–110):

```javascript
c.innerHTML = `
${badge}           ← method badge
${confBadgeHtml}   ← existing field-level confidence badge (0–100%)
<div class="card">
  <div class="card-title">...Extracted Fields...
  ...
```

**New order:**

```javascript
c.innerHTML = `
${badge}           ← method badge (unchanged)
${confBannerHtml}  ← Phase 7 parse quality banner (replaces confBadgeHtml)
<div class="card">
  <div class="card-title">...Extracted Fields...
  ...
```

**Why before the field list:** The banner informs the user of parse quality BEFORE they start reviewing fields. A red or amber banner appearing mid-screen (after scrolling past the field list) would be missed. Placing it at the top ensures it is the first thing a user sees when the step renders.

**Why replace `confBadgeHtml` instead of adding alongside:** The existing `confBadgeHtml` shows the `overallConfidence` integer from `validator.py` — a field-value quality signal. The Phase 7 banner shows parse quality from `compute_confidence()` — a parse pipeline signal. Both together would create two confidence indicators with different scales and meanings, confusing the user. The Phase 7 banner subsumes the function of the existing badge (it already shows an "X% Confidence" label) and adds the warning list. The existing per-field badges (`.field-confidence` below each flagged input) are kept — they are precise, inline, and useful at the field level.

#### The `confBannerHtml` computation block

Placed where `confBadgeHtml` currently lives (step2.js lines 26–42), replacing it:

```javascript
// Phase 7: parse quality confidence banner
const parsedConf = window.S.confidence.parsed || null
let confBannerHtml = ''
if (parsedConf) {
  const overall = parsedConf.overall          // 0.0–1.0
  const pct = Math.round(overall * 100)       // display percentage
  const warnings = parsedConf.warnings || []  // from extraction_warnings

  const WARNING_LABELS = {
    'missing_field:solicitation_number': 'Solicitation number not found',
    'missing_field:due_date':            'Response due date not found',
    'missing_field:contact_email':       'Contact email not found',
    'missing_field:naics_code':          'NAICS code not found',
    'unknown_format':                    'Document format not recognized — field accuracy may be low',
    'no_line_items':                     'No line items found — add them manually in Step 3',
  }

  function warnLabel(w) {
    const key = w.field ? `${w.code}:${w.field}` : w.code
    return WARNING_LABELS[key] || `${w.code}${w.field ? ': ' + w.field : ''}`
  }

  if (overall >= 0.8) {
    // GREEN state — subtle, non-interrupting
    confBannerHtml = `<div class="confidence-badge">
      <span class="mbadge ai">${pct}% Confidence</span>
    </div>`
  } else if (overall >= 0.5) {
    // AMBER state — visible banner with warning list
    const warnItems = warnings.map(w =>
      `<li>${esc(warnLabel(w))}</li>`
    ).join('')
    confBannerHtml = `<div class="alert alert-warn" style="flex-direction:column;align-items:flex-start;gap:var(--space-xs)">
      <div style="font-weight:700">${pct}% Confidence &mdash; review these fields carefully</div>
      ${warnItems ? `<ul style="margin:var(--space-xs) 0 0 var(--space-lg);padding:0">${warnItems}</ul>` : ''}
    </div>`
  } else {
    // RED state — prominent banner with AI extraction message
    const warnItems = warnings.map(w =>
      `<li>${esc(warnLabel(w))}</li>`
    ).join('')
    confBannerHtml = `<div class="alert alert-error" style="flex-direction:column;align-items:flex-start;gap:var(--space-xs)">
      <div style="font-weight:700">${pct}% Confidence &mdash; extraction accuracy is low</div>
      ${warnItems ? `<ul style="margin:var(--space-xs) 0 0 var(--space-lg);padding:0">${warnItems}</ul>` : ''}
      <div style="margin-top:var(--space-xs);color:var(--color-text-muted)">Review all fields carefully. AI-assisted extraction will be available in Phase 8.</div>
    </div>`
  }
}
```

#### Three-state HTML structures

**Green state** (`overall >= 0.8`) — compact, non-interrupting:

```html
<div class="confidence-badge">
  <span class="mbadge ai">87% Confidence</span>
</div>
```

Uses existing `.confidence-badge` + `.mbadge.ai` CSS. No margin penalty — same footprint as the existing badge.

---

**Amber state** (`0.5 <= overall < 0.8`) — visible alert with warning list:

```html
<div class="alert alert-warn" style="flex-direction:column;align-items:flex-start;gap:var(--space-xs)">
  <div style="font-weight:700">73% Confidence &mdash; review these fields carefully</div>
  <ul style="margin:var(--space-xs) 0 0 var(--space-lg);padding:0">
    <li>No line items found — add them manually in Step 3</li>
  </ul>
</div>
```

Uses existing `.alert.alert-warn` CSS. Color: `--color-success` (`#AAFF00`) text/border, `rgba(170,255,0,.08)` background. Renders as a yellow-green notice box.

---

**Red state** (`overall < 0.5`) — prominent alert with AI message:

```html
<div class="alert alert-error" style="flex-direction:column;align-items:flex-start;gap:var(--space-xs)">
  <div style="font-weight:700">18% Confidence &mdash; extraction accuracy is low</div>
  <ul style="margin:var(--space-xs) 0 0 var(--space-lg);padding:0">
    <li>Document format not recognized — field accuracy may be low</li>
    <li>Solicitation number not found</li>
    <li>Response due date not found</li>
    <li>Contact email not found</li>
    <li>NAICS code not found</li>
    <li>No line items found — add them manually in Step 3</li>
  </ul>
  <div style="margin-top:var(--space-xs);color:var(--color-text-muted)">
    Review all fields carefully. AI-assisted extraction will be available in Phase 8.
  </div>
</div>
```

Uses existing `.alert.alert-error` CSS. Color: `--color-error` (`#FF4444`) text/border, `rgba(255,68,68,.08)` background.

---

#### Warning code to human-readable text mapping

Complete mapping table:

| Code | Field | Human-readable text |
|------|-------|---------------------|
| `missing_field` | `solicitation_number` | Solicitation number not found |
| `missing_field` | `due_date` | Response due date not found |
| `missing_field` | `contact_email` | Contact email not found |
| `missing_field` | `naics_code` | NAICS code not found |
| `unknown_format` | — | Document format not recognized — field accuracy may be low |
| `no_line_items` | — | No line items found — add them manually in Step 3 |

The `warnLabel()` helper builds the lookup key as `"code:field"` for `missing_field` warnings and `"code"` for others. This avoids a nested switch/if chain.

#### CSS needed

**No new CSS classes or variables are required.** The implementation uses only:

- `.alert`, `.alert-warn`, `.alert-error` — already defined (index.html lines 180–184)
- `.confidence-badge` — already defined (index.html line 306)
- `.mbadge`, `.mbadge.ai` — already defined (index.html lines 241–243)
- `--color-success`, `--color-error`, `--color-text-muted`, `--space-xs`, `--space-lg` — all in `:root`

One optional addition: an inline `style="flex-direction:column"` override on the `.alert` element to stack the headline and list vertically. The existing `.alert` uses `display:flex;align-items:flex-start` which can hold this layout. No new class needed — the override is inline.

---

### E. Validation Steps

The following manual steps confirm the full end-to-end feature works. No new automated tests exist (Phase 9 closes test gaps). These are run by hand after implementation.

**Step 1 — Regression: no change to extraction output**

```
python testdata/run.py
```

Expected: `SUMMARY: 6 fixture(s) validated, 0 skipped — PASS: 6`

All extraction values must be identical to Phase 6 output. The `compute_confidence()` function is read-only with respect to the result dict fields; it only adds the `confidence` key and the `_format_score` key. If any fixture fails, the `detect_format()` tuple return change likely introduced a regression in `classify_document()` (check that `fmt, _ = detect_format(text)` is used there).

---

**Step 2 — Green state: 70B bundle**

Upload `70B06C26Q00000080.pdf` + `70B06C26Q00000080+Attachment+1+-+LLSM+SOW.pdf` + `70B06C26Q00000080+Attachment+2-Pricing+Sheeet.xlsx` as a three-file bundle.

Expected:
- `confidence.overall` >= 0.85 (formula: `0.3*1.0 + 0.4*1.0 + 0.3*1.0 = 1.0`)
- Green banner: `<span class="mbadge ai">100% Confidence</span>`
- No warning list visible

---

**Step 3 — Amber state: W911S225U14310001**

Upload `W911S225U14310001_CSS_08062025.pdf` as a single file.

Expected:
- `confidence.overall` ~0.73 (formula: `0.3*1.0 + 0.4*1.0 + 0.3*0.1 = 0.73`)
- Amber banner: `.alert.alert-warn` with "73% Confidence — review these fields carefully"
- Warning list shows: "No line items found — add them manually in Step 3"
- No missing-field warnings (all 4 required fields are present)

---

**Step 4 — Amber state: N5005426Q0114**

Upload `N5005426Q0114_CSS_03312026.pdf` as a single file.

Expected:
- `confidence.overall` ~0.73 (same formula as W911 — all fields present, no line items)
- Amber banner with same warning list
- No red state — all required fields are present in this SAM export

---

**Step 5 — Amber state: request-for-quotation (formal RFQ)**

Upload `request-for-quotation.pdf` as a single file.

Expected:
- `confidence.overall` ~0.73 (format known, all 4 required fields present, no items)
- Amber banner

---

**Step 6 — Red state: no fixture available, verify with a blank/corrupt file**

To verify red state without a real unknown-format fixture: temporarily add a text file with no recognizable solicitation content.

Expected:
- `_format` = "unknown", `_format_score` = 0
- `confidence.format_detection` = 0.0
- If required fields also missing: `confidence.overall` = 0.03 or similar
- Red banner: `.alert.alert-error` with "N% Confidence — extraction accuracy is low"
- Full warning list rendered

Alternatively: verify red state by reading the rendered `confBannerHtml` logic directly in the browser console after uploading a minimal text file (`echo "test" > test.txt`).

---

**Step 7 — Warning text rendering check**

For the amber case (W911), verify:
- The `<ul>` list is visible
- "No line items found — add them manually in Step 3" appears as the single `<li>`
- No "undefined" or missing text in any `<li>` (verifies `warnLabel()` lookup is working)

---

**Step 8 — `run.py` final check**

```
python testdata/run.py
```

Expected: 6/6 pass, unchanged from Step 1. If any fixture newly fails here, the issue is likely `_format_score` not being stored correctly in `extract_data()` and reaching `compute_confidence()` as `0` for a valid format, which would produce wrong `format_detection` scores.

---

## Part 3 — Change Order and Regression Risk

### Change sequence

All changes are in `python/extractor.py` and `electron/js/modules/step1.js` + `electron/js/modules/step2.js`. No changes to `server.py`, `validator.py`, `state.js`, or `index.html`.

```
Step 1: Modify detect_format() to return (name, score) tuple
        — Update all callers: extract_data(), classify_document()
        — Run: python testdata/run.py
        — Expected: 6/6 pass (extraction values unchanged, only return type changed)

Step 2: Add _W_FORMAT, _W_FIELDS, _W_ITEMS weight constants at module scope

Step 3: Add compute_confidence(result) function

Step 4: Store _format_score in extract_data()
        — d["_format_score"] = format_score after unpack
        — Run: python testdata/run.py
        — Expected: 6/6 pass (new key added, no values changed)

Step 5: Call compute_confidence(data) at end of parse_solicitation_bundle()
        — data["confidence"] = compute_confidence(data)
        — Run: python testdata/run.py
        — Expected: 6/6 pass (new key, does not affect harness validation)

Step 6: Extend window.S.confidence in step1.js
        — Add: parsed: data.data?.confidence || null
        — No automated test — verify in browser

Step 7: Replace confBadgeHtml in step2.js with new confBannerHtml block
        — Implement warnLabel() helper, three-state HTML, WARNING_LABELS map
        — Test all three states manually (Steps 2–6 of validation)
```

### Regression risk table

| Change | Risk | Fixtures at risk | Mechanism |
|--------|------|-----------------|-----------|
| `detect_format()` returns tuple | **Low** | All 6 fixtures | `classify_document()` calls `detect_format()` and uses the result. Must unpack: `fmt, _ = detect_format(text)`. If missed, Python will crash with `ValueError: too many values to unpack` on parse. Mitigation: grep for all `detect_format(` callsites before landing. |
| `_format_score` added to result dict | **None** | None | Additive key. No expected_output.json checks for it. Harness skips unknown keys. |
| `compute_confidence()` added | **None** | None | New function, not called until Step 5. |
| `data["confidence"]` in bundle result | **None** | None | Additive key. No harness check for it. Does not affect extraction values. |
| `window.S.confidence.parsed` in step1.js | **None** | None | Frontend-only. Adds a new key to existing object. Does not affect existing field-level confidence UI. |
| Replace `confBadgeHtml` with `confBannerHtml` | **Low** | None | If `window.S.confidence.parsed` is null (e.g. after SAM.gov lookup which doesn't go through `parse_solicitation_bundle()`), `confBannerHtml` must render empty string. The guard `if (parsedConf)` handles this. SAM.gov lookup path (`/sam_lookup` route) does not call `parse_solicitation_bundle()` and will not have `parsed` in `window.S.confidence`. The banner will simply not render for SAM.gov lookups. This is acceptable behavior for Phase 7. |

### Callsites of `detect_format()` that must be updated

```
python/extractor.py:656   extract_data()           format_name = detect_format(text)
python/extractor.py:1148  classify_document()      fmt = detect_format(text)
```

Both must unpack the tuple after the change. No other callers exist (confirmed by search pattern).

---

## Part 4 — Acceptance Criteria Cross-Check

| Check from roadmap | How it passes |
|--------------------|---------------|
| 70B bundle parse: `confidence.overall` >= 0.85, green bar in Step 2 | `overall = 1.0` → green state, `<span class="mbadge ai">100% Confidence</span>` |
| Unknown-format fixture: `confidence.overall` <= 0.4, red bar, warning listed | `format_detection=0.0, required_fields=0.0, line_items=0.1 → overall=0.03` → red state, all warnings listed |
| SAM export fixtures: amber or green depending on field completeness | W911 and N5005426 have all 4 required fields but no items → `overall=0.73` → amber state |
| No change to extraction output: all run.py tests still pass | `compute_confidence()` is read-only; `_format_score` is an additive key; tuple return from `detect_format()` is backward-compatible with updated callers |

---

*End of Phase 7 diagnostic report and implementation plan.*  
*Generated: 2026-05-03. No code was modified during this analysis.*
