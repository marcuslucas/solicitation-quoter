# Phase 1 — Data Enrichment Implementation Plan

**Scope:** Add `spec_text`, `source_page`, `source_file`, `_source`, and `qty_total` to every line item.  
**Files changed:** `python/extractor.py` only.  
**All changes are additive** — no existing field is removed or changed in meaning until Change 3 overrides `qty`.

---

## Diagnostic Q&A

### Q1 — Where is `body` computed in `extract_sow_line_items()`?

Lines 758–760:
```python
body_start = m.end()
body_end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
body = text[body_start:body_end]
```
`body` is the raw text between the current section header and the next one. It is used for unit/manufacturer/part-number extraction but is **never stored** in the appended dict (lines 824–832).

---

### Q2 — Current signature of `extract_sow_line_items()`

Line 731:
```python
def extract_sow_line_items(text):
```
Takes **only `text: str`**. No `page_texts` argument. The `DocumentResult` is not accessible inside the function at all today.

---

### Q3 — How is `extract_sow_line_items()` called in `parse_solicitation_bundle()`?

Lines 1136–1141. It receives only `.text` — the string extracted from `DocumentResult`. The full `DocumentResult` (with `page_texts`) is available in `sow_doc["result"]` but is not passed through:

```python
# Line 1136-1137 — dedicated SOW docs
for sow_doc in sow_docs:
    sow_items.extend(extract_sow_line_items(sow_doc["result"].text))

# Line 1140-1141 — fallback on main doc
if not sow_items:
    sow_items = extract_sow_line_items(main_doc["result"].text)
```

`page_texts` is available as `sow_doc["result"].page_texts` at the call site — it just isn't passed.

---

### Q4 — Where does the final merged list get built in `merge_line_item_sources()`?

Lines 1001–1005 — the 5 lines immediately before `return merged`:

```python
    def _section_key(item):
        return tuple(int(p) for p in item["sow_section"].split(".") if p.isdigit())

    merged.sort(key=_section_key)
    return merged
```

All `_source` and `qty_total` enrichment must be inserted **before** the `merged.sort(...)` call (line 1004).

---

### Q5 — Full structure of a merged item with all keys

A fully-merged SOW+XLSX item looks like this after `merge_line_item_sources()` today:

```python
{
    # From XLSX (baseline)
    "sow_section":        "4.1.1",
    "description":        "M201A1 Smoke Grenade",   # overwritten by SOW if longer
    "part_number":        None,                      # overwritten from SOW
    "manufacturer_ref":   None,                      # overwritten from SOW
    "unit":               "EA",                      # overwritten from SOW
    "qty_period_1":       1140,                      # raw P1 qty, kept as-is
    "quantities_by_period": {
        "period_1": 1140,
        "period_2": 1140,
        "period_3": 1140,
        "period_4": 1140,
        "period_5": 1140,
    },
    "qty":        1140,    # currently = period_1 only
    "unit_price": "N/A",
    # spec_text / source_page / source_file / _source / qty_total — NOT PRESENT YET
}
```

---

### Q6 — Does `DocumentResult` carry `page_texts`?

Yes. `document_loader.py` lines 30–31:
```python
page_texts: list = field(default_factory=list)
"""Per-page text strings. Index 0 = page 1."""
```
It is populated by all four loaders: `_load_pdf()` (line 103), `_load_zip_bundle()` (line 173), `_load_docx()` (line 213), `_load_text()` (line 229). It will never be `None` — worst case it is `[]`.

---

## Implementation Plan

### Change order summary

1. **`extract_sow_line_items()`** — signature + page_map + `spec_text`/`source_page` in append block. No callers break (new param is optional).
2. **`parse_solicitation_bundle()`** — pass `page_texts` and stamp `source_file`. Depends on Change 1 being done.
3. **`merge_line_item_sources()`** — propagate fields in merge loop, add `_source` + `qty_total` pass before sort. Depends on Change 2 so items actually carry the new fields.

---

### Change 1 — `extract_sow_line_items()`: add `page_texts` param, build page_map, store `spec_text` and `source_page`

**Signature change at line 731:**
```python
# BEFORE
def extract_sow_line_items(text):

# AFTER
def extract_sow_line_items(text, page_texts=None):
```

**After line 742** (`matches = list(_SOW_SECTION_RE.finditer(text))`), insert the page_map block:
```python
    # Build page boundary map for source_page resolution
    # Offsets must match DocumentResult: page_texts joined with '\n\n'
    page_map = []  # [(start_char, end_char, 1-indexed page_number), ...]
    if page_texts:
        pos = 0
        for i, pt in enumerate(page_texts):
            normalized = pt.replace('\r\n', '\n').replace('\r', '\n')
            page_map.append((pos, pos + len(normalized), i + 1))
            pos += len(normalized) + 2  # +2 for the '\n\n' separator

    def _find_page(char_pos):
        for start, end, pg in page_map:
            if start <= char_pos < end:
                return pg
        return None
```

**In the `items.append({...})` block at lines 824–832**, add two fields:
```python
        items.append({
            "sow_section":      section_num,
            "description":      title,
            "manufacturer_ref": manufacturer_ref,
            "part_number":      part_number,
            "unit":             unit,
            "qty":              "N/A",
            "unit_price":       "N/A",
            "spec_text":        body.strip()[:2000],            # NEW
            "source_page":      _find_page(m.start()),          # NEW (None if no page_map)
        })
```

---

### Change 2 — `parse_solicitation_bundle()`: pass `page_texts`, stamp `source_file`

Replace lines 1136–1141 (both call sites):

```python
# Dedicated SOW docs (replaces lines 1136-1137)
sow_items = []
for sow_doc in sow_docs:
    items = extract_sow_line_items(
        sow_doc["result"].text,
        sow_doc["result"].page_texts,   # NEW
    )
    for item in items:
        item["source_file"] = sow_doc["filename"]  # NEW
    sow_items.extend(items)

# Fallback to main doc (replaces lines 1140-1141)
if not sow_items:
    items = extract_sow_line_items(
        main_doc["result"].text,
        main_doc["result"].page_texts,  # NEW
    )
    for item in items:
        item["source_file"] = main_doc["filename"]  # NEW
    sow_items = items
```

`DocumentResult.page_texts` is always a `list` (defaulting to `[]`), never `None`, so no guard needed.

---

### Change 3 — `merge_line_item_sources()`: propagate provenance fields, add `_source`, compute `qty_total`

**Part A — propagate `spec_text`/`source_page`/`source_file` from SOW into merged items.**

After line 984 (`merged_item["unit"] = sow.get("unit", "EA")`), add:
```python
            merged_item["spec_text"]   = sow.get("spec_text")
            merged_item["source_page"] = sow.get("source_page")
            merged_item["source_file"] = sow.get("source_file")
```

No change needed for the SOW-only guard block (lines 989–999) — `**sow_item` spreads all keys including the new ones automatically.

**Part B — `_source` and `qty_total` pass. Insert before `merged.sort(...)` (line 1004):**

```python
    for item in merged:
        # Provenance tag
        has_sow  = item.get("spec_text") is not None
        has_xlsx = item.get("qty_period_1") not in (None, "N/A")
        if has_sow and has_xlsx:
            item["_source"] = "SOW+XLSX"
        elif has_sow:
            item["_source"] = "SOW"
        elif has_xlsx:
            item["_source"] = "XLSX"
        else:
            item["_source"] = "unknown"

        # Total quantity across all periods; override qty
        periods = item.get("quantities_by_period", {})
        numeric = [v for v in periods.values() if isinstance(v, (int, float))]
        item["qty_total"] = sum(numeric) if numeric else None
        item["qty"] = item["qty_total"] if item["qty_total"] is not None else item.get("qty_period_1", "N/A")

    merged.sort(key=_section_key)
    return merged
```

---

## Edge Cases

| Scenario | Behavior |
|---|---|
| `page_texts` is `[]` (txt/docx fallback) | `page_map = []`, `source_page = None` on all items — safe |
| SOW item has no XLSX match (guard path) | `**sow_item` spreads `spec_text`/`source_page`/`source_file`; `qty_period_1 = "N/A"` → `_source = "SOW"` |
| XLSX item has no SOW match | `spec_text` never set → `has_sow = False` → `_source = "XLSX"` |
| All periods are `None` in `quantities_by_period` | `numeric = []` → `qty_total = None` → `qty = qty_period_1` (preserves old behavior) |
| `source_file` not set on sow_item (old code path) | `.get("source_file")` returns `None` — no crash |

---

## Acceptance Test

Run from the repo root after all three changes are applied:

```bash
python3 -c "
import sys; sys.path.insert(0, 'python')
from extractor import parse_solicitation_bundle

base = 'testdata/test_solicitations/70B06C26Q00000080'
files = [
    {'path': base + '/70B06C26Q00000080.pdf',
     'filename': '70B06C26Q00000080.pdf'},
    {'path': base + '/70B06C26Q00000080+Attachment+1+-+LLSM+SOW.pdf',
     'filename': '70B06C26Q00000080+Attachment+1+-+LLSM+SOW.pdf'},
    {'path': base + '/70B06C26Q00000080+Attachment+2-Pricing+Sheeet.xlsx',
     'filename': '70B06C26Q00000080+Attachment+2-Pricing+Sheeet.xlsx'},
]
result = parse_solicitation_bundle(files)
item = result['line_items'][0]

checks = {
    'spec_text':   lambda v: isinstance(v, str) and len(v) > 0,
    'source_page': lambda v: isinstance(v, int),
    'source_file': lambda v: v is not None and len(v) > 0,
    '_source':     lambda v: v == 'SOW+XLSX',
    'qty_total':   lambda v: isinstance(v, (int, float)) and v > 0,
}
for field, pred in checks.items():
    val = item.get(field)
    status = 'PASS' if pred(val) else 'FAIL'
    print(f'{status}  {field} = {val!r}')

assert item['qty'] == item['qty_total'], f'qty mismatch: {item[\"qty\"]} != {item[\"qty_total\"]}'
print('PASS  qty == qty_total')
print(f'Total line items: {len(result[\"line_items\"])}')
"
```

Expected output:
```
PASS  spec_text   = '<paragraph text containing item description...>'
PASS  source_page = <integer>
PASS  source_file = '70B06C26Q00000080+Attachment+1+-+LLSM+SOW.pdf'
PASS  _source     = 'SOW+XLSX'
PASS  qty_total   = <sum of P1-P5>
PASS  qty == qty_total
Total line items: 118
```
