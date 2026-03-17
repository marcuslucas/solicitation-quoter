"""
SEC-03 tests: 50MB upload size limit.
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
    # Temporarily lower the size limit to 100 bytes so the test doesn't need
    # to allocate 51 MB of memory just to trigger the limit.
    original_limit = server.app.config.get('MAX_CONTENT_LENGTH')
    server.app.config['MAX_CONTENT_LENGTH'] = 100  # 100 bytes for test
    with server.app.test_client() as c:
        yield c
    # Restore
    server.app.config['MAX_CONTENT_LENGTH'] = original_limit


def test_oversized_file_rejected(client):
    """A request exceeding MAX_CONTENT_LENGTH must return 413.

    Flask enforces MAX_CONTENT_LENGTH at the WSGI layer and returns 413 before
    the route function is called. validate_upload() provides the same check for
    chunked transfers where Content-Length may be absent.
    """
    # With MAX_CONTENT_LENGTH=100 bytes, a realistic multipart body (several
    # hundred bytes) will always exceed the limit.
    resp = client.post(
        '/parse',
        data={'file': (io.BytesIO(b'%PDF-1.4 this is a normal sized document'), 'test.pdf')},
        content_type='multipart/form-data'
    )
    assert resp.status_code == 413, \
        f"Expected 413 for oversized upload, got {resp.status_code}"
