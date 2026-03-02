#!/usr/bin/env python3
import os, sys, json, re, tempfile, traceback, io
from pathlib import Path
from flask import Flask, request, jsonify, send_file

app = Flask(__name__)

@app.after_request
def cors(r):
    r.headers["Access-Control-Allow-Origin"] = "*"
    r.headers["Access-Control-Allow-Headers"] = "Content-Type"
    r.headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS"
    return r

@app.route("/ping")
def ping():
    return jsonify({"status": "ok"})

# ── PARSERS ──────────────────────────────────────────────────────────────────

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

# ── RULE-BASED EXTRACTOR ─────────────────────────────────────────────────────

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

# ── AI EXTRACTOR ─────────────────────────────────────────────────────────────

def ai_extract(text, api_key):
    import anthropic
    client = anthropic.Anthropic(api_key=api_key)
    if len(text) > 14000:
        text = text[:7000] + "\n\n[...truncated...]\n\n" + text[-7000:]
    prompt = f"""Extract all data from this solicitation and return ONLY a JSON object with these keys (empty string if not found):
solicitation_number, project_title, solicitation_type, issuing_agency, contracting_office_address,
due_date, posting_date, contact_name, contact_email, contact_phone, naics_code, psc_code, set_aside,
place_of_performance, contract_type, period_of_performance, estimated_value, scope_of_work,
quantities (array of {{size,qty}}), special_requirements (array of strings), attachments (array of strings)

SOLICITATION:
{text}"""
    resp = client.messages.create(model="claude-sonnet-4-20250514", max_tokens=2000,
                                   messages=[{"role":"user","content":prompt}])
    raw = re.sub(r"^```(?:json)?\s*","",resp.content[0].text.strip())
    raw = re.sub(r"\s*```$","",raw)
    return json.loads(raw)

def extract_data(text, api_key=""):
    rules = extract(text)
    if api_key:
        try:
            ai = ai_extract(text, api_key)
            merged = {**rules}
            for k,v in ai.items():
                if v and v != "" and v != [] and v != {}:
                    merged[k] = v
            merged["_method"] = "ai+rules"
            return merged
        except Exception as e:
            print(f"AI failed, using rules: {e}")
    rules["_method"] = "rules"
    return rules

# ── QUOTE GENERATOR ──────────────────────────────────────────────────────────

def generate_quote(solicitation, vendor, line_items):
    from docx import Document
    from docx.shared import Pt, Inches, RGBColor
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.oxml.ns import qn
    from docx.oxml import OxmlElement
    import datetime

    doc = Document()
    for sec in doc.sections:
        sec.top_margin = Inches(1); sec.bottom_margin = Inches(1)
        sec.left_margin = Inches(1.25); sec.right_margin = Inches(1.25)

    NAVY  = RGBColor(0x0D,0x2B,0x55)
    DGRAY = RGBColor(0x44,0x44,0x44)
    WHITE = RGBColor(0xFF,0xFF,0xFF)

    def bg(cell, color):
        tc = cell._tc; pr = tc.get_or_add_tcPr()
        s = OxmlElement("w:shd")
        s.set(qn("w:fill"), color); s.set(qn("w:val"), "clear")
        pr.append(s)

    def run(para, text, bold=False, size=11, color=None, italic=False):
        r = para.add_run(text); r.bold=bold; r.italic=italic; r.font.size=Pt(size)
        if color: r.font.color.rgb=color
        return r

    def heading(txt, sb=14):
        p = doc.add_paragraph()
        p.paragraph_format.space_before=Pt(sb); p.paragraph_format.space_after=Pt(4)
        run(p, txt, bold=True, size=11, color=NAVY)
        pr = p._p.get_or_add_pPr(); bd = OxmlElement("w:pBdr")
        b = OxmlElement("w:bottom"); b.set(qn("w:val"),"single"); b.set(qn("w:sz"),"6")
        b.set(qn("w:space"),"1"); b.set(qn("w:color"),"0D2B55"); bd.append(b); pr.append(bd)

    today = datetime.date.today().strftime("%B %d, %Y")

    # Header table
    ht = doc.add_table(rows=1, cols=2); ht.style="Table Grid"; ht.autofit=False
    ht.columns[0].width=Inches(3.5); ht.columns[1].width=Inches(3.25)
    lc=ht.cell(0,0); rc=ht.cell(0,1)
    bg(lc,"0D2B55"); bg(rc,"F5F5F5")
    lp=lc.paragraphs[0]; lp.paragraph_format.space_before=Pt(10); lp.paragraph_format.left_indent=Pt(10)
    run(lp, vendor.get("company_name","Your Company"), bold=True, size=15, color=WHITE)
    for f in ["address","city_state_zip","phone","email","website"]:
        v=vendor.get(f,"")
        if v:
            fp=lc.add_paragraph(); fp.paragraph_format.left_indent=Pt(10)
            run(fp, v, size=9, color=RGBColor(0xCC,0xCC,0xCC))
    lc.add_paragraph()
    rp=rc.paragraphs[0]; rp.paragraph_format.space_before=Pt(10); rp.paragraph_format.left_indent=Pt(8)
    run(rp,"QUOTE / PROPOSAL", bold=True, size=13, color=NAVY)
    for label,value in [
        ("Quote #", vendor.get("quote_number","Q-"+datetime.date.today().strftime("%Y%m%d"))),
        ("Date", today),
        ("Solicitation #", solicitation.get("solicitation_number","")),
        ("Valid For", vendor.get("validity_period","30 days")),
        ("Prepared By", vendor.get("prepared_by","")),
    ]:
        if value:
            mp=rc.add_paragraph(); mp.paragraph_format.left_indent=Pt(8)
            run(mp,f"{label}: ",bold=True,size=9,color=DGRAY); run(mp,value,size=9,color=DGRAY)
    rc.add_paragraph()
    doc.add_paragraph()

    # Solicitation info
    heading("SOLICITATION INFORMATION")
    fields=[
        ("Project / Subject",    solicitation.get("project_title")),
        ("Solicitation Number",  solicitation.get("solicitation_number")),
        ("Solicitation Type",    solicitation.get("solicitation_type")),
        ("Issuing Agency",       solicitation.get("issuing_agency")),
        ("Contracting Office",   solicitation.get("contracting_office_address")),
        ("Response Due Date",    solicitation.get("due_date")),
        ("NAICS Code",           solicitation.get("naics_code")),
        ("PSC Code",             solicitation.get("psc_code")),
        ("Set-Aside",            solicitation.get("set_aside")),
        ("Place of Performance", solicitation.get("place_of_performance")),
        ("Period of Performance",solicitation.get("period_of_performance")),
    ]
    fields=[(l,v) for l,v in fields if v]
    if fields:
        st=doc.add_table(rows=len(fields),cols=2); st.style="Table Grid"; st.autofit=False
        st.columns[0].width=Inches(2.2); st.columns[1].width=Inches(4.55)
        for i,(label,value) in enumerate(fields):
            lc2=st.cell(i,0); rc2=st.cell(i,1)
            bg(lc2,"E8EDF3")
            lp2=lc2.paragraphs[0]; lp2.paragraph_format.left_indent=Pt(4)
            run(lp2,label,bold=True,size=9,color=NAVY)
            rp2=rc2.paragraphs[0]; rp2.paragraph_format.left_indent=Pt(4)
            run(rp2,str(value)[:200],size=9,color=DGRAY)

    # Scope
    scope=solicitation.get("scope_of_work","")
    if scope:
        heading("SCOPE OF WORK / REQUIREMENT")
        sp=doc.add_paragraph(); sp.paragraph_format.left_indent=Inches(0.1)
        run(sp, scope[:2000], size=9.5, color=DGRAY)

    # Line items
    heading("QUOTE DETAILS")
    cw=[Inches(0.45),Inches(2.9),Inches(0.7),Inches(0.75),Inches(0.95),Inches(0.95)]
    hdrs=["#","Description / Item","Size/Type","Qty","Unit Price","Total"]
    lt=doc.add_table(rows=1+len(line_items)+1,cols=6); lt.style="Table Grid"; lt.autofit=False
    for ci,w in enumerate(cw): lt.columns[ci].width=w
    hr=lt.rows[0]
    for ci,h in enumerate(hdrs):
        c=hr.cells[ci]; bg(c,"0D2B55"); c.width=cw[ci]
        p=c.paragraphs[0]; p.alignment=WD_ALIGN_PARAGRAPH.CENTER
        run(p,h,bold=True,size=9,color=WHITE)
    grand=0.0
    AL=[WD_ALIGN_PARAGRAPH.CENTER,WD_ALIGN_PARAGRAPH.LEFT,WD_ALIGN_PARAGRAPH.CENTER,
        WD_ALIGN_PARAGRAPH.CENTER,WD_ALIGN_PARAGRAPH.RIGHT,WD_ALIGN_PARAGRAPH.RIGHT]
    for i,item in enumerate(line_items):
        row=lt.rows[i+1]; qty=float(item.get("qty",0) or 0)
        up=float(item.get("unit_price",0) or 0); total=qty*up; grand+=total
        bcolor="FFFFFF" if i%2==0 else "F7F9FC"
        vals=[str(i+1),item.get("description",""),item.get("size",""),
              str(int(qty)) if qty==int(qty) else str(qty),f"${up:,.2f}",f"${total:,.2f}"]
        for ci,(val,al,w) in enumerate(zip(vals,AL,cw)):
            c=row.cells[ci]; bg(c,bcolor); c.width=w
            p=c.paragraphs[0]; p.alignment=al; p.paragraph_format.left_indent=Pt(3)
            run(p,val,size=9,color=DGRAY)
    tr=lt.rows[-1]
    for ci in range(6): bg(tr.cells[ci],"E8EDF3"); tr.cells[ci].width=cw[ci]
    tr.cells[0].merge(tr.cells[3])
    tp=tr.cells[0].paragraphs[0]; tp.alignment=WD_ALIGN_PARAGRAPH.RIGHT
    run(tp,"GRAND TOTAL",bold=True,size=10,color=NAVY)
    freight=float(vendor.get("freight",0) or 0)
    tax_rate=float(vendor.get("tax_rate",0) or 0)
    tax=grand*(tax_rate/100); final=grand+freight+tax
    gp=tr.cells[-1].paragraphs[0]; gp.alignment=WD_ALIGN_PARAGRAPH.RIGHT
    run(gp,f"${final:,.2f}",bold=True,size=11,color=NAVY)

    # Notes & Terms
    notes=vendor.get("notes",""); terms=vendor.get("terms","")
    if notes or terms:
        heading("NOTES & TERMS")
        if notes:
            np=doc.add_paragraph(); np.paragraph_format.left_indent=Inches(0.1)
            run(np,"Notes: ",bold=True,size=9.5,color=NAVY); run(np,notes,size=9.5,color=DGRAY)
        if terms:
            tp2=doc.add_paragraph(); tp2.paragraph_format.left_indent=Inches(0.1)
            run(tp2,"Terms: ",bold=True,size=9.5,color=NAVY); run(tp2,terms,size=9.5,color=DGRAY)

    # Signature
    heading("AUTHORIZED SIGNATURE", sb=18)
    sigt=doc.add_table(rows=1,cols=2); sigt.style="Table Grid"; sigt.autofit=False
    sigt.columns[0].width=Inches(3.5); sigt.columns[1].width=Inches(3.25)
    lsc=sigt.cell(0,0); rsc=sigt.cell(0,1)
    def sigline(cell,label,value=""):
        p=cell.add_paragraph(); p.paragraph_format.left_indent=Pt(6); p.paragraph_format.space_after=Pt(10)
        run(p,f"{label}: ",bold=True,size=9,color=NAVY); run(p,value or "_"*28,size=9,color=DGRAY)
    sigline(lsc,"Authorized Signature"); sigline(lsc,"Printed Name",vendor.get("prepared_by",""))
    sigline(lsc,"Title",vendor.get("title","")); sigline(lsc,"Date",today)
    sigline(rsc,"Company",vendor.get("company_name","")); sigline(rsc,"Phone",vendor.get("phone",""))
    sigline(rsc,"Email",vendor.get("email","")); sigline(rsc,"SAM UEI",vendor.get("sam_uei",""))
    doc.add_paragraph()
    fp=doc.add_paragraph(); fp.alignment=WD_ALIGN_PARAGRAPH.CENTER
    run(fp,f"Quote valid for {vendor.get('validity_period','30 days')} from {today}.",
        size=8,color=RGBColor(0x99,0x99,0x99),italic=True)

    buf=io.BytesIO(); doc.save(buf); buf.seek(0); return buf.read()

# ── ROUTES ───────────────────────────────────────────────────────────────────

@app.route("/parse", methods=["POST","OPTIONS"])
def parse_route():
    if request.method=="OPTIONS": return jsonify({}),200
    try:
        if "file" not in request.files:
            return jsonify({"error":"No file uploaded"}),400
        file=request.files["file"]; api_key=request.form.get("api_key","")
        suffix=Path(file.filename).suffix
        with tempfile.NamedTemporaryFile(delete=False,suffix=suffix) as tmp:
            file.save(tmp.name); tmp_path=tmp.name
        try:
            text=parse_document(tmp_path)
            if not text.strip():
                return jsonify({"error":"Could not extract text from document."}),400
            data=extract_data(text,api_key)
            return jsonify({"success":True,"data":data})
        finally:
            os.unlink(tmp_path)
    except Exception as e:
        traceback.print_exc(); return jsonify({"error":str(e)}),500

@app.route("/generate_quote", methods=["POST","OPTIONS"])
def gen_route():
    if request.method=="OPTIONS": return jsonify({}),200
    try:
        body=request.get_json()
        docx_bytes=generate_quote(body.get("solicitation",{}),body.get("vendor",{}),body.get("line_items",[]))
        sol=body.get("solicitation",{}).get("solicitation_number","quote").replace("/","-")
        return send_file(io.BytesIO(docx_bytes),
            mimetype="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            as_attachment=True, download_name=f"Quote_{sol}.docx")
    except Exception as e:
        traceback.print_exc(); return jsonify({"error":str(e)}),500

if __name__=="__main__":
    port=int(os.environ.get("PORT",5199))
    print(f"[SolicitationQuoter] Running on http://localhost:{port}")
    app.run(host="127.0.0.1",port=port,debug=False)
