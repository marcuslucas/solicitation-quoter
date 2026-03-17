"""
SEC-04 tests: Temp file tracking infrastructure.
"""
import sys
import os
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'python'))

import server


def test_tmp_tracking():
    """server._active_tmp_files must be a set."""
    assert isinstance(server._active_tmp_files, set), \
        f"server._active_tmp_files is not a set: {type(server._active_tmp_files)}"


def test_atexit_cleanup():
    """_cleanup_active_tmp_files() must remove registered files from disk and the set."""
    # Create a real temp file and register it
    tmp = tempfile.NamedTemporaryFile(prefix='sqt_', delete=False, suffix='.txt')
    tmp_path = tmp.name
    tmp.write(b'test content')
    tmp.close()

    # Register in the tracking set
    server._active_tmp_files.add(tmp_path)
    assert os.path.exists(tmp_path), "Temp file should exist before cleanup"
    assert tmp_path in server._active_tmp_files, "Temp file should be in tracking set"

    # Run the cleanup handler
    server._cleanup_active_tmp_files()

    # File should be gone
    assert not os.path.exists(tmp_path), \
        f"Temp file still exists after _cleanup_active_tmp_files(): {tmp_path}"
    assert tmp_path not in server._active_tmp_files, \
        "Temp file still in _active_tmp_files after cleanup"
