"""
SEC-02 tests: Magic byte validation for uploaded files.
"""
import sys
import os
import io

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'python'))

import pytest


@pytest.fixture
def client():
    import server
    server.app.config['TESTING'] = True
    with server.app.test_client() as c:
        yield c


def _post_file(client, data, filename, content_type='application/octet-stream'):
    """Helper to POST a file to /parse."""
    return client.post(
        '/parse',
        data={'file': (io.BytesIO(data), filename)},
        content_type='multipart/form-data'
    )


def test_magic_bytes_reject_exe(client):
    """MZ-header bytes (EXE) uploaded as .pdf must return 400."""
    exe_bytes = b'MZ' + b'\x00' * 510
    resp = _post_file(client, exe_bytes, 'malware.pdf')
    assert resp.status_code == 400, \
        f"Expected 400 for MZ-header .pdf, got {resp.status_code}"


def test_valid_pdf_accepted(client):
    """A file with %PDF header must NOT be rejected by magic byte validation."""
    import json as _json
    pdf_bytes = b'%PDF-1.4 fake content here'
    resp = _post_file(client, pdf_bytes, 'test.pdf')
    # If rejected, it should NOT be for the magic byte reason
    if resp.status_code == 400:
        body = _json.loads(resp.data)
        assert "Unsupported file type" not in body.get("error", ""), \
            f"Valid PDF magic bytes incorrectly rejected with 'Unsupported file type': {body}"


def test_valid_docx_accepted(client):
    """A file with PK header must NOT be rejected by magic byte validation."""
    import json as _json
    # PK zip header — what DOCX files start with
    pk_bytes = b'PK\x03\x04' + b'\x00' * 508
    resp = _post_file(client, pk_bytes, 'test.docx')
    if resp.status_code == 400:
        body = _json.loads(resp.data)
        assert "Unsupported file type" not in body.get("error", ""), \
            f"Valid DOCX magic bytes incorrectly rejected with 'Unsupported file type': {body}"


def test_binary_txt_rejected(client):
    """Binary (non-UTF-8) bytes uploaded as .txt must return 400."""
    binary_bytes = b'\x80\x81\x82\x83\x84\x85\x86\x87\x88\x89\x8a\x8b\x8c\x8d\x8e\x8f'
    resp = _post_file(client, binary_bytes, 'badfile.txt')
    assert resp.status_code == 400, \
        f"Expected 400 for binary .txt, got {resp.status_code}"


def test_unsupported_extension_rejected(client):
    """File with unsupported extension must return 400."""
    resp = _post_file(client, b'any content', 'program.exe')
    assert resp.status_code == 400, \
        f"Expected 400 for .exe extension, got {resp.status_code}"


def test_png_file_rejected(client):
    """PNG file (magic bytes 0x89 PNG) must be rejected with 400."""
    import json as _json
    # Real PNG magic bytes
    png_bytes = b'\x89PNG\r\n\x1a\n' + b'\x00' * 504
    resp = _post_file(client, png_bytes, 'photo.png')
    assert resp.status_code == 400, \
        f"Expected 400 for .png upload, got {resp.status_code}"
    body = _json.loads(resp.data)
    assert "Unsupported file type" in body.get("error", ""), \
        f"Expected 'Unsupported file type' error for .png, got: {body}"


def test_zip_file_rejected(client):
    """ZIP file (PK magic bytes) with .zip extension must be rejected with 400."""
    import json as _json
    # ZIP magic bytes — same as DOCX but with .zip extension
    zip_bytes = b'PK\x03\x04' + b'\x00' * 508
    resp = _post_file(client, zip_bytes, 'archive.zip')
    assert resp.status_code == 400, \
        f"Expected 400 for .zip upload, got {resp.status_code}"
    body = _json.loads(resp.data)
    assert "Unsupported file type" in body.get("error", ""), \
        f"Expected 'Unsupported file type' error for .zip, got: {body}"


def test_png_renamed_to_pdf_rejected(client):
    """PNG bytes renamed to .pdf must fail magic byte check and return 400."""
    import json as _json
    png_bytes = b'\x89PNG\r\n\x1a\n' + b'\x00' * 504
    resp = _post_file(client, png_bytes, 'renamed.pdf')
    assert resp.status_code == 400, \
        f"Expected 400 for PNG-bytes uploaded as .pdf, got {resp.status_code}"
    body = _json.loads(resp.data)
    assert "Unsupported file type" in body.get("error", ""), \
        f"Expected 'Unsupported file type' for PNG-as-PDF, got: {body}"
