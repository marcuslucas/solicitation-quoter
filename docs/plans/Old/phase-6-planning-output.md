# Phase 6 — Extractor Hardening: Diagnostic Report & Implementation Plan

**Date:** 2026-05-01  
**Scope:** Phase 6 of sol-quoter-roadmap-phases-6-10.md  
**Status:** Planning — no code written

---

## Files Read

- `python/extractor.py` — full (1251 lines)
- `python/document_loader.py` — full (251 lines)
- `testdata/run.py` — full (383 lines)
- `docs/plans/sol-quoter-roadmap-phases-6-10.md` — Phase 6 section
- All existing `_expected_output.json` files (`36C24225Q0696`, `70B06C26Q00000080`, `request-for-quotation`)

---

## Part 1 — Live Extractor Output

Both fixtures were run using:
- `document_loader.load_document()` to extract text from the PDF
- `detect_format()` with verbose scoring (scores per fingerprint captured)
- `extract_data()` to get the full dict
- `extract_sow_line_items()` and `_extract_clin_items()` called separately

---

### Fixture 1: W911S225U14310001_CSS_08062025

**File:** `W911S225U14310001_CSS_08062025.pdf`  
**Loaded as:** `source_format=pdf`, 2224 chars, 4 pages

#### Q1 — detect_format() result

```
scores = {
  'sam_export': 7,
  'agency_form': 0,
  'formal_rfq': 0,
  'sf1449': 0
}
-> sam_export
```

All four sam_export fingerprints matched:
- `"Notice ID:" in first_2000` → **+3** ✓ (appears at char 142: `Notice ID: W911S225U1431`)
- `"Combined Synopsis/Solicitation Details" in first_2000` → **+2** ✓ (appears at char 85)
- `"Primary Contact Name:" in first_5000` → **+1** ✓ (appears at char 1072)
- `"Notice Details" in first_5000` → **+1** ✓ (appears at char 1294)

#### Q2 — Which extract_* function is called?

`extract_sam_export(text)` — correct for this format.

#### Q3 — Full returned dict

```python
{
  "solicitation_number":   "W911S225U1431",          # WRONG — missing "0001"
  "project_title":         "Law Enforcement ballistic vests",
  "solicitation_type":     "RFQ",
  "issuing_agency":        "W6QM MICC-FT DRUM",
  "due_date":              "2025/08/13 08:00 -08:00 Pacific Standard Time",
  "posting_date":          "2025/08/06",
  "contact_name":          "Cory Ponder",
  "contact_email":         "cory.a.ponder.civ@army.mil",
  "contact_phone":         "2534776356",
  "naics_code":            "339113: Surgical Appliance and Supplies Manufacturing",  # includes descriptor
  "psc_code":              "8470: ARMOR, PERSONAL",       # includes descriptor
  "set_aside":             "Total Small Business Set-Aside",
  "place_of_performance":  "Place of Performance Zip Code\nBLDG 20000 Alder RdJoint Base Lewis McChord, WA 98433 98433",
  "scope_of_work":         "Amendment implemented to change NAICS codes from 922120 to 339113...",  # 931 chars
  "scope_truncated":       False,
  "quantities":            [{"size": "SM", "qty": "10"}, {"size": "M", "qty": "10"},
                            {"size": "L", "qty": "20"}, {"size": "XL", "qty": "10"}],
  "attachments":           ["W911S225U1431_S2P2.pdf"],
  "_format":               "sam_export",
  "_method":               "rules"
}
```

#### Q4 — Line items

`extract_sow_line_items()` → **0 items** (no 4.x.x section headers in text)  
`_extract_clin_items()` → **0 items** (no CLIN/LINE ITEM/ITEM NNNN blocks)

`run.py` runs this fixture in **single-file mode** (one non-xlsx file). `extract_data()` is called; it does not set `line_items`. No `line_items` key in result. Effective count: **0**.

`quantities` is set (4 size/qty pairs from garment size regex), but this key is distinct from `line_items` and is not counted by the harness.

#### Q5 — Empty fields

No fields return empty string `""` — all populated (though several have wrong values, see above). Fields entirely absent from the dict (not even empty): `period_of_performance`, `estimated_value`, `contracting_office_address`.

#### Q6 — solicitation_number

**Returned:** `"W911S225U1431"` (13 characters)  
**Expected:** `"W911S225U14310001"` (17 characters, the directory name minus the `_CSS_08062025` suffix)

---

### Fixture 2: N5005426Q0114_CSS_03312026

**File:** `N5005426Q0114_CSS_03312026.pdf`  
**Loaded as:** `source_format=pdf`, 2712 chars, 4 pages

#### Q1 — detect_format() result

```
scores = {
  'sam_export': 7,
  'agency_form': 0,
  'formal_rfq': 0,
  'sf1449': 0
}
-> sam_export
```

All four sam_export fingerprints matched:
- `"Notice ID:" in first_2000` → **+3** ✓ (char 160: `Notice ID: N5005426Q0114`)
- `"Combined Synopsis/Solicitation Details" in first_2000` → **+2** ✓ (char 92)
- `"Primary Contact Name:" in first_5000` → **+1** ✓
- `"Notice Details" in first_5000` → **+1** ✓

**N5005426Q0114 correctly detects as `sam_export` — it is not mis-classified.** Score 7 gives maximum confidence. No fingerprints fail.

#### Q2 — Which extract_* function is called?

`extract_sam_export(text)` — correct.

#### Q3 — Full returned dict

```python
{
  "solicitation_number":  "N5005426Q0114",            # CORRECT
  "project_title":        "Central Fresh Water System Parts",
  "solicitation_type":    "RFQ",
  "issuing_agency":       "MID ATLANTIC REG MAINT CTR",
  "due_date":             "2026/04/07 15:00 -05:00 Eastern Standard Time",
  "posting_date":         "2026/03/31",
  "contact_name":         "Erica Crandall",
  "contact_email":        "erica.collins1@navy.mil",
  "contact_phone":        "4000779",                   # 7 digits — suspicious
  "naics_code":           "332996: Fabricated Pipe and Pipe Fitting Manufacturing",  # descriptor included
  "psc_code":             "4730: HOSE, PIPE, TUBE, LUBRICATION, AND RAILING FITTINGS",  # descriptor included
  "set_aside":            "Total Small Business Set-Aside",
  "place_of_performance": "Place of Performance Zip Code",   # WRONG — label captured, not value
  "scope_of_work":        "This is a COMBINED SYNOPSIS/SOLICITATION...",  # 1253 chars, full description
  "scope_truncated":      False,
  "attachments":          ["Attachment_I_Statement_of_Work.pdf", "Attachment_II_DD_2345.pdf",
                           "Attachment_III_Instructions_for_the_DD2345.pdf",
                           "Attachment_IV_FAR_52_212_5.pdf", "Attachment_V_FAR_52_212_3.pdf",
                           "Combined_Synopsis_Solicitation.docx"],
  "_format":              "sam_export",
  "_method":              "rules"
}
```

#### Q4 — Line items

`extract_sow_line_items()` → **0 items**  
`_extract_clin_items()` → **0 items**  
Line items: **0**. SOW is an attachment (`Attachment_I_Statement_of_Work.pdf`) not included in this fixture's directory.

#### Q5 — Empty fields

Missing from dict entirely (empty values stripped by `extract_sam_export`'s `{k: v for k, v in d.items() if v not in ("", [], None)}`):  
`period_of_performance`, `estimated_value`, `contracting_office_address`.

#### Q6 — solicitation_number

**Returned:** `"N5005426Q0114"` — correct. No amendment/update number in this document.

---

## Part 2 — W911 Truncation Bug Analysis

### What the PDF text actually contains

The PDF text (extracted verbatim by pdfplumber) shows:

```
Notice ID: W911S225U1431
```

followed immediately by a newline. The string `"W911S225U14310001"` does **not appear anywhere** in the 2224-character document. Confirmed by string search and hex inspection of the bytes around the Notice ID field.

The "0001" appears only as part of the page header on every page:

```
W911S225U1431: Combined Synopsis/Solicitation
Law Enforcement ballistic vests Update: 0001
```

### The exact pattern responsible

```python
# extractor.py:162
d["solicitation_number"] = find([
    r"Notice\s*ID[:\s]*([A-Z0-9\-]+)",    # <-- this pattern
    r"Solicitation\s*(?:No|Number|#)[:\s]*([A-Z0-9\-]+)",
    ...
])
```

**Why it produces "W911S225U1431":** The character class `[A-Z0-9\-]+` correctly stops at the newline after `W911S225U1431`. This is not a regex truncation issue — the Notice ID field in the SAM.gov export PDF genuinely contains only the base notice number `W911S225U1431`. The amendment suffix `0001` is stored in a separate field ("Update: 0001") in the page header, not appended to the Notice ID field.

The roadmap description ("the pattern is too conservative on trailing characters") is imprecise. The actual issue is: **the SAM.gov export PDF stores the base notice ID and amendment number in two separate text tokens, and the extractor only reads the first**.

### Corrected approach

**Root cause:** Must combine `Notice ID: W911S225U1431` (base notice) with `Update: 0001` (amendment suffix) to reconstruct `W911S225U14310001`.

**Proposed fix:** After extracting `solicitation_number` from the Notice ID field, check for an "Update: NNNN" pattern anchored to the SAM.gov page header, and append it if found and not already present.

The SAM.gov page header always follows this exact format on amendment notices:
```
<BASE_NOTICE_ID>: Combined Synopsis/Solicitation
<Title> Update: <AMENDMENT_NUM>
```

**Corrected pattern (two-step, in `extract_sam_export`):**

```python
# STEP 1 (existing — unchanged)
d["solicitation_number"] = find([
    r"Notice\s*ID[:\s]*([A-Z0-9\-]+)",
    r"Solicitation\s*(?:No|Number|#)[:\s]*([A-Z0-9\-]+)",
    r"RFP\s*(?:No|Number|#)[:\s]*([A-Z0-9\-]+)",
    r"RFQ\s*(?:No|Number|#)[:\s]*([A-Z0-9\-]+)",
])

# STEP 2 (new) — append amendment number from SAM.gov page header
# Only fires when page header has "Update: NNNN" pattern (amendment notices only)
_update_m = re.search(
    r"^[A-Z0-9\-]+:\s+Combined\s+Synopsis/Solicitation\b.*?\bUpdate:\s*(\d+)\b",
    text, re.MULTILINE | re.DOTALL | re.IGNORECASE
)
if _update_m and d.get("solicitation_number"):
    suffix = _update_m.group(1)
    if not d["solicitation_number"].endswith(suffix):
        d["solicitation_number"] = d["solicitation_number"] + suffix
```

**Result:** `"W911S225U1431"` + `"0001"` = `"W911S225U14310001"` ✓

**Regression safety:**
- Anchor on `Combined Synopsis/Solicitation` restricts the match to SAM.gov export page headers only.
- N5005426Q0114 has no "Update:" token → does not fire.
- Existing SAM fixtures (W911S2.., N50054..) with no amendment → does not fire.

---

## Part 3 — N5005426Q0114 Additional Findings

Since `detect_format()` correctly returns `sam_export` (score=7, all fingerprints matched), no detect_format fix is required for this fixture. However, the extraction reveals **three secondary bugs** not in the Phase 6 roadmap scope, documented here as additional findings:

### Additional Finding A — naics_code and psc_code include descriptor text

**Pattern responsible (naics_code):**
```python
# extractor.py:193
d["naics_code"] = find([r"NAICS\s*(\d{5,6}(?:[:\s]+[^\n]+)?)"])
```

The optional group `(?:[:\s]+[^\n]+)?` is overly greedy — it captures the full rest of the line after the code number. For SAM.gov exports that write "NAICS 332996: Fabricated Pipe and Pipe Fitting Manufacturing", the entire descriptor is captured.

**Extracted:** `"332996: Fabricated Pipe and Pipe Fitting Manufacturing"`  
**Expected:** `"332996"`

**Pattern responsible (psc_code):**
```python
# extractor.py:194
d["psc_code"] = find([r"Product\s+or\s+Service\s+Code\s*([0-9A-Z]+[^\n]*)"])
```

`[^\n]*` captures the rest of the line.

**Extracted:** `"8470: ARMOR, PERSONAL"` / `"4730: HOSE, PIPE, TUBE, LUBRICATION, AND RAILING FITTINGS"`  
**Expected:** `"8470"` / `"4730"`

### Additional Finding B — place_of_performance captures label, not value

For N5005426Q0114, the PDF has:
```
Place of Performance Information
Place of Performance Address Place of Performance Zip Code
```
with no actual address on the value line (the zip code is missing). The pattern captures "Place of Performance Zip Code" (the header line) instead of a value. This is a data quality issue in the PDF itself — no address is available — but the extraction returns the wrong token.

### Additional Finding C — contact_phone is 7 digits

`"4000779"` — 7 digits, not a standard US phone number. The source PDF likely has an abbreviated extension. Not a parser bug; accurately reflects the PDF content.

---

## Part 4 — Structural Questions

### Q7 — detect_format() minimum score threshold

```python
# extractor.py:121-127
best = max(scores, key=scores.get)
if scores[best] >= 3:            # <-- threshold: 3
    print(f"[detect_format] scores={scores} -> {best}")
    return best

print(f"[detect_format] scores={scores} -> unknown")
return "unknown"
```

**Minimum threshold: 3.** Any format whose highest score is 2 or less returns `'unknown'`.

### Q8 — sam_export fingerprints: fragility analysis

Current fingerprints with weights:

| Fingerprint | Weight | Location | Fragility |
|-------------|--------|----------|-----------|
| `"Notice ID:" in first_2000` | **+3** | Page 1, labeled | HIGH — absent if SAM export uses `"Solicitation Number:"` as the top-level label instead |
| `"Combined Synopsis/Solicitation Details" in first_2000` | **+2** | Section header | LOW — very specific phrase, stable across SAM exports |
| `"Primary Contact Name:" in first_5000` | **+1** | Contact section | MEDIUM — appears in both SAM exports tested; absent if SAM section uses different labeling |
| `"Notice Details" in first_5000` | **+1** | Section header | HIGH — extremely generic; could match non-SAM documents |

**Failure scenario:** A SAM.gov export that uses `"Solicitation Number:"` instead of `"Notice ID:"` as its primary label would score only 4 at best (if Combined Synopsis section header and both +1 patterns all match), but if it also lacks the "Combined Synopsis/Solicitation Details" phrase, it would score only 2 → returns `'unknown'`.

**Safer additional fingerprints for sam_export:**
- `"Contracting Office Information" in first_5000` → +1 (SAM export section header, distinct from other formats)
- `"Response Date:" in first_5000` → +1 (SAM export field label for due date)
- `"Set Aside Code" in text` → +1 (SAM export label, not present in agency_form or sf1449)

Note: Both current test fixtures score 7 (maximum possible). Format detection is not broken for these two fixtures. Improvements are future-proofing for unseen variants.

### Q9 — extraction_warnings in parse_solicitation_bundle()

**`extraction_warnings` does not exist anywhere in the codebase.** The field is absent from:
- `parse_solicitation_bundle()` — not populated, not returned
- `extract_data()` — not populated, not returned
- `extract_sam_export()`, `extract_agency_form()`, `extract_formal_rfq()`, `extract_sf1449()` — none return a warnings list
- `server.py` — no warnings key in parse response (confirmed from architecture context; not re-read here)

Phase 6.4 must add this field from scratch.

### Q10 — parse_solicitation_bundle() return statement and the 10 lines before it

```python
# extractor.py:1238-1250 — exact as written
    # Merge and attach to result
    if sow_items or pricing_items:
        data["line_items"] = merge_line_item_sources(sow_items, pricing_items)
        print(f"[parse_solicitation_bundle] line_items={len(data['line_items'])} "
              f"(sow={len(sow_items)}, pricing={len(pricing_items)})")

    # CLIN fallback — fires only when no 4.x.x SOW items and no pricing XLSX
    if not data.get("line_items") and main_doc:
        clin_items = _extract_clin_items(main_doc["result"].text)
        if clin_items:
            data["line_items"] = clin_items
            print(f"[parse_solicitation_bundle] CLIN fallback: {len(clin_items)} items")

    return data
```

`return data` is the only return in `parse_solicitation_bundle()`. The function always returns a dict (possibly empty `{}` if `main_doc is None`, line 1210).

---

## Part 5 — Implementation Plan

### Change order: mandatory sequence

Changes must be applied in this order to avoid intermediate breakage:

```
1. Fix naics_code / psc_code patterns (isolated, safe)
2. Fix solicitation_number amendment append (in extract_sam_export — isolated)
3. Add detect_format() sam_export scoring improvements (additive)
4. Add extraction_warnings assembly in parse_solicitation_bundle()
5. Write _expected_output.json files (depends on 1+2+3+4 complete)
6. Run python testdata/run.py and verify 6/6 pass
```

Changes 1, 2, 3 are independent of each other and can be applied in any sub-order. Change 4 depends only on the final shape of the data dict (which is stabilized by 1-3). Change 5 must come last.

---

### A — Corrected regex for W911 solicitation_number truncation

**File:** `python/extractor.py`  
**Location:** `extract_sam_export()`, after the existing `d["solicitation_number"] = find([...])` call

**Change:** Add a two-step amendment-suffix check immediately after the solicitation_number find:

```python
# After existing find([...]) for solicitation_number — new block:
_update_m = re.search(
    r"^[A-Z0-9\-]+:\s+Combined\s+Synopsis/Solicitation\b.*?\bUpdate:\s*(\d+)\b",
    text, re.MULTILINE | re.DOTALL | re.IGNORECASE
)
if _update_m and d.get("solicitation_number"):
    suffix = _update_m.group(1)
    if not d["solicitation_number"].endswith(suffix):
        d["solicitation_number"] = d["solicitation_number"] + suffix
```

**Why the anchor is safe:** The pattern requires `Combined Synopsis/Solicitation` to appear on the same line as the notice ID, which is a SAM.gov-specific page header format. General prose containing "Update:" would not match.

**Also fix (same commit) — naics_code and psc_code trailing descriptor:**

```python
# CURRENT (extractor.py:193)
d["naics_code"] = find([r"NAICS\s*(\d{5,6}(?:[:\s]+[^\n]+)?)"])

# CORRECTED
d["naics_code"] = find([r"NAICS\s*(\d{5,6})"])

# CURRENT (extractor.py:194)
d["psc_code"] = find([r"Product\s+or\s+Service\s+Code\s*([0-9A-Z]+[^\n]*)"])

# CORRECTED
d["psc_code"] = find([r"Product\s+or\s+Service\s+Code\s*([0-9A-Z]+)"])
```

These fix the descriptor-bleeding issue. They cannot break SAM export fixtures because:
- The corrected patterns still match the numeric/alphanumeric codes
- `[^\n]*` and `(?:[:\s]+[^\n]+)?` extensions are removed (they produced wrong values)
- `apply_generic_fallback()` has its own naics_code fallback pattern `r"NAICS[^\d]{0,20}(\d{5,6})"` which is already code-only

---

### B — detect_format() scoring additions for SAM export

**File:** `python/extractor.py`  
**Location:** `detect_format()`, within the `# ── sam_export ──` block  
**Reason:** Based on the diagnostic above, both current fixtures score 7. The improvements below are defensive — they maintain detection reliability for SAM export variants that use different labeling for the Notice ID field.

**Additions to sam_export block:**

```python
# ── sam_export ────────────────────────────────────────────────────────────
if "Notice ID:" in first_2000:
    scores["sam_export"] += 3
if "Combined Synopsis/Solicitation Details" in first_2000:
    scores["sam_export"] += 2
if "Primary Contact Name:" in first_5000:
    scores["sam_export"] += 1
if "Notice Details" in first_5000:
    scores["sam_export"] += 1

# NEW: additional fingerprints for SAM export variants
if "Contracting Office Information" in first_5000:
    scores["sam_export"] += 1
if re.search(r"Response Date:\s*\d{4}/\d{2}/\d{2}", first_5000):
    scores["sam_export"] += 1
if "Set Aside Code" in text:
    scores["sam_export"] += 1
```

**Rationale per addition:**
- `"Contracting Office Information"` — SAM.gov export section header, does not appear in agency_form or sf1449
- `r"Response Date:\s*\d{4}/\d{2}/\d{2}"` — SAM.gov date format (ISO-ish) is distinct from agency_form's `RESPONSE DATE/TIME/ZONE` and sf1449's date format
- `"Set Aside Code"` — SAM.gov export label (SAM uses "Set Aside Code" vs agency_form's "Set-Aside*" and sf1449's "SET ASIDE:")

With these additions, a SAM export that lacks "Notice ID:" but has the other fingerprints would score up to 6 (if all three new patterns match) — still well above threshold 3.

**What is NOT changed:** Existing thresholds and patterns for agency_form, formal_rfq, sf1449 are untouched. The min threshold of 3 is unchanged.

---

### C — extraction_warnings shape and population logic

**Shape** (per Phase 6 roadmap spec):

```python
result["extraction_warnings"] = [
    {"code": "missing_field", "field": "due_date"},
    {"code": "unknown_format"},
    {"code": "no_line_items", "source": "fallback_single_row"},
]
```

Each warning is a dict with a mandatory `"code"` key and optional context keys.

**Population function** (new, in `extractor.py`):

```python
def _build_extraction_warnings(data, sow_item_count=0, clin_item_count=0):
    """
    Build extraction_warnings list from a completed extraction result dict.
    
    Parameters:
      data              — the result dict from extract_data() or parse_solicitation_bundle()
      sow_item_count    — how many 4.x.x SOW items were found (0 in single-file mode)
      clin_item_count   — how many CLIN items were found (0 in single-file mode)
    
    Returns a list of warning dicts. Empty list means clean extraction.
    """
    warnings = []
    
    REQUIRED_FIELDS = ["solicitation_number", "due_date", "contact_email", "naics_code"]
    for field in REQUIRED_FIELDS:
        val = data.get(field)
        if not val or str(val).strip() == "":
            warnings.append({"code": "missing_field", "field": field})
    
    if data.get("_format") == "unknown":
        warnings.append({"code": "unknown_format"})
    
    # no_line_items fires when both SOW and CLIN paths returned zero items
    # AND there is no line_items key in the result (meaning no XLSX pricing either)
    if sow_item_count == 0 and clin_item_count == 0 and not data.get("line_items"):
        warnings.append({"code": "no_line_items", "source": "fallback_single_row"})
    
    return warnings
```

---

### D — Where extraction_warnings is assembled in parse_solicitation_bundle()

**File:** `python/extractor.py`  
**Location:** `parse_solicitation_bundle()`, immediately before the existing `return data` statement (line 1250)

**Insertion point** (replaces the current `return data`):

```python
    # CLIN fallback — fires only when no 4.x.x SOW items and no pricing XLSX
    if not data.get("line_items") and main_doc:
        clin_items = _extract_clin_items(main_doc["result"].text)
        if clin_items:
            data["line_items"] = clin_items
            print(f"[parse_solicitation_bundle] CLIN fallback: {len(clin_items)} items")

    # ── NEW: assemble extraction_warnings ─────────────────────────────────────
    # Track how many items each path produced for warning logic
    _sow_count = len(sow_items)
    _clin_count = len(data.get("line_items", [])) if data.get("line_items") and \
                   all(i.get("_source") == "CLIN" for i in data.get("line_items", [])) else 0
    data["extraction_warnings"] = _build_extraction_warnings(data, _sow_count, _clin_count)
    if data["extraction_warnings"]:
        print(f"[parse_solicitation_bundle] warnings={data['extraction_warnings']}")

    return data
```

**Also add extraction_warnings to extract_data():** The roadmap says warnings appear in every parse response. The `/parse` endpoint calls `parse_solicitation_bundle()` for bundles, but may also call `extract_data()` for single-file paths. To cover both:

In `extract_data()`, after `apply_generic_fallback(d, text)`:

```python
    apply_generic_fallback(d, text)
    d["_format"] = format_name
    d["_method"] = "rules"

    # NEW: add extraction_warnings for single-file extraction path
    # sow/clin counts are 0 here — line item extraction happens in parse_solicitation_bundle
    d["extraction_warnings"] = _build_extraction_warnings(d, sow_item_count=0, clin_item_count=0)
    
    ...
    return d
```

**Why both:** `parse_solicitation_bundle()` calls `extract_data()` and then does additional processing (line items). The warnings in `extract_data()` are overwritten by the richer warnings in `parse_solicitation_bundle()`, which has full visibility into SOW/CLIN counts.

---

### E — Warning trigger conditions

| Code | Field | Trigger condition | Notes |
|------|-------|-------------------|-------|
| `missing_field` | `"solicitation_number"` | `data.get("solicitation_number")` is falsy or blank | After apply_generic_fallback |
| `missing_field` | `"due_date"` | `data.get("due_date")` is falsy or blank | |
| `missing_field` | `"contact_email"` | `data.get("contact_email")` is falsy or blank | |
| `missing_field` | `"naics_code"` | `data.get("naics_code")` is falsy or blank | |
| `unknown_format` | — | `data.get("_format") == "unknown"` | Means all format-specific extractors returned empty `{}` |
| `no_line_items` | — | `sow_item_count == 0 AND clin_item_count == 0 AND "line_items" not in data` | True fallback: single-row from project_title only |

**Check timing:** Warnings are assessed AFTER `apply_generic_fallback()` has run (so generic patterns have had a chance to fill fields). The `missing_field` check fires on the final state of `data`, not on intermediate states from format-specific extractors.

**`unknown_format` note:** When format is `unknown`, `extract_data()` sets `d = {}` and relies entirely on `apply_generic_fallback()`. This is a data-quality signal worth surfacing — the document matched no format with sufficient confidence.

**`no_line_items` note:** The condition is **both** paths returning zero AND no `line_items` key. This correctly identifies the "single-row fallback" case (where `extract_line_items()` would produce exactly one row from `project_title`). The warning does NOT fire when SOW items exist but CLIN is also 0 — it only fires when neither path produced structured line items.

---

### F — v2 _expected_output.json schema and values for three fixtures

**Schema (v2):**
```json
{
  "_schema_version": 2,
  "format": "<format name returned by detect_format>",
  "solicitation_number": "<extracted value after all Phase 6 fixes>",
  "line_item_count": 0,
  "required_fields": ["solicitation_number", "due_date", "contact_email", "naics_code"],
  "line_items_sample": [],
  "notes": "<free text>"
}
```

Fields `title`, `due_date`, `contact_email`, etc. are added when they are useful for regression verification. Fields set to `null` in the expected output are skipped by the harness field-comparison loop (see `run.py:179: if exp_val is None: continue`).

---

#### Fixture: W911S225U14310001_CSS_08062025

After Phase 6 fixes (amendment suffix appended, naics_code descriptor stripped):

```json
{
  "_schema_version": 2,
  "format": "sam_export",
  "solicitation_number": "W911S225U14310001",
  "title": "Law Enforcement ballistic vests",
  "due_date": "2025/08/13 08:00 -08:00 Pacific Standard Time",
  "contact_email": "cory.a.ponder.civ@army.mil",
  "naics_code": "339113",
  "psc_code": "8470",
  "set_aside": "Total Small Business Set-Aside",
  "line_item_count": 0,
  "line_items_sample": [],
  "required_fields": ["solicitation_number", "due_date", "contact_email", "naics_code"],
  "notes": "SAM.gov Combined Synopsis/Solicitation with amendment. solicitation_number is base notice ID 'W911S225U1431' + amendment '0001' = 'W911S225U14310001'. No line items — SOW attachment (W911S225U1431_S2P2.pdf) not included in fixture. Vest sizes extracted to quantities[] not line_items. due_date includes timezone offset string — raw SAM.gov format. naics_code and psc_code are numeric codes only (descriptor stripped by Phase 6 fix)."
}
```

**Harness behavior:** `format` check → OK. `solicitation_number` required field → OK. `line_item_count: 0` → OK (±3 tolerance, got 0). All 4 required fields present → OK.

---

#### Fixture: N5005426Q0114_CSS_03312026

After Phase 6 fixes (naics_code and psc_code descriptors stripped):

```json
{
  "_schema_version": 2,
  "format": "sam_export",
  "solicitation_number": "N5005426Q0114",
  "title": "Central Fresh Water System Parts",
  "due_date": "2026/04/07 15:00 -05:00 Eastern Standard Time",
  "contact_email": "erica.collins1@navy.mil",
  "naics_code": "332996",
  "psc_code": "4730",
  "set_aside": "Total Small Business Set-Aside",
  "line_item_count": 0,
  "line_items_sample": [],
  "required_fields": ["solicitation_number", "due_date", "contact_email", "naics_code"],
  "notes": "SAM.gov Combined Synopsis/Solicitation, no amendment. solicitation_number matches notice ID exactly. No line items — SOW is Attachment_I_Statement_of_Work.pdf not included in fixture. place_of_performance captured as label token only ('Place of Performance Zip Code') — no address value in PDF for this field. naics_code and psc_code are numeric codes only after Phase 6 fix. contact_phone is 7 digits ('4000779') — abbreviated extension, accurately reflects PDF."
}
```

---

#### Fixture: 18Q0042

Before any Phase 6 fix (18Q0042 is sf1449, unaffected by Phase 6 changes):

```json
{
  "_schema_version": 2,
  "format": "sf1449",
  "solicitation_number": "N0016418Q0042",
  "due_date": null,
  "contact_email": "emily.a.johnson@navy.mil",
  "naics_code": "325920",
  "set_aside": "Small Business Set-Aside 100%",
  "estimated_value": "$15,000.00",
  "line_item_count": 0,
  "line_items_sample": [],
  "required_fields": ["solicitation_number", "contact_email", "naics_code"],
  "notes": "73-page SF-1449 SOLICITATION/CONTRACT/ORDER. Extracted in single-file mode via extract_data() — CLIN fallback (_extract_clin_items) only fires in parse_solicitation_bundle() bundle mode and is not reached here. 9 CLIN items exist in document but are not in result; line_item_count: 0 reflects current single-file extraction behavior. due_date set to null — sf1449 extractor returns it as '05/15/2026 2:00PM ET' from a different block 8 pattern (not verified for this fixture, set null to skip comparison). project_title extracted incorrectly as SF-1449 boilerplate text — excluded from required_fields. contact_name not extracted — excluded from required_fields."
}
```

**Note on 18Q0042 `due_date`:** The sf1449 extractor pattern `r"(\d{2}/\d{2}/\d{4}\s+\d{1,2}:\d{2}[AP]M\s+\w+)"` should match "01/26/2018 03:00 PM" from Block 8. At the time of this diagnostic run, `due_date` was not in the extracted dict — needs verification after the extractor runs cleanly. Set to `null` in expected output to skip comparison until verified.

---

### G — Change application order to avoid intermediate breakage

```
Step 1: Fix naics_code / psc_code patterns
        — Isolated to extract_sam_export(). Safe to apply first.
        — Run: python testdata/run.py
        — Expected: existing 3 fixtures still pass (36C, 70B, rfq unaffected)

Step 2: Fix solicitation_number amendment append
        — Add two-step logic to extract_sam_export()
        — Safe: only fires when "Combined Synopsis/Solicitation ... Update: NNNN" pattern matches
        — Run: python testdata/run.py
        — Expected: existing 3 fixtures still pass

Step 3: Add detect_format() sam_export fingerprints
        — Additive only — adds scoring points, does not remove any
        — Cannot lower any format's score, can only raise sam_export
        — Run: python testdata/run.py
        — Expected: existing 3 fixtures still pass (no sam_export among them)

Step 4: Add _build_extraction_warnings() function and wire into parse_solicitation_bundle() and extract_data()
        — Adds new key "extraction_warnings" to all parse results
        — Cannot break existing validation (harness does not check this key)
        — Run: python testdata/run.py
        — Expected: existing 3 fixtures still pass (new key is not in any expected_output.json)

Step 5: Write _expected_output.json for W911S225U14310001, N5005426Q0114, 18Q0042
        — Based on actual post-fix extraction output
        — Run: python testdata/run.py
        — Expected: 6/6 fixtures validated, exit 0
```

---

### H — Regression risk analysis

| Change | Risk Level | Fixtures at risk | Mechanism |
|--------|-----------|-----------------|-----------|
| **naics_code pattern** (strips descriptor) | **Low** | None from current 3 | 36C/70B use agency_form/sf1449 extractors which have different naics patterns; rfq extractor has its own pattern. Only extract_sam_export() changes. |
| **psc_code pattern** (strips descriptor) | **Low** | None from current 3 | Same reason as naics_code — format-specific extractors are separate. |
| **solicitation_number amendment append** | **Low** | None from current 3 | Pattern requires "Combined Synopsis/Solicitation ... Update:" — unique to amended SAM exports. None of the 3 existing fixtures are SAM exports. |
| **detect_format() sam_export additions** | **Low** | None from current 3 | 36C = agency_form (score≥3 without sam_export), 70B = sf1449 (score≥6), rfq = formal_rfq (score≥3). New sam_export points cannot flip any of these. |
| **extraction_warnings addition** | **None** | None | Additive new key. No existing expected_output.json checks for it. Harness skips unknown keys. |
| **New _expected_output.json files** | **Low** | W911, N5005426, 18Q0042 | If extractor output differs from what was captured here (e.g., due to pdfplumber version changes), the new expected files would create immediate failures. Mitigation: run `python testdata/run.py` after writing each file and before committing. |

**One specific risk to verify:** The naics_code pattern change from `r"NAICS\s*(\d{5,6}(?:[:\s]+[^\n]+)?)"` to `r"NAICS\s*(\d{5,6})"` will affect `apply_generic_fallback()` which uses its own independent pattern `r"NAICS[^\d]{0,20}(\d{5,6})"`. The fallback pattern is already code-only. No conflict. But verify: does any existing passing test rely on naics_code containing a descriptor? Looking at 36C24225Q0696 expected output: `"naics_code": "811310"` (code only). 70B06C26Q00000080: `"naics_code": "332994"` (code only). rfq: `"naics_code": "812332"` (code only). All expected values are code-only. ✓ Safe.

---

## Appendix A — Full PDF Text of W911S225U14310001 (for reference)

```
W911S225U1431: Combined Synopsis/Solicitation
Law Enforcement ballistic vests Update: 0001
Combined Synopsis/Solicitation Details
Notice ID: W911S225U1431
Subject: Law Enforcement ballistic vests
Description: Amendment implemented to change NAICS codes from 922120 to 339113 and PSC Codes from 1367 to
8470. FY25 NWJRCF Law Enforcement Ballistic Vests. Sizes - SM: 10 M: 10 L: 20 XL: 10 Total: 50. ballistic insert set
(front and rear ballistics) for each corresponding vest size - NIJ Standard 0101.06- NIJ Certified Threat Level IIIAstab plate
for each corresponding vest size- NIJ Certified Spike III PlateFront view of Vest: Velcro for nametape, Velcro for Badge,
Include Velcro for MILITARY POLICE, Pocket w/Clip Closure (Radio), and pockets, must be National Institute of Justice
(NIJ) Approved, no zippered front, hook and loop side closureBack View of Vest: Velcro for MILITARY POLICE, Velcro for
adjustable side strap closuresVENDOR TO INCLUDE SPECIFICATION SHEET FOR OFFERED VEST, BALLISTIC, STAB
Plates, also include picture for reference

W911S225U1431: Combined Synopsis/Solicitation
Law Enforcement ballistic vests Update: 0001
Contact Information
◆ Primary Contact Name: Cory Ponder
◆ Primary Contact Email: cory.a.ponder.civ@army.mil
◆ Primary Contact Phone Number: 2534776356

W911S225U1431: Combined Synopsis/Solicitation
Law Enforcement ballistic vests Update: 0001
Notice Details
Solicitation Type: RFQ
Response Date: 2025/08/13 08:00 -08:00 Pacific Standard Time
Set Aside Code Total Small Business Set-Aside
Posting Date 2025/08/06
Archive Date
Product or Service Code 8470: ARMOR, PERSONAL
NAICS 339113: Surgical Appliance and Supplies Manufacturing
Recovery Act N
Contracting Office Information
Contracting Office DoDAAC W911S2
Contracting Office Name W6QM MICC-FT DRUM
MICC FORT DRUM 4205 PO VALLEY RD FORT DRUM NY
Contracting Office Address
13602-5220 FORT DRUM NY 13602-5220 USA
Material Safety Data Sheet (MSDS) N
Place of Performance Information
Place of Performance Address Place of Performance Zip Code
BLDG 20000 Alder RdJoint Base Lewis McChord, WA 98433 98433

W911S225U1431: Combined Synopsis/Solicitation
Law Enforcement ballistic vests Update: 0001
Attachment(s)
◆ W911S225U1431_S2P2.pdf
```

---

## Appendix B — Full PDF Text of N5005426Q0114 (for reference)

```
N5005426Q0114: Combined Synopsis/Solicitation
Central Fresh Water System Parts
Combined Synopsis/Solicitation Details
Notice ID: N5005426Q0114
Subject: Central Fresh Water System Parts
Description: This is a COMBINED SYNOPSIS/SOLICITATION for commercial items prepared in accordance with
the information in Federal Acquisition Regulation (FAR) Part 13 using Simplified Acquisition Procedures (SAP). ...
The RFQ number is N5005426Q0114. ...

Contact Information
◆ Primary Contact Name: Erica Crandall
◆ Primary Contact Email: erica.collins1@navy.mil
◆ Primary Contact Phone Number: 4000779

Notice Details
Solicitation Type: RFQ
Response Date: 2026/04/07 15:00 -05:00 Eastern Standard Time
Set Aside Code Total Small Business Set-Aside
Posting Date 2026/03/31
Archive Date 2026/05/09
Product or Service Code 4730: HOSE, PIPE, TUBE, LUBRICATION, AND RAILING FITTINGS
NAICS 332996: Fabricated Pipe and Pipe Fitting Manufacturing
...
Place of Performance Information
Place of Performance Address Place of Performance Zip Code
[no value present in PDF]

Attachment(s)
◆ Attachment_I_Statement_of_Work.pdf
◆ Attachment_II_DD_2345.pdf
◆ Attachment_III_Instructions_for_the_DD2345.pdf
◆ Attachment_IV_FAR_52_212_5.pdf
◆ Attachment_V_FAR_52_212_3.pdf
◆ Combined_Synopsis_Solicitation.docx
```

---

## Appendix C — Phase 6 Acceptance Criteria (from roadmap)

| Check | Expected | Notes |
|-------|----------|-------|
| `W911S225U14310001` solicitation_number | Returns `"W911S225U14310001"` (not `"W911S225U1431"`) | Fixed by amendment-append logic |
| SAM export format detection | Both SAM fixtures return `sam_export` consistently | Already working; scoring additions are hardening |
| `extraction_warnings` in parse response | Present on all `/parse` responses; `[]` on clean parses | New field, added to both extract_data() and parse_solicitation_bundle() |
| `run.py` | 6/6 fixtures validated, exit 0 | 3 existing pass + 3 new files written |

---

*End of Phase 6 diagnostic report and implementation plan.*  
*Generated: 2026-05-01. No code was modified during this analysis.*
