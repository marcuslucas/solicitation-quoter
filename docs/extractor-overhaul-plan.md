# Extractor Overhaul Plan — Sol-Quoter

## Executive Summary

The current `extractor.py` has three hardcoded format parsers that work for real PDFs. Two critical gaps prevent it from handling the new DHS LLSM solicitation (`70B06C26Q00000080`):

1. **Input layer failure:** SAM.gov now delivers documents as ZIP archives containing per-page JPEG images and OCR'd text files — not PDFs. `parse_pdf()` fails silently.
2. **No format parser for SF-1449:** The DHS solicitation uses Standard Form 1449 with Roman-numeral sections (I, II, III), not the lettered sections (A, B, C, D, E) that `formal_rfq` expects.
3. **No multi-document support:** Line items live in a separate SOW attachment and a pricing spreadsheet — not in the main solicitation body.
4. **Line item extraction is brittle:** The current CLIN regex looks for `CLIN 0001` patterns. The new format uses `4.x.x` SOW section numbering with 100+ items across categories.

This plan addresses all four gaps while strengthening the overall system.

---

## Phase 0: File Handling — Fix the Input Layer

### Problem
SAM.gov delivers files as ZIP archives (`.pdf` extension but actually ZIP) containing:
```
manifest.json          # page metadata
1.jpeg, 2.jpeg, ...    # page images
1.txt, 2.txt, ...      # OCR'd text per page
```

Both `pdfplumber` and `pypdf` throw exceptions on these files. The current code catches silently and returns empty string.

### Solution: New `document_loader.py` module

Replace `parse_document()` with a smarter loader that detects actual file types.

```python
# document_loader.py

import zipfile, json, os
from pathlib import Path
from dataclasses import dataclass, field

@dataclass
class DocumentResult:
    text: str                           # reassembled full text
    page_count: int = 0
    source_format: str = "unknown"      # "pdf", "sam_zip", "docx", "txt"
    has_images: bool = False
    page_texts: list[str] = field(default_factory=list)  # per-page text for targeted extraction
    error: str | None = None

def load_document(filepath: str) -> DocumentResult:
    """
    Detect actual file type and extract text.
    Handles: real PDFs, SAM.gov ZIP bundles, DOCX, plain text.
    """
    path = Path(filepath)

    # 1. Check magic bytes — don't trust file extension
    with open(filepath, "rb") as f:
        magic = f.read(4)

    if magic[:2] == b"PK":  # ZIP-based format
        return _load_zip_bundle(filepath)
    elif magic == b"%PDF":
        return _load_pdf(filepath)
    elif path.suffix.lower() == ".txt":
        return _load_text(filepath)
    else:
        # Try PDF as fallback
        result = _load_pdf(filepath)
        if result.text:
            return result
        return DocumentResult(text="", error=f"Unrecognized file format: {path.suffix}")
```

#### `_load_zip_bundle()` — SAM.gov format
```python
def _load_zip_bundle(filepath: str) -> DocumentResult:
    """Handle SAM.gov ZIP archives with manifest.json + page text/images."""
    with zipfile.ZipFile(filepath) as zf:
        names = zf.namelist()

        # Check for SAM.gov manifest
        if "manifest.json" in names:
            manifest = json.loads(zf.read("manifest.json"))
            num_pages = manifest.get("num_pages", 0)
            page_texts = []

            for i in range(1, num_pages + 1):
                txt_name = f"{i}.txt"
                if txt_name in names:
                    page_text = zf.read(txt_name).decode("utf-8", errors="ignore")
                    page_texts.append(page_text)

            full_text = "\n\n".join(page_texts)
            has_images = any(n.endswith((".jpeg", ".jpg", ".png")) for n in names)

            return DocumentResult(
                text=full_text,
                page_count=num_pages,
                source_format="sam_zip",
                has_images=has_images,
                page_texts=page_texts,
            )

        # Check for DOCX (also ZIP-based)
        if "word/document.xml" in names:
            return _load_docx_from_path(filepath)

    return DocumentResult(text="", error="ZIP archive without recognized structure")
```

#### Key design decisions
- **Magic bytes, not extensions.** SAM.gov labels ZIPs as `.pdf`. We check `PK` (ZIP) vs `%PDF`.
- **Page-level text preserved.** `page_texts` list enables targeted extraction (e.g., "give me pages 39-43 for the evaluation table").
- **No behavior change for real PDFs.** Existing `parse_pdf` logic is wrapped but unchanged.

### Files changed
- **New:** `document_loader.py`
- **Modified:** `extractor.py` — `parse_document()` delegates to `document_loader.load_document()`

---

## Phase 1: Format Detection Hardening

### Current state
```python
def detect_format(text):
    if "Notice ID:" in first_1000:           return "sam_export"
    if "SOLICITATION NUMBER*":               return "agency_form"
    if "Issuing Office:" or "SECTION [A-E]": return "formal_rfq"
    return "unknown"
```

### Problems
1. **SF-1449 misidentified.** The DHS solicitation has `SOLICITATION NUMBER` on page 1 (the SF-1449 form header) but also `SECTION I`, `SECTION II`, `SECTION III`. It matches neither `agency_form` (needs `*` suffix) nor `formal_rfq` (needs lettered sections A-E).
2. **Order-dependent.** If a document has both `Notice ID:` and `SECTION A`, the first match wins regardless of which is actually the right format.
3. **`unknown` is a dead end.** Falls through to empty dict + generic fallback, which misses most fields.

### Solution: Scoring-based detection

Replace the first-match cascade with a scoring system. Each format gets a confidence score based on how many fingerprint patterns match.

```python
def detect_format(text: str) -> str:
    first_2000 = text[:2000]
    scores = {
        "sam_export": 0,
        "agency_form": 0,
        "formal_rfq": 0,
        "sf1449": 0,
    }

    # SAM.gov structured export
    if "Notice ID:" in first_2000:                              scores["sam_export"] += 3
    if "Combined Synopsis/Solicitation Details" in first_2000:  scores["sam_export"] += 2
    if "Primary Contact Name:" in text[:5000]:                  scores["sam_export"] += 1
    if "Notice Details" in text[:5000]:                         scores["sam_export"] += 1

    # VA/agency combined synopsis form
    if re.search(r"SOLICITATION NUMBER\*", first_2000):         scores["agency_form"] += 3
    if "POINT OF CONTACT*" in text:                             scores["agency_form"] += 2
    if "RESPONSE DATE/TIME/ZONE" in first_2000:                 scores["agency_form"] += 1

    # Formal RFQ with lettered sections
    if "Issuing Office:" in first_2000:                         scores["formal_rfq"] += 3
    if re.search(r"\bSECTION\s+[A-E]\b", text):                scores["formal_rfq"] += 2
    if "Quotation Due Date:" in first_2000:                     scores["formal_rfq"] += 1

    # SF-1449 (new)
    if "STANDARD FORM 1449" in text[:5000]:                     scores["sf1449"] += 3
    if "Solicitation/Contract/Order for Commercial" in first_2000: scores["sf1449"] += 3
    if re.search(r"SECTION\s+I\s+SCHEDULES", text):            scores["sf1449"] += 2
    if re.search(r"SECTION\s+II\s+CONTRACT\s+CLAUSES", text):  scores["sf1449"] += 2
    if "SCHEDULE OF SUPPLIES/SERVICES" in first_2000:           scores["sf1449"] += 1

    best = max(scores, key=scores.get)
    if scores[best] >= 3:
        return best
    return "unknown"
```

### Why scoring, not cascading
- Multiple formats share keywords (`SOLICITATION NUMBER` appears in both `agency_form` and `sf1449`).
- Scoring lets us add new formats without worrying about match order.
- The threshold (≥3) prevents false positives on generic documents.

---

## Phase 2: SF-1449 Extractor

### New function: `extract_sf1449(text)`

The SF-1449 form has a dense, structured first page with numbered blocks (Block 5 = Solicitation Number, Block 7 = Contact, Block 8 = Due Date, etc.), followed by numbered sections.

```python
def extract_sf1449(text):
    """
    Extract fields from SF-1449 Solicitation/Contract/Order for Commercial Products.
    Fingerprint: 'STANDARD FORM 1449' or 'Solicitation/Contract/Order for Commercial'
    Structure: Numbered blocks on page 1, then SECTION I/II/III with Roman numerals.
    """
    def find(patterns):
        for p in patterns:
            m = re.search(p, text, re.IGNORECASE | re.MULTILINE)
            if m:
                v = (m.group(1) if m.lastindex else m.group(0)).strip()
                if v: return v
        return ""

    d = {}

    # Block 5: Solicitation Number
    d["solicitation_number"] = find([
        r"(?:5\.\s*)?SOLICITATION\s*NUMBER\s*\n?\s*([A-Z0-9]{10,})",
        r"(?:SOLICITATION\s*NUMBER)\s+([A-Z0-9][\w\-]+)",
    ])

    # Block 6: Issue Date
    d["posting_date"] = find([
        r"SOLICITATION\s*ISSUE\s*DATE\s*\n?\s*(\d{2}/\d{2}/\d{4})",
    ])

    # Block 7: Contact info
    d["contact_name"] = find([
        r"(?:FOR\s+SOLICITATION\s+INFORMATION\s+CALL|7\.\s*FOR\s+SOLICITATION)\s*"
        r".*?(?:a\.\s*NAME\s*)?.*?\n?\s*([A-Z][a-z]+(?:,\s*[A-Z][a-z]+)+)",
    ])
    d["contact_email"] = find([
        r"b\.\s*Email\s*\n?\s*([\w.%+\-]+@[\w.\-]+\.\w{2,})",
        r"([\w.%+\-]+@[\w.\-]+\.(?:gov|mil|us))",
    ])

    # Block 8: Due Date
    d["due_date"] = find([
        r"OFFER\s+DUE\s+DATE.*?\n?\s*(\d{2}/\d{2}/\d{4}\s*\d{1,2}:\d{2}\s*[AP]M\s*\w+)",
        r"OFFER\s+DUE\s+DATE.*?(\d{2}/\d{2}/\d{4})",
    ])

    # Block 9: Issuing Office
    d["issuing_agency"] = find([
        r"ISSUED\s+BY\s+CODE\s+\w+\s*\n\s*(.+?)(?:\n\n|\Z)",
    ])
    # Clean multi-line agency name
    if d.get("issuing_agency"):
        lines = [l.strip() for l in d["issuing_agency"].split("\n") if l.strip()]
        d["issuing_agency"] = ", ".join(lines[:2])

    # Block 10: NAICS and Set-Aside
    d["naics_code"] = find([r"NAICS:\s*\n?\s*(\d{5,6})"])
    d["set_aside"] = find([
        r"SET\s*ASIDE\s*:?\s*(\d+)\s*%?\s*FOR",
        r"(SMALL\s+BUSINESS)",
        r"(Total Small Business Set.?Aside)",
    ])

    # Block 14: Method of solicitation
    d["solicitation_type"] = find([
        r"METHOD OF SOLICITATION\s*\n?\s*(RFQ|IFB|RFP)",
        r"\b(RFQ|RFP|IFB)\b.*?(?:checked|marked|X)",
    ])

    # Section I: Schedule info
    # Maximum amount
    d["estimated_value"] = find([
        r"[Mm]aximum\s+(?:amount|value)[^\$]*\$\s*([\d,\.]+(?:\s*(?:million|billion))?)",
        r"not\s+(?:to\s+)?exceed[^\$]*\$\s*([\d,\.]+)",
    ])

    # Period of performance
    d["period_of_performance"] = find([
        r"(?:ordering\s+period|period\s+of\s+performance)[^\d]*?(\d+\s+months|\d+\s+year[s]?\s+ordering)",
    ])

    # Contract type from Section I or II
    d["contract_type"] = find([
        r"(indefinite\s+delivery/indefinite\s+quantity|ID/IQ|IDIQ)",
        r"(firm[\s\-]fixed[\s\-]price|FFP)",
    ])

    # Project title — from the schedule line or description
    d["project_title"] = find([
        r"SCHEDULE\s+OF\s+SUPPLIES/SERVICES.*?\n.*?\d+\s+(.+?)(?:\n|$)",
        r"(?:Subject|Title)[:\s]+(.+?)(?:\n|$)",
    ])

    # Scope from Section I or description block
    scope_m = re.search(
        r"(?:SECTION\s+I\s+SCHEDULES|ADDITIONAL\s+INFORMATION)[^\n]*\n(.+?)(?=SECTION\s+II|\Z)",
        text, re.IGNORECASE | re.DOTALL)
    if scope_m:
        d.update(_scope_block(scope_m.group(1)))
    else:
        d.update(_scope_block(text[:SCOPE_MAX * 2]))

    return {k: v for k, v in d.items() if v not in ("", [], None)}
```

### Integration into `extract_data()`
```python
def extract_data(text, api_key=""):
    format_name = detect_format(text)
    if format_name == "sam_export":     d = extract_sam_export(text)
    elif format_name == "agency_form":  d = extract_agency_form(text)
    elif format_name == "formal_rfq":   d = extract_formal_rfq(text)
    elif format_name == "sf1449":       d = extract_sf1449(text)  # NEW
    else:                               d = {}
    # ... rest unchanged
```

---

## Phase 3: Line Item Extraction Overhaul

This is the critical piece. The current `extract_line_items()` has four strategies:
1. AI-extracted items (best quality, but truncation kills it for large docs)
2. Size/qty pairs from regex (`SM: 10, L: 20`)
3. CLIN-style blocks (`CLIN 0001 ...`)
4. Fallback: single row from project title

None of these handle the `4.x.x` SOW structure or the pricing spreadsheet.

### New strategy: `extract_sow_line_items(text)`

Parse the hierarchical `4.x.x` numbering pattern used in DHS/DoD SOW documents:

```python
def extract_sow_line_items(text: str) -> list[dict]:
    """
    Extract line items from SOW documents that use X.Y.Z section numbering.
    Handles patterns like:
      4.1.1 Smoke Canister for Training (Reduced Toxicity). This hand...
            Performance shall be equal to or better than Defense Technologies
            part number 1063, Saf-smoke Grenade.
    """
    items = []

    # Pattern: section number + title, capturing everything until next section or end
    # Matches: "4.1.1 Description Title." or "4.1.1. Description Title."
    section_pattern = re.compile(
        r"(4\.\d{1,2}\.\d{1,2})\s*\.?\s+"        # section number
        r"([A-Z][^\n.]+(?:\([^)]+\))?[^\n.]*)",   # title (may include parenthetical)
        re.MULTILINE
    )

    # Find all section headers
    matches = list(section_pattern.finditer(text))

    for i, m in enumerate(matches):
        section_num = m.group(1).strip()
        title = m.group(2).strip().rstrip(".")

        # Get the full body text between this match and the next
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else min(start + 2000, len(text))
        body = text[start:end]

        # Extract manufacturer part number reference
        part_m = re.search(
            r"(?:part\s+number|P/N|part\s+#)\s+(\d{3,6}[A-Z]*(?:[-/]\d+[A-Z]*)?)",
            body, re.IGNORECASE
        )
        part_number = part_m.group(1) if part_m else ""

        # Extract manufacturer name
        mfr_m = re.search(
            r"(?:equal to or better than)\s+([\w\s]+?)(?:\s+part\s+number|\s+P/N)",
            body, re.IGNORECASE
        )
        manufacturer = mfr_m.group(1).strip() if mfr_m else ""

        items.append({
            "sow_section": section_num,
            "description": title,
            "manufacturer_ref": manufacturer,
            "part_number": part_number,
            "unit": "EA",
            "qty": "N/A",         # quantities come from pricing spreadsheet
            "unit_price": "N/A",
        })

    return items
```

### Evaluation table parser (secondary source)

The evaluation table on pages 39-43 provides the authoritative, clean line item list:

```python
def extract_eval_table_items(text: str) -> list[dict]:
    """
    Extract line items from evaluation tables with pattern:
      4.1.1  Description Text  Pass/DQ
    """
    pattern = re.compile(
        r"(4\.\d{1,2}\.\d{1,2})\s+"
        r"(.+?)\s+"
        r"Pass/DQ",
        re.MULTILINE
    )
    items = []
    seen = set()
    for m in pattern.finditer(text):
        section = m.group(1).strip()
        if section in seen:
            continue
        seen.add(section)
        desc = re.sub(r"\s+", " ", m.group(2)).strip()
        items.append({
            "sow_section": section,
            "description": desc,
            "unit": "EA",
            "qty": "N/A",
            "unit_price": "N/A",
        })
    return items
```

### Pricing spreadsheet parser

```python
def extract_pricing_spreadsheet(filepath: str) -> list[dict]:
    """
    Parse pricing schedule XLSX files.
    Expected structure: SOW Section | Description | Part # | Unit Cost | Est Qty | Sub-Total
    across multiple pricing periods.
    """
    import pandas as pd
    df = pd.read_excel(filepath, header=None)

    items = []
    for _, row in df.iterrows():
        section = str(row.iloc[0]).strip() if pd.notna(row.iloc[0]) else ""
        desc = str(row.iloc[1]).strip() if pd.notna(row.iloc[1]) else ""

        # Skip header rows, category headers (no sub-items), and notes
        if not re.match(r"4\.\d+\.\d+", section):
            continue

        # Extract quantities from all pricing periods
        # Columns: 0=section, 1=desc, 2=part#, 3=unit_cost_p1, 4=est_qty_p1, 5=subtotal_p1, ...
        quantities = {}
        period_cols = [(4, "period_1"), (7, "period_2"), (10, "period_3"), (13, "period_4"), (16, "period_5")]
        for col_idx, period_name in period_cols:
            if col_idx < len(row) and pd.notna(row.iloc[col_idx]):
                try:
                    quantities[period_name] = int(float(row.iloc[col_idx]))
                except (ValueError, TypeError):
                    pass

        items.append({
            "sow_section": section,
            "description": desc,
            "part_number": str(row.iloc[2]).strip() if pd.notna(row.iloc[2]) else "",
            "unit": "EA",
            "quantities_by_period": quantities,
            "qty_period_1": quantities.get("period_1", "N/A"),
            "unit_price": "N/A",
        })

    return items
```

### Merge strategy

When multiple sources provide line items (SOW text, eval table, pricing spreadsheet), merge on `sow_section` as the join key:

```python
def merge_line_item_sources(
    sow_items: list[dict],
    eval_items: list[dict],
    pricing_items: list[dict]
) -> list[dict]:
    """
    Merge line items from SOW text, evaluation table, and pricing spreadsheet.
    Priority: pricing spreadsheet > eval table > SOW text
    Join key: sow_section (e.g., "4.1.1")
    """
    merged = {}

    # Base layer: SOW text (has specs, manufacturer refs)
    for item in sow_items:
        merged[item["sow_section"]] = {**item}

    # Middle layer: eval table (has clean descriptions)
    for item in eval_items:
        key = item["sow_section"]
        if key in merged:
            # Eval table descriptions are often cleaner
            if len(item["description"]) > 5:
                merged[key]["description"] = item["description"]
        else:
            merged[key] = {**item}

    # Top layer: pricing spreadsheet (has quantities, is authoritative)
    for item in pricing_items:
        key = item["sow_section"]
        if key in merged:
            if item.get("part_number"):
                merged[key]["part_number"] = item["part_number"]
            if item.get("quantities_by_period"):
                merged[key]["quantities_by_period"] = item["quantities_by_period"]
            if item.get("qty_period_1") != "N/A":
                merged[key]["qty"] = item["qty_period_1"]
        else:
            merged[key] = {**item}

    # Sort by section number
    def sort_key(section: str) -> tuple:
        parts = section.split(".")
        return tuple(int(p) for p in parts if p.isdigit())

    return [merged[k] for k in sorted(merged.keys(), key=sort_key)]
```

---

## Phase 4: Multi-Document Support

### Problem
Currently the parse endpoint accepts a single file. The LLSM solicitation requires:
- Main solicitation (SF-1449 + sections I/II/III) → header fields
- SOW attachment → line items with specs
- Pricing spreadsheet → quantities and pricing structure

### Solution: Multi-file parse endpoint

```
POST /api/sol-quoter/solicitations/parse
  → Multipart form: field "files" = one or more files (PDF, XLSX, DOCX, TXT, ZIP)
  → Runs extraction pipeline on each file
  → Correlates by solicitation number
  → Returns merged fields + line items + confidence
```

#### Backend flow:
```python
def parse_solicitation_bundle(files: list[UploadedFile]) -> dict:
    """
    Process multiple files as a single solicitation.
    1. Load each file with document_loader
    2. Detect which file is the main solicitation vs attachments
    3. Extract fields from main solicitation
    4. Extract line items from SOW and/or pricing files
    5. Merge everything
    """
    results = []
    for f in files:
        doc = load_document(f.path)
        doc_type = classify_document(doc.text, f.filename)
        results.append((doc, doc_type, f))

    # Classification heuristics:
    # - "pricing" or ".xlsx" → pricing spreadsheet
    # - "SOW" or "Statement of Work" in text → SOW attachment
    # - SF-1449 / main solicitation → primary document
    # - Everything else → supplementary

    main_doc = next((r for r in results if r[1] == "main"), None)
    sow_docs = [r for r in results if r[1] == "sow"]
    pricing_docs = [r for r in results if r[1] == "pricing"]

    # Extract header fields from main document
    fields = extract_data(main_doc[0].text) if main_doc else {}

    # Extract line items from all sources
    sow_items = []
    for doc, _, _ in sow_docs:
        sow_items.extend(extract_sow_line_items(doc.text))

    eval_items = extract_eval_table_items(main_doc[0].text) if main_doc else []

    pricing_items = []
    for _, _, f in pricing_docs:
        pricing_items.extend(extract_pricing_spreadsheet(f.path))

    # If no dedicated SOW doc, try extracting from main doc
    if not sow_items and main_doc:
        sow_items = extract_sow_line_items(main_doc[0].text)

    line_items = merge_line_item_sources(sow_items, eval_items, pricing_items)
    fields["line_items"] = line_items

    return fields
```

#### Document classification:
```python
def classify_document(text: str, filename: str) -> str:
    """Classify a document's role in a solicitation bundle."""
    fn_lower = filename.lower()

    if fn_lower.endswith((".xlsx", ".xls", ".csv")):
        return "pricing"
    if "pricing" in fn_lower or "attachment 2" in fn_lower.replace("_", " "):
        return "pricing"
    if "sow" in fn_lower or "statement of work" in fn_lower.replace("_", " "):
        return "sow"
    if "Statement of Work" in text[:500]:
        return "sow"

    # Check for main solicitation markers
    fmt = detect_format(text)
    if fmt != "unknown":
        return "main"

    # Check if it's a SOW by content
    if re.search(r"4\.\d+\.\d+\s+[A-Z]", text[:5000]):
        return "sow"

    return "supplementary"
```

---

## Phase 5: AI Extraction Improvements

### Current problem
`ai_extract()` truncates the full document to 14K characters (first 7K + last 7K). For a 150K+ character solicitation, this misses:
- All line items (they're in the middle)
- Section I schedule details
- Contact info (often on page 1 which is dense and >7K alone)

### Solution: Targeted section extraction

Instead of blind truncation, send the AI **structured sections**:

```python
def ai_extract_targeted(text: str, page_texts: list[str] | None = None) -> dict:
    """
    Send targeted document sections to AI for extraction.
    Much more accurate than blind truncation.
    """
    sections = []

    # Always include: first 2 pages (header/cover data)
    if page_texts and len(page_texts) >= 2:
        sections.append("=== COVER/HEADER (Pages 1-2) ===\n" + "\n".join(page_texts[:2]))
    else:
        sections.append("=== COVER/HEADER ===\n" + text[:4000])

    # Find and include Section I (schedule info)
    sec_i = re.search(r"(SECTION\s+I\s+SCHEDULES?.+?)(?=SECTION\s+II|\Z)", text, re.DOTALL | re.IGNORECASE)
    if sec_i:
        sections.append("=== SECTION I - SCHEDULE ===\n" + sec_i.group(1)[:3000])

    # Find and include evaluation table (line items)
    eval_m = re.search(r"(4\.1\.1.+?Pass/DQ.+?)(?=PRICE\s+EVALUATION|\Z)", text, re.DOTALL)
    if eval_m:
        sections.append("=== EVALUATION TABLE (LINE ITEMS) ===\n" + eval_m.group(1)[:5000])

    # Combine and ensure under token limit
    combined = "\n\n".join(sections)
    if len(combined) > 14000:
        combined = combined[:14000]

    # ... rest of AI call unchanged but using `combined` instead of truncated `text`
```

---

## Phase 6: Confidence Scoring

### Problem
The spec calls for `{ value, confidence: 0.0-1.0 }` per field. Current code returns raw values with no confidence scores.

### Solution: Heuristic confidence scoring

```python
def score_extraction(fields: dict, format_name: str) -> dict:
    """
    Assign confidence scores to extracted fields.
    Returns dict of field_name → { value, confidence }.
    """
    scored = {}
    for key, value in fields.items():
        if key.startswith("_") or key in ("scope_truncated", "scope_full"):
            continue

        confidence = 0.0

        if not value or value == "N/A":
            confidence = 0.0
        elif key == "solicitation_number":
            # High confidence if it looks like a proper solicitation number
            confidence = 0.95 if re.match(r"[A-Z0-9]{8,}", str(value)) else 0.5
        elif key == "contact_email":
            confidence = 0.9 if "@" in str(value) and "." in str(value) else 0.3
        elif key == "naics_code":
            confidence = 0.9 if re.match(r"\d{5,6}$", str(value)) else 0.4
        elif key == "due_date":
            confidence = 0.85 if re.search(r"\d{1,4}[-/]\d{1,2}[-/]\d{2,4}", str(value)) else 0.4
        elif format_name == "unknown":
            confidence = 0.4  # All fields from unknown format get lower confidence
        else:
            confidence = 0.75  # Default for known-format extractions

        scored[key] = {"value": value, "confidence": confidence}

    return scored
```

---

## Implementation Order

| Priority | Phase | Effort | Impact | Dependency |
|----------|-------|--------|--------|------------|
| **P0** | Phase 0: File handling | 1 day | Blocks everything for SAM.gov ZIPs | None |
| **P0** | Phase 1: Format detection | 0.5 day | Fixes misclassification | Phase 0 |
| **P1** | Phase 2: SF-1449 extractor | 1 day | Extracts header fields from DHS format | Phase 1 |
| **P1** | Phase 3: Line item extraction | 2 days | Core value: 100+ line items extracted | Phase 2 |
| **P1** | Phase 4: Multi-document support | 1.5 days | Enables SOW + pricing merge | Phase 3 |
| **P2** | Phase 5: AI improvements | 0.5 day | Better AI fallback accuracy | Phase 0 |
| **P2** | Phase 6: Confidence scoring | 0.5 day | UI flagging for review | Phase 2 |

**Total: ~7 days of focused implementation**

---

## Test Fixtures Required

| Fixture | File | Format | Status |
|---------|------|--------|--------|
| `70B06C26Q00000080.pdf` | DHS LLSM main solicitation | SAM.gov ZIP / SF-1449 | **New — in project** |
| `70B06C26Q00000080Attachment1LLSMSOW.pdf` | DHS LLSM SOW | SAM.gov ZIP / SOW | **New — in project** |
| `70B06C26Q00000080_Attachment_2-Pricing_Sheeet.xlsx` | DHS LLSM pricing | XLSX pricing schedule | **New — in project** |
| `36C24225Q0696.pdf` | VA electrical maintenance | Real PDF / agency_form | **Existing format — in project** |
| `W911S225U14310001_CSS_08062025.pdf` | Army ballistic vests | Real PDF / sam_export | **Existing format — in project** |
| `N5005426Q0114_CSS_03312026.pdf` | Navy fresh water parts | Real PDF / sam_export | **Existing format — in project** |
| `request-for-quotation.pdf` | FHWA laundry service | Real PDF / formal_rfq | **Existing format — in project** |

### Regression test strategy
1. Run all existing test fixtures through the new code — **zero regressions** before any new features.
2. Each new format gets its own fixture file and assertion set.
3. Line item count assertions: the LLSM solicitation should produce **exactly 99 line items** (4.1.1 through 4.10.9, excluding category headers like 4.1, 4.2, etc.).

---

## Architecture Notes

### What this plan does NOT change
- `docx_generator.py` — untouched
- Database schema — the `line_items` JSON structure is compatible
- Existing format extractors — `extract_sam_export`, `extract_agency_form`, `extract_formal_rfq` are preserved exactly
- The `extract()` alias — kept for backward compatibility

### What this plan adds
- `document_loader.py` — new module for file type detection and text extraction
- `extract_sf1449()` — new format-specific extractor
- `extract_sow_line_items()` — new SOW section parser
- `extract_eval_table_items()` — new evaluation table parser
- `extract_pricing_spreadsheet()` — new XLSX parser
- `merge_line_item_sources()` — multi-source line item merge
- `classify_document()` — document role classification
- `score_extraction()` — confidence scoring
- Multi-file parse endpoint update

### Future: Product database integration
The `sow_section` and `part_number` fields from line item extraction are the natural join keys for the product database. When a line item has `part_number: "1063"` and `manufacturer_ref: "Defense Technologies"`, the product DB lookup becomes:

```sql
SELECT * FROM products
WHERE manufacturer_part_number = '1063'
  AND manufacturer LIKE '%Defense Technologies%'
```

This is a clean interface boundary — the extractor produces structured line items, and the product DB enrichment happens at the API layer when building the quote.
