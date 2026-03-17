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
    with server.app.test_client() as c:
        yield c


def test_oversized_file_rejected(client):
    """A request with Content-Length > 50MB must return 413."""
    # We set content_length header directly; actual data can be small
    # because validate_upload checks request.content_length before reading
    oversized = 51 * 1024 * 1024  # 51 MB
    resp = client.post(
        '/parse',
        data={'file': (io.BytesIO(b'%PDF fake'), 'test.pdf')},
        content_type='multipart/form-data',
        headers={'Content-Length': str(oversized)}
    )
    assert resp.status_code == 413, \
        f"Expected 413 for oversized upload, got {resp.status_code}"
