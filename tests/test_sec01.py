"""
SEC-01 tests: api_key must NOT be read from request.form in parse_route().
ai_extract() must read the key from os.environ, not accept it as a parameter.
"""
import inspect
import sys
import os

# Add python/ to path so we can import server
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'python'))

import server


def test_parse_no_api_key_in_form():
    """parse_route source must not read api_key from request.form."""
    import inspect
    src = inspect.getsource(server.parse_route)
    assert 'request.form.get("api_key"' not in src, \
        "parse_route() still reads api_key from request.form (double-quote variant)"
    assert "request.form.get('api_key'" not in src, \
        "parse_route() still reads api_key from request.form (single-quote variant)"


def test_ai_extract_reads_env():
    """ai_extract() must not accept api_key as a parameter."""
    sig = inspect.signature(server.ai_extract)
    assert 'api_key' not in sig.parameters, \
        f"ai_extract() still has 'api_key' parameter: {list(sig.parameters.keys())}"
