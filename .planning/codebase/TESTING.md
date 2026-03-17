# Testing Patterns

**Analysis Date:** 2026-03-17

## Test Framework

**Runner:**
- Not detected: No Jest, Vitest, Mocha, pytest, or similar test runner configured
- Manual testing only: Project does not include automated test files

**Test Data:**
- `testdata/run.py` — Python script for manual testing of extraction and quote generation
- `testdata/solicitation.txt` — Sample solicitation document
- `testdata/quote_input.json` — Sample vendor and line items data
- `testdata/output/` — Generated test output directory

**Run Commands:**
```bash
# Manual testing (Python backend only)
python testdata/run.py
python testdata/run.py --solicitation "path/to/file.pdf"
python testdata/run.py --input testdata/quote_template.json
python testdata/run.py --api-key sk-ant-...   # enable AI extraction

# Application testing
npm start                    # Run app with hot reload (development)
npm run build:win           # Build Windows installer
npm run build:mac           # Build macOS DMG
```

## Test File Organization

**Location:**
- Manual test harness: `testdata/run.py`
- No automated test files co-located with source code
- No `*.test.js`, `*.spec.py`, or similar files detected

**Naming:**
- Test harness: `run.py` (executable script)
- Test data: `solicitation.txt`, `quote_input.json`
- Test output: `output/` directory

**Structure:**
```
testdata/
├── run.py                    # Test harness
├── solicitation.txt          # Sample input
├── quote_input.json          # Vendor + line items template
└── output/                   # Generated output directory
```

## Manual Test Harness

**Location:** `testdata/run.py`

**Purpose:** Generate quote documents without launching Electron UI

**Pattern:**
```python
#!/usr/bin/env python3
"""
Quick test harness — generates a quote document without launching Electron.

Usage:
    python testdata/run.py
    python testdata/run.py --solicitation "path/to/file.pdf"
    python testdata/run.py --input testdata/quote_template.json
    python testdata/run.py --api-key sk-ant-...
"""
import sys, json, argparse
from pathlib import Path

# Import functions from backend
sys.path.insert(0, str(Path(__file__).parent.parent / "python"))
from server import parse_document, extract_data, generate_quote, extract_line_items

HERE = Path(__file__).parent

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--api-key", default="")
    parser.add_argument("--solicitation", default=str(HERE / "solicitation.txt"))
    parser.add_argument("--input", default=str(HERE / "quote_input.json"))
    args = parser.parse_args()

    # Parse and extract
    text = parse_document(str(args.solicitation))
    solicitation = extract_data(text, api_key=args.api_key)

    # Load vendor/items and generate
    data = json.loads(Path(args.input).read_text())
    docx_bytes = generate_quote(solicitation, data["vendor"], data.get("line_items", []))

    # Save output
    out_dir = HERE / "output"
    out_dir.mkdir(exist_ok=True)
    Path(out_dir / "output.docx").write_bytes(docx_bytes)
```

## Backend Unit Testing Approach

**Parser Testing:**
- No automated tests; parsers are tested manually via `testdata/run.py`
- `parse_pdf()`: Tested with actual PDF files in testdata
- `parse_docx()`: Tested with actual DOCX files
- `parse_document()`: Router function dispatches to format-specific parsers

**Extraction Testing:**
- `extract()` (rules-based): No unit tests; validated against sample solicitation
- `ai_extract()` (Claude AI): Requires valid API key; tested via command-line flag
- `extract_data()` (combined): Tested in manual harness with `--api-key` flag
- `extract_line_items()`: Tested against solicitation text; validates fallback logic

**Quote Generation Testing:**
- `generate_quote()`: Tested end-to-end via manual harness
- No unit tests for document structure or formatting
- Output file examined visually

## Frontend Testing Approach

**UI Testing:**
- Manual testing only: Navigate through 4-step wizard
- No automated browser tests (Selenium, Playwright, Cypress not configured)
- Interactive testing of:
  - File upload (dropzone drag-and-drop, file picker)
  - Data editing (solicitation review, vendor info, line items)
  - Theme switching
  - SAM.gov lookup
  - API key storage/retrieval

**State Testing:**
- No unit tests for state management
- localStorage persistence validated manually
- Session resumption tested via UI

## Integration Testing

**API Contract Testing:**
- Manual HTTP requests to Flask routes
- No automated testing of `/parse`, `/generate_quote`, `/sam_lookup` endpoints
- Tested via:
  - JavaScript UI (`fetch()` calls)
  - `testdata/run.py` (direct Python function calls)
  - Manual curl requests (implied but not documented)

**End-to-End Testing:**
- Full workflow tested manually:
  1. Launch `npm start`
  2. Upload solicitation file
  3. Review extracted data
  4. Enter vendor info
  5. Add/edit line items
  6. Generate and save quote

## Coverage

**Requirements:** None enforced

**Test Coverage Status:**
- Code coverage: Not measured (no coverage tool configured)
- Untested areas:
  - Python: All extraction regex patterns, AI fallback logic
  - JavaScript: All UI rendering, event handlers, localStorage persistence
  - IPC: All Electron IPC handlers (`ipcMain.handle()`)

## Error Handling in Tests

**Testing Error Paths:**
- Parser failures: Manual testing with corrupted/empty files
- Network errors: Manual testing with disconnected SAM.gov API
- Invalid data: Manual testing with malformed JSON
- No automated error scenario testing

**Observed Error Handling Patterns:**
```python
# Python route handlers
@app.route("/parse", methods=["POST","OPTIONS"])
def parse_route():
    tmp_path = None
    try:
        if "file" not in request.files:
            return jsonify({"error":"No file uploaded"}),400
        file=request.files["file"]; api_key=request.form.get("api_key","")
        # ... parse logic
        return jsonify({"success":True,"data":data})
    except Exception as e:
        traceback.print_exc(); return jsonify({"error":str(e)}),500
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except Exception:
                pass
```

```javascript
// JavaScript error handling
try {
    startBackend()
    await waitForBackend()
    win.loadFile(path.join(__dirname, 'index.html'))
} catch(e) {
    win.loadFile(path.join(__dirname, 'error.html'))
}
```

## Fallback Testing

**Parser Fallbacks:**
- PDF parsing attempts `pdfplumber` first, falls back to `pypdf`, then returns empty string
- Each failure is logged but doesn't stop execution

**AI Extraction Fallback:**
```python
def extract_data(text, api_key=""):
    rules = extract(text)
    if api_key:
        try:
            ai = ai_extract(text, api_key)
            merged = {**rules}
            for k,v in ai.items():
                if v and v != "" and v != [] and v != {}:
                    merged[k] = v
            return merged
        except Exception as e:
            print(f"AI failed, using rules: {e}")
    rules["_method"] = "rules"
    return rules
```

**Testing approach:** Manual verification that rule-based extraction still works when AI fails

## Performance Testing

**Not conducted:** No performance benchmarks or load testing observed

**Potential bottlenecks (not tested):**
- Large PDF parsing (>50MB files)
- AI extraction with very large documents (text truncated at 14000 chars)
- Quote generation with 100+ line items

## Test Data Fixtures

**Location:** `testdata/`

**Fixtures:**
- `solicitation.txt` — Sample government solicitation document
- `quote_input.json` — Template for vendor and line items
  ```json
  {
    "vendor": {
      "company_name": "Your Company",
      "address": "...",
      ...
    },
    "line_items": [
      {"description": "...", "qty": 1, "unit_price": "..."}
    ]
  }
  ```

**Usage in Tests:**
- Manually loaded by `testdata/run.py --input [path]`
- Can be modified to test different scenarios

## Debugging

**Tools:**
- Node.js DevTools: Built into Electron; launch `npm start` and press F12
- Python debugger: Add `import pdb; pdb.set_trace()` in server.py functions
- Browser console: Access via Electron DevTools
- Backend logs: Visible in terminal when running `npm start` (prefixed with `[backend]`)

**Logging available:**
- Backend startup: `[SolicitationQuoter] Running on http://localhost:5199`
- Parser failures: `pdfplumber failed: ...` / `pypdf failed: ...`
- AI extraction failures: `AI failed, using rules: ...`
- Route exceptions: Full traceback via `traceback.print_exc()`

---

*Testing analysis: 2026-03-17*
