#!/usr/bin/env python3
import os, sys, json, re, tempfile, traceback, io, atexit, glob, time
from pathlib import Path
from flask import Flask, request, jsonify, send_file

from constants import MAX_UPLOAD_BYTES, PORT, TMP_PREFIX
from extractor import parse_document, extract_data, extract, extract_line_items
from generator import generate_quote

app = Flask(__name__)

# Flask enforces MAX_CONTENT_LENGTH at the WSGI layer and raises a 413 before
# the route function runs — belt-and-suspenders alongside validate_upload().
app.config['MAX_CONTENT_LENGTH'] = MAX_UPLOAD_BYTES

# Module-level set tracking temp files created by the current process.
# Populated per-request in parse_route(); cleared in the finally block.
# The atexit handler below ensures cleanup on unexpected exit.
_active_tmp_files = set()


def _cleanup_active_tmp_files():
    """atexit handler — delete any temp files still registered (handles crash/SIGTERM)."""
    for path in list(_active_tmp_files):
        try:
            if os.path.exists(path):
                os.unlink(path)
                _active_tmp_files.discard(path)
        except Exception:
            pass


atexit.register(_cleanup_active_tmp_files)


def validate_upload(file):
    """Validate upload size and magic bytes.

    Returns (error_message, status_code) on failure, or (None, None) if valid.
    Seeks the file stream back to position 0 after reading so file.save() works.
    """
    # Size check — content_length may be None for chunked transfers
    content_len = request.content_length
    if content_len is not None and content_len > MAX_UPLOAD_BYTES:
        return "File too large — maximum 50 MB", 413

    # Magic bytes — read without saving, then seek back to 0
    header = file.stream.read(512)
    file.stream.seek(0)  # CRITICAL: reset before file.save()

    fname = (file.filename or '').lower()
    if fname.endswith('.pdf'):
        if header[:4] != b'%PDF':
            return "Unsupported file type — only PDF, DOCX, and TXT are accepted", 400
    elif fname.endswith('.docx') or fname.endswith('.doc'):
        if header[:2] != b'PK':
            return "Unsupported file type — only PDF, DOCX, and TXT are accepted", 400
    elif fname.endswith('.txt'):
        try:
            header.decode('utf-8')
        except UnicodeDecodeError:
            return "Unsupported file type — only PDF, DOCX, and TXT are accepted", 400
    else:
        return "Unsupported file type — only PDF, DOCX, and TXT are accepted", 400

    return None, None


def _startup_sweep():
    """Delete stale app temp files from prior sessions (older than 1 hour)."""
    tmp_dir = tempfile.gettempdir()
    cutoff = time.time() - 3600
    patterns = ['sqt_*.pdf', 'sqt_*.docx', 'sqt_*.doc', 'sqt_*.txt']
    removed = 0
    for pattern in patterns:
        for f in glob.glob(os.path.join(tmp_dir, pattern)):
            try:
                if os.path.getmtime(f) < cutoff:
                    os.unlink(f)
                    removed += 1
            except Exception:
                pass
    if removed:
        print(f"[startup] Removed {removed} stale temp file(s)", flush=True)


@app.errorhandler(413)
def handle_request_entity_too_large(e):
    return jsonify({"error": "File too large — maximum 50 MB"}), 413


@app.after_request
def cors(r):
    # Allow requests from the Electron renderer (loaded from file://, which sends
    # Origin: null) and from any localhost:5199 page during development.
    origin = request.headers.get("Origin", "")
    if origin in ("http://127.0.0.1:5199", "null", "") or origin.startswith("file://"):
        r.headers["Access-Control-Allow-Origin"] = origin if origin else "http://127.0.0.1:5199"
    else:
        r.headers["Access-Control-Allow-Origin"] = "http://127.0.0.1:5199"
    r.headers["Access-Control-Allow-Headers"] = "Content-Type"
    r.headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS"
    return r

@app.route("/ping")
def ping():
    return jsonify({"status": "ok"})

# ── ROUTES ───────────────────────────────────────────────────────────────────

@app.route("/parse", methods=["POST","OPTIONS"])
def parse_route():
    if request.method=="OPTIONS": return jsonify({}),200
    tmp_path = None
    try:
        if "file" not in request.files:
            return jsonify({"error":"No file uploaded"}),400
        file=request.files["file"]
        # Validate size and magic bytes BEFORE saving to disk
        error_msg, status_code = validate_upload(file)
        if error_msg:
            return jsonify({"error": error_msg}), status_code
        suffix=Path(file.filename).suffix
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix, prefix=TMP_PREFIX) as tmp:
            tmp_path=tmp.name
        file.save(tmp_path)
        _active_tmp_files.add(tmp_path)
        text=parse_document(tmp_path)
        if not text.strip():
            return jsonify({"error":"Could not extract text from document."}),400
        data=extract_data(text)
        return jsonify({"success":True,"data":data})
    except Exception as e:
        from werkzeug.exceptions import RequestEntityTooLarge
        if isinstance(e, RequestEntityTooLarge):
            return jsonify({"error": "File too large — maximum 50 MB"}), 413
        traceback.print_exc(); return jsonify({"error":str(e)}),500
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except Exception:
                pass
        if tmp_path:
            _active_tmp_files.discard(tmp_path)

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

@app.route("/sam_lookup", methods=["POST","OPTIONS"])
def sam_lookup():
    if request.method=="OPTIONS": return jsonify({}),200
    try:
        body=request.get_json()
        notice_id=body.get("notice_id","").strip()
        api_key=body.get("api_key","").strip()
        if not notice_id: return jsonify({"error":"Notice ID is required"}),400
        if not api_key:   return jsonify({"error":"SAM.gov API key is required"}),400

        from datetime import datetime,timedelta
        import urllib.request as _ur, urllib.parse as _up
        today=datetime.now(); ago=today-timedelta(days=365)
        params=_up.urlencode({"api_key":api_key,"noticeid":notice_id,
                               "postedFrom":ago.strftime("%m/%d/%Y"),
                               "postedTo":today.strftime("%m/%d/%Y"),"limit":1})
        url=f"https://api.sam.gov/opportunities/v2/search?{params}"
        req=_ur.Request(url,headers={"Accept":"application/json","User-Agent":"SolicitationQuoter/1.0"})
        with _ur.urlopen(req,timeout=15) as resp:
            data=json.loads(resp.read())

        opps=data.get("opportunitiesData",[])
        if not opps: return jsonify({"error":f"No opportunity found for: {notice_id}"}),404
        opp=opps[0]

        desc_raw=opp.get("description","")
        desc=re.sub(r"\s+"," ",re.sub(r"<[^>]+>"," ",desc_raw)).strip()

        solicitation={
            "solicitation_number": opp.get("solicitationNumber") or opp.get("noticeId",""),
            "project_title":       opp.get("title",""),
            "solicitation_type":   opp.get("type",""),
            "issuing_agency":      opp.get("fullParentPathName",""),
            "due_date":            opp.get("responseDeadLine",""),
            "posting_date":        opp.get("postedDate",""),
            "naics_code":          opp.get("naicsCode",""),
            "psc_code":            opp.get("classificationCode",""),
            "set_aside":           opp.get("typeOfSetAsideDescription") or opp.get("typeOfSetAside",""),
            "scope_of_work":       desc[:3000],
        }
        pop=opp.get("placeOfPerformance",{})
        if pop:
            city=pop.get("city",{}).get("name",""); state=pop.get("state",{}).get("code","")
            if city or state: solicitation["place_of_performance"]=f"{city}, {state}".strip(", ")
        contacts=opp.get("pointOfContact",[])
        if contacts:
            c=contacts[0]
            solicitation["contact_name"]=c.get("fullName","")
            solicitation["contact_email"]=c.get("email","")
            solicitation["contact_phone"]=c.get("phone","")
        office=opp.get("officeAddress",{})
        if office:
            solicitation["contracting_office_address"]=" ".join(
                filter(None,[office.get("city",""),office.get("state",""),office.get("zipcode","")]))

        solicitation["_method"]="sam_gov"
        # Also run rule-based extraction on desc for quantities
        rules=extract(desc)
        for k,v in rules.items():
            if v and k not in solicitation: solicitation[k]=v

        line_items=extract_line_items(solicitation, desc)
        return jsonify({"success":True,"data":solicitation,"line_items":line_items})

    except Exception as e:
        import urllib.error
        if isinstance(e, urllib.error.HTTPError):
            if e.code == 403:
                return jsonify({"error": "Invalid or expired SAM.gov API key."}), 400
            return jsonify({"error": f"SAM.gov returned an error (HTTP {e.code}). Try again later."}), 502
        if isinstance(e, urllib.error.URLError):
            if 'timed out' in str(e).lower() or isinstance(getattr(e, 'reason', None), Exception) and 'timed out' in str(e.reason).lower():
                return jsonify({"error": "SAM.gov did not respond in time. Check your connection and try again."}), 504
            return jsonify({"error": f"Could not reach SAM.gov. Check your internet connection."}), 503
        if isinstance(e, (ValueError, KeyError)):
            return jsonify({"error": "SAM.gov returned an unexpected response. Try again later."}), 502
        traceback.print_exc(); return jsonify({"error": str(e)}), 500

if __name__=="__main__":
    _startup_sweep()
    port=int(os.environ.get("PORT", PORT))
    print(f"[SolicitationQuoter] Running on http://localhost:{port}")
    app.run(host="127.0.0.1",port=port,debug=False)
