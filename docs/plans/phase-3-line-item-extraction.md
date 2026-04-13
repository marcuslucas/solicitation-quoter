# Phase 3: Line Item Extraction — Implementation Plan

## Overview

Extract 118 line items from the DHS LLSM solicitation (`70B06C26Q00000080`) by combining three
sources: SOW text (specs and part numbers), XLSX pricing sheet (quantities), and optional eval
table. Items use `4.x.x` hierarchical SOW section numbering across 10 product categories.

This phase is purely additive — existing `extract_line_items()` and all existing extractors are
untouched. New keys on line item dicts are ignored by `generator.py` via `.get()` with defaults.

---

## Ground Truth Summary (from fixture inspection)

| Source | File | Content |
|--------|------|---------|
| SOW PDF | `70B06C26Q00000080+Attachment+1+-+LLSM+SOW.pdf` | 29 pages, real PDF (magic `%PDF`). Sections 4.1–4.10 with 118 terminal items. |
| Pricing XLSX | `70B06C26Q00000080+Attachment+2-Pricing+Sheeet.xlsx` | 135 rows, 5 pricing periods (Period 1 qty in col E). **No part numbers in col C** — column is empty in all data rows. |
| Expected | `70B06C26Q00000080_expected_line_items.json` | 118 items, sow_section 4.1.1–4.10.9. All manufacturer_ref "Defense Technologies" except 4.10.1–4.10.6 (Avon) and 4.8.x, 4.10.5, 4.10.7–4.10.9 (null). |

**Critical finding:** Part numbers only exist in the SOW text, not the XLSX. XLSX col C (Part #)
is blank for every row. Part number extraction is SOW-only.

---

## Data Sources Detail

### SOW PDF Text Structure (pdfplumber)

Section headers follow this pattern in extracted text:
```
4.1.1. Smoke Canister for Training (Reduced Toxicity). This hand delivered
smoke canister shall be equipped with an M201A1...
Performance shall be equal to or better than Defense Technologies part
number 1063, Saf-smoke Grenade.
```

Key structural rules:
- Section number has **trailing period**: `4.X.Y.` (not `4.X.Y `)
- Title runs from the space after the period to the first `.` not inside parentheses
- Body text follows the title, ending at the start of the next `4.X.Y.` section
- Manufacturer reference pattern: `equal to or better than [MANUFACTURER] part number [PART_NUM]`
- Avon items use: `equal to or better than the Avon [MODEL], [product name]`
- Avon outsert 4.10.4: `Avon Clear Outsert, #70501-156` — part number has `#` prefix
- Avon canister 4.10.6: `Avon CTCF50 Riot Control Canister, 72606/3` — part number has `/`

### XLSX Structure (stdlib: zipfile + xml.etree.ElementTree — no pandas)

Columns (zero-indexed in parsed output):
| Col | Letter | Content |
|-----|--------|---------|
| 0 | A | SOW Section — float for category headers (e.g., `4.0999999999999996`), string for items |
| 1 | B | Description |
| 2 | C | Part # (always empty) |
| 3 | D | Unit Cost Period 1 |
| 4 | E | **Est Qty Period 1** ← primary quantity |
| 5 | F | Subtotal P1 |
| 6 | G | Unit Cost P2 |
| 7 | H | Est Qty P2 |
| 8 | I | Subtotal P2 |
| 9 | J | Unit Cost P3 |
| 10 | K | Est Qty P3 |
| 11 | L | Subtotal P3 |
| 12 | M | Unit Cost P4 |
| 13 | N | Est Qty P4 |
| 14 | O | Subtotal P4 |
| 15 | P | Unit Cost P5 |
| 16 | Q | Est Qty P5 |
| 17 | R | Subtotal P5 |
| 19 | T | Grand Total |

Category headers (rows to skip): col A contains a float with only one decimal place
(e.g., `4.0999999999999996` for `4.1`). These have 2-part section numbers. Skip any row
where the normalized section doesn't match `^\d+\.\d+\.\d+$`.

---

## Known Tricky Cases

These 8 items require special handling beyond the generic regex:

| Section | Issue | Resolution |
|---------|-------|-----------|
| 4.9.2, 4.9.3 | Both titled "Liquid Smoke Solution" in SOW | Body text: "1-quart containers" → append "(1 Quart)"; "1-gallon containers" → append "(1 Gallon)" |
| 4.10.1 | SOW title "Respiratory Protection Mask" → expected "(PC50)" | Append `(PART_NUM)` when title matches sibling items and ref provides short model number |
| 4.10.2 | Same SOW title → expected "(FM53)" | Same disambiguation rule |
| 4.10.3 | Same SOW title → expected "(FM54)" | Same disambiguation rule |
| 4.10.4 | Part number `#70501-156` has `#` prefix | Strip `#` prefix from part number |
| 4.10.6 | Part number `72606/3` contains `/` | Allow `/` in part number regex |
| 4.8.x | No "equal to or better than" reference | manufacturer_ref=null, part_number=null, unit="KT" |
| 4.10.5, 4.10.7–4.10.9 | No "equal to or better than" reference | manufacturer_ref=null, part_number=null |

---

## Unit Extraction Rules (from SOW body text)

```
"1-quart containers"   → unit = "QT"
"1-gallon containers"  → unit = "GA"
"delivered as one item" in section 4.8.x context → unit = "KT"
default                → unit = "EA"
```

---

## New Functions

### 1. `extract_sow_line_items(text: str) -> list[dict]`

**Location:** `python/extractor.py` (new function, ~80 lines)

**Algorithm:**

```
Step 1: Extract all section blocks
  pattern = r"^(4\.\d{1,2}\.\d{1,2})\.\s+((?:[^.()]|\([^)]*\))+)\."
  flags = re.MULTILINE
  Find all matches → list of (section_num, title, match_end)
  For each match, body = text[match_end : next_match_start]  (cap at 1500 chars)

Step 2: For each section block:
  a. title = matched group 2, stripped

  b. Unit from body:
     - "1-quart" in body (case-insensitive) → "QT"
     - "1-gallon" in body (case-insensitive) → "GA"
     - section_num starts with "4.8." → "KT"
     - else → "EA"

  c. Manufacturer reference:
     pattern_def_tech = r"equal to or better than\s+([\w\s]+?)\s+part\s+number\s+([\w\-/]+)"
     pattern_avon_model = r"equal to or better than the\s+(Avon)\s+([\w]+)(?:,\s+Protective)?"
     pattern_avon_part = r"equal to or better than the\s+Avon\s+\w+.*?[,#]\s*([\w\-/]+)"
     Try each in order. If no match → manufacturer_ref=None, part_number=None

     Special: part number from pattern_def_tech group 2 may contain comma suffix
       ("1063, Saf-smoke Grenade") → take only the alphanumeric prefix before comma
     Special: strip leading "#" from part numbers (case 4.10.4)

  d. Disambiguation — append to title when needed:
     Check if title was already seen in this pass (duplicate detection):
       - "Liquid Smoke Solution" seen twice → append "(1 Quart)" or "(1 Gallon)" from body
       - "Respiratory Protection Mask" seen multiple times → append "(PART_NUM)" if part_num is short alphanumeric

  e. Emit item dict:
     {
       "sow_section": section_num,      # e.g. "4.1.1"
       "description": title,             # cleaned, disambiguated
       "manufacturer_ref": mfr or None,
       "part_number": part_num or None,
       "unit": unit,
       "qty": "N/A",                     # filled by pricing spreadsheet
       "unit_price": "N/A",
     }

Step 3: Return list sorted by sow_section (natural numeric sort)
```

**Deduplication:** Use a `seen_titles` dict mapping title → count. On second occurrence, look up
disambiguation rule. This is order-dependent (matches SOW order), which is correct because 4.9.2
appears before 4.9.3 in the document.

**Regex for title capture:**
```python
re.compile(
    r"^(4\.\d{1,2}\.\d{1,2})\.\s+"     # section number with trailing period
    r"((?:[^.()\n]|\([^)]*\))+)"        # title: no unmatched parens, no newline
    r"\.",                               # title-ending period
    re.MULTILINE
)
```
This handles: `Smoke Canister for Training (Reduced Toxicity).` correctly.

---

### 2. `extract_pricing_spreadsheet(filepath: str) -> list[dict]`

**Location:** `python/extractor.py` (new function, ~60 lines)

**Constraint:** stdlib only — no pandas, no openpyxl. Use `zipfile + xml.etree.ElementTree`.

**Algorithm:**

```
Step 1: Open XLSX as ZIP, parse xl/sharedStrings.xml
  Build shared_strings list (indices → string values)
  Handle <si><r><t> (rich text) and <si><t> (plain text)

Step 2: Parse xl/worksheets/sheet1.xml
  For each <row>:
    Extract cell values using shared string lookup for t="s" cells
    Numeric values: take <v> text directly

Step 3: Build column map
  Assume fixed layout after inspecting fixture:
    col A (index 0): sow_section
    col B (index 1): description
    col E (index 4): qty_period_1
    col H (index 7): qty_period_2
    col K (index 10): qty_period_3
    col N (index 13): qty_period_4
    col Q (index 16): qty_period_5

Step 4: For each data row:
  a. Normalize section: if col A looks like a float (e.g., "4.0999999999999996"),
     round to nearest 0.1 → this produces "4.1" etc. → skip (category header)
     Heuristic: if A contains only one period after normalization → skip
  
  b. If A matches r"^\d+\.\d+\.\d+$" → item row
     Strip trailing whitespace from description (XLSX has trailing spaces in some rows)
     Strip embedded part numbers from description (4.4.15 has "1013391 Yellow Nose" suffix)
       → description cleanup: strip after last trailing word that looks like a part# or color note
       Actually: use SOW description as override in merge — don't over-engineer XLSX cleanup

  c. Parse all period quantities:
     quantities_by_period = {
       "period_1": int(E) if E else None,
       "period_2": int(H) if H else None,
       ...
     }

  d. Emit item dict:
     {
       "sow_section": section_str,       # "4.1.1"
       "description": desc.strip(),
       "part_number": None,              # col C always empty
       "manufacturer_ref": None,
       "unit": "EA",                     # XLSX has no unit column
       "qty_period_1": int(E) or "N/A",
       "quantities_by_period": quantities_by_period,
       "qty": int(E) or "N/A",          # compat alias
       "unit_price": "N/A",
     }
```

**Section normalization helper:**
```python
def _normalize_section(raw: str) -> str:
    """Convert float section values like '4.0999999999999996' to '4.1'."""
    try:
        f = float(raw)
        # Round to 1 decimal, then format as string
        rounded = round(f, 1)
        return str(rounded)  # "4.1"
    except (ValueError, TypeError):
        return str(raw).strip()
```

---

### 3. `merge_line_item_sources(sow_items: list[dict], pricing_items: list[dict]) -> list[dict]`

**Location:** `python/extractor.py` (new function, ~40 lines)

**Strategy:** XLSX provides the complete item list (all 118 guaranteed). SOW enriches with
specs. Start from XLSX baseline, enrich from SOW.

```
Step 1: Build SOW lookup: {sow_section → sow_item}

Step 2: For each XLSX item (baseline):
  merged = copy of xlsx_item
  
  If sow_section in SOW lookup:
    sow = SOW lookup[sow_section]
    # SOW description is cleaner — prefer it over XLSX
    if sow["description"] and len(sow["description"]) > 3:
      merged["description"] = sow["description"]
    # SOW provides specs not in XLSX
    merged["manufacturer_ref"] = sow.get("manufacturer_ref")
    merged["part_number"] = sow.get("part_number")
    merged["unit"] = sow.get("unit", "EA")
  
  Result has all keys for both schemas

Step 3: For any SOW items not in XLSX (should not happen with this fixture):
  Add them at the end with qty="N/A"

Step 4: Sort by sow_section (natural numeric sort)
  sort key: tuple(int(p) for p in section.split(".") if p.isdigit())
```

**Note:** Eval table is omitted from merge parameters. Inspection shows no dedicated eval table
pages in this SOW PDF (the fixture has specification paragraphs, not a pass/fail table). The
extractor-overhaul-plan.md's `extract_eval_table_items()` is a future feature for other formats.
This phase does not implement it.

---

### 4. Integration into `extract_data()` and `server.py`

#### `extract_data()` change (minimal)

`extract_data()` signature stays the same. It currently returns a dict — no change needed for
the single-file case. The SOW is a separate file; multi-file coordination happens in `server.py`.

For the sf1449 format case specifically:
```python
# In extract_data(), after sf1449 extraction:
elif format_name == "sf1449":
    d = extract_sf1449(text)
    # SOW line items handled via bundle parse — see server.py
    # If caller passes sow_text kwarg (future), could call here.
    # For now, line_items populated by server.py bundle logic.
```

#### `server.py` multi-file support

The `/parse` endpoint currently accepts a single file. Extend to accept optional attachment files:

```
POST /parse
  field "file" = main solicitation (required)
  field "attachments[]" = additional files (optional, 0..N)
```

New `parse_bundle()` function in `server.py`:
```
1. Call parse_pdf(main_file) → text
2. Call extract_data(text) → solicitation fields
3. For each attachment:
   a. If filename matches *.xlsx → call extract_pricing_spreadsheet(path) → pricing_items
   b. If filename matches *SOW* or text starts with "Statement of Work" → 
      call parse_pdf(path) → sow_text
      call extract_sow_line_items(sow_text) → sow_items
4. merge_line_item_sources(sow_items, pricing_items) → merged_items
5. solicitation["line_items"] = merged_items
6. Run existing extract_line_items() only if no merged_items (backward compat fallback)
7. Return solicitation
```

**Backward compatibility:** When no attachments are uploaded, `parse_bundle()` reduces to the
existing single-file flow. `extract_line_items()` runs as before.

---

## Output Schema

### New schema (SOW-enriched items)

```json
{
  "sow_section": "4.1.1",
  "description": "Smoke Canister for Training (Reduced Toxicity)",
  "manufacturer_ref": "Defense Technologies",
  "part_number": "1063",
  "unit": "EA",
  "qty_period_1": 1140,
  "quantities_by_period": {
    "period_1": 1140,
    "period_2": 570,
    "period_3": 570,
    "period_4": 330,
    "period_5": 330
  },
  "qty": 1140,
  "unit_price": "N/A"
}
```

### Existing schema (non-SOW documents) — unchanged

```json
{
  "description": "...",
  "size": "N/A",
  "unit": "EA",
  "qty": "N/A",
  "unit_price": "N/A"
}
```

`generator.py` uses `.get("description","")`, `.get("size","")`, `.get("unit","EA")`, 
`.get("qty")`, `.get("unit_price")`. New keys `sow_section`, `manufacturer_ref`,
`part_number`, `qty_period_1`, `quantities_by_period` are silently ignored. No change to
`generator.py`.

---

## Implementation Order

| Step | What | Why |
|------|------|-----|
| 1 | `extract_pricing_spreadsheet()` | Simpler, no regex. Establishes 118-item baseline. Validates XLSX parse logic works standalone. |
| 2 | `extract_sow_line_items()` — basic cases | Get 4.1.x–4.7.x working first (all Defense Technologies, uniform pattern). Covers ~90 items. |
| 3 | `extract_sow_line_items()` — special cases | 4.8.x (KT unit), 4.9.x (QT/GA units, duplicate title), 4.10.x (Avon, title disambiguation). Covers remaining ~28 items. |
| 4 | `merge_line_item_sources()` | Straightforward once sources work. |
| 5 | `server.py` multi-file endpoint | Minimal: add `attachments[]` field, call bundle function. |
| 6 | Test against fixture | Compare output to expected_line_items.json. Fix regex gaps. |

---

## Acceptance Test

Run the following against the fixture after implementation:

```python
from python.extractor import extract_sow_line_items, extract_pricing_spreadsheet, merge_line_item_sources
import json, pdfplumber

SOW_PATH  = "testdata/test_solicitations/70B06C26Q00000080/70B06C26Q00000080+Attachment+1+-+LLSM+SOW.pdf"
XLSX_PATH = "testdata/test_solicitations/70B06C26Q00000080/70B06C26Q00000080+Attachment+2-Pricing+Sheeet.xlsx"
EXPECTED  = "testdata/test_solicitations/70B06C26Q00000080/70B06C26Q00000080_expected_line_items.json"

with pdfplumber.open(SOW_PATH) as pdf:
    sow_text = "\n\n".join(p.extract_text() or "" for p in pdf.pages)

sow_items     = extract_sow_line_items(sow_text)
pricing_items = extract_pricing_spreadsheet(XLSX_PATH)
merged        = merge_line_item_sources(sow_items, pricing_items)
expected      = json.load(open(EXPECTED))

# Check section coverage
expected_sections = {e["sow_section"] for e in expected}
merged_sections   = {m["sow_section"] for m in merged}
missing = expected_sections - merged_sections
extra   = merged_sections - expected_sections

print(f"Items: {len(merged)} / {len(expected)} expected")
print(f"Missing sections: {sorted(missing)}")
print(f"Extra sections: {sorted(extra)}")

# Check description accuracy
desc_matches = sum(
    1 for e in expected
    if any(m["sow_section"] == e["sow_section"] and
           m["description"] == e["description"]
           for m in merged)
)
print(f"Description exact matches: {desc_matches} / {len(expected)}")

# Check part_number accuracy
pn_matches = sum(
    1 for e in expected
    if e.get("part_number") and any(
        m["sow_section"] == e["sow_section"] and
        m.get("part_number") == e["part_number"]
        for m in merged)
)
pn_expected = sum(1 for e in expected if e.get("part_number"))
print(f"Part number matches: {pn_matches} / {pn_expected}")
```

**Pass criteria:**
- `len(merged)` == 118
- `missing` == empty set (XLSX guarantees all 118)
- `desc_matches` >= 110 (from SOW extraction; ~8 tricky items may need iteration)
- `pn_matches` >= 100 / 114 items that have part numbers in expected

---

## Regression Guard

Before shipping, run the existing test flow against all three existing solicitation fixtures to
confirm no behavior change:

```
python testdata/run.py testdata/test_solicitations/36C24225Q0696/36C24225Q0696.pdf
python testdata/run.py testdata/test_solicitations/request-for-quotation/request-for-quotation.pdf
# SAM-export fixtures (no expected output files, visually confirm)
```

These pass through `extract_line_items()` which is not modified — regression risk is zero.
The only possible regression is if `extract_data()` changes introduce a bug for sf1449 format
(new format added in Phase 2); that format was not present in existing fixtures.

---

## Edge Cases and Failure Modes

| Risk | Mitigation |
|------|-----------|
| XLSX float-encoded section numbers (e.g., `4.0999999999999996`) mistakenly treated as items | `_normalize_section()` + 2-part section detection: skip if no second `.` in normalized string |
| SOW section regex misses items due to unusual page headers ("Statement of Work (SOW) / Less Lethal...") at top of each page | The section regex uses `re.MULTILINE` and anchors to `^` — page headers don't match `^4.\d+.\d+.` |
| Duplicate titles break order-dependent disambiguation | Process sections in document order; `seen_titles` counter is ordered by first appearance |
| Avon part numbers with `/` in them (`72606/3`) | Part number regex: `r"[\w\-/]+"` — allow `/` in character class |
| Part numbers with `-` (e.g., `6530-50`, `6530LE-50`) | Regex already allows `-` via `[\w\-]+` |
| XLSX description whitespace variants (trailing spaces, extra internal spaces) | `desc.strip()` and `re.sub(r"\s{2,}", " ", desc)` before storing |
| pdfplumber may hyphenate words across line breaks | SOW body text uses line-continuation — regex searches on the rejoined text; no line-anchored regex on body |

---

## What This Plan Does NOT Include

- `extract_eval_table_items()` — no eval table found in this fixture. Defined in overhaul plan for future formats.
- AI-assisted extraction for SOW items — all extraction is pure regex/rules per privacy policy.
- Unit price extraction — pricing sheet has no vendor prices (cells are blank); unit_price stays "N/A" throughout.
- Multi-period quantity display in generator.py — generator currently shows `qty` only. `quantities_by_period` stored in dict for future UI use but not rendered yet.
- Part number lookup in product DB — clean interface boundary: extractor produces structured items, DB enrichment is a future API-layer concern.
