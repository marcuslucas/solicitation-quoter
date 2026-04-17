#!/usr/bin/env python3
import os, sys, json, re, tempfile, traceback, io, atexit, glob, time, threading, concurrent.futures
import shutil, datetime
from pathlib import Path
from flask import Flask, request, jsonify, send_file

from constants import MAX_UPLOAD_BYTES, PORT, TMP_PREFIX
from extractor import parse_document, extract_data, extract, extract_line_items, SCOPE_MAX, parse_solicitation_bundle, classify_document
from document_loader import load_document
from generator import generate_quote
from validator import validate_fields


def get_session_dir() -> Path:
    d = Path.home() / ".sol-quoter" / "session" / "current"
    d.mkdir(parents=True, exist_ok=True)
    return d


def clear_session_dir():
    d = Path.home() / ".sol-quoter" / "session" / "current"
    if d.exists():
        shutil.rmtree(d)
    d.mkdir(parents=True, exist_ok=True)

_PORT = int(os.environ.get("PORT", PORT))
_ALLOWED_ORIGIN = f"http://127.0.0.1:{_PORT}"

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
        # Accept both real PDFs (%PDF) and SAM.gov ZIP bundles (PK) delivered with .pdf extension
        if header[:4] not in (b'%PDF', b'PK\x03\x04'):
            return "Unsupported file type — only PDF, DOCX, TXT, and XLSX are accepted", 400
    elif fname.endswith('.docx') or fname.endswith('.doc'):
        if header[:2] != b'PK':
            return "Unsupported file type — only PDF, DOCX, TXT, and XLSX are accepted", 400
    elif fname.endswith(('.xlsx', '.xls')):
        if header[:2] != b'PK':
            return "Unsupported file type — only PDF, DOCX, TXT, and XLSX are accepted", 400
    elif fname.endswith('.txt'):
        try:
            header.decode('utf-8')
        except UnicodeDecodeError:
            return "Unsupported file type — only PDF, DOCX, TXT, and XLSX are accepted", 400
    else:
        return "Unsupported file type — only PDF, DOCX, TXT, and XLSX are accepted", 400

    return None, None


def _startup_sweep():
    """Delete stale app temp files from prior sessions (older than 1 hour)."""
    tmp_dir = tempfile.gettempdir()
    cutoff = time.time() - 3600
    patterns = ['sqt_*.pdf', 'sqt_*.docx', 'sqt_*.doc', 'sqt_*.txt', 'sqt_*.xlsx', 'sqt_*.xls']
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


def _watch_parent(ppid: int):
    """Daemon thread: self-terminate if parent Electron process has exited."""
    import psutil
    while True:
        time.sleep(3)
        try:
            if not psutil.pid_exists(ppid):
                print("[SolicitationQuoter] Parent exited — shutting down", flush=True)
                os._exit(0)
        except Exception:
            pass  # psutil errors are non-fatal; keep polling


@app.errorhandler(413)
def handle_request_entity_too_large(e):
    return jsonify({"error": "File too large — maximum 50 MB"}), 413


@app.after_request
def cors(r):
    # Allow requests from the Electron renderer (loaded from file://, which sends
    # Origin: null) and from the configured localhost origin during development.
    origin = request.headers.get("Origin", "")
    if origin in (_ALLOWED_ORIGIN, "null", "") or origin.startswith("file://"):
        r.headers["Access-Control-Allow-Origin"] = origin if origin else _ALLOWED_ORIGIN
    else:
        r.headers["Access-Control-Allow-Origin"] = _ALLOWED_ORIGIN
    r.headers["Access-Control-Allow-Headers"] = "Content-Type"
    r.headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS"
    return r

@app.route("/ping")
def ping():
    return jsonify({"status": "ok"})


@app.route("/api/sol-quoter/session/clear", methods=["POST", "OPTIONS"])
def session_clear_route():
    if request.method == "OPTIONS":
        return jsonify({}), 200
    try:
        clear_session_dir()
        return jsonify({"status": "cleared"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ── ROUTES ───────────────────────────────────────────────────────────────────

@app.route("/parse", methods=["POST","OPTIONS"])
def parse_route():
    if request.method=="OPTIONS": return jsonify({}),200
    try:
        uploaded_files = request.files.getlist("file")
        if not uploaded_files:
            return jsonify({"error":"No file uploaded"}),400

        # Wipe previous session and save each file to the session directory
        clear_session_dir()
        session_dir = get_session_dir()

        saved_files = []
        bundle = []  # list of {path, filename}
        for file in uploaded_files:
            error_msg, status_code = validate_upload(file)
            if error_msg:
                return jsonify({"error": error_msg}), status_code
            dest = session_dir / Path(file.filename).name
            file.save(str(dest))
            saved_files.append({"path": str(dest), "filename": file.filename})
            bundle.append({"path": str(dest), "filename": file.filename})

        def _do_parse(files):
            return parse_solicitation_bundle(files)

        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
            fut = ex.submit(_do_parse, bundle)
            try:
                data = fut.result(timeout=30)
            except concurrent.futures.TimeoutError:
                return jsonify({
                    "error": "Parsing timed out after 30 seconds. The file may be too large or corrupted."
                }), 408

        if not data:
            return jsonify({"error":"Could not extract text from document."}),400

        # Determine source type from the first PDF in the bundle (for validation + bounding boxes)
        main_file = uploaded_files[0]
        source_type = Path(main_file.filename).suffix.lower().lstrip('.')
        if source_type in ('doc', 'docx'):
            source_type = 'docx'

        # Extract bounding boxes for the main PDF source (best-effort)
        bounding_boxes = {}
        main_tmp = bundle[0]["path"]
        if source_type == 'pdf':
            try:
                import pdfplumber
                with pdfplumber.open(main_tmp) as pdf:
                    for page_num, page in enumerate(pdf.pages, 1):
                        words = page.extract_words()
                        for field_name, field_value in data.items():
                            if field_name.startswith('_') or not isinstance(field_value, str) or not field_value:
                                continue
                            if field_name in bounding_boxes:
                                continue
                            search_text = field_value[:40].lower()
                            page_text = ' '.join(w['text'] for w in words).lower()
                            if search_text[:20] in page_text:
                                for w in words:
                                    if w['text'].lower() in search_text:
                                        bounding_boxes[field_name] = {
                                            'page': page_num,
                                            'x0': round(w['x0'], 1),
                                            'y0': round(w['top'], 1),
                                            'x1': round(w['x1'], 1),
                                            'y1': round(w['bottom'], 1)
                                        }
                                        break
            except Exception:
                pass  # bounding boxes are best-effort

        # Run confidence validation
        confidence = validate_fields(data, source_type)

        # Merge bounding boxes into confidence field entries
        for field_entry in confidence.get('fields', []):
            bb = bounding_boxes.get(field_entry['name'])
            if bb:
                field_entry['boundingBox'] = bb

        # Classify files and build session file map
        _session_files = {"main": None, "sow": None, "pricing": None}
        try:
            for f in saved_files:
                doc = load_document(f["path"])
                role = classify_document(doc.text, f["filename"])
                if role == "main":
                    _session_files["main"] = f["filename"]
                elif role == "sow":
                    _session_files["sow"] = f["filename"]
                elif role == "pricing":
                    _session_files["pricing"] = f["filename"]

            # Write manifest
            manifest = {
                "timestamp": datetime.datetime.utcnow().isoformat(),
                "solicitation_number": data.get("solicitation_number", ""),
                "files": _session_files
            }
            (session_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))
        except Exception as e:
            print(f"[session] Manifest write failed (non-fatal): {e}", flush=True)

        return jsonify({
            "success": True,
            "data": data,
            "overallConfidence": confidence["overallConfidence"],
            "fields": confidence["fields"],
            "flags": confidence["flags"],
            "_session_files": _session_files
        })
    except Exception as e:
        from werkzeug.exceptions import RequestEntityTooLarge
        if isinstance(e, RequestEntityTooLarge):
            return jsonify({"error": "File too large — maximum 50 MB"}), 413
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
            "solicitation_number": opp.get("solicitationNumber") or opp.get("noticeId") or "",
            "project_title":       opp.get("title") or "",
            "solicitation_type":   opp.get("type") or "",
            "issuing_agency":      opp.get("fullParentPathName") or "",
            "due_date":            opp.get("responseDeadLine") or "",
            "posting_date":        opp.get("postedDate") or "",
            "naics_code":          opp.get("naicsCode") or "",
            "psc_code":            opp.get("classificationCode") or "",
            "set_aside":           opp.get("typeOfSetAsideDescription") or opp.get("typeOfSetAside") or "",
            "scope_of_work":       desc[:SCOPE_MAX],
        }
        if len(desc) > SCOPE_MAX:
            solicitation["scope_truncated"] = True
            solicitation["scope_full"] = desc
        else:
            solicitation["scope_truncated"] = False
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
    ppid = int(os.environ.get("PARENT_PID", "0"))
    if ppid:
        threading.Thread(target=_watch_parent, args=(ppid,), daemon=True).start()
    port=int(os.environ.get("PORT", PORT))
    print(f"[SolicitationQuoter] Running on http://localhost:{port}")
    app.run(host="127.0.0.1",port=port,debug=False)
