#!/usr/bin/env python3
"""Text parsing and field extraction for SolicitationQuoter."""

import os, re, json
from pathlib import Path


def parse_pdf(filepath):
    try:
        import pdfplumber
        with pdfplumber.open(filepath) as pdf:
            text = "\n\n".join(p.extract_text() or "" for p in pdf.pages).strip()
        if text:
            return text
    except Exception as e:
        print(f"pdfplumber failed: {e}")
    try:
        from pypdf import PdfReader
        reader = PdfReader(filepath)
        text = "\n\n".join(p.extract_text() or "" for p in reader.pages).strip()
        if text:
            return text
    except Exception as e:
        print(f"pypdf failed: {e}")
    return ""


def parse_docx(filepath):
    from docx import Document
    doc = Document(filepath)
    parts = [p.text.strip() for p in doc.paragraphs if p.text.strip()]
    for table in doc.tables:
        for row in table.rows:
            cells = [c.text.strip() for c in row.cells if c.text.strip()]
            if cells:
                parts.append(" | ".join(cells))
    return "\n".join(parts)


def parse_document(filepath):
    ext = Path(filepath).suffix.lower()
    if ext == ".pdf":    return parse_pdf(filepath)
    if ext in (".docx",".doc"): return parse_docx(filepath)
    if ext == ".txt":
        return open(filepath, encoding="utf-8", errors="ignore").read()
    raise ValueError(f"Unsupported file type: {ext}")


def extract(text):
    def find(patterns):
        for p in patterns:
            m = re.search(p, text, re.IGNORECASE | re.MULTILINE)
            if m:
                v = (m.group(1) if m.lastindex else m.group(0)).strip()
                if v: return v
        return ""

    d = {}
    d["solicitation_number"] = find([
        r"Notice\s*ID[:\s]*([A-Z0-9\-]+)",
        r"Solicitation\s*(?:No|Number|#)[:\s]*([A-Z0-9\-]+)",
        r"RFP\s*(?:No|Number|#)[:\s]*([A-Z0-9\-]+)",
        r"RFQ\s*(?:No|Number|#)[:\s]*([A-Z0-9\-]+)",
    ])
    d["project_title"] = find([
        r"Subject[:\s]+(.+?)(?:\n|$)",
        r"(?:Project|Contract|Solicitation)\s+Title[:\s]+(.+?)(?:\n|$)",
    ])
    d["solicitation_type"] = find([
        r"Solicitation\s+Type[:\s]+(\w+)",
        r"\b(RFQ|RFP|IFB|Sources Sought|Combined Synopsis)\b",
    ])
    d["issuing_agency"] = find([
        r"Contracting\s+Office\s+Name[:\s]+(.+?)(?:\n|$)",
        r"(?:Issued by|Issuing Office|Agency)[:\s]+(.+?)(?:\n|$)",
    ])
    d["contracting_office_address"] = find([
        r"Contracting\s+Office\s+Address\s*\n(.+?)(?:\n\n|\Z)",
    ])
    d["due_date"] = find([
        r"Response\s+Date[:\s]*([^\n]+)",
        r"(?:Due Date|Deadline|Response Due)[:\s]*([^\n]+)",
    ])
    d["posting_date"] = find([r"Posting\s+Date[:\s]*([^\n]+)"])
    d["contact_name"]  = find([r"Primary\s+Contact\s+Name[:\s]*([^\n]+)"])
    d["contact_email"] = find([
        r"Primary\s+Contact\s+Email[:\s]*([^\s]+@[^\s]+)",
        r"([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})",
    ])
    d["contact_phone"] = find([r"Primary\s+Contact\s+Phone\s*(?:Number)?[:\s]*([^\n]+)"])
    d["naics_code"] = find([r"NAICS\s*(\d{5,6}(?:[:\s]+[^\n]+)?)"])
    d["psc_code"]   = find([r"Product\s+or\s+Service\s+Code\s*([0-9A-Z]+[^\n]*)"])
    d["set_aside"]  = find([
        r"Set\s*Aside\s*Code\s*(.+?)(?:\n|$)",
        r"(Total Small Business Set.?Aside|Small Business|8\(a\)|SDVOSB|HUBZone|WOSB)",
    ])
    d["place_of_performance"] = find([
        r"Place\s+of\s+Performance\s+Address\s*([^\n]+(?:\n[^\n]+)?)",
    ])
    d["period_of_performance"] = find([r"Period\s+of\s+Performance[:\s]+(.+?)(?:\n|$)"])
    d["estimated_value"] = find([
        r"Estimated\s+(?:Value|Cost|Budget)[:\s]*\$?([\d,\.]+(?:\s*(?:million|billion))?)",
        r"Not\s+to\s+Exceed[:\s]*\$?([\d,\.]+)",
    ])

    # Scope of work
    m = re.search(r"Description[:\s]*(.+?)(?=Contact Information|Notice Details|Attachment|\Z)", text, re.IGNORECASE|re.DOTALL)
    d["scope_of_work"] = re.sub(r"\s+"," ", m.group(1)).strip()[:3000] if m else re.sub(r"\s+"," ",text[:2000]).strip()

    # Quantities
    qtys = re.findall(r"\b(SM|S|M|L|XL|XXL|2XL|3XL)[:\s]*(\d+)", text, re.IGNORECASE)
    if qtys:
        d["quantities"] = [{"size": q[0].upper(), "qty": q[1]} for q in qtys]

    # Attachments
    atts = re.findall(r"[•\-\*]?\s*([A-Z0-9_\-]+\.pdf|[A-Z0-9_\-]+\.docx)", text, re.IGNORECASE)
    if atts:
        d["attachments"] = list(set(atts))

    return {k: v for k, v in d.items() if v not in ("", [], None)}


def ai_extract(text):
    api_key = os.environ.get('ANTHROPIC_API_KEY', '')
    if not api_key:
        raise ValueError("No API key configured — set ANTHROPIC_API_KEY environment variable")
    import anthropic
    client = anthropic.Anthropic(api_key=api_key)
    if len(text) > 14000:
        text = text[:7000] + "\n\n[...truncated...]\n\n" + text[-7000:]
    prompt = f"""Extract all data from this solicitation and return ONLY a JSON object with these keys (empty string if not found):
solicitation_number, project_title, solicitation_type, issuing_agency, contracting_office_address,
due_date, posting_date, contact_name, contact_email, contact_phone, naics_code, psc_code, set_aside,
place_of_performance, contract_type, period_of_performance, estimated_value, scope_of_work,
quantities (array of {{size,qty}}), special_requirements (array of strings), attachments (array of strings),
line_items (array of {{description, size, unit, qty, unit_price}} — extract from CLIN tables or item lists if present; use empty string for unknown unit_price)

SOLICITATION:
{text}"""
    resp = client.messages.create(model="claude-sonnet-4-6", max_tokens=2000,
                                   messages=[{"role":"user","content":prompt}])
    raw = re.sub(r"^```(?:json)?\s*","",resp.content[0].text.strip())
    raw = re.sub(r"\s*```$","",raw)
    return json.loads(raw)


def extract_data(text, api_key=""):
    rules = extract(text)
    _env_key = os.environ.get('ANTHROPIC_API_KEY', '')
    if api_key or _env_key:
        try:
            ai = ai_extract(text)
            merged = {**rules}
            for k,v in ai.items():
                if v and v != "" and v != [] and v != {}:
                    merged[k] = v
            # Store AI line items separately so extractor can prefer them
            if ai.get("line_items"):
                merged["ai_line_items"] = ai["line_items"]
            merged["_method"] = "ai+rules"
            return merged
        except Exception as e:
            print(f"AI failed, using rules: {e}")
    rules["_method"] = "rules"
    return rules


def extract_line_items(solicitation, text):
    """
    Derive line items from extracted solicitation data and raw text.
    Returns list of dicts: {description, size, unit, qty, unit_price}.
    Any field that cannot be determined is set to the string "N/A".
    """
    base_desc = (solicitation.get("project_title") or
                 solicitation.get("solicitation_number") or "N/A")
    items = []

    # 0. Use AI-extracted line items if available (best quality)
    ai_items = solicitation.get("ai_line_items", [])
    if ai_items:
        for it in ai_items:
            items.append({
                "description": it.get("description", base_desc) or base_desc,
                "size":        it.get("size", "N/A") or "N/A",
                "unit":        it.get("unit", "EA") or "EA",
                "qty":         it.get("qty", "N/A"),
                "unit_price":  it.get("unit_price", "N/A"),
            })
        return items

    # 1. Use size/qty pairs already pulled by the rules engine
    quantities = solicitation.get("quantities", [])
    if quantities:
        for q in quantities:
            try:
                qty_val = int(q.get("qty", "N/A"))
            except (ValueError, TypeError):
                qty_val = "N/A"
            items.append({
                "description": base_desc,
                "size":        q.get("size", "N/A") or "N/A",
                "unit":        "EA",
                "qty":         qty_val,
                "unit_price":  "N/A",
            })
        return items

    # 2. Look for CLIN-style line items
    clin_blocks = re.findall(
        r"(?:CLIN|LINE\s*ITEM|ITEM)\s*(\d{1,4})\s+(.*?)(?=(?:CLIN|LINE\s*ITEM|ITEM)\s*\d|\Z)",
        text, re.IGNORECASE | re.DOTALL
    )
    if clin_blocks:
        for _clin_num, block in clin_blocks:
            block = re.sub(r"\s+", " ", block).strip()
            qty_m = re.search(r"(?:QTY|Quantity)[:\s]*(\d+)", block, re.IGNORECASE)
            up_m  = re.search(r"(?:Unit\s+Price|UNIT\s+PRICE|UP)[:\s]*\$?([\d,\.]+)", block, re.IGNORECASE)
            qty_val = int(qty_m.group(1)) if qty_m else "N/A"
            up_val  = float(up_m.group(1).replace(",","")) if up_m else "N/A"
            items.append({
                "description": block[:120] or base_desc,
                "size":        "N/A",
                "unit":        "EA",
                "qty":         qty_val,
                "unit_price":  up_val,
            })
        return items

    # 3. Fallback: single row from project title
    items.append({"description": base_desc, "size": "N/A", "unit": "EA", "qty": "N/A", "unit_price": "N/A"})
    return items
