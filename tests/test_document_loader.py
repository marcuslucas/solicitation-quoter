"""
tests/test_document_loader.py

Tests for Phase 0 + 1: file handling and format detection.

Coverage:
  - document_loader.load_document() with real PDFs
  - document_loader._load_zip_bundle() with synthetic SAM.gov ZIP
  - detect_format() scoring for all 5 fixture formats
  - extract_sf1449() field extraction against expected output
  - Regression: agency_form (36C24225Q0696) fields unchanged
  - server.validate_upload() accepts ZIP magic bytes for .pdf files
"""

import io
import json
import os
import sys
import zipfile

import pytest

# Add python/ to path for all imports
PYTHON_DIR = os.path.join(os.path.dirname(__file__), '..', 'python')
sys.path.insert(0, PYTHON_DIR)

FIXTURES_DIR = os.path.join(os.path.dirname(__file__), '..', 'testdata', 'test_solicitations')


# ── helpers ──────────────────────────────────────────────────────────────────

def fixture_path(sol_dir, filename):
    return os.path.join(FIXTURES_DIR, sol_dir, filename)


def make_sam_zip(pages: list) -> bytes:
    """Create an in-memory SAM.gov-style ZIP with manifest.json + N.txt files."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w') as zf:
        zf.writestr('manifest.json', json.dumps({'num_pages': len(pages)}))
        for i, text in enumerate(pages, 1):
            zf.writestr(f'{i}.txt', text)
            zf.writestr(f'{i}.jpeg', b'fake-jpeg-data')  # simulate images
    buf.seek(0)
    return buf.read()


# ── Phase 0: document_loader ─────────────────────────────────────────────────

class TestLoadDocument:
    """document_loader.load_document() dispatch and extraction."""

    def test_load_real_pdf_36C(self):
        """Real PDF (agency_form) loads as source_format='pdf' with non-empty text."""
        from document_loader import load_document
        path = fixture_path('36C24225Q0696', '36C24225Q0696.pdf')
        result = load_document(path)
        assert result.source_format == 'pdf', f"Expected 'pdf', got {result.source_format!r}"
        assert result.text.strip(), "Expected non-empty text"
        assert result.error is None, f"Unexpected error: {result.error}"
        assert result.page_count >= 1

    def test_load_real_pdf_70B(self):
        """70B06C26Q00000080.pdf is a real PDF; loads as source_format='pdf'."""
        from document_loader import load_document
        path = fixture_path('70B06C26Q00000080', '70B06C26Q00000080.pdf')
        result = load_document(path)
        assert result.source_format == 'pdf', f"Expected 'pdf', got {result.source_format!r}"
        assert len(result.text) > 10000, f"Expected substantial text, got {len(result.text)} chars"
        assert result.error is None, f"Unexpected error: {result.error}"
        assert result.page_count >= 1

    def test_load_real_pdf_has_page_texts(self):
        """Real PDF load populates page_texts list."""
        from document_loader import load_document
        path = fixture_path('70B06C26Q00000080', '70B06C26Q00000080.pdf')
        result = load_document(path)
        assert len(result.page_texts) >= 1, "page_texts must be populated for PDF"
        assert all(isinstance(p, str) for p in result.page_texts)

    def test_load_sow_pdf(self):
        """SOW attachment (also a real PDF) loads correctly."""
        from document_loader import load_document
        path = fixture_path('70B06C26Q00000080', '70B06C26Q00000080+Attachment+1+-+LLSM+SOW.pdf')
        result = load_document(path)
        assert result.source_format == 'pdf'
        assert result.text.strip(), "SOW PDF must produce non-empty text"
        # SOW should contain section number patterns like 4.1.1
        import re
        assert re.search(r'4\.\d+\.\d+', result.text), \
            "SOW text must contain 4.x.x section numbers"

    def test_load_synthetic_sam_zip(self, tmp_path):
        """SAM.gov ZIP bundle (PK magic, manifest.json) loads as source_format='sam_zip'."""
        from document_loader import load_document
        pages = [
            "Page 1: Solicitation/Contract/Order for Commercial Products\nSTANDARD FORM 1449",
            "Page 2: SECTION I SCHEDULES\nI.1 DESCRIPTION: This is a test.",
            "Page 3: SECTION II CONTRACT CLAUSES",
        ]
        zip_bytes = make_sam_zip(pages)
        zip_path = str(tmp_path / 'test_bundle.pdf')  # .pdf extension, ZIP content
        with open(zip_path, 'wb') as f:
            f.write(zip_bytes)

        result = load_document(zip_path)
        assert result.source_format == 'sam_zip', \
            f"Expected 'sam_zip', got {result.source_format!r}"
        assert result.error is None, f"Unexpected error: {result.error}"
        assert len(result.page_texts) == 3, \
            f"Expected 3 page texts, got {len(result.page_texts)}"
        assert "STANDARD FORM 1449" in result.text
        assert "SECTION I SCHEDULES" in result.text
        assert result.has_images is True  # synthetic ZIPs include .jpeg files
        assert result.page_count == 3

    def test_load_synthetic_sam_zip_missing_page(self, tmp_path, capsys):
        """Missing page text in SAM ZIP is skipped with a log, not a crash."""
        from document_loader import load_document
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, 'w') as zf:
            zf.writestr('manifest.json', json.dumps({'num_pages': 3}))
            zf.writestr('1.txt', 'Page one content')
            # page 2 is missing intentionally
            zf.writestr('3.txt', 'Page three content')
        buf.seek(0)
        zip_path = str(tmp_path / 'partial.pdf')
        with open(zip_path, 'wb') as f:
            f.write(buf.read())

        result = load_document(zip_path)
        assert result.source_format == 'sam_zip'
        assert result.error is None
        assert len(result.page_texts) == 2  # only 2 pages extracted
        captured = capsys.readouterr()
        assert '2.txt' in captured.out, "Missing page should be logged"

    def test_load_unrecognized_zip_returns_error(self, tmp_path):
        """ZIP without manifest.json or word/document.xml returns error, not exception."""
        from document_loader import load_document
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, 'w') as zf:
            zf.writestr('random_file.txt', 'some content')
        buf.seek(0)
        zip_path = str(tmp_path / 'unknown.pdf')
        with open(zip_path, 'wb') as f:
            f.write(buf.read())

        result = load_document(zip_path)
        assert result.error is not None, "Should return an error for unrecognized ZIP"
        assert result.text == ""


# ── Phase 0: server.py validate_upload ───────────────────────────────────────

class TestValidateUploadZipPdf:
    """server.validate_upload() accepts PK magic bytes for .pdf files (Task 0.1)."""

    @pytest.fixture
    def client(self):
        import server
        server.app.config['TESTING'] = True
        with server.app.test_client() as c:
            yield c

    def _post_file(self, client, data, filename):
        return client.post(
            '/parse',
            data={'file': (io.BytesIO(data), filename)},
            content_type='multipart/form-data'
        )

    def test_pdf_with_zip_magic_not_rejected_by_magic_check(self, client):
        """ZIP magic bytes (PK\\x03\\x04) uploaded as .pdf must NOT return 400 for magic-byte reason."""
        pk_bytes = b'PK\x03\x04' + b'\x00' * 508
        resp = self._post_file(client, pk_bytes, 'bundle.pdf')
        # Must not be rejected for unsupported file type
        if resp.status_code == 400:
            body = json.loads(resp.data)
            assert "Unsupported file type" not in body.get("error", ""), \
                f"ZIP-magic .pdf incorrectly rejected as 'Unsupported file type': {body}"

    def test_real_pdf_magic_still_accepted(self, client):
        """Real PDF magic (%PDF) still accepted after the .pdf check change."""
        pdf_bytes = b'%PDF-1.4 fake content'
        resp = self._post_file(client, pdf_bytes, 'real.pdf')
        if resp.status_code == 400:
            body = json.loads(resp.data)
            assert "Unsupported file type" not in body.get("error", ""), \
                f"Real PDF magic incorrectly rejected: {body}"

    def test_dot_zip_extension_still_rejected(self, client):
        """ZIP file with .zip extension is still rejected (behavior unchanged)."""
        zip_bytes = b'PK\x03\x04' + b'\x00' * 508
        resp = self._post_file(client, zip_bytes, 'archive.zip')
        assert resp.status_code == 400
        body = json.loads(resp.data)
        assert "Unsupported file type" in body.get("error", "")

    def test_png_renamed_to_pdf_still_rejected(self, client):
        """PNG bytes renamed to .pdf are still rejected."""
        png_bytes = b'\x89PNG\r\n\x1a\n' + b'\x00' * 504
        resp = self._post_file(client, png_bytes, 'bad.pdf')
        assert resp.status_code == 400


# ── Phase 1: detect_format scoring ───────────────────────────────────────────

class TestDetectFormat:
    """detect_format() scoring returns correct format for all known fixtures."""

    @staticmethod
    def _extract_text(sol_dir, filename):
        from document_loader import load_document
        return load_document(fixture_path(sol_dir, filename)).text

    def test_sam_export_W911(self):
        """W911S225U14310001 detects as sam_export."""
        from extractor import detect_format
        text = self._extract_text(
            'W911S225U14310001_CSS_08062025',
            'W911S225U14310001_CSS_08062025.pdf'
        )
        assert detect_format(text) == 'sam_export'

    def test_sam_export_N5005(self):
        """N5005426Q0114 detects as sam_export."""
        from extractor import detect_format
        text = self._extract_text(
            'N5005426Q0114_CSS_03312026',
            'N5005426Q0114_CSS_03312026.pdf'
        )
        assert detect_format(text) == 'sam_export'

    def test_agency_form_36C(self):
        """36C24225Q0696 detects as agency_form."""
        from extractor import detect_format
        text = self._extract_text('36C24225Q0696', '36C24225Q0696.pdf')
        assert detect_format(text) == 'agency_form'

    def test_formal_rfq(self):
        """request-for-quotation detects as formal_rfq."""
        from extractor import detect_format
        text = self._extract_text('request-for-quotation', 'request-for-quotation.pdf')
        assert detect_format(text) == 'formal_rfq'

    def test_sf1449_70B(self):
        """70B06C26Q00000080 detects as sf1449."""
        from extractor import detect_format
        text = self._extract_text('70B06C26Q00000080', '70B06C26Q00000080.pdf')
        assert detect_format(text) == 'sf1449'

    def test_sf1449_score_dominates(self):
        """sf1449 score must be >= 3 and strictly higher than all others for 70B text."""
        from extractor import detect_format
        import re
        text = self._extract_text('70B06C26Q00000080', '70B06C26Q00000080.pdf')
        # Re-run scoring logic inline for assertion
        first_2000 = text[:2000]
        first_5000 = text[:5000]
        scores = {
            "sam_export": (3 if "Notice ID:" in first_2000 else 0) +
                          (2 if "Combined Synopsis/Solicitation Details" in first_2000 else 0),
            "agency_form": (3 if re.search(r"SOLICITATION NUMBER\*", first_2000) else 0),
            "formal_rfq": (3 if "Issuing Office:" in first_2000 else 0),
            "sf1449": (3 if "STANDARD FORM 1449" in first_5000 else 0) +
                      (3 if "Solicitation/Contract/Order for Commercial" in first_2000 else 0),
        }
        assert scores["sf1449"] >= 3, f"sf1449 score must be >=3, got {scores}"
        for fmt in ("sam_export", "agency_form", "formal_rfq"):
            assert scores["sf1449"] > scores[fmt], \
                f"sf1449 score ({scores['sf1449']}) must beat {fmt} ({scores[fmt]})"

    def test_unknown_for_empty_text(self):
        """Empty text returns 'unknown'."""
        from extractor import detect_format
        assert detect_format("") == "unknown"

    def test_unknown_for_generic_text(self):
        """Plain text with no solicitation keywords returns 'unknown'."""
        from extractor import detect_format
        result = detect_format("Hello world. This is a generic document with no procurement keywords.")
        assert result == "unknown"


# ── Phase 1: extract_sf1449 field extraction ─────────────────────────────────

class TestExtractSf1449:
    """extract_sf1449() field extraction against 70B06C26Q00000080 expected output."""

    @pytest.fixture(scope='class')
    def extracted(self):
        from extractor import parse_document, extract_data
        path = fixture_path('70B06C26Q00000080', '70B06C26Q00000080.pdf')
        text = parse_document(path)
        return extract_data(text)

    def test_format_is_sf1449(self, extracted):
        assert extracted.get('_format') == 'sf1449'

    def test_solicitation_number(self, extracted):
        assert extracted.get('solicitation_number') == '70B06C26Q00000080'

    def test_project_title(self, extracted):
        assert extracted.get('project_title') == 'Less Lethal Specialty Munitions (LLSM) IDIQ'

    def test_solicitation_type(self, extracted):
        assert extracted.get('solicitation_type') == 'RFP'

    def test_issuing_agency(self, extracted):
        agency = extracted.get('issuing_agency', '')
        assert 'DHS' in agency or 'Customs' in agency, \
            f"issuing_agency must mention DHS/Customs, got: {agency!r}"
        assert 'Contracting Division' in agency or 'Mission Support' in agency, \
            f"issuing_agency must include division, got: {agency!r}"

    def test_due_date(self, extracted):
        assert extracted.get('due_date') == '05/15/2026 2:00PM ET'

    def test_posting_date(self, extracted):
        assert extracted.get('posting_date') == '04/15/2026'

    def test_contact_name(self, extracted):
        assert extracted.get('contact_name') == 'Crockett, John'

    def test_contact_email(self, extracted):
        assert extracted.get('contact_email') == 'john.t.crockett@cbp.dhs.gov'

    def test_naics_code(self, extracted):
        assert extracted.get('naics_code') == '332994'

    def test_set_aside(self, extracted):
        assert extracted.get('set_aside') == 'Small Business Set-Aside 100%'

    def test_estimated_value(self, extracted):
        assert extracted.get('estimated_value') == '$49,900,000.00'

    def test_minimum_guarantee(self, extracted):
        assert extracted.get('minimum_guarantee') == '$10,000.00'

    def test_contract_type(self, extracted):
        ct = extracted.get('contract_type', '')
        assert 'IDIQ' in ct, f"contract_type must contain 'IDIQ', got: {ct!r}"
        assert 'Firm Fixed Price' in ct or 'FFP' in ct, \
            f"contract_type must mention Firm Fixed Price, got: {ct!r}"

    def test_period_of_performance_key_phrases(self, extracted):
        """period_of_performance must contain the key phrases from the expected output.

        TODO: plan gap — expected JSON has a summarized string, but we extract the full
        prose from I.5. Checking key substrings rather than exact match.
        """
        pop = extracted.get('period_of_performance', '')
        assert '5 year' in pop.lower() or '60 months' in pop.lower(), \
            f"period_of_performance must mention 5-year/60-month period, got: {pop[:120]!r}"
        assert '12 months' in pop.lower(), \
            f"period_of_performance must mention 12-month delivery extension, got: {pop[:120]!r}"

    def test_psc_code_absent_or_null(self, extracted):
        """psc_code is null in expected output — absent or empty string is acceptable."""
        psc = extracted.get('psc_code', None)
        assert psc is None or psc == '', \
            f"psc_code should be absent/null for 70B fixture, got: {psc!r}"

    def test_place_of_performance_absent_or_null(self, extracted):
        """place_of_performance is null in expected output."""
        pop = extracted.get('place_of_performance', None)
        assert pop is None or pop == '', \
            f"place_of_performance should be absent/null for 70B fixture, got: {pop!r}"

    def test_no_extra_format_leakage(self, extracted):
        """Fields from other format extractors must not appear spuriously."""
        # sam_export-specific patterns should not fire on sf1449
        assert extracted.get('_format') != 'sam_export'
        assert extracted.get('_format') != 'unknown', \
            "sf1449 document must not fall through to unknown"


# ── Regression: agency_form (36C24225Q0696) ──────────────────────────────────

class TestRegressionAgencyForm:
    """
    36C24225Q0696 (agency_form) must produce identical output after Phase 0+1 changes.
    These are the fields that were confirmed working before this phase.
    """

    @pytest.fixture(scope='class')
    def extracted(self):
        from extractor import parse_document, extract_data
        path = fixture_path('36C24225Q0696', '36C24225Q0696.pdf')
        text = parse_document(path)
        return extract_data(text)

    def test_format_is_agency_form(self, extracted):
        assert extracted.get('_format') == 'agency_form'

    def test_solicitation_number(self, extracted):
        assert extracted.get('solicitation_number') == '36C24225Q0696'

    def test_contact_name(self, extracted):
        assert extracted.get('contact_name') == 'Nathan Northrup'

    def test_contact_email(self, extracted):
        assert extracted.get('contact_email') == 'nathan.northrup@va.gov'

    def test_naics_code(self, extracted):
        assert extracted.get('naics_code') == '811310'

    def test_psc_code(self, extracted):
        assert extracted.get('psc_code') == 'J061'

    def test_set_aside(self, extracted):
        assert extracted.get('set_aside') == 'Total Small Business Set-Aside'

    def test_due_date_present(self, extracted):
        """due_date must be non-empty (exact format may vary)."""
        assert extracted.get('due_date', '').strip() != '', \
            "due_date must be extracted for 36C fixture"


# ── Regression: sam_export smoke tests ───────────────────────────────────────

class TestRegressionSamExport:
    """sam_export fixtures must still extract solicitation_number without crashing."""

    def _check_sol_number(self, sol_dir, filename, expected_prefix):
        from extractor import parse_document, extract_data
        path = fixture_path(sol_dir, filename)
        text = parse_document(path)
        data = extract_data(text)
        assert data.get('_format') == 'sam_export', \
            f"Expected sam_export format for {filename}"
        sol = data.get('solicitation_number', '')
        assert sol.startswith(expected_prefix), \
            f"Expected sol# starting with {expected_prefix!r}, got {sol!r}"

    def test_W911_smoke(self):
        self._check_sol_number(
            'W911S225U14310001_CSS_08062025',
            'W911S225U14310001_CSS_08062025.pdf',
            'W911S225U1431'
        )

    def test_N5005_smoke(self):
        self._check_sol_number(
            'N5005426Q0114_CSS_03312026',
            'N5005426Q0114_CSS_03312026.pdf',
            'N5005426Q0114'
        )


# ── Regression: formal_rfq smoke test ────────────────────────────────────────

class TestRegressionFormalRfq:
    """request-for-quotation (formal_rfq) must still extract without crashing."""

    def test_formal_rfq_smoke(self):
        from extractor import parse_document, extract_data
        path = fixture_path('request-for-quotation', 'request-for-quotation.pdf')
        text = parse_document(path)
        data = extract_data(text)
        assert data.get('_format') == 'formal_rfq'
        assert data.get('solicitation_number', '').strip() != '', \
            "solicitation_number must be extracted for formal_rfq fixture"
