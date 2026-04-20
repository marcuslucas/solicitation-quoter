# Phase 5 — Test Coverage Expansion Plan

**Status:** Planning  
**Scope:** run.py harness improvements, expected output schema, fixture onboarding  
**No production code changes in this phase** unless regressions surface

---

## Part 1 — Diagnostic Answers

### 1. What does run.py currently do?

**Fixture discovery:** None. run.py processes exactly one solicitation at a time. It has no concept of iterating fixtures. The `--solicitation` flag defaults to `testdata/solicitation.txt`. There is no code that scans `testdata/test_solicitations/`.

**What it runs per file:**
1. `parse_document(sol_path)` → raw text (handles PDF/DOCX/TXT via pdfplumber/pypdf/docx)
2. `extract_data(text, api_key)` → field dict (calls detect_format, routes to the right extractor)
3. If `quote_input.json` has real items: uses those; else calls `extract_line_items(solicitation, text)`
4. `generate_quote(solicitation, vendor, line_items)` → DOCX bytes
5. Saves `.docx` to `testdata/output/`

**Pass/fail:** There is none. The only early-exit is `if not text.strip(): sys.exit(1)`. No comparison against expected output of any kind.

**Output:** Prints extraction method, solicitation number, project title, due date, line item count (if extracted). Saves DOCX. No structured result.

**Exit code on failure:** Only exits non-zero (code 1) if text extraction returns empty. A wrong solicitation number, a missing due_date, zero line items when dozens are expected — none of these cause a non-zero exit. There is no CI-usable exit code.

---

### 2. Current `_expected_output.json` structure

Three fixtures have expected output files. None follow the `_expected_output.json` naming convention — all use `[number]_expected_output.json`. Example (36C24225Q0696):

```json
{
  "solicitation_number": "36C24225Q0696",
  "title": "FY25 Service (Base + 2) - WNY Electrical Distribution Maintenance - 528/528A4",
  "type": "RFQ",
  "agency": "Department of Veterans Affairs",
  "due_date": "07-18-2025 12:00 EASTERN TIME",
  "posting_date": null,
  "contact_name": "Nathan Northrup",
  "contact_email": "nathan.northrup@va.gov",
  "contact_phone": null,
  "naics_code": "811310",
  "psc_code": "J061",
  "set_aside": "Total Small Business Set-Aside",
  "place_of_performance": "Buffalo VA Medical Center, 3495 Bailey Avenue...",
  "period_of_performance": "Base year from date of award plus 2 option years",
  "estimated_value": "$12.5 Million (small business size standard)",
  "scope_of_work": "Firm fixed-price service contract..."
}
```

Missing from all existing files: `format`, `line_item_count`, `line_items_sample`, `required_fields`.

---

### 3. Fixtures currently in testdata/test_solicitations/

| Directory | Has expected output? | Notes |
|-----------|---------------------|-------|
| `18Q0042` | No | Single PDF only |
| `36C24225Q0696` | Yes — `36C24225Q0696_expected_output.json` | agency_form format |
| `70B06C26Q00000080` | Yes — `70B06C26Q00000080_expected_output.json` | sf1449 + SOW + XLSX bundle |
| `N5005426Q0114_CSS_03312026` | No | Single PDF only |
| `request-for-quotation` | Yes — `request-for-quotation_expected_output.json` | formal_rfq |
| `W911S225U14310001_CSS_08062025` | No | Single PDF only |

---

### 4. Which fixtures have expected output files?

With expected output: **36C24225Q0696**, **70B06C26Q00000080**, **request-for-quotation**  
Without expected output: **18Q0042**, **N5005426Q0114_CSS_03312026**, **W911S225U14310001_CSS_08062025**

**Naming inconsistency:** All three existing files use `[number]_expected_output.json` not `_expected_output.json`. The harness needs to handle both patterns (or we standardize — see Part 2).

---

### 5. What fields does run.py currently validate?

**Zero.** run.py never reads any `_expected_output.json` file. It does not compare any extracted field against any expected value. `line_item_count` and `required_fields` are not checked anywhere.

---

### 6. `extract_data()` call signature and what it expects

```python
def extract_data(text, api_key=""):
```

It expects **pre-extracted text**, not a file path. run.py calls `parse_document(filepath)` first to get text, then passes that text to `extract_data()`. The full pipeline:

```python
text = parse_document(str(sol_path))   # file path → raw string
solicitation = extract_data(text, api_key=args.api_key)  # raw string → dict
```

`parse_document` handles PDF (pdfplumber → pypdf fallback), DOCX (python-docx), and plain text. There is no file-path-aware extraction — the extractor only sees text.

---

## Part 2 — run.py Improvements

### 2a. `--fixture` argument

Add a `--fixture <DIRNAME>` argument that runs a single fixture from `testdata/test_solicitations/`:

```
python testdata/run.py --fixture 70B06C26Q00000080
python testdata/run.py --fixture request-for-quotation
```

When `--fixture` is given:
- Look up `testdata/test_solicitations/<FIXTURE>/`
- Find all PDFs/DOCXs/XLSXs in the directory
- Route them through the same parse logic as the "run all" mode
- Report pass/fail for that single fixture

When `--fixture` is not given, scan all subdirectories and run all fixtures that have an expected output file. Fixtures without expected output are skipped (with a warning printed).

**Backward compatibility:** The existing `--solicitation` + `--input` flow for generating a single DOCX should still work unchanged. Add a branch: if `--fixture` is given, run fixture validation mode; otherwise fall through to the existing generation path.

---

### 2b. Expected output file discovery

The harness needs to find expected output files. Two naming conventions exist:
- `_expected_output.json` (planned standard — underscore prefix, no fixture name)
- `[fixture_name]_expected_output.json` (what the three existing files actually use)

**Decision:** Support both. For each fixture directory, look for:
1. `_expected_output.json` first (new standard)
2. `[dirname]_expected_output.json` as fallback (existing files)

This avoids renaming existing files and allows new fixtures to use the simpler `_expected_output.json` name.

---

### 2c. Multi-file bundle detection

For fixtures with multiple files (like 70B06C26Q00000080), the harness needs to call `parse_solicitation_bundle()` rather than `extract_data()` directly.

**Detection logic:**
- If directory contains exactly one PDF/DOCX/TXT: call `parse_document` → `extract_data`
- If directory contains multiple files (any combination of PDF/DOCX/XLSX): call `parse_solicitation_bundle` with all non-JSON/non-PNG files

Import `parse_solicitation_bundle` from `server.py` the same way `parse_document` and `extract_data` are currently imported.

---

### 2d. Per-fixture validation and reporting

For each fixture with an expected output file, validate:

**Scalar fields:** For each key in expected output that has a non-null value, compare with extracted value. Report:
- PASS: exact match (after stripping whitespace)
- PARTIAL: extracted value contains expected value as a substring (acceptable for long text like scope_of_work)
- FAIL: value is null/empty when expected is non-null, or strings don't match

**`format` field:** If present in expected output, compare `extracted["_format"]` against it. A wrong format detection is a critical failure and should be flagged prominently.

**`line_item_count`:** If present in expected output, compare `len(extracted.get("line_items", []))` against it. Report count vs expected, flag if difference > 5.

**`required_fields` list:** For each field name in the list, check that the extracted value is non-null and non-empty. Report each missing field by name.

**`line_items_sample`:** For each sample item, verify at least one extracted line item matches on `sow_section` (or `description` if `sow_section` absent). Report which sample items were not found.

---

### 2e. Output format

Per-fixture block:
```
─────────────────────────────────────────
FIXTURE: 70B06C26Q00000080
  Format detected : sf1449 ✓
  Fields: 12/14 matched
    FAIL  due_date         → got "05/15/2026 2:00PM ET"  expected "05/15/2026 2:00PM ET"
    FAIL  contact_phone    → got null                    expected "(555) 123-4567"
  Line items: 118 extracted, expected 118 ✓
  Required fields: solicitation_number ✓  due_date ✓  contact_email ✓  naics_code ✓
  Result: PASS (1 warning)
─────────────────────────────────────────
```

End-of-run summary:
```
══════════════════════════════════════════
SUMMARY: 3 fixtures run
  PASS: 2
  FAIL: 1 (36C24225Q0696)
══════════════════════════════════════════
```

---

### 2f. Exit code behavior

| Condition | Exit code |
|-----------|-----------|
| All fixtures pass (or pass with warnings) | 0 |
| Any fixture has at least one FAIL | 1 |
| No fixtures found / no expected output files | 2 |
| Import error / crash | 1 |

Exit code 1 on any failure enables future `if python testdata/run.py; then ...` CI usage.

---

### 2g. Argument matrix (complete)

```
python testdata/run.py
    → Run all fixtures with expected output files. Exit 0/1.

python testdata/run.py --fixture 70B06C26Q00000080
    → Run single fixture. Exit 0/1.

python testdata/run.py --solicitation path/to/file.pdf
    → Original generation mode. Saves DOCX. Exit 0 on success.

python testdata/run.py --solicitation path/to/file.pdf --input path/to/vendor.json
    → Original generation mode with custom vendor data.

python testdata/run.py --api-key sk-ant-...
    → Original generation mode with AI extraction.
```

---

## Part 3 — New `_expected_output.json` Schema

### 3a. Full schema

```json
{
  "_schema_version": 2,
  "format": "sam_export|agency_form|formal_rfq|sf1449|unknown",
  "solicitation_number": "...",
  "title": "...",
  "type": "RFQ|RFP|...",
  "agency": "...",
  "due_date": "...",
  "posting_date": "...",
  "contact_name": "...",
  "contact_email": "...",
  "contact_phone": "...",
  "naics_code": "...",
  "psc_code": "...",
  "set_aside": "...",
  "place_of_performance": "...",
  "period_of_performance": "...",
  "estimated_value": "...",
  "scope_of_work": "...",
  "line_item_count": 0,
  "line_items_sample": [
    {
      "sow_section": "4.1.1",
      "description": "Smoke Canister for Training",
      "_source": "SOW+XLSX"
    }
  ],
  "required_fields": [
    "solicitation_number",
    "due_date",
    "contact_email",
    "naics_code"
  ],
  "notes": "Free-text notes about format quirks, extraction decisions, known partial matches"
}
```

### 3b. Field classification

**Required in every expected output file:**
- `_schema_version` — set to 2 for all new files; omit for existing files (harness treats absent = v1)
- `format` — the correct format string. Critical: if the extractor detects the wrong format, everything else will be wrong.
- `solicitation_number` — the canonical identifier
- `required_fields` — list of fields the harness must confirm are non-null

**Include when known, null when genuinely absent from the document:**
- `title`, `type`, `agency`, `due_date`, `posting_date`
- `contact_name`, `contact_email`, `contact_phone`
- `naics_code`, `psc_code`, `set_aside`
- `place_of_performance`, `period_of_performance`, `estimated_value`
- `scope_of_work` — include the first 200 chars; harness uses substring match

**Line item fields:**
- `line_item_count` — exact count; harness allows ±5 tolerance (±3 for small counts < 20)
- `line_items_sample` — 3–5 representative items. Include one from the beginning, one from the middle, one from the end of the list. Each sample item needs at minimum `sow_section` or `description`. Include `_source` if the document has both SOW and XLSX.

**Metadata:**
- `notes` — mandatory. At minimum one sentence about the format and any known extraction quirks. This is what makes the fixture useful for debugging regressions.

### 3c. `required_fields` default and overrides

The default required fields for every fixture are:
```json
["solicitation_number", "due_date", "contact_email", "naics_code"]
```

Override for specific formats:
- `agency_form`: also require `contact_name`
- `sf1449`: also require `naics_code`, `set_aside`
- Fixtures without line items (service contracts, etc.): do not add `line_item_count` to required_fields — just omit or set to 0

### 3d. Null policy

Set a field to `null` in expected output when the field is genuinely absent from the document (not just not extracted yet). This distinguishes "the document doesn't have a phone number" from "we haven't written the extractor for phone numbers." The harness skips null fields in expected output — it only validates non-null expected values.

---

## Part 4 — SAM.gov Search Queries

These are precise search queries for SAM.gov (sam.gov/search). Search under "Contract Opportunities." For each, set **Status = Active** and **Posted date = Last 2 years**.

### Profile 1 — DoD supply contract with 30+ CLINs and XLSX pricing

**Why:** Tests CLIN-numbered line items (0001, 0002, AA, AB) vs SOW 4.x.x numbering.

```
Search query: "CLIN" AND "pricing schedule" AND "attachment"
Agency filter: Department of Defense
Type: Solicitation
NAICS: 332994 OR 336992 OR 345 (defense equipment)
```

Also try:
```
"contract line item number" "Microsoft Excel" site:sam.gov
```

Look for: Army Contracting Command, NAVSUP, or DLA solicitations with a separate "Pricing Schedule.xlsx" attachment, 20+ CLINs, awarded/active in 2024-2025.

---

### Profile 2 — VA medical supplies with size/qty matrix

**Why:** Tests size-based quantity tables (S/M/L/XL columns), different agency and NAICS.

```
Search query: "medical supplies" "size" "quantity"
Agency filter: Department of Veterans Affairs
Type: Solicitation
NAICS: 339112 OR 423450 (medical equipment/supplies)
```

Also try:
```
"statement of work" "size matrix" "per size" agency:"VA"
```

Look for: VA National Acquisition Center solicitations with a separate SOW attachment that has a table of sizes and quantities.

---

### Profile 3 — GSA IT hardware with multiple attachments

**Why:** Tests multiple SOW-style attachments, possible format variant (SF-1449 with PWS vs SOW), larger item counts.

```
Search query: "performance work statement" "IT hardware" "attachment"
Agency filter: General Services Administration
Type: Solicitation
NAICS: 334111 OR 334118 (computer hardware)
```

Also try:
```
"schedule of deliverables" "section C" "section L" site:sam.gov GSA IT equipment
```

Look for: GSA solicitations with 3+ attachments (main SF-1449, PWS/SOW, pricing sheet), NAICS 33411x, posted 2024-2025.

---

### Profile 4 — DHS/CBP law enforcement equipment (different from LLSM)

**Why:** Same agency and format as 70B06C26Q00000080. Tests SF-1449 robustness across different CBP product categories.

```
Search query: "CBP" OR "Customs and Border Protection" "statement of work"
Agency filter: Department of Homeland Security
Type: Solicitation
NAICS: 332994 OR 339999 OR 334290 (law enforcement equipment)
```

Also try:
```
site:sam.gov "70B0" solicitation "attachment" "pricing"
```

Look for: Any CBP/DHS solicitation with a separate SOW PDF and pricing XLSX, different CLIN/item numbering than 4.x.x, posted 2024-2026.

---

### Profile 5 — Army clothing/uniform with size breakdown

**Why:** Confirms sam_export format with size matrix still works on a different solicitation than W911S225U14310001.

```
Search query: "clothing" OR "uniform" "sizes" "Army"
Agency filter: Department of Defense / Army
Type: Solicitation
NAICS: 315210 OR 315280 (apparel manufacturing)
```

Also try:
```
"W911S" site:sam.gov uniform solicitation 2024 2025
```

Look for: Army Contracting Command solicitations for uniforms or clothing with size breakdown tables (S/M/L/XL/XXL), preferably SAM.gov notice export format with "Notice ID:" in the header.

---

## Part 5 — Fixture Onboarding Process

### When you have a solicitation number but no files yet

1. Go to sam.gov → Contract Opportunities → search the solicitation number
2. Download all attachments: main solicitation, any SOW/PWS, any pricing XLSX
3. Create directory: `testdata/test_solicitations/[SOLICITATION_NUMBER]/`
4. Place all downloaded files there with their original filenames

### Step-by-step fixture addition

**Step 1 — Run a dry extraction:**
```
python testdata/run.py --solicitation testdata/test_solicitations/[NUMBER]/[MAIN].pdf
```
If it's a bundle, add the `--solicitation` path and observe what gets printed. For bundles, temporarily add a `parse_solicitation_bundle` call to see the full output.

**Step 2 — Capture raw extraction output:**
```python
# Quick one-off in python/ directory:
import sys; sys.path.insert(0, '.')
from server import parse_document, extract_data
text = parse_document('testdata/test_solicitations/[NUMBER]/[MAIN].pdf')
from extractor import detect_format; print(detect_format(text))
from extractor import extract_data; import json; print(json.dumps(extract_data(text), indent=2))
```

**Step 3 — Verify against the source document manually:**
Open the PDF. For each field in the extraction output, find where the value came from in the PDF. Correct anything that is wrong in expected output — the expected output represents ground truth, not what the extractor currently returns.

**Step 4 — Write `_expected_output.json`:**
Create `testdata/test_solicitations/[NUMBER]/_expected_output.json` using the schema from Part 3. Rules:
- Set fields to `null` for anything genuinely absent in the document
- Set `format` to what `detect_format()` returned (verify it is correct by checking the document header)
- Set `line_item_count` to the actual count in the document (count manually in PDF if needed)
- Write 3–5 `line_items_sample` entries: first, middle, last items in the SOW/CLIN list
- Set `required_fields` to at minimum `["solicitation_number", "due_date", "contact_email", "naics_code"]`
- Write a `notes` entry explaining the format and any quirks

**Step 5 — Run the harness:**
```
python testdata/run.py --fixture [NUMBER]
```
If any field FAILs, decide: is the expected output wrong (fix the expected output) or is the extractor wrong (note as a bug, file separately, do NOT fix inline)?

**Step 6 — Run all fixtures to confirm no regressions:**
```
python testdata/run.py
```
Exit code 0 = ready to commit. Exit code 1 = investigate before committing.

**Step 7 — Commit:**
```
git add testdata/test_solicitations/[NUMBER]/
git commit -m "test: add [NUMBER] fixture ([FORMAT] format, [N] line items)"
```
Never commit a fixture that causes existing fixtures to regress.

---

### What to check manually before committing expected output

| Check | How |
|-------|-----|
| `solicitation_number` matches PDF cover exactly | Find on page 1 of main PDF |
| `format` is correct | `detect_format()` output matches the actual document structure |
| `due_date` includes time and timezone if present in document | Read the response/quote due date field in PDF |
| `contact_email` is in the document, not guessed | Search PDF for "@" |
| `naics_code` is the 6-digit code, not the description | Should be pure digits |
| `line_item_count` counted from PDF, not from extraction | Manually count items in SOW or CLIN table |
| `line_items_sample` items are real items from the document | Open PDF, find each sample item |
| `scope_of_work` first 200 chars match document | Find the scope/description section in PDF |

---

## Part 6 — Implementation Tasks

### Task 1 — Update run.py

**File:** `testdata/run.py`

Changes:
1. Add `--fixture` argument (single fixture mode)
2. Add fixture discovery: scan `testdata/test_solicitations/` for dirs with expected output
3. Add expected output loading (supports both `_expected_output.json` and `[name]_expected_output.json`)
4. Add multi-file bundle detection and routing to `parse_solicitation_bundle`
5. Add field comparison logic with PASS/PARTIAL/FAIL classification
6. Add `line_item_count` comparison (±5 tolerance)
7. Add `required_fields` validation
8. Add `line_items_sample` matching
9. Add structured per-fixture reporting
10. Add exit code logic (0 = all pass, 1 = any fail, 2 = no fixtures found)
11. Preserve existing `--solicitation` + `--input` DOCX generation path

**Estimated effort:** 3–4 hours

---

### Task 2 — Upgrade existing expected output files to v2 schema

**Files:** The three existing `[name]_expected_output.json` files

For each:
- Add `_schema_version: 2`
- Add `format` field (correct format string)
- Add `line_item_count` (0 for 36C24225Q0696 and request-for-quotation; 118 for 70B06C26Q00000080)
- Add `line_items_sample` (3 samples for 70B06C26Q00000080; empty array for others)
- Add `required_fields` list
- Add `notes`

Do NOT rename the files — harness supports both naming conventions.

**Estimated effort:** 30 minutes

---

### Task 3 — Write expected output for existing fixtures without it

**Fixtures:** 18Q0042, N5005426Q0114_CSS_03312026, W911S225U14310001_CSS_08062025

Follow the fixture onboarding process (Part 5) for each. These are lower priority than acquiring the 5 new fixtures from Part 4 but should be done before Phase 5 is marked complete.

**Estimated effort:** 1–2 hours per fixture

---

### Task 4 — Acquire 5 new solicitations

Using the SAM.gov queries from Part 4, download 5 new solicitations matching the target profiles. Follow the fixture onboarding process for each.

**Estimated effort:** ~1 day

---

## Acceptance Criteria

| Check | Expected |
|-------|----------|
| `python testdata/run.py` | Runs all fixtures with expected output, exits 0 |
| `python testdata/run.py --fixture 70B06C26Q00000080` | Runs single fixture, exits 0 |
| `python testdata/run.py --solicitation ...` | Existing DOCX generation path works unchanged |
| Any field FAIL | Exit code 1, FAIL clearly reported |
| 3 existing expected output files upgraded to v2 | `format` + `line_item_count` + `required_fields` present |
| 5 new fixtures acquired | All have `_expected_output.json`, all pass harness |
| All existing formats still pass | Zero regressions on 70B bundle, 36C, request-for-quotation |
| Fixtures without expected output | Skipped with warning, not treated as failures |

---

*End of Phase 5 Test Coverage Plan*
