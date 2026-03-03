#!/usr/bin/env python3
"""
Quick test harness — generates a quote document without launching Electron.

Usage:
    python testdata/run.py
    python testdata/run.py --solicitation "path/to/file.pdf"
    python testdata/run.py --input testdata/quote_template.json
    python testdata/run.py --solicitation "path/to/file.pdf" --input testdata/quote_template.json
    python testdata/run.py --api-key sk-ant-...   # use Claude AI extraction

Flags:
    --solicitation   Path to solicitation file (pdf / docx / txt).
                     Defaults to testdata/solicitation.txt
    --input          Path to vendor + line items JSON.
                     Defaults to testdata/quote_input.json
    --api-key        Anthropic API key — enables AI field extraction on top of rules.

Output is saved to testdata/output/
"""
import sys, json, argparse
from pathlib import Path

# Allow importing from python/server.py
sys.path.insert(0, str(Path(__file__).parent.parent / "python"))
from server import parse_document, extract_data, generate_quote, extract_line_items

HERE = Path(__file__).parent

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--api-key", default="", help="Anthropic API key for AI extraction")
    parser.add_argument("--solicitation", default=str(HERE / "solicitation.txt"),
                        help="Path to solicitation file (pdf/docx/txt)")
    parser.add_argument("--input", default=str(HERE / "quote_input.json"),
                        help="Path to vendor + line items JSON")
    args = parser.parse_args()

    sol_path = Path(args.solicitation)
    inp_path = Path(args.input)

    print(f"Parsing: {sol_path.name}")
    text = parse_document(str(sol_path))
    if not text.strip():
        print("ERROR: could not extract text from the solicitation file.")
        sys.exit(1)

    solicitation = extract_data(text, api_key=args.api_key)
    method = solicitation.pop("_method", "rules")
    print(f"  Extraction method : {method}")
    print(f"  Solicitation #    : {solicitation.get('solicitation_number', '(not found)')}")
    print(f"  Project title     : {solicitation.get('project_title', '(not found)')}")
    print(f"  Due date          : {solicitation.get('due_date', '(not found)')}")

    data = json.loads(inp_path.read_text(encoding="utf-8"))
    vendor = data["vendor"]
    input_items = data.get("line_items", [])

    # Use input file items only if at least one has a real qty or description
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

    print(f"Generating quote...")

    docx_bytes = generate_quote(solicitation, vendor, line_items)

    out_dir = HERE / "output"
    out_dir.mkdir(exist_ok=True)
    sol_num = solicitation.get("solicitation_number", "TEST").replace("/", "-")
    out_path = out_dir / f"Quote_{sol_num}.docx"
    out_path.write_bytes(docx_bytes)
    print(f"\nSaved -> {out_path}")

if __name__ == "__main__":
    main()
