#!/usr/bin/env python3
"""Text parsing and field extraction for SolicitationQuoter."""

import os, re, json
from pathlib import Path

SCOPE_MAX = 3000


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


# ── FORMAT DETECTION ──────────────────────────────────────────────────────────

def detect_format(text):
    """Identify the solicitation format from the document text."""
    first_1000 = text[:1000]
    if "Notice ID:" in first_1000:
        return "sam_export"
    if re.search(r"SOLICITATION NUMBER\*", first_1000):
        return "agency_form"
    if "Issuing Office:" in first_1000 or re.search(r"\bSECTION\s+[A-E]\b", text):
        return "formal_rfq"
    return "unknown"


# ── SHARED HELPERS ────────────────────────────────────────────────────────────

def _scope_block(raw):
    """Return scope_of_work dict with optional truncation metadata."""
    raw = re.sub(r"\s+", " ", raw).strip()
    d = {"scope_of_work": raw[:SCOPE_MAX]}
    if len(raw) > SCOPE_MAX:
        d["scope_truncated"] = True
        d["scope_full"] = raw
    else:
        d["scope_truncated"] = False
    return d


# ── FORMAT-SPECIFIC EXTRACTORS ────────────────────────────────────────────────

def extract_sam_export(text):
    """
    Extract fields from SAM.gov-style structured solicitations.
    Fingerprint: 'Notice ID:' near top of page 1.
    Structure: labeled key-value pages with 'Primary Contact', 'Notice Details', etc.
    """
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
    raw_scope = m.group(1) if m else text[:SCOPE_MAX * 2]
    d.update(_scope_block(raw_scope))

    # Quantities
    qtys = re.findall(r"\b(SM|S|M|L|XL|XXL|2XL|3XL)[:\s]*(\d+)", text, re.IGNORECASE)
    if qtys:
        d["quantities"] = [{"size": q[0].upper(), "qty": q[1]} for q in qtys]

    # Attachments
    atts = re.findall(r"[•\-\*]?\s*([A-Z0-9_\-]+\.pdf|[A-Z0-9_\-]+\.docx)", text, re.IGNORECASE)
    if atts:
        d["attachments"] = list(set(atts))

    return {k: v for k, v in d.items() if v not in ("", [], None)}


def extract_agency_form(text):
    """
    Extract fields from VA/agency Combined Synopsis/Solicitation form.
    Fingerprint: 'SOLICITATION NUMBER*' on page 1.
    Structure: ALL-CAPS labels with optional * followed by value on the SAME line.
    E.g.: SOLICITATION NUMBER* 36C24225Q0696
    Contact block is multi-line: POINT OF CONTACT* -> blank lines -> role -> name -> email.
    """
    def same_line(label_pat):
        """Match: LABEL[*] VALUE (label and value on same line, space-separated)."""
        m = re.search(label_pat + r'\*?\s+(.+?)(?:\n|$)', text, re.IGNORECASE)
        return m.group(1).strip() if m else ""

    d = {}
    d["solicitation_number"] = same_line(r"SOLICITATION NUMBER")
    d["project_title"]       = same_line(r"SUBJECT")
    # Strip trailing city/country suffix (e.g. ", NEW YORK, USA") — stop at first comma
    due_raw = same_line(r"RESPONSE DATE/TIME/ZONE")
    d["due_date"] = re.sub(r",.*$", "", due_raw).strip()
    d["issuing_agency"]      = same_line(r"CONTRACTING OFFICE ADDRESS")

    naics_m = re.search(r"NAICS CODE\*?\s+(\d{5,6})", text, re.IGNORECASE)
    if naics_m:
        d["naics_code"] = naics_m.group(1).strip()

    psc_m = re.search(r"PRODUCT SERVICE CODE\*?\s+([A-Z0-9]{3,4})", text, re.IGNORECASE)
    if psc_m:
        d["psc_code"] = psc_m.group(1).strip()

    # Contact name — find the line immediately before the email address in the
    # POINT OF CONTACT block. Works for both layouts:
    #   pdfplumber: "POINT OF CONTACT* Contract Officer\nNathan Northrup\nemail"
    #   pypdf:      "POINT OF CONTACT*\n\n\nContract Officer\nNathan Northrup\nemail"
    poc_m = re.search(r"POINT OF CONTACT\*?[^\n]*\n(.+?)(?=PLACE OF PERFORMANCE|\Z)", text, re.DOTALL)
    if poc_m:
        name_m = re.search(
            r"([A-Z][a-z]+(?:\s+[A-Z][a-z.]+)+)\s*\n\s*([\w.%+\-]+@[\w.\-]+\.\w{2,})",
            poc_m.group(1))
        if name_m:
            d["contact_name"] = name_m.group(1).strip()

    # Email — prefer dedicated label (apostrophe may be a replacement char in pypdf)
    email_m = re.search(r"AGENCY CONTACT.{1,3}S EMAIL ADDRESS\s+([\w.%+\-]+@[\w.\-]+\.\w{2,})", text, re.IGNORECASE)
    if not email_m:
        email_m = re.search(r"([\w.%+\-]+@[\w.\-]+\.\w{2,})", text)
    if email_m:
        d["contact_email"] = email_m.group(1).strip()

    # Place of performance — full address block until next ALL-CAPS label
    pop_m = re.search(
        r"PLACE OF PERFORMANCE\s*\nADDRESS\s+(.+?)(?=\nPOSTAL CODE|\nCOUNTRY|\nADDITIONAL|\Z)",
        text, re.DOTALL)
    if pop_m:
        zip_m = re.search(r"POSTAL CODE\s+(\d{5})", text)
        lines = [re.sub(r"\s+and\s*$", "", l.strip(), flags=re.IGNORECASE)
                 for l in pop_m.group(1).split('\n') if l.strip()]
        val = ", ".join(lines)
        if zip_m:
            val = val + " " + zip_m.group(1)
        d["place_of_performance"] = val

    # Solicitation type from prose
    type_m = re.search(r"solicitation is issued as (?:an?\s+)?([A-Z]+)", text, re.IGNORECASE)
    if type_m:
        d["solicitation_type"] = type_m.group(1).strip()
    else:
        type_m2 = re.search(r"\b(RFQ|RFP|IFB)\b", text)
        if type_m2:
            d["solicitation_type"] = type_m2.group(1)

    # Scope — description paragraph from prose
    scope_m = re.search(
        r"(?:is seeking|firm fixed.price service contract for)\s+(.+?)"
        r"(?:\n\n|All interested|See attached|\Z)",
        text, re.IGNORECASE | re.DOTALL)
    if scope_m:
        d.update(_scope_block(scope_m.group(1)))
    else:
        d.update(_scope_block(text[:SCOPE_MAX * 2]))

    return {k: v for k, v in d.items() if v not in ("", [], None)}


def extract_formal_rfq(text):
    """
    Extract fields from formal RFQ documents with cover page + lettered sections.
    Fingerprint: 'Issuing Office:' on page 1, or SECTION A/B/C/D/E headings.
    Structure: labeled cover page fields; NAICS/PSC in Section A prose; SOW in Section C.
    """
    def labeled(label_pat):
        """Match: Label: Value (same line)."""
        m = re.search(label_pat + r'\s*(.+?)(?:\n|$)', text, re.IGNORECASE)
        return m.group(1).strip() if m else ""

    d = {}
    d["solicitation_number"] = labeled(r"Solicitation Number:")
    d["project_title"]       = labeled(r"Title:")
    d["posting_date"]        = labeled(r"Solicitation Release Date:")
    d["solicitation_type"]   = "RFQ"

    # Due date — strip leading weekday name if present
    due_m = re.search(
        r"Quotation Due Date:\s*(?:(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s*)?(.+?)(?:\n|$)",
        text, re.IGNORECASE)
    if due_m:
        d["due_date"] = due_m.group(1).strip().rstrip(',')

    # Issuing agency — multi-line block; stop before street address / ZIP
    agency_m = re.search(r"Issuing Office:\s+(.+?)(?:\n\n|\Z)", text, re.DOTALL)
    if agency_m:
        lines = [l.strip() for l in agency_m.group(1).split('\n') if l.strip()]
        org_lines = []
        for line in lines:
            if re.match(r'\d+\s+\w', line) or re.search(r'\b[A-Z]{2}\s+\d{5}', line):
                break
            org_lines.append(line)
        if org_lines:
            d["issuing_agency"] = ", ".join(org_lines)

    # Agency contact — "Agency Contact: Name, Title, (XXX) XXX-XXXX, email"
    contact_m = re.search(r"Agency Contact:\s+([^,\n]+)", text, re.IGNORECASE)
    if contact_m:
        d["contact_name"] = contact_m.group(1).strip()

    phone_m = re.search(r"Agency Contact:[^\n]*\((\d{3})\)\s*(\d{3})-(\d{4})", text, re.IGNORECASE)
    if phone_m:
        d["contact_phone"] = phone_m.group(1) + phone_m.group(2) + phone_m.group(3)

    email_m = re.search(r"Agency Contact:[^\n]*([\w.%+\-]+@[\w.\-]+\.\w{2,})", text, re.IGNORECASE)
    if email_m:
        d["contact_email"] = email_m.group(1).strip()

    # NAICS / PSC from Section A prose
    naics_m = re.search(r"NAICS[^\d]{0,30}(\d{5,6})", text, re.IGNORECASE)
    if naics_m:
        d["naics_code"] = naics_m.group(1).strip()

    psc_m = re.search(r"Product Service Code \(PSC\)\s+(?:is\s+)?([A-Z]\d{3,4})", text, re.IGNORECASE)
    if psc_m:
        d["psc_code"] = psc_m.group(1).strip()

    set_aside_m = re.search(r"TOTAL SMALL BUSINESS SET.?\s*ASIDE", text, re.IGNORECASE)
    if set_aside_m:
        d["set_aside"] = "Total Small Business Set-Aside"

    # Place of performance — "located at ADDRESS" in SOW prose.
    # DOTALL needed because pypdf may split "5th" across lines (superscript artifact).
    # Rejoin lowercase continuations after capture (e.g. "5\nth" → "5th").
    pop_m = re.search(r"located at\s+(.+?)(?:\.|,\s*and\b|\Z)", text, re.IGNORECASE | re.DOTALL)
    if pop_m:
        val = re.sub(r"\n([a-z])", r"\1", pop_m.group(1))
        d["place_of_performance"] = re.sub(r"\s+", " ", val).strip()

    # Period of performance — Base Period + all Option lines that follow
    base_m = re.search(r"Base Period:\s*(.+?)(?:\n|$)", text, re.IGNORECASE)
    if base_m:
        base_val = base_m.group(1).strip()
        opts = []
        for opt_line in re.findall(r"Option\s+\d+:[^\n]+", text, re.IGNORECASE):
            dates = re.findall(r"\d{2}/\d{2}/\d{4}", opt_line)
            if dates:
                opts.append(dates[-1])  # end date is the last date on the line
        if opts:
            n = len(opts)
            d["period_of_performance"] = (
                f"Base period {base_val}, plus {n} option period"
                + ("s" if n != 1 else "")
                + f" of 12 months each through {opts[-1]}"
            )
        else:
            d["period_of_performance"] = "Base period " + base_val

    # Scope — full Section C content
    scope_m = re.search(
        r"SECTION C[^\n]*\n(.+?)(?=SECTION\s+[D-Z]\b|\Z)",
        text, re.IGNORECASE | re.DOTALL)
    if scope_m:
        d.update(_scope_block(scope_m.group(1)))
    else:
        d.update(_scope_block(text[:SCOPE_MAX * 2]))

    return {k: v for k, v in d.items() if v not in ("", [], None)}


# ── GENERIC FALLBACK ──────────────────────────────────────────────────────────

def apply_generic_fallback(d, text):
    """Fill any still-empty fields using format-agnostic patterns. Modifies d in-place."""
    def try_fill(key, patterns):
        if d.get(key):
            return
        for p in patterns:
            m = re.search(p, text, re.IGNORECASE | re.MULTILINE)
            if m:
                v = (m.group(1) if m.lastindex else m.group(0)).strip()
                if v:
                    d[key] = v
                    return

    try_fill("solicitation_number", [
        r"(?:solicitation\s*(?:number|#|no\.?))\s*[:\s]*([A-Z0-9][-A-Z0-9]{6,})",
    ])
    try_fill("naics_code", [
        r"NAICS[^\d]{0,20}(\d{5,6})",
    ])
    try_fill("psc_code", [
        r"(?:PSC|Product\s+Service\s+Code)[^\w]{0,20}([A-Z]?\d{3,4}[A-Z]?)",
    ])
    try_fill("contact_email", [
        r"([\w.%+\-]+@[\w.\-]+\.\w{2,})",
    ])
    try_fill("due_date", [
        r"(?:response|due|deadline|closing)[^0-9]{0,30}(\d{1,2}[-/]\d{1,2}[-/]\d{2,4}[^,\n]*)",
    ])
    try_fill("set_aside", [
        r"(Total Small Business Set.?Aside)",
        r"(Small Business Set.?Aside)",
        r"(8\(a\)(?:\s+set.?aside)?)",
        r"(SDVOSB)",
        r"(HUBZone)",
        r"(WOSB)",
    ])


# ── AI EXTRACTION ─────────────────────────────────────────────────────────────

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


# ── ENTRY POINT ───────────────────────────────────────────────────────────────

def extract_data(text, api_key=""):
    format_name = detect_format(text)
    print(f"Detected format: {format_name}")

    if format_name == "sam_export":
        d = extract_sam_export(text)
    elif format_name == "agency_form":
        d = extract_agency_form(text)
    elif format_name == "formal_rfq":
        d = extract_formal_rfq(text)
    else:
        d = {}

    apply_generic_fallback(d, text)
    d["_format"] = format_name
    d["_method"] = "rules"

    _env_key = os.environ.get('ANTHROPIC_API_KEY', '')
    if api_key or _env_key:
        try:
            ai = ai_extract(text)
            merged = {**d}
            for k, v in ai.items():
                if v and v != "" and v != [] and v != {}:
                    merged[k] = v
            if ai.get("line_items"):
                merged["ai_line_items"] = ai["line_items"]
            merged["_method"] = "ai+rules"
            return merged
        except Exception as e:
            print(f"AI failed, using rules: {e}")

    return d


# Keep the old name as an alias so any direct callers don't break
def extract(text):
    return extract_sam_export(text)


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
