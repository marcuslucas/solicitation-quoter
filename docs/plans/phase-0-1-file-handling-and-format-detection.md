# Phase 0 + 1 Implementation Plan — File Handling & Format Detection

**Scope:** Phases 0 and 1 from `docs/extractor-overhaul-plan.md`  
**Target fixture:** `testdata/test_solicitations/70B06C26Q00000080/` (SAM.gov ZIP bundle, SF-1449 format)  
**Constraint:** Zero regressions on the 4 existing working PDFs

---

## Pre-Work Discovery: Critical Blocker in `server.py`

Before `parse_document()` is even reached, `validate_upload()` in `server.py` (line 57–58) explicitly rejects any `.pdf` file whose first 4 bytes are not `%PDF`:

```python
if fname.endswith('.pdf'):
    if header[:4] != b'%PDF':
        return "Unsupported file type — only PDF, DOCX, and TXT are accepted", 400
```

The SAM.gov ZIP bundle (`70B06C26Q00000080.pdf`) has magic bytes `PK\x03\x04` (ZIP). It is blocked at the HTTP layer and never reaches the extractor. **This must be fixed in Task 0.1 before anything else can run.**

---

## Files to Create or Modify

| Action   | Path                        | Purpose                                       |
|----------|-----------------------------|-----------------------------------------------|
| **New**  | `python/document_loader.py` | Magic-byte-aware file loader; ZIP bundle reader |
| **Modify** | `python/server.py`        | `validate_upload()` — allow ZIP magic bytes for `.pdf` |
| **Modify** | `python/extractor.py`     | `parse_document()` delegates to loader; `detect_format()` replaced with scoring; new `extract_sf1449()` added |

---

## Task 0.1 — `server.py`: Relax PDF magic-byte check

**File:** `python/server.py`  
**Function:** `validate_upload()` (lines 55–70)

### Change

The current check rejects any `.pdf` that isn't `%PDF`. Replace it with:

```
if fname.endswith('.pdf'):
    if header[:4] not in (b'%PDF', b'PK\x03\x04'):
        return "Unsupported file type — only PDF, DOCX, and TXT are accepted", 400
```

### Rationale

SAM.gov now delivers solicitations as ZIP archives with a `.pdf` extension. `b'PK\x03\x04'` is the ZIP local-file-header magic. DOCX files are also ZIPs but they arrive with `.docx` extension so the existing DOCX check (`header[:2] == b'PK'`) is unaffected.

### Regression safety

Real PDFs still begin with `%PDF` — they pass the check exactly as before. No other behavior in `validate_upload()` changes.

---

## Task 0.2 — New `python/document_loader.py`

This module owns all file-type detection and text extraction. `extractor.py` calls it; `server.py` never calls it directly.

### `DocumentResult` dataclass

```python
@dataclass
class DocumentResult:
    text: str
    """Reassembled full text of the document, ready for regex extraction."""

    page_count: int = 0
    """Number of pages (or ZIP entries) extracted."""

    source_format: str = "unknown"
    """Detected container format: 'pdf', 'sam_zip', 'docx', 'txt', 'unknown'."""

    has_images: bool = False
    """True if the source contains image files (JPEG/PNG pages in a ZIP)."""

    page_texts: list[str] = field(default_factory=list)
    """Per-page text strings. Index 0 = page 1. Enables targeted extraction."""

    error: str | None = None
    """Non-None if loading failed; text may be empty or partial."""
```

### `load_document(filepath: str) -> DocumentResult`

```python
def load_document(filepath: str) -> DocumentResult:
    """
    Detect the actual file type by magic bytes and extract text.

    Dispatch table:
      b'PK\\x03\\x04'  → _load_zip_bundle()   (SAM.gov ZIP or DOCX)
      b'%PDF'          → _load_pdf()
      .txt extension   → _load_text()
      anything else    → try _load_pdf(), then return error

    Never raises; errors are returned in DocumentResult.error.
    """
```

**Key design choice:** magic bytes take absolute precedence over file extension. A file named `.pdf` that starts with `PK` is a ZIP, not a PDF.

### `_load_pdf(filepath: str) -> DocumentResult`

```python
def _load_pdf(filepath: str) -> DocumentResult:
    """
    Extract text from a real PDF using pdfplumber (primary) then pypdf (fallback).

    Preserves per-page text in page_texts for downstream targeted extraction.
    Returns source_format='pdf'.
    On total failure returns DocumentResult(text='', error=<message>).
    """
```

Wraps the existing two-library fallback logic from `extractor.parse_pdf()` verbatim. No behavior change.

### `_load_zip_bundle(filepath: str) -> DocumentResult`

```python
def _load_zip_bundle(filepath: str) -> DocumentResult:
    """
    Handle ZIP archives that may be:
      (a) SAM.gov bundles: contain manifest.json + N.txt + N.jpeg per page
      (b) DOCX files: contain word/document.xml

    For SAM.gov bundles:
      - Read manifest.json to get num_pages
      - Read 1.txt, 2.txt, ... num_pages.txt in order
      - Join with double-newline separator to preserve page breaks
      - Set source_format='sam_zip', has_images=True if any *.jpeg present

    For DOCX:
      - Delegate to _load_docx(filepath)

    For unrecognized ZIPs:
      - Return DocumentResult(text='', error='ZIP archive without recognized structure')
    """
```

**SAM.gov manifest.json structure** (observed in `70B06C26Q00000080.pdf`):
```json
{ "num_pages": N, ... }
```
Files inside the ZIP are named `1.txt`, `2.txt`, …, `N.txt` and `1.jpeg`, `2.jpeg`, …, `N.jpeg`.

**Error handling:** If `manifest.json` is present but a page text file is missing, skip that page and continue (don't crash). Log the gap with `print()`.

### `_load_docx(filepath: str) -> DocumentResult`

```python
def _load_docx(filepath: str) -> DocumentResult:
    """
    Extract text from a DOCX file using python-docx.
    Extracts paragraph text and table cell text (pipe-separated rows).
    Returns source_format='docx'.
    """
```

Wraps the existing `extractor.parse_docx()` logic verbatim.

### `_load_text(filepath: str) -> DocumentResult`

```python
def _load_text(filepath: str) -> DocumentResult:
    """
    Read a plain-text file as UTF-8 (errors='ignore').
    Returns source_format='txt', page_count=1.
    """
```

---

## Task 0.3 — `extractor.py`: Delegate `parse_document()` to loader

**File:** `python/extractor.py`  
**Function:** `parse_document()` (lines 42–48)

### Change

Replace the current extension-switch implementation with a thin delegation:

```python
def parse_document(filepath: str) -> str:
    """
    Extract text from a document file.

    Delegates to document_loader.load_document() which detects actual file
    type by magic bytes (not extension). Returns the full text string.
    Raises ValueError if the file format is not supported and no text
    could be extracted.
    """
    from document_loader import load_document
    result = load_document(filepath)
    if result.error and not result.text.strip():
        raise ValueError(result.error)
    return result.text
```

**Backward compatibility:** Return type remains `str`. All callers (`server.py`, `testdata/run.py`) use it as `text = parse_document(path)` — no change needed upstream.

**Import note:** `document_loader` is a sibling module in `python/`. The lazy `from document_loader import load_document` inside the function body avoids circular import risk and keeps the module importable without `document_loader.py` present (graceful degradation during partial deployment).

---

## Task 1.1 — `extractor.py`: Replace `detect_format()` with scoring

**File:** `python/extractor.py`  
**Function:** `detect_format()` (lines 53–62)

### New signature

```python
def detect_format(text: str) -> str:
    """
    Identify the solicitation format by scoring multiple fingerprint patterns.

    Formats scored:
      'sam_export'  — SAM.gov structured notice export
      'agency_form' — VA/agency combined synopsis form (SOLICITATION NUMBER*)
      'formal_rfq'  — Formal RFQ with cover page + SECTION A/B/C/D/E
      'sf1449'      — SF-1449 Solicitation/Contract/Order for Commercial Products

    Returns the format name with the highest score if score >= 3, else 'unknown'.
    Scoring beats first-match cascades when multiple formats share keywords
    (e.g. 'SOLICITATION NUMBER' appears in both agency_form and sf1449).
    """
```

### Scoring table

| Signal | Format | Points | Search window |
|--------|--------|--------|---------------|
| `"Notice ID:"` | sam_export | 3 | first 2000 chars |
| `"Combined Synopsis/Solicitation Details"` | sam_export | 2 | first 2000 chars |
| `"Primary Contact Name:"` | sam_export | 1 | first 5000 chars |
| `"Notice Details"` | sam_export | 1 | first 5000 chars |
| `SOLICITATION NUMBER\*` (regex, asterisk literal) | agency_form | 3 | first 2000 chars |
| `"POINT OF CONTACT*"` | agency_form | 2 | full text |
| `"RESPONSE DATE/TIME/ZONE"` | agency_form | 1 | first 2000 chars |
| `"Issuing Office:"` | formal_rfq | 3 | first 2000 chars |
| `\bSECTION\s+[A-E]\b` (regex) | formal_rfq | 2 | full text |
| `"Quotation Due Date:"` | formal_rfq | 1 | first 2000 chars |
| `"STANDARD FORM 1449"` | sf1449 | 3 | first 5000 chars |
| `"Solicitation/Contract/Order for Commercial"` | sf1449 | 3 | first 2000 chars |
| `SECTION\s+I\s+SCHEDULES` (regex) | sf1449 | 2 | full text |
| `SECTION\s+II\s+CONTRACT\s+CLAUSES` (regex) | sf1449 | 2 | full text |
| `"SCHEDULE OF SUPPLIES/SERVICES"` | sf1449 | 1 | first 2000 chars |

**Decision rule:** `best = max(scores, key=scores.get)`. If `scores[best] >= 3`, return `best`. Otherwise return `"unknown"`.

### Why the threshold is 3

A score of 3 requires at least one strong signal (a 3-point fingerprint). Single-point matches on common words can't trigger a format alone. This prevents false positives on cover letters or attachments.

### Regression check for existing formats

| Fixture | Dominant signal | Expected winner |
|---------|----------------|-----------------|
| W911S225U14310001 | `"Notice ID:"` (+3) | sam_export |
| N5005426Q0114 | `"Notice ID:"` (+3) | sam_export |
| 36C24225Q0696 | `SOLICITATION NUMBER\*` (+3) | agency_form |
| request-for-quotation | `"Issuing Office:"` (+3) | formal_rfq |
| 70B06C26Q00000080 | `"STANDARD FORM 1449"` (+3) | sf1449 |

No existing fixture triggers `sf1449` scoring: none contain `"STANDARD FORM 1449"`, `"Solicitation/Contract/Order for Commercial"`, or Roman-numeral section headings.

---

## Task 1.2 — `extractor.py`: Add `extract_sf1449()` and wire into `extract_data()`

**File:** `python/extractor.py`

### New function signature

```python
def extract_sf1449(text: str) -> dict:
    """
    Extract fields from SF-1449 Solicitation/Contract/Order for Commercial Products.

    Fingerprint: 'STANDARD FORM 1449' or 'Solicitation/Contract/Order for Commercial'
    Structure: Numbered blocks (5=sol#, 6=issue date, 7=contact, 8=due date, 9=issuing
    office, 10=set-aside/NAICS) on page 1, then SECTION I / II / III with Roman numerals.

    The 70B06C26Q00000080 fixture is a SAM.gov ZIP bundle — text is reassembled from
    per-page OCR. Block labels may appear on lines by themselves followed by the value.
    All patterns use re.IGNORECASE | re.MULTILINE.

    Returns a dict of extracted fields (keys with empty/None values are omitted).
    Field names match the canonical schema used by all other extractors.
    """
```

### Fields to extract and their patterns

The patterns below are starting points derived from the overhaul plan plus the expected output schema. They will require tuning against actual OCR text during implementation — treat as initial candidates, not final regex.

| Field (canonical key) | Expected value from fixture | Source block / section | Initial pattern approach |
|----------------------|----------------------------|------------------------|--------------------------|
| `solicitation_number` | `70B06C26Q00000080` | Block 5 | `(?:5\.\s*)?SOLICITATION\s*NUMBER\s*\n?\s*([A-Z0-9]{10,})` |
| `project_title` | `Less Lethal Specialty Munitions (LLSM) IDIQ` | Schedule line or title | `(?:Subject\|Title)[:\s]+(.+?)(?:\n\|$)` or schedule description |
| `solicitation_type` | `RFP` | Block 14 or checked box | `METHOD OF SOLICITATION\s*\n?\s*(RFQ\|IFB\|RFP)` |
| `issuing_agency` | `DHS - Customs & Border Protection, Mission Support Contracting Division` | Block 9 / ISSUED BY | Multi-line block after `ISSUED BY CODE`, join first 2–3 org lines |
| `due_date` | `05/15/2026 2:00PM ET` | Block 8 / OFFER DUE | `OFFER\s+DUE\s+DATE.*?(\d{2}/\d{2}/\d{4}\s*\d{1,2}:\d{2}\s*[AP]M\s*\w+)` |
| `posting_date` | `04/15/2026` | Block 6 / ISSUE DATE | `(?:ISSUE\s+DATE\|SOLICITATION\s+ISSUE\s+DATE)\s*\n?\s*(\d{2}/\d{2}/\d{4})` |
| `contact_name` | `Crockett, John` | Block 7 / FOR SOLICITATION | Name line before or near email; allow `Last, First` format |
| `contact_email` | `john.t.crockett@cbp.dhs.gov` | Block 7 | Standard email regex anchored near block 7 label |
| `naics_code` | `332994` | Block 10 | `NAICS[:\s]*\n?\s*(\d{5,6})` |
| `set_aside` | `Small Business Set-Aside 100%` | Block 10 / set-aside | `(\d+)\s*%\s*(?:Small\s+Business\|SB)` or labeled checkbox |
| `period_of_performance` | `5 year ordering period from date of award, delivery orders may require delivery up to 12 months beyond last day of ordering period` | Section I or description | Prose match on `ordering period` |
| `estimated_value` | `$49,900,000.00` | Section I / maximum amount | `[Mm]aximum\s+(?:amount\|value)[^\$]*\$\s*([\d,\.]+)` |
| `contract_type` | `IDIQ with Firm Fixed Price delivery orders` | Section I/II | `(indefinite\s+delivery.indefinite\s+quantity\|ID/IQ\|IDIQ)` |
| `minimum_guarantee` | `$10,000.00` | Section I | `[Mm]inimum\s+(?:guarantee\|order)[^\$]*\$\s*([\d,\.]+)` |
| `scope_of_work` | `Acquisition of Distraction Devices...` | Section I or description block | `_scope_block()` applied to Section I prose |

**`minimum_guarantee` is a new field** not in the existing canonical schema. It must be passed through `extract_data()` and surfaced in the response — no schema migration needed since the response is a plain dict.

### Wiring into `extract_data()`

```python
# In extract_data(), after the existing elif chain:
elif format_name == "sf1449":
    d = extract_sf1449(text)
```

Insert between `formal_rfq` and the `else: d = {}` branch. No other changes to `extract_data()`.

---

## Regression Test Plan

### Mechanism

Use `testdata/run.py` as the test driver. For each fixture with an `_expected_output.json`, run extraction and diff the result against expected values.

Add a new `--compare` flag (or a separate `test_regression.py` script) that:
1. Calls `parse_document(pdf_path)` → `extract_data(text)`
2. Loads `_expected_output.json`
3. For each key in expected output, checks extracted value matches (string equality, case-insensitive, stripped)
4. Reports PASS / FAIL per field and overall

### Fixtures with expected output (must PASS after changes)

| Fixture directory | PDF | Expected output file | Format detected |
|-------------------|-----|---------------------|-----------------|
| `36C24225Q0696` | `36C24225Q0696.pdf` (real PDF, `%PDF` magic) | `36C24225Q0696_expected_output.json` | `agency_form` |
| `70B06C26Q00000080` | `70B06C26Q00000080.pdf` (ZIP magic `PK`) | `70B06C26Q00000080_expected_output.json` | `sf1449` |

### Fixtures without expected output (smoke test — must not crash or regress)

| Fixture | Format | Smoke test criteria |
|---------|--------|---------------------|
| `W911S225U14310001_CSS_08062025` | `sam_export` | `solicitation_number` extracted, no exception |
| `N5005426Q0114_CSS_03312026` | `sam_export` | `solicitation_number` extracted, no exception |
| `request-for-quotation` | `formal_rfq` | `solicitation_number` extracted, no exception |

### Regression assertion for `36C24225Q0696`

The following fields must match the expected output exactly (after stripping whitespace):

```
solicitation_number  → "36C24225Q0696"
title                → "FY25 Service (Base + 2) - WNY Electrical Distribution Maintenance - 528/528A4"
type                 → "RFQ"
agency               → "Department of Veterans Affairs"
due_date             → "07-18-2025 12:00 EASTERN TIME"
contact_name         → "Nathan Northrup"
contact_email        → "nathan.northrup@va.gov"
naics_code           → "811310"
psc_code             → "J061"
set_aside            → "Total Small Business Set-Aside"
```

Fields `posting_date`, `contact_phone`, `place_of_performance`, `period_of_performance`, `estimated_value` are allowed to vary (they were gaps before Phase 10; do not regress fields that were already passing).

---

## New Test Cases: ZIP Bundle Format (`70B06C26Q00000080`)

### Test 1: `document_loader` correctly identifies ZIP magic bytes

**Input:** `70B06C26Q00000080.pdf`  
**Expected:** `DocumentResult.source_format == "sam_zip"`  
**Expected:** `DocumentResult.text` is non-empty (several thousand characters)  
**Expected:** `DocumentResult.page_texts` has `len >= 1`  
**Expected:** `DocumentResult.error is None`

### Test 2: `detect_format()` returns `"sf1449"` for assembled text

**Input:** The `text` string assembled by `_load_zip_bundle()`  
**Expected:** `detect_format(text) == "sf1449"`  
**Boundary:** Score for `sf1449` must be `>= 3`; score for all other formats must be `< score["sf1449"]`

### Test 3: Header field extraction matches expected output

**Input:** `70B06C26Q00000080.pdf` → full pipeline  
**Expected:** The following fields match `70B06C26Q00000080_expected_output.json`:

```
solicitation_number  → "70B06C26Q00000080"
title                → "Less Lethal Specialty Munitions (LLSM) IDIQ"
type                 → "RFP"
agency               → "DHS - Customs & Border Protection, Mission Support Contracting Division"
due_date             → "05/15/2026 2:00PM ET"
posting_date         → "04/15/2026"
contact_name         → "Crockett, John"
contact_email        → "john.t.crockett@cbp.dhs.gov"
naics_code           → "332994"
set_aside            → "Small Business Set-Aside 100%"
period_of_performance → "5 year ordering period from date of award, delivery orders may require delivery up to 12 months beyond last day of ordering period"
estimated_value      → "$49,900,000.00"
contract_type        → "IDIQ with Firm Fixed Price delivery orders"
minimum_guarantee    → "$10,000.00"
```

Fields `psc_code` and `place_of_performance` are `null` in the expected output — extraction returning empty string or absent key is acceptable.

### Test 4: `validate_upload()` no longer rejects the ZIP bundle

**Input:** POST `/parse` with `70B06C26Q00000080.pdf`  
**Expected:** HTTP response is NOT 400  
**Expected:** Response body `success == true` with non-empty `data`

### Test 5: SOW attachment also loads correctly (smoke)

**Input:** `70B06C26Q00000080+Attachment+1+-+LLSM+SOW.pdf`  
**Expected:** `DocumentResult.source_format == "sam_zip"`, non-empty text  
**Expected:** Text contains section headers matching `4.\d.\d` pattern (line items present in OCR)

---

## Expected Output Schema

All extractor functions return a flat `dict[str, Any]`. The canonical field names are:

```python
{
    # Identity
    "solicitation_number": str,
    "project_title":       str,
    "solicitation_type":   str,   # "RFQ", "RFP", "IFB", etc.
    "_format":             str,   # "sam_export" | "agency_form" | "formal_rfq" | "sf1449" | "unknown"
    "_method":             str,   # "rules" | "ai+rules"

    # Parties
    "issuing_agency":               str,
    "contracting_office_address":   str,
    "contact_name":                 str,
    "contact_email":                str,
    "contact_phone":                str,

    # Dates
    "due_date":     str,
    "posting_date": str,

    # Classification
    "naics_code": str,
    "psc_code":   str,
    "set_aside":  str,

    # Terms
    "place_of_performance":  str,
    "period_of_performance": str,
    "estimated_value":       str,
    "contract_type":         str,
    "minimum_guarantee":     str,  # new field; present for sf1449 only

    # Scope
    "scope_of_work":   str,
    "scope_truncated": bool,
    "scope_full":      str,   # only present when scope_truncated=True

    # Items (populated by extract_line_items(), not extract_data())
    "quantities":     list[dict],  # [{"size": str, "qty": str}]
    "ai_line_items":  list[dict],  # present only when AI extraction ran
}
```

Keys with empty string, `None`, or empty list values are omitted from the returned dict (enforced by the `{k: v for k, v in d.items() if v not in ("", [], None)}` guard at the end of each extractor function — maintain this pattern in `extract_sf1449()`).

---

## Acceptance Criteria

### Phase 0 complete when:

- [ ] `70B06C26Q00000080.pdf` reaches `parse_document()` without being rejected by `validate_upload()` (no HTTP 400)
- [ ] `parse_document("70B06C26Q00000080.pdf")` returns a non-empty string (not `""`)
- [ ] `DocumentResult.source_format` is `"sam_zip"` for the fixture
- [ ] All 4 existing PDF fixtures still return non-empty text (no regression in `parse_document`)
- [ ] No existing test raises an exception that wasn't raised before

### Phase 1 complete when:

- [ ] `detect_format(text_from_70B)` returns `"sf1449"`
- [ ] `detect_format` returns the same format as before for all 4 existing fixtures (confirmed by smoke tests)
- [ ] `extract_data(text_from_70B)["_format"] == "sf1449"`
- [ ] `extract_data(text_from_70B)["solicitation_number"] == "70B06C26Q00000080"`
- [ ] All fields listed in Test 3 above match the expected output (case-insensitive, stripped)
- [ ] `extract_data` for the 3 sam_export fixtures still returns `solicitation_number` without regression
- [ ] `extract_data` for `36C24225Q0696` still matches all fields listed in the regression assertion above

---

## Implementation Order

Execute tasks in this strict sequence — each task unblocks the next:

1. **Task 0.1** (`server.py`) — unblocks the HTTP layer so the ZIP file reaches the backend
2. **Task 0.2** (`document_loader.py`) — new module; no existing code changes until tested
3. **Task 0.3** (`extractor.py: parse_document`) — thin delegation; verify existing PDFs still work
4. **Task 1.1** (`extractor.py: detect_format`) — scoring replacement; run all 5 fixtures to confirm format detection
5. **Task 1.2** (`extractor.py: extract_sf1449`) — new extractor; iterate against expected output until all fields pass

Run the regression suite after each task before proceeding to the next.

---

## Out of Scope for This Plan

- Phase 2 (SF-1449 line item extraction / `extract_sow_line_items`)  
- Phase 3 (XLSX pricing spreadsheet parser)  
- Phase 4 (multi-document parse endpoint)  
- Phase 5 (AI extraction improvements)  
- Phase 6 (confidence scoring)  
- Changes to `generator.py`, `validator.py`, or any frontend files  
- The SOW attachment and pricing spreadsheet are present in the test fixture directory but are not processed by this plan — they are inputs for Phase 2+

The `70B06C26Q00000080_expected_line_items.json` fixture (99 items) is the acceptance target for Phase 2, not this plan.
