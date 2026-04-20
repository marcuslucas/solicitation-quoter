#!/usr/bin/env python3
"""
Test harness — validates extraction against expected output, and generates quote documents.

Usage (fixture validation — new default):
    python testdata/run.py                                # run all fixtures
    python testdata/run.py --fixture 70B06C26Q00000080   # single fixture

Usage (quote generation — original mode, requires --solicitation):
    python testdata/run.py --solicitation "path/to/file.pdf"
    python testdata/run.py --solicitation "path/to/file.pdf" --input testdata/quote_input.json
    python testdata/run.py --api-key sk-ant-...

Output (generation mode) is saved to testdata/output/

Exit codes:
    0 — all fixtures pass (or pass with field-comparison warnings)
    1 — one or more fixtures fail (wrong format, line items off, required fields missing)
    2 — no fixtures found / bad invocation
"""
import sys, json, argparse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "python"))
from server import parse_document, extract_data, generate_quote, extract_line_items, parse_solicitation_bundle

HERE = Path(__file__).parent
FIXTURES_DIR = HERE / "test_solicitations"

# Fields the extractor returns under different names than legacy expected output files use.
FIELD_ALIASES = {
    "title":  "project_title",
    "type":   "solicitation_type",
    "agency": "issuing_agency",
}

# Always validate presence of these fields in extracted result.
DEFAULT_REQUIRED = ["solicitation_number", "due_date", "contact_email", "naics_code"]

# File extensions treated as solicitation documents (everything else is metadata).
SOL_EXTENSIONS = {".pdf", ".docx", ".txt", ".xlsx", ".xls"}

# Keys that are not field values — skip from field comparison.
META_KEYS = {
    "_schema_version", "format", "line_item_count", "line_items_sample",
    "required_fields", "notes", "contract_type", "minimum_guarantee",
}


# ── Discovery helpers ─────────────────────────────────────────────────────────

def find_expected_output(fixture_dir: Path):
    """Return path to expected output file, or None. Supports both naming conventions."""
    p = fixture_dir / "_expected_output.json"
    if p.exists():
        return p
    p = fixture_dir / f"{fixture_dir.name}_expected_output.json"
    if p.exists():
        return p
    return None


def find_sol_files(fixture_dir: Path):
    """Return list of solicitation document files (no metadata/screenshots)."""
    return [
        f for f in fixture_dir.iterdir()
        if f.is_file() and f.suffix.lower() in SOL_EXTENSIONS
    ]


# ── Extraction ────────────────────────────────────────────────────────────────

def run_extraction(fixture_dir: Path):
    """
    Detect single vs bundle, run extraction. Returns (result_dict, mode_str).
    result_dict is None on failure.
    """
    sol_files = find_sol_files(fixture_dir)
    if not sol_files:
        return None, "no-files"

    non_xlsx = [f for f in sol_files if f.suffix.lower() not in {".xlsx", ".xls"}]
    has_xlsx = any(f.suffix.lower() in {".xlsx", ".xls"} for f in sol_files)

    if len(sol_files) == 1 and not has_xlsx:
        text = parse_document(str(sol_files[0]))
        if not text.strip():
            return None, "empty-text"
        result = extract_data(text)
        result.pop("_method", None)
        return result, "single"
    else:
        file_list = [{"path": str(f), "filename": f.name} for f in sol_files]
        result = parse_solicitation_bundle(file_list)
        result.pop("_method", None)
        return result, "bundle"


# ── Field comparison ──────────────────────────────────────────────────────────

def get_field(result, key):
    """Get value from result dict, resolving legacy field-name aliases."""
    if key in result:
        return result[key]
    alias = FIELD_ALIASES.get(key)
    return result.get(alias) if alias else None


def compare_field(expected_val, actual_val):
    """Return 'PASS', 'PARTIAL', or 'FAIL'. PARTIAL = substring match."""
    if actual_val is None or str(actual_val).strip() == "":
        return "FAIL"
    exp = str(expected_val).strip()
    got = str(actual_val).strip()
    if exp == got:
        return "PASS"
    if exp in got or got in exp:
        return "PARTIAL"
    return "FAIL"


# ── Validation ────────────────────────────────────────────────────────────────

def validate_fixture(fixture_name, expected, result):
    """
    Compare result against expected. Returns (hard_fail: bool, lines: list[str]).

    hard_fail is True only for:
      - Wrong format detection
      - Line item count outside tolerance
      - Required field missing (null/empty) in extracted result

    Field-value mismatches are shown but do NOT set hard_fail.
    """
    lines = []
    hard_fail = False

    # ── Format ────────────────────────────────────────────────────────────────
    exp_format = expected.get("format")
    got_format = result.get("_format", "unknown")
    if exp_format:
        ok = got_format == exp_format
        mark = "OK" if ok else "FAIL"
        lines.append(f"  Format detected : {got_format} (expected: {exp_format})  {mark}")
        if not ok:
            hard_fail = True
    else:
        lines.append(f"  Format detected : {got_format}")

    # ── Line item count ───────────────────────────────────────────────────────
    exp_count = expected.get("line_item_count")
    if exp_count is not None:
        got_count = len(result.get("line_items", []))
        tolerance = 3 if exp_count < 20 else 5
        ok = abs(got_count - exp_count) <= tolerance
        mark = "OK" if ok else "FAIL"
        lines.append(f"  Line items      : {got_count} extracted, expected {exp_count}  {mark}")
        if not ok:
            hard_fail = True

    # ── Required fields (presence check) ─────────────────────────────────────
    req_fields = list(dict.fromkeys(DEFAULT_REQUIRED + list(expected.get("required_fields", []))))
    req_parts = []
    missing = []
    for field in req_fields:
        val = get_field(result, field)
        present = val is not None and str(val).strip() != ""
        req_parts.append(f"{field} {'OK' if present else 'MISS'}")
        if not present:
            missing.append(field)
            hard_fail = True
    lines.append(f"  Required fields : {',  '.join(req_parts)}")
    if missing:
        lines.append(f"  Missing fields  : {', '.join(missing)}")

    # ── Field-value comparison (informational) ────────────────────────────────
    field_results = []
    for key, exp_val in expected.items():
        if key in META_KEYS or exp_val is None:
            continue
        actual_val = get_field(result, key)
        status = compare_field(exp_val, actual_val)
        field_results.append((key, status, exp_val, actual_val))

    passes  = sum(1 for _, s, _, _ in field_results if s == "PASS")
    partial = sum(1 for _, s, _, _ in field_results if s == "PARTIAL")
    fails   = sum(1 for _, s, _, _ in field_results if s == "FAIL")
    total   = len(field_results)
    lines.append(f"  Fields          : {passes} exact, {partial} partial, {fails} mismatch / {total} compared")

    for key, status, exp_val, actual_val in field_results:
        if status == "FAIL":
            got_str = f'"{str(actual_val)[:55]}"' if actual_val else "null"
            exp_str = f'"{str(exp_val)[:55]}"'
            lines.append(f"    WARN  {key:<28} got {got_str}")
            lines.append(f"          {'':<28} exp {exp_str}")
        elif status == "PARTIAL":
            lines.append(f"    PART  {key:<28} (substring match)")

    # ── Sample items ──────────────────────────────────────────────────────────
    sample = expected.get("line_items_sample", [])
    if sample:
        actual_items = result.get("line_items", [])
        actual_sections = {item.get("sow_section") for item in actual_items}
        actual_descs = {(item.get("description") or "").lower() for item in actual_items}
        not_found = []
        for s in sample:
            sec = s.get("sow_section")
            desc = (s.get("description") or "").lower()
            if sec and sec in actual_sections:
                continue
            if desc and any(desc in d or d in desc for d in actual_descs):
                continue
            not_found.append(sec or desc)
        if not_found:
            lines.append(f"  Sample items    : NOT FOUND: {not_found}")
        else:
            lines.append(f"  Sample items    : all {len(sample)} found OK")

    result_label = "FAIL" if hard_fail else "PASS"
    if not hard_fail and fails > 0:
        result_label += f" (with {fails} field warning(s))"
    lines.append(f"  Result          : {result_label}")
    return hard_fail, lines


# ── Fixture mode ──────────────────────────────────────────────────────────────

def run_fixture_mode(fixture_name=None):
    """Run validation against one or all fixtures. Returns exit code."""
    if not FIXTURES_DIR.exists():
        print(f"ERROR: fixtures directory not found: {FIXTURES_DIR}")
        return 2

    if fixture_name:
        fixture_dir = FIXTURES_DIR / fixture_name
        if not fixture_dir.exists():
            available = [d.name for d in FIXTURES_DIR.iterdir() if d.is_dir()]
            print(f"ERROR: fixture not found: {fixture_name!r}")
            print(f"Available: {', '.join(sorted(available))}")
            return 1
        fixture_dirs = [fixture_dir]
    else:
        fixture_dirs = sorted(d for d in FIXTURES_DIR.iterdir() if d.is_dir())

    if not fixture_dirs:
        print("ERROR: no fixture directories found")
        return 2

    results = []  # (name, hard_fail, has_expected)

    for fixture_dir in fixture_dirs:
        name = fixture_dir.name
        print("-" * 52)
        print(f"FIXTURE: {name}")

        expected_path = find_expected_output(fixture_dir)

        result, mode = run_extraction(fixture_dir)
        if result is None:
            print(f"  ERROR: extraction failed ({mode})")
            results.append((name, True, False))
            continue

        got_format = result.get("_format", "unknown")
        sol_num    = result.get("solicitation_number") or result.get("project_title") or "(not found)"
        item_count = len(result.get("line_items", []))
        print(f"  Extracted ({mode})")
        print(f"  Format          : {got_format}")
        print(f"  Solicitation #  : {sol_num}")
        print(f"  Line items      : {item_count}")

        if not expected_path:
            print(f"  [no expected output — skipping validation]")
            results.append((name, False, False))
            continue

        expected = json.loads(expected_path.read_text(encoding="utf-8"))
        hard_fail, report_lines = validate_fixture(name, expected, result)
        for line in report_lines:
            print(line)
        results.append((name, hard_fail, True))

    print("=" * 52)
    validated = [(n, hf) for n, hf, has_exp in results if has_exp]
    skipped   = [n for n, hf, has_exp in results if not has_exp]
    failed    = [n for n, hf in validated if hf]
    passed    = [n for n, hf in validated if not hf]

    print(f"SUMMARY: {len(validated)} fixture(s) validated, {len(skipped)} skipped (no expected output)")
    if passed:
        print(f"  PASS : {len(passed)}")
    if failed:
        print(f"  FAIL : {len(failed)}  ({', '.join(failed)})")
    if skipped:
        print(f"  SKIP : {', '.join(skipped)}")

    return 1 if failed else 0


# ── Generation mode (original) ────────────────────────────────────────────────

def run_generation_mode(args):
    """Original DOCX generation mode. Returns exit code."""
    sol_path = Path(args.solicitation)
    inp_path = Path(args.input)

    print(f"Parsing: {sol_path.name}")
    text = parse_document(str(sol_path))
    if not text.strip():
        print("ERROR: could not extract text from the solicitation file.")
        return 1

    solicitation = extract_data(text, api_key=args.api_key)
    method = solicitation.pop("_method", "rules")
    print(f"  Extraction method : {method}")
    print(f"  Solicitation #    : {solicitation.get('solicitation_number', '(not found)')}")
    print(f"  Project title     : {solicitation.get('project_title', '(not found)')}")
    print(f"  Due date          : {solicitation.get('due_date', '(not found)')}")

    data = json.loads(inp_path.read_text(encoding="utf-8"))
    vendor = data["vendor"]
    input_items = data.get("line_items", [])

    has_real_items = any(
        (str(item.get("qty", 0)) not in ("0", "", "N/A") and item.get("qty") not in (0, None))
        or item.get("description", "").strip()
        for item in input_items
    )

    if has_real_items:
        line_items = input_items
        print(f"\nUsing {len(line_items)} line item(s) from input file.")
    else:
        line_items = extract_line_items(solicitation, text)
        print(f"\nExtracted {len(line_items)} line item(s) from solicitation.")
        for li in line_items:
            print(f"  {li['size']:>4}  qty={li['qty']}  {li['description'][:60]}")

    print("Generating quote...")
    docx_bytes = generate_quote(solicitation, vendor, line_items)

    out_dir = HERE / "output"
    out_dir.mkdir(exist_ok=True)
    sol_num = solicitation.get("solicitation_number", "TEST").replace("/", "-")
    out_path = out_dir / f"Quote_{sol_num}.docx"
    out_path.write_bytes(docx_bytes)
    print(f"\nSaved -> {out_path}")
    return 0


# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Fixture validation harness and quote generator.",
        epilog=(
            "Examples:\n"
            "  python testdata/run.py                           # validate all fixtures\n"
            "  python testdata/run.py --fixture 70B06C26Q00000080\n"
            "  python testdata/run.py --solicitation path/to/file.pdf\n"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--fixture", default=None,
                        help="Run only this fixture (directory name under test_solicitations/)")
    parser.add_argument("--api-key", default="",
                        help="Anthropic API key for AI extraction (generation mode only)")
    parser.add_argument("--solicitation", default=None,
                        help="Path to solicitation file — activates generation mode")
    parser.add_argument("--input", default=str(HERE / "quote_input.json"),
                        help="Path to vendor + line items JSON (generation mode)")
    args = parser.parse_args()

    if args.solicitation is not None:
        sys.exit(run_generation_mode(args))
    else:
        sys.exit(run_fixture_mode(args.fixture))


if __name__ == "__main__":
    main()
